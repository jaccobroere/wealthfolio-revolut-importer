import { Decimal } from 'decimal.js';
import type { MoneyValue, SignedMoney } from '../domain/money-value';

/**
 * Normalize a raw signed numeric string into an absolute-positive canonical
 * {@link MoneyValue} plus a {@link SignedMoney} that retains the source sign.
 * Used when the money value is already split from its currency prefix.
 *
 * Throws on malformed numeric input — callers validate the shape first.
 */
export function normalizeSignedAmount(
  currency: string,
  rawNumeric: string,
): { value: MoneyValue; signed: SignedMoney } {
  const decimal = new Decimal(rawNumeric);
  const isNegative = decimal.isNegative();
  return {
    value: { currency, amount: decimal.abs().toString() },
    signed: { currency, amount: decimal.toString(), isNegative },
  };
}

/** Activity types whose direction expresses an outflow of cash. */
export const OUTFLOW_ACTIVITY_TYPES: ReadonlySet<string> = new Set(['SELL', 'WITHDRAWAL']);

/** Activity types whose direction expresses an inflow of cash or a purchase. */
export const INFLOW_ACTIVITY_TYPES: ReadonlySet<string> = new Set([
  'BUY',
  'DEPOSIT',
  'DIVIDEND',
  'CREDIT',
]);
