/**
 * Idempotent import flow for the Revolut importer.
 *
 * Flow (verified 3.6.1 contract):
 * 1. Convert normalized drafts → complete `ActivityImport[]` (with required
 *    `isValid`/`isDraft`). `UNKNOWN` activity types are blocked (never sent).
 * 2. Call `activities.checkImport(ActivityImport[])` (read-only gate). Fatal
 *    host errors return to review and keep Import disabled.
 * 3. Build a duplicate index from `activities.getAll(accountId)`, filtering
 *    by this add-on's `importerId`.
 * 4. Partition accepted rows into new and legacy exact-duplicates.
 * 5. Submit the checked rows to Wealthfolio's import-specific workflow.
 * 6. Use the host import result for authoritative created/duplicate outcomes.
 */
import type { ActivityImport, HostAPI } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import { buildDuplicateIndex } from './duplicate-index';
import { toActivityImport } from './convert-activity';
import { getActivities, checkImport, importCheckedActivities } from './api';
import type { ImportFlowResult, PreparedDraft } from './types';
import { IMPORTER_ID } from './types';

/**
 * Prepare drafts: attach fingerprints, source row numbers, and resolved
 * assets.
 *
 * Revolut fingerprints are computed from the source row in the pure core
 * (see `src/duplicates/fingerprint.ts`), so the adapter receives them
 * alongside the drafts. This function enriches drafts with resolution.
 *
 * @param drafts Normalized pure-core drafts.
 * @param fingerprints Idempotency fingerprints, one per draft, in order.
 * @param sourceRowNumbers 1-based source row numbers, one per draft, in order.
 * @param resolveAsset Optional resolver for instrument mappings (see
 *   `symbol-mappings.ts`). When omitted, instrument drafts use their source
 *   ticker as the asset symbol (no exchange/provider enrichment).
 */
export async function prepareDrafts(
  drafts: ActivityDraft[],
  fingerprints: string[],
  sourceRowNumbers: number[],
  resolveAsset?: (
    draft: ActivityDraft,
  ) => Promise<import('@wealthfolio/addon-sdk').AssetResolutionInput | undefined>,
): Promise<PreparedDraft[]> {
  if (drafts.length !== fingerprints.length || drafts.length !== sourceRowNumbers.length) {
    throw new Error(
      `prepareDrafts: length mismatch (drafts=${drafts.length}, fingerprints=${fingerprints.length}, rows=${sourceRowNumbers.length})`,
    );
  }
  const prepared: PreparedDraft[] = [];
  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const fingerprint = fingerprints[i];
    const sourceRowNumber = sourceRowNumbers[i];
    const isCash = !draft.ticker || draft.ticker.length === 0;
    const asset = isCash ? undefined : ((await resolveAsset?.(draft)) ?? { symbol: draft.ticker });
    prepared.push({ draft, fingerprint, sourceRowNumber, asset });
  }
  return prepared;
}

/**
 * Run the full idempotent import flow.
 *
 * @param api Host API.
 * @param accountId Selected destination account id.
 * @param drafts Normalized pure-core drafts.
 * @param fingerprints Idempotency fingerprints, one per draft, in order.
 * @param sourceRowNumbers 1-based source row numbers, one per draft, in order.
 * @param resolveAsset Optional resolver for instrument mappings (see
 *   `symbol-mappings.ts`). When omitted, instrument drafts use their source
 *   ticker as the asset symbol (no exchange/provider enrichment).
 */
