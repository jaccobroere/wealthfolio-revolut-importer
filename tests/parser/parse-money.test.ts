import { describe, expect, it } from 'vitest';
import { isMoneyShape, parseMoney, MONEY_REGEX } from '../../src/parser/parse-money';

describe('MONEY_REGEX', () => {
  it('matches prefixed money with optional minus and decimals', () => {
    expect(MONEY_REGEX.test('EUR 287.30')).toBe(true);
    expect(MONEY_REGEX.test('USD 1.24')).toBe(true);
    expect(MONEY_REGEX.test('EUR 30')).toBe(true);
    expect(MONEY_REGEX.test('EUR -30')).toBe(true);
    expect(MONEY_REGEX.test('EUR  30')).toBe(true); // multiple spaces
  });

  it('rejects malformed prefixed money', () => {
    expect(MONEY_REGEX.test('287.30')).toBe(false);
    expect(MONEY_REGEX.test('EUR287.30')).toBe(false);
    expect(MONEY_REGEX.test('eur 287.30')).toBe(false);
    expect(MONEY_REGEX.test('EUR 2,87.30')).toBe(false);
    expect(MONEY_REGEX.test('EUR 1e2')).toBe(false);
    expect(MONEY_REGEX.test(' EUR 287.30')).toBe(false);
    expect(MONEY_REGEX.test('')).toBe(false);
  });
});

describe('parseMoney', () => {
  it('returns canonical absolute value and signed provenance', () => {
    const r = parseMoney('EUR 287.30');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ currency: 'EUR', amount: '287.3' });
    expect(r.signed).toEqual({
      currency: 'EUR',
      amount: '287.3',
      isNegative: false,
    });
  });

  it('normalizes a negative source amount to absolute value with sign retained', () => {
    const r = parseMoney('USD -1.5');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ currency: 'USD', amount: '1.5' });
    expect(r.signed).toEqual({
      currency: 'USD',
      amount: '-1.5',
      isNegative: true,
    });
  });

  it('strips insignificant trailing zeros via decimal.js', () => {
    const r = parseMoney('EUR 1.2300');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.amount).toBe('1.23');
  });

  it('validates the prefix against an expected currency', () => {
    expect(parseMoney('USD 10', 'EUR').ok).toBe(false);
    const ok = parseMoney('EUR 10', 'EUR');
    expect(ok.ok).toBe(true);
  });

  it('reports format and empty reasons', () => {
    const empty = parseMoney('');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe('money.empty');

    const bad = parseMoney('garbage');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('money.format');
  });

  it('isMoneyShape mirrors the regex', () => {
    expect(isMoneyShape('EUR 1.0')).toBe(true);
    expect(isMoneyShape('bad')).toBe(false);
  });
});
