/**
 * Ticker-only identifier handling. The pure core normalizes the raw Revolut
 * ticker string for review and matching; canonical symbol, exchange MIC,
 * quote currency, and provider resolution happen in the review workflow and
 * the Wealthfolio adapter (later tasks).
 */

/** Trim and upper-case a raw ticker. Returns `''` for absent tickers. */
export function normalizeTicker(raw: string): string {
  return (raw ?? '').trim().toUpperCase();
}

/** `true` when the source row carries a non-empty ticker. */
export function hasTicker(raw: string): boolean {
  return normalizeTicker(raw).length > 0;
}