export async function runImport(
  api: HostAPI,
  accountId: string,
  drafts: ActivityDraft[],
  fingerprints: string[],
  sourceRowNumbers: number[],
  resolveAsset?: (
    draft: ActivityDraft,
  ) => Promise<import('@wealthfolio/addon-sdk').AssetResolutionInput | undefined>,
): Promise<ImportFlowResult> {
  const result: ImportFlowResult = {
    attempted: 0,
    created: 0,
    importedFingerprints: [],
    failedFingerprints: [],
    skippedDuplicates: 0,
    blocked: 0,
    failures: [],
  };

  // 1. Prepare drafts with fingerprints and assets.
  const prepared = await prepareDrafts(drafts, fingerprints, sourceRowNumbers, resolveAsset);

  // 2. Convert to ActivityImport[] and call the read-only checkImport gate.
  //    UNKNOWN activity types are blocked before conversion.
  const validPrepared = prepared.filter((p) => p.draft.activityType !== 'UNKNOWN');
  result.blocked += prepared.length - validPrepared.length;

  const imports: ActivityImport[] = validPrepared.map((p) => toActivityImport(p, accountId));
  let checked: ActivityImport[];
  try {
    checked = await checkImport(api, imports);
  } catch (err) {
    result.fatal = safeHostFailureMessage(err, 'batch');
    return result;
  }

  // 3. Build the duplicate index from existing activities on this account.
  const existing = await getActivities(api, accountId);
  const index = buildDuplicateIndex(existing);

  // 4. Honor legacy importer metadata first. Wealthfolio's import endpoint
  // performs native duplicate detection for all newer imports.
  const accepted: Array<{ prepared: PreparedDraft; checked: ActivityImport }> = [];
  for (let i = 0; i < validPrepared.length; i++) {
    const p = validPrepared[i];
    const checkedRow = checked[i];
    if (!checkedRow?.isValid) {
      result.blocked += 1;
      result.failures.push({
        sourceRowNumber: p.sourceRowNumber,
        message: safeHostFailureMessage(checkedRow?.errors),
      });
      continue;
    }
    if (index.importedFingerprints.has(p.fingerprint)) {
      result.skippedDuplicates += 1;
      continue;
    }
    accepted.push({ prepared: p, checked: checkedRow });
  }

  if (accepted.length === 0) {
    return result;
  }

  // 5. Send the host-checked rows through the documented import path. The
  // reconciliation acknowledgement is the user's confirmation to post them.
  const confirmed = accepted.map(({ checked }) => ({ ...checked, isDraft: false }));
  result.attempted = confirmed.length;

  let hostImport;
  try {
    hostImport = await importCheckedActivities(api, confirmed);
  } catch (err) {
    // A rejected import has no safe per-row outcome. Do not retry implicitly.
    result.fatal = safeHostFailureMessage(err, 'batch');
    result.failedFingerprints = accepted.map(({ prepared }) => prepared.fingerprint);
    return result;
  }

  // 6. The host preserves request order in its import result. That gives us
  // safe row correlation without rebuilding low-level ActivityCreate payloads.
  if (hostImport.activities.length !== accepted.length) {
    result.fatal = 'Wealthfolio returned an incomplete import result. No automatic retry was made.';
    result.failedFingerprints = accepted.map(({ prepared }) => prepared.fingerprint);
    return result;
  }

  const imported: string[] = [];
  let hostDuplicates = 0;
  for (let i = 0; i < accepted.length; i++) {
    const returned = hostImport.activities[i];
    const preparedDraft = accepted[i].prepared;
    if (isHostDuplicate(returned)) {
      hostDuplicates += 1;
      continue;
    }
    if (!returned.isValid || hasErrors(returned)) {
      result.failures.push({
        sourceRowNumber: preparedDraft.sourceRowNumber,
        message: safeHostFailureMessage(returned.errors),
      });
      result.failedFingerprints.push(preparedDraft.fingerprint);
      continue;
    }
    imported.push(preparedDraft.fingerprint);
  }

  result.created = hostImport.summary.imported;
  result.skippedDuplicates += Math.max(hostDuplicates, hostImport.summary.duplicates);
  if (!hostImport.summary.success || hostImport.summary.imported !== imported.length) {
    result.fatal =
      'Wealthfolio did not return a complete import outcome. No automatic retry was made.';
    result.failedFingerprints = accepted.map(({ prepared }) => prepared.fingerprint);
    return result;
  }
  result.importedFingerprints = imported;

  return result;
}

function hasErrors(activity: ActivityImport): boolean {
  return Object.values(activity.errors ?? {}).some((messages) => messages.length > 0);
}

function isHostDuplicate(activity: ActivityImport): boolean {
  return (
    !!activity.duplicateOfId ||
    activity.duplicateOfLineNumber !== undefined ||
    Object.prototype.hasOwnProperty.call(activity.warnings ?? {}, '_duplicate')
  );
}

// Re-export the importer id for callers (e.g. tests).
export { IMPORTER_ID };

/**
 * Host messages may contain account ids or source-derived values. Render only
 * stable, actionable categories in the sandbox UI.
 */
function safeHostFailureMessage(error: unknown, scope: 'activity' | 'batch' = 'activity'): string {
  const text =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error ?? '');
  if (/quote currency/i.test(text)) {
    return 'The selected security has no quote currency. Re-select its mapping.';
  }
  if (/credit card/i.test(text)) {
    return 'The selected destination account does not support these activities.';
  }
  if (/asset-backed|asset_id|symbol/i.test(text)) {
    return 'The security mapping is incomplete. Re-select the instrument.';
  }
  return scope === 'batch'
    ? 'Wealthfolio could not complete this import batch. Re-check the destination account and security mappings, then retry.'
    : 'Wealthfolio rejected this activity. Review the destination account and mapping.';
}
