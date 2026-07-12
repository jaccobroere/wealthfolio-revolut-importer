import { describe, expect, it } from 'vitest';
import { normalizeSignedAmount } from '../../src/mapping/signs';

describe('normalizeSignedAmount', () => {
  it('returns absolute value plus signed provenance for a positive input', () => {
    const r = normalizeSignedAmount('EUR', '225.00');
    expect(r.value).toEqual({ currency: 'EUR', amount: '225' });
    expect(r.signed).toEqual({
      currency: 'EUR',
      amount: '225',
      isNegative: false,
    });
  });

  it('flips a negative input to absolute value while retaining the sign', () => {
    const r = normalizeSignedAmount('EUR', '-1.50');
    expect(r.value.amount).toBe('1.5');
    expect(r.signed.amount).toBe('-1.5');
    expect(r.signed.isNegative).toBe(true);
  });
});
