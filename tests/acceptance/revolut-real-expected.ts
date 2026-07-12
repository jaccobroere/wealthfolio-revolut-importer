/**
 * Reviewed aggregate expectations and invariants for the supplied real Revolut
 * investment CSV. These are the only facts the acceptance suite asserts; no
 * raw row, ticker, holding, amount, filename, or path is ever asserted or
 * printed.
 *
 * Source: manual review of the supplied 152-row statement (referenced locally
 * via `REVOLUT_ACCEPTANCE_CSV`, never committed).
 */

export const EXPECTED_TOTAL_ROWS = 152;

export const EXPECTED_SOURCE_TYPE_COUNTS: Readonly<Record<string, number>> = {
  'BUY - MARKET': 80,
  'CASH TOP-UP': 60,
  'SELL - MARKET': 4,
  'COMMISSION REFUND': 3,
  DIVIDEND: 3,
  'CASH WITHDRAWAL': 1,
  REWARD: 1,
};

export const EXPECTED_NORMALIZED_TYPE_COUNTS: Readonly<Record<string, number>> = {
  BUY: 80,
  SELL: 4,
  DEPOSIT: 60,
  DIVIDEND: 3,
  CREDIT: 4,
  WITHDRAWAL: 1,
};

export const EXPECTED_NORMALIZED_SUBTYPE_COUNTS: Readonly<Record<string, number>> = {
  FEE_REFUND: 3,
  BONUS: 1,
};

/** Distinct currencies present in the supplied statement. */
export const EXPECTED_CURRENCY_COUNT = 2;

/** Number of trade-rounding diagnostics strictly above 0.01. */
export const EXPECTED_ROUNDING_DIAGNOSTICS = 17;

/**
 * Exact maximum observed `|quantity x displayed price - Total Amount|`
 * variance, computed with `decimal.js` (no floating point). Reflects Revolut's
 * rounded displayed unit prices; `Total Amount` remains authoritative.
 */
export const EXPECTED_MAX_ROUNDING_VARIANCE = '0.4436557132';

/** Threshold above which a trade-rounding variance becomes a diagnostic. */
export const ROUNDING_DIAGNOSTIC_THRESHOLD = '0.01';
