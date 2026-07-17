/**
 * Revolut importer wizard state machine.
 *
 * Pure state + selectors for the four-step review/reconciliation UI.
 * The state machine is the single source of truth for which step is active,
 * what has been uploaded/mapped/reviewed/reconciled, and whether Import is
 * enabled. UI components dispatch actions and read derived flags; they never
 * mutate state directly.
 *
 * State machine (exactly 4 user-facing steps + 2 transient states):
 *
 *   upload → mapping → review → reconcile → importing → done
 *
 * Privacy: this module never holds raw row content. It holds parsed
 * {@link RowOutcome}s (normalized values + source row number/type) and
 * decimal-string reconciliation totals only. Raw balances/order ids are not
 * stored.
 *
 * This module imports only pure-core types and the Wealthfolio adapter
 * *types* (for `Account` / `SymbolSearchResult` / `CanonicalIdentity`). It
 * does not import React or the SDK runtime — it is framework-free and safe
 * to unit-test in isolation.
 */
import type { Account, SymbolSearchResult } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import type { BatchResult, RowOutcome } from '../domain/import-outcome';
import type { ReconciliationReport } from '../domain/reconciliation';
import type { CanonicalIdentity } from '../wealthfolio/symbol-mappings';

/** The six wizard states. `importing` and `done` are transient/terminal. */
export type WizardStep = 'upload' | 'mapping' | 'review' | 'reconcile' | 'importing' | 'done';

/** Review filter keys. Every row is reachable through exactly one category. */
export type ReviewFilter =
  'all' | 'errors' | 'warnings' | 'duplicates' | 'cash' | 'trades' | 'dividends' | 'credits';

/**
 * Resolution state for a single source ticker. `pending` until the user
 * confirms a canonical identity (or the resolver reports no/ambiguous
 * results). Unresolved tickers block Import.
 */
export type TickerResolution =
  | { status: 'pending' }
  | { status: 'no-results' }
  | { status: 'candidates'; results: SymbolSearchResult[] }
  | { status: 'blocked'; reason: string }
  | { status: 'resolved'; identity: CanonicalIdentity; fromSaved: boolean };

/** A ticker requiring mapping, with its current resolution state. */
export interface TickerEntry {
  /** Normalized source ticker (upper-cased, trimmed). */
  readonly ticker: string;
  /** 1-based source row numbers that reference this ticker. */
  readonly rowIndices: readonly number[];
  /** Current resolution. */
  readonly resolution: TickerResolution;
}

/** Result of the upload step: schema validation + parsed batch. */
export interface UploadSummary {
  /** Header validation result from the pure parser. */
  readonly headerOk: boolean;
  /** Actionable error message when `headerOk === false`. */
  readonly headerError?: string;
  /** Number of parsed data rows (0 when header invalid). */
  readonly rowCount: number;
  /** Earliest source date (ISO date prefix), or undefined when empty/invalid. */
  readonly minDate?: string;
  /** Latest source date (ISO date prefix), or undefined when empty/invalid. */
  readonly maxDate?: string;
}

/** Result of the import flow (mirrors the adapter `ImportFlowResult`). */
export interface ImportSummary {
  readonly attempted: number;
  readonly created: number;
  readonly skippedDuplicates: number;
  readonly blocked: number;
  readonly failed: number;
  /** Safe, row-level persistence errors from Wealthfolio's bulk API. */
  readonly failures: readonly { sourceRowNumber?: number; message: string }[];
  readonly fatal?: string;
}

/** The full wizard state. */
export interface ImportState {
  readonly step: WizardStep;
  readonly upload: UploadSummary | null;
  /** Parsed batch (outcomes + fingerprints). Cleared on reset. */
  readonly batch: BatchResult | null;
  /** Selected destination account id. */
  readonly accountId: string | null;
  /** Accounts available from the host (loaded in mapping). */
  readonly accounts: readonly Account[];
  /** Ticker entries requiring resolution (traded securities only). */
  readonly tickers: Readonly<Record<string, TickerEntry>>;
  /** Duplicate fingerprints detected within the uploaded file. */
  readonly duplicateFingerprints: ReadonlySet<string>;
  /** Reconciliation report (computed in reconcile step). */
  readonly reconciliation: ReconciliationReport | null;
  /** User acknowledgement checkbox. */
  readonly acknowledged: boolean;
  /** Active review filter. */
  readonly filter: ReviewFilter;
  /** Import result summary (set in `done`). */
  readonly importSummary: ImportSummary | null;
  /** Non-fatal error message to surface (e.g. host call failure). */
  readonly error: string | null;
}

