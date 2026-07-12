import { Decimal } from 'decimal.js';

/**
 * ISO-4217 alpha-3 currency code (e.g. `EUR`, `USD`).
 *
 * Kept as a branded-ish string alias rather than a closed union: Revolut may
 * emit any alpha-3 code in the `Currency` column. Validation enforces the
 * `[A-Z]{3}` shape and that every prefixed money value carries the same code.
 */
export type Currency = string;

/**
 * A non-negative canonical monetary value.
 *
 * `amount` is always a canonical decimal string produced by `decimal.js`:
 * insignificant trailing zeros are stripped, the value is absolute (sign lives
 * on the activity type / {@link SignedMoney}), and no `Number`/float ever
 * touches it.
 */
export interface MoneyValue {
  readonly currency: Currency;
  readonly amount: string;
}

/**
 * Signed monetary provenance retained for review. `amount` keeps the source
 * sign (canonical decimal); `isNegative` flags rows Revolut emitted as
 * negative even though the normalized economic amount is absolute-positive.
 */
export interface SignedMoney {
  readonly currency: Currency;
  readonly amount: string;
  readonly isNegative: boolean;
}

/** `true` if `value` is an alpha-3 uppercase currency code. */
export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/**
 * Canonicalize a decimal string with `decimal.js`: strips insignificant
 * trailing zeros, rejects malformed input by throwing, and never returns a
 * float. Examples: `'287.30' -> '287.3'`, `'1.2300' -> '1.23'`, `'30' -> '30'`.
 */
export function canonicalDecimal(value: string): string {
  return new Decimal(value).toString();
}

/** Absolute-value canonical decimal string. Preserves no sign. */
export function absCanonicalDecimal(value: string): string {
  return new Decimal(value).abs().toString();
}
