/**
 * Conversion boundary: pure-core `ActivityDraft` → Wealthfolio 3.6.1
 * `ActivityImport` and `ActivityCreate`.
 *
 * This is the ONLY module in the adapter layer that imports the
 * `@wealthfolio/addon-sdk` activity *types* at runtime. Decimal strings are
 * preserved through this boundary (3.6.1 accepts strings for quantity,
 * unitPrice, amount, fee, tax, and fxRate).
 */
import type {
  ActivityCreate,
  ActivityImport,
  ActivitySubtype,
  ActivityType,
  AssetResolutionInput,
} from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import type { ActivityMetadataV1, PreparedDraft } from './types';
import { IMPORTER_ID, IMPORTER_VERSION, SOURCE_SCHEMA_VERSION, SOURCE_TYPE } from './types';

// Re-export the constants so callers don't need a second import.
export { IMPORTER_ID, IMPORTER_VERSION, SOURCE_SCHEMA_VERSION, SOURCE_TYPE };

/**
 * Map a pure-core `ActivityType` (Revolut subset) to the SDK `ActivityType`.
 *
 * Revolut emits BUY, SELL, DIVIDEND, DEPOSIT, WITHDRAWAL, CREDIT, UNKNOWN.
 * `UNKNOWN` is blocked before conversion (never sent to the host), so this
 * function only receives the valid SDK-compatible subset.
 */
export function toSdkActivityType(type: ActivityDraft['activityType']): ActivityType {
  return type as ActivityType;
}

/** Map a pure-core `ActivitySubtype` to the SDK `ActivitySubtype`. */
export function toSdkSubtype(subtype: ActivityDraft['subtype']): ActivitySubtype | undefined {
  return subtype as ActivitySubtype | undefined;
}

/**
 * Build the non-sensitive metadata object for one activity.
 *
 * Only provenance fields are included; never raw rows, balances, filenames,
 * or paths.
 */
export function buildMetadata(
  draft: ActivityDraft,
  fingerprint: string,
  sourceRowNumber: number,
  resolved?: AssetResolutionInput,
): ActivityMetadataV1 {
  return {
    metadataVersion: 1,
    importerId: IMPORTER_ID,
    importerVersion: IMPORTER_VERSION,
    sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
    sourceType: SOURCE_TYPE,
    sourceFingerprint: fingerprint,
    sourceRowNumber,
    sourceTicker: draft.ticker || undefined,
    resolvedSymbol: resolved?.symbol,
    resolvedMic: resolved?.exchangeMic,
    resolvedProviderId: resolved?.providerId,
  };
}

/**
 * Whether a draft is a cash movement (no instrument asset). Cash movements
 * have no ticker or an empty ticker; trades (BUY/SELL) and dividends carry a
 * ticker.
 */
function isCashActivity(draft: ActivityDraft): boolean {
  return !draft.ticker || draft.ticker.length === 0;
}

/**
 * Convert a prepared draft to an `ActivityImport` row for the read-only
 * `checkImport` gate.
 *
 * `isValid` and `isDraft` are required on every `ActivityImport`. We set
 * `isDraft: true` so the host keeps the row in review until the user confirms
 * the import. Decimal strings are passed through unchanged. `UNKNOWN`
 * activity types are never converted (blocked upstream).
 */
export function toActivityImport(prepared: PreparedDraft, accountId: string): ActivityImport {
  const { draft, asset } = prepared;
  const isCash = isCashActivity(draft);
  return {
    accountId,
    activityType: toSdkActivityType(draft.activityType),
    subtype: toSdkSubtype(draft.subtype),
    date: draft.date,
    symbol: isCash ? undefined : draft.ticker,
    quantity: draft.quantity || undefined,
    unitPrice: draft.unitPrice?.amount || undefined,
    amount: draft.totalAmount.amount || undefined,
    currency: draft.currency,
    fxRate: draft.fxRate || undefined,
    // Asset resolution hints, when a confirmed mapping exists.
    exchangeMic: asset?.exchangeMic,
    quoteCcy: asset?.quoteCcy,
    instrumentType: asset?.instrumentType,
    quoteMode: asset?.quoteMode,
    providerId: asset?.providerId,
    providerSymbol: asset?.providerSymbol,
    isValid: draft.activityType !== 'UNKNOWN',
    isDraft: true,
  } satisfies ActivityImport;
}

/**
 * Convert an accepted (checkImport-passed) `ActivityImport` row to an
 * `ActivityCreate` for `saveMany({ creates })`.
 *
 * Decimal strings are preserved. `asset` is set explicitly when a confirmed
 * mapping exists; cash activities omit `asset`. Metadata carries the
 * non-sensitive provenance fingerprint used for duplicate detection.
 */
export function toActivityCreate(prepared: PreparedDraft, accountId: string): ActivityCreate {
  const { draft, fingerprint, sourceRowNumber, asset } = prepared;
  const isCash = isCashActivity(draft);
  const meta = buildMetadata(draft, fingerprint, sourceRowNumber, asset);
  return {
    accountId,
    activityType: toSdkActivityType(draft.activityType),
    subtype: toSdkSubtype(draft.subtype),
    activityDate: draft.date,
    asset: isCash ? undefined : (asset ?? { symbol: draft.ticker }),
    quantity: draft.quantity || undefined,
    unitPrice: draft.unitPrice?.amount || undefined,
    amount: draft.totalAmount.amount || undefined,
    currency: draft.currency,
    fee: undefined,
    comment: undefined,
    fxRate: draft.fxRate || undefined,
    metadata: meta as unknown as Record<string, unknown>,
  } satisfies ActivityCreate;
}