export const INITIAL_STATE: ImportState = {
  step: 'upload',
  upload: null,
  batch: null,
  accountId: null,
  accounts: [],
  tickers: {},
  duplicateFingerprints: new Set(),
  reconciliation: null,
  acknowledged: false,
  filter: 'all',
  importSummary: null,
  error: null,
};

// --- Actions -----------------------------------------------------------------

export type Action =
  | { type: 'RESET' }
  | {
      type: 'UPLOAD_COMPLETE';
      batch: BatchResult;
      summary: UploadSummary;
    }
  | { type: 'UPLOAD_FAILED'; error: string }
  | { type: 'GOTO'; step: WizardStep }
  | { type: 'ACCOUNTS_LOADED'; accounts: readonly Account[] }
  | { type: 'SELECT_ACCOUNT'; accountId: string }
  | {
      type: 'TICKERS_INITIALIZED';
      tickers: Readonly<Record<string, TickerEntry>>;
    }
  | {
      type: 'TICKER_RESOLVED';
      ticker: string;
      identity: CanonicalIdentity;
    }
  | {
      type: 'TICKER_RESOLUTION_SET';
      ticker: string;
      resolution: TickerResolution;
    }
  | { type: 'SET_FILTER'; filter: ReviewFilter }
  | { type: 'RECONCILE_COMPLETE'; report: ReconciliationReport }
  | { type: 'SET_ACKNOWLEDGED'; acknowledged: boolean }
  | { type: 'IMPORT_STARTED' }
  | { type: 'IMPORT_COMPLETE'; summary: ImportSummary }
  | { type: 'IMPORT_FAILED'; error: string }
  | { type: 'CLEAR_ERROR' };

/**
 * Reducer. Pure: returns a new state, never mutates.
 *
 * Step transitions are guarded by selectors below; the reducer itself only
 * moves state. Components call selectors to decide whether an action is
 * dispatchable.
 */
export function reducer(state: ImportState, action: Action): ImportState {
  switch (action.type) {
    case 'RESET':
      return { ...INITIAL_STATE };

    case 'UPLOAD_COMPLETE':
      return {
        ...state,
        step: 'mapping',
        upload: action.summary,
        batch: action.batch,
        error: null,
      };

    case 'UPLOAD_FAILED':
      return { ...state, step: 'upload', upload: null, error: action.error };

    case 'GOTO':
      return { ...state, step: action.step };

    case 'ACCOUNTS_LOADED':
      return { ...state, accounts: action.accounts };

    case 'SELECT_ACCOUNT':
      return { ...state, accountId: action.accountId };

    case 'TICKERS_INITIALIZED':
      return { ...state, tickers: action.tickers };

    case 'TICKER_RESOLVED': {
      const existing = state.tickers[action.ticker];
      if (!existing) return state;
      return {
        ...state,
        tickers: {
          ...state.tickers,
          [action.ticker]: {
            ...existing,
            resolution: {
              status: 'resolved',
              identity: action.identity,
              fromSaved: false,
            },
          },
        },
      };
    }

    case 'TICKER_RESOLUTION_SET': {
      const existing = state.tickers[action.ticker];
      if (!existing) return state;
      return {
        ...state,
        tickers: {
          ...state.tickers,
          [action.ticker]: {
            ...existing,
            resolution: action.resolution,
          },
        },
      };
    }

    case 'SET_FILTER':
      return { ...state, filter: action.filter };

    case 'RECONCILE_COMPLETE':
      return { ...state, reconciliation: action.report };

    case 'SET_ACKNOWLEDGED':
      return { ...state, acknowledged: action.acknowledged };

    case 'IMPORT_STARTED':
      return { ...state, step: 'importing', error: null };

    case 'IMPORT_COMPLETE':
      return {
        ...state,
        step: 'done',
        importSummary: action.summary,
        error: null,
      };

    case 'IMPORT_FAILED':
      return {
        ...state,
        step: 'reconcile',
        error: action.error,
      };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    default:
      return state;
  }
}

