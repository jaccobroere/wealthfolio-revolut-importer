import type { Currency, MoneyValue } from './money-value';

/**
 * Normalized Wealthfolio-aligned activity types produced by Revolut mapping.
 * These are the subset of the Wealthfolio `ActivityType` union that Revolut
 * can emit; `UNKNOWN` is reserved for blocked, unmapped source types.
 */
export type ActivityType =
  'BUY' | 'SELL' | 'DIVIDEND' | 'DEPOSIT' | 'WITHDRAWAL' | 'CREDIT' | 'UNKNOWN';

/** Wealthfolio activity subtypes Revolut mapping can emit. */
export type ActivitySubtype = 'FEE_REFUND' | 'BONUS';

/**
 * A normalized, decimal-safe draft derived from exactly one Revolut source
 * row. This is the pure-core representation; the Wealthfolio adapter
 * converts drafts into the published `ActivityImport` / `ActivityCreate`
 * contracts.
 *
 * Invariants:
 * - `date` preserves the full ISO timestamp from the source.
 * - `totalAmount` is authoritative for cash reconciliation and for the
 *   eventual Wealthfolio `amount`.
 * - `unitPrice` / `quantity` are present for trades (`BUY`/`SELL`) only and
 *   are always strictly positive canonical decimal strings.
 * - All monetary fields are absolute-positive; the source sign is retained on
 *   `rawSignedAmount` for review.
 * - `fxRate` is the raw numeric string from the source (no normalization).
 */
export interface ActivityDraft {
  readonly schemaVersion: string;
  readonly date: string;
  readonly sourceType: string;
  readonly activityType: ActivityType;
  readonly subtype?: ActivitySubtype;
  readonly ticker: string;
  readonly quantity?: string;
  readonly unitPrice?: MoneyValue;
  readonly totalAmount: MoneyValue;
  readonly currency: Currency;
  readonly fxRate: string;
  readonly rawSignedAmount: string;
}
