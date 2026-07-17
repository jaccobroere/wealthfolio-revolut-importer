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
    // Wealthfolio 3.6.1's HTTP ActivityImport DTO requires `symbol` even
    // for cash movements; its import checker accepts the empty cash symbol.
    symbol: isCash ? '' : draft.ticker,
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
 * Convert an accepted `checkImport` row to an `ActivityCreate` for
 * `saveMany({ creates })`.
 *
 * `checkImport` is not merely a gate in Wealthfolio 3.6.1: it resolves the
 * quote currency, instrument type, quote mode, and (when already known) asset
 * id required by the persistence-only `saveMany` path. Rebuilding the asset
 * from the original CSV draft loses those fields and causes the host to reject
 * new market-priced assets. The checked row is therefore the source of truth
 * for both the activity values and its asset resolution.
 */
export function toActivityCreate(
  prepared: PreparedDraft,
  checked: ActivityImport,
  accountId: string,
  temporaryId: string,
): ActivityCreate {
  const { draft, fingerprint, sourceRowNumber, asset } = prepared;
  const symbol = checked.symbol?.trim() ?? '';
  const isCash = symbol.length === 0;
  const resolvedAsset: AssetResolutionInput | undefined = isCash
    ? undefined
    : {
        id: checked.assetId,
        symbol,
        exchangeMic: checked.exchangeMic,
        name: checked.symbolName,
        quoteMode:
          checked.quoteMode === 'MANUAL' || checked.quoteMode === 'MARKET'
            ? checked.quoteMode
            : undefined,
        quoteCcy: checked.quoteCcy,
        instrumentType: checked.instrumentType,
        providerId: checked.providerId,
        providerSymbol: checked.providerSymbol,
      };
  const meta = buildMetadata(draft, fingerprint, sourceRowNumber, resolvedAsset ?? asset);
  return {
    // saveMany uses this only as a temporary correlation id. Wealthfolio
    // returns it in a row-level error/mapping; it never becomes the activity id.
    id: temporaryId,
    accountId,
    activityType: checked.activityType,
    subtype: checked.subtype,
    activityDate: checked.date ?? draft.date,
    asset: resolvedAsset,
    quantity: checked.quantity ?? undefined,
    unitPrice: checked.unitPrice ?? undefined,
    amount: checked.amount ?? undefined,
    currency: checked.currency ?? draft.currency,
    fee: checked.fee ?? undefined,
    tax: checked.tax ?? undefined,
    comment: checked.comment ?? undefined,
    fxRate: checked.fxRate ?? undefined,
    // The released 3.6.1 server's NewActivity DTO receives metadata as a JSON
    // string, then persists it as structured activity metadata.
    metadata: JSON.stringify(meta),
  } satisfies ActivityCreate;
}