// --- Selectors ---------------------------------------------------------------

/** True when the upload produced a valid header and at least one row. */
export function hasValidUpload(state: ImportState): boolean {
  return !!state.upload?.headerOk && (state.upload?.rowCount ?? 0) > 0;
}

/** True when an account has been selected. */
export function hasAccount(state: ImportState): boolean {
  return !!state.accountId;
}

/**
 * The set of tickers that require resolution (traded securities with a
 * non-empty ticker that are not yet resolved).
 */
export function unresolvedTickers(state: ImportState): TickerEntry[] {
  return Object.values(state.tickers).filter((t) => t.resolution.status !== 'resolved');
}

/** True when every traded-security ticker is resolved. */
export function allTickersResolved(state: ImportState): boolean {
  return unresolvedTickers(state).length === 0;
}

/** Count of fatal/unknown rows (UNKNOWN source type). */
export function unknownCount(state: ImportState): number {
  if (!state.batch) return 0;
  return state.batch.outcomes.filter((o) => o.kind === 'unknown').length;
}

/** Count of invalid rows (known type, malformed value). */
export function invalidCount(state: ImportState): number {
  if (!state.batch) return 0;
  return state.batch.outcomes.filter((o) => o.kind === 'invalid').length;
}

/** True when there are zero fatal/unknown rows. */
export function noFatalRows(state: ImportState): boolean {
  return unknownCount(state) === 0 && invalidCount(state) === 0;
}

/**
 * Reconciliation residual rules pass when every imported row is accounted
 * for in the report (accountedRows === number of imported outcomes) and
 * there are no unaccounted rows. Trade-rounding variances are diagnostic
 * only and never block.
 */
export function reconciliationPasses(state: ImportState): boolean {
  if (!state.reconciliation) return false;
  const imported = state.batch?.outcomes.filter((o) => o.kind === 'imported').length ?? 0;
  return state.reconciliation.accountedRows === imported;
}

/**
 * The master gate: Import is enabled ONLY when ALL blocking conditions are
 * clear:
 *   1. account selected;
 *   2. zero fatal/unknown rows;
 *   3. all traded securities resolved;
 *   4. reconciliation residual rules pass;
 *   5. user acknowledgement checked.
 *
 * This is the single function UI components call to enable/disable Import.
 */
export function canImport(state: ImportState): boolean {
  return (
    hasAccount(state) &&
    noFatalRows(state) &&
    allTickersResolved(state) &&
    reconciliationPasses(state) &&
    state.acknowledged
  );
}

/**
 * Human-readable list of blocking reasons (for the disabled-Import tooltip
 * and the reconciliation panel). Empty when `canImport` is true.
 */
export function blockingReasons(state: ImportState): string[] {
  const reasons: string[] = [];
  if (!hasAccount(state)) reasons.push('Select a destination account');
  if (!noFatalRows(state)) {
    const u = unknownCount(state);
    const i = invalidCount(state);
    if (u > 0) reasons.push(`Resolve ${u} unknown row${u === 1 ? '' : 's'}`);
    if (i > 0) reasons.push(`Resolve ${i} invalid row${i === 1 ? '' : 's'}`);
  }
  const unresolved = unresolvedTickers(state);
  if (unresolved.length > 0) {
    reasons.push(`Resolve ${unresolved.length} ticker${unresolved.length === 1 ? '' : 's'}`);
  }
  if (!reconciliationPasses(state)) {
    reasons.push('Reconciliation residuals must pass');
  }
  if (!state.acknowledged) {
    reasons.push('Acknowledge reconciliation');
  }
  return reasons;
}

// --- Derived review data -----------------------------------------------------

/**
 * Categorize a single outcome into a review category. Every row maps to
 * exactly one category (conservation).
 *
 * - `errors`     — unknown or invalid rows (fatal, block Import).
 * - `duplicates` — imported rows whose fingerprint collides with an earlier
 *                  row in the same file.
 * - `cash`       — DEPOSIT / WITHDRAWAL.
 * - `trades`     — BUY / SELL.
 * - `dividends`  — DIVIDEND.
 * - `credits`    — CREDIT (FEE_REFUND / BONUS).
 * - `warnings`   — imported rows with a trade-rounding variance (diagnostic).
 *
 * `all` matches everything. Order of precedence: errors > duplicates >
 * warnings > trades > cash > dividends > credits.
 */
