import { Decimal } from 'decimal.js';
import type { Currency, MoneyValue, SignedMoney } from '../domain/money-value';

/**
 * Strict Revolut prefixed-money regex.
 *
 * Matches `<CCC> [-]?<digits>[.<digits>]` — ISO-4217 alpha-3 prefix, one or
 * more whitespace, optional leading minus, integer or decimal mantissa. No
 * thousands separators, no exponent, no surrounding whitespace.
 */
export const MONEY_REGEX = /^[A-Z]{3}\s+-?\d+(?:\.\d+)?$/;

const MONEY_PARTS = /^([A-Z]{3})\s+(-?\d+(?:\.\d+)?)$/;

export type ParseMoneyResult =
  { ok: true; value: MoneyValue; signed: SignedMoney } | { ok: false; reason: MoneyParseError };

export type MoneyParseError = 'money.empty' | 'money.format' | 'money.currency-mismatch';

/**
 * Parse a Revolut prefixed-money string into a canonical {@link MoneyValue}
 * (absolute-positive) and a {@link SignedMoney} provenance (source sign
 * retained). When `expectedCurrency` is given, the prefix must equal it.
 *
 * Returns canonical decimal strings produced by `decimal.js`; never a float.
 */
export function parseMoney(raw: string, expectedCurrency?: Currency): ParseMoneyResult {
  const input = raw ?? '';
  if (input.length === 0) return { ok: false, reason: 'money.empty' };

  const match = MONEY_PARTS.exec(input);
  if (!match) return { ok: false, reason: 'money.format' };

  const currency = match[1];
  const numeric = match[2];

  if (expectedCurrency !== undefined && currency !== expectedCurrency) {
    return { ok: false, reason: 'money.currency-mismatch' };
  }

  const decimal = new Decimal(numeric);
  const isNegative = decimal.isNegative();
  const signed: SignedMoney = {
    currency,
    amount: decimal.toString(),
    isNegative,
  };
  const value: MoneyValue = {
    currency,
    amount: decimal.abs().toString(),
  };

  return { ok: true, value, signed };
}

/** `true` if `raw` matches the strict prefixed-money shape. */
export function isMoneyShape(raw: string): boolean {
  return MONEY_REGEX.test(raw ?? '');
}
