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
 * 4. Partition accepted rows into new and exact-duplicate. Exact duplicates
 *    are skipped (zero `saveMany` creates).
 * 5. Convert only accepted, non-duplicate rows → `ActivityCreate[]`.
 * 6. Call `activities.saveMany({ creates })`. NEVER pass a bare array.
 * 7. Mark fingerprints imported ONLY for entries that appear in `created`
 *    (authoritative). Failed/partial writes never mark failed fingerprints.
 */
import type { ActivityCreate, ActivityImport, HostAPI } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import { buildDuplicateIndex } from './duplicate-index';
import { toActivityCreate, toActivityImport } from './convert-activity';
import { getActivities, checkImport, saveCreates } from './api';
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
    result.fatal = err instanceof Error ? err.message : String(err);
    return result;
  }

  // 3. Build the duplicate index from existing activities on this account.
  const existing = await getActivities(api, accountId);
  const index = buildDuplicateIndex(existing);

  // 4. Partition into new and exact-duplicate. Only rows that passed
  //    checkImport (isValid true) and are not exact duplicates proceed.
  const acceptedPrepared: PreparedDraft[] = [];
  for (let i = 0; i < validPrepared.length; i++) {
    const p = validPrepared[i];
    const checkedRow = checked[i];
    if (!checkedRow?.isValid) {
      result.blocked += 1;
      continue;
    }
    if (index.importedFingerprints.has(p.fingerprint)) {
      result.skippedDuplicates += 1;
      continue;
    }
    acceptedPrepared.push(p);
  }

  if (acceptedPrepared.length === 0) {
    return result;
  }

  // 5. Convert accepted rows to ActivityCreate[].
  const creates: ActivityCreate[] = acceptedPrepared.map((p) => toActivityCreate(p, accountId));
  result.attempted = creates.length;

  // 6. Call saveMany({ creates }). NEVER a bare array.
  let mutation;
  try {
    mutation = await saveCreates(api, creates);
  } catch (err) {
    // Fatal: no fingerprints are marked imported.
    result.fatal = err instanceof Error ? err.message : String(err);
    result.failedFingerprints = acceptedPrepared.map((p) => p.fingerprint);
    return result;
  }

  // 7. Mark imported ONLY the fingerprints that appear in `created`. The
  //    `created` array is authoritative; entries in `errors` are not marked.
  const createdFingerprints: string[] = [];

  // Map created activities back to prepared drafts via metadata fingerprint.
  // The host assigns ids; we correlate via the metadata we attached.
  for (const activity of mutation.created) {
    const meta = activity.metadata as Record<string, unknown> | undefined;
    const fp = meta?.sourceFingerprint;
    if (typeof fp === 'string' && fp.length > 0) createdFingerprints.push(fp);
  }

  // If the host did not round-trip metadata, fall back to positional
  // correlation: assume `created` is in the same order as `creates`. This is
  // defensive only; the metadata round-trip is the verified protocol.
  if (
    createdFingerprints.length === 0 &&
    mutation.created.length > 0 &&
    mutation.created.length === acceptedPrepared.length
  ) {
    for (let i = 0; i < acceptedPrepared.length; i++) {
      createdFingerprints.push(acceptedPrepared[i].fingerprint);
    }
  }

  result.created = mutation.created.length;
  result.importedFingerprints = createdFingerprints;

  // Any attempted fingerprint not in `created` is a failure (partial write).
  const createdSet = new Set(createdFingerprints);
  for (const p of acceptedPrepared) {
    if (!createdSet.has(p.fingerprint)) result.failedFingerprints.push(p.fingerprint);
  }

  return result;
}

// Re-export the importer id for callers (e.g. tests).
export { IMPORTER_ID };