export function categorize(
  outcome: RowOutcome,
  duplicateFingerprints: ReadonlySet<string>,
  fingerprints: readonly string[],
  roundingVariances: ReadonlyMap<number, string>,
): ReviewFilter {
  if (outcome.kind === 'unknown' || outcome.kind === 'invalid') return 'errors';
  if (outcome.kind !== 'imported' || !outcome.draft) return 'errors';
  const fp = fingerprints[outcome.rowIndex - 1] ?? '';
  if (fp && duplicateFingerprints.has(fp)) return 'duplicates';
  if (roundingVariances.has(outcome.rowIndex)) return 'warnings';
  switch (outcome.draft.activityType) {
    case 'BUY':
    case 'SELL':
      return 'trades';
    case 'DEPOSIT':
    case 'WITHDRAWAL':
      return 'cash';
    case 'DIVIDEND':
      return 'dividends';
    case 'CREDIT':
      return 'credits';
    default:
      return 'errors';
  }
}

/**
 * Filter outcomes by the active review filter. Returns the subset of
 * outcomes matching the filter, preserving source order.
 */
export function filterOutcomes(state: ImportState): readonly RowOutcome[] {
  if (!state.batch) return [];
  const outcomes = state.batch.outcomes;
  if (state.filter === 'all') return outcomes;
  const rounding = new Map<number, string>(
    (state.reconciliation?.tradeRoundingVariances ?? []).map((v) => [v.rowIndex, v.variance]),
  );
  return outcomes.filter(
    (o) =>
      categorize(o, state.duplicateFingerprints, state.batch!.fingerprints, rounding) ===
      state.filter,
  );
}

/** Count outcomes per review category. */
export function categoryCounts(state: ImportState): Record<ReviewFilter, number> {
  const counts: Record<ReviewFilter, number> = {
    all: 0,
    errors: 0,
    warnings: 0,
    duplicates: 0,
    cash: 0,
    trades: 0,
    dividends: 0,
    credits: 0,
  };
  if (!state.batch) return counts;
  const rounding = new Map<number, string>(
    (state.reconciliation?.tradeRoundingVariances ?? []).map((v) => [v.rowIndex, v.variance]),
  );
  for (const o of state.batch.outcomes) {
    const cat = categorize(o, state.duplicateFingerprints, state.batch.fingerprints, rounding);
    counts[cat]++;
    counts.all++;
  }
  return counts;
}

/**
 * Build the ticker entries that require resolution from a parsed batch.
 * Only traded securities (BUY/SELL) and dividends carry a ticker that needs
 * mapping; cash movements have no ticker.
 */
export function buildTickerEntries(batch: BatchResult): Record<string, TickerEntry> {
  const entries: Record<string, TickerEntry> = {};
  for (const outcome of batch.outcomes) {
    if (outcome.kind !== 'imported' || !outcome.draft) continue;
    const draft: ActivityDraft = outcome.draft;
    if (!draft.ticker) continue;
    const ticker = draft.ticker;
    const existing = entries[ticker];
    if (existing) {
      entries[ticker] = {
        ...existing,
        rowIndices: [...existing.rowIndices, outcome.rowIndex],
      };
    } else {
      entries[ticker] = {
        ticker,
        rowIndices: [outcome.rowIndex],
        resolution: { status: 'pending' },
      };
    }
  }
  return entries;
}

/**
 * Compute the upload summary from a parsed CSV result. Privacy: only row
 * count and date range — never content, balances, or tickers.
 */
export function uploadSummaryFromBatch(
  batch: BatchResult,
  headerOk: boolean,
  headerError?: string,
): UploadSummary {
  const dates: string[] = [];
  for (const o of batch.outcomes) {
    if (o.kind === 'imported' && o.draft) {
      dates.push(o.draft.date.slice(0, 10));
    }
  }
  dates.sort();
  return {
    headerOk,
    headerError,
    rowCount: batch.outcomes.length,
    minDate: dates[0],
    maxDate: dates[dates.length - 1],
  };
}
