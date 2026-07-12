import { describe, expect, it } from 'vitest';
import type { RevolutSourceRow } from '../../src/domain/revolut-row';
import { validateRow } from '../../src/validation/validate-row';

function row(partial: Partial<RevolutSourceRow> = {}): RevolutSourceRow {
  return {
    date: '2024-01-01T10:00:00.000000Z',
    ticker: 'SYNTH',
    type: 'BUY - MARKET',
    quantity: '1.5',
    pricePerShare: 'USD 150.00',
    totalAmount: 'USD 225.00',
    currency: 'USD',
    fxRate: '1.0000',
    ...partial,
  };
}

describe('validateRow', () => {
  it('imports a valid BUY with decimal-safe canonical fields', () => {
    const o = validateRow(row(), 2);
    expect(o.kind).toBe('imported');
    expect(o.draft?.activityType).toBe('BUY');
    expect(o.draft?.quantity).toBe('1.5');
    expect(o.draft?.unitPrice).toEqual({ currency: 'USD', amount: '150' });
    expect(o.draft?.totalAmount).toEqual({ currency: 'USD', amount: '225' });
    expect(o.draft?.rawSignedAmount).toBe('225');
    expect(o.draft?.fxRate).toBe('1.0000');
    expect(o.draft?.date).toBe('2024-01-01T10:00:00.000000Z');
  });

  it('maps every supported type to the expected activity type', () => {
    expect(validateRow(row({ type: 'SELL - MARKET' }), 1).draft?.activityType).toBe('SELL');
    expect(validateRow(row({ type: 'CASH TOP-UP', ticker: '', quantity: '', pricePerShare: '', totalAmount: 'EUR 100.00', currency: 'EUR' }), 1).draft?.activityType).toBe('DEPOSIT');
    expect(validateRow(row({ type: 'CASH WITHDRAWAL', ticker: '', quantity: '', pricePerShare: '', totalAmount: 'EUR 50.00', currency: 'EUR' }), 1).draft?.activityType).toBe('WITHDRAWAL');
    expect(validateRow(row({ type: 'DIVIDEND', quantity: '', pricePerShare: '', totalAmount: 'EUR 5.00', currency: 'EUR' }), 1).draft?.activityType).toBe('DIVIDEND');
    expect(validateRow(row({ type: 'COMMISSION REFUND', quantity: '', pricePerShare: '', totalAmount: 'EUR 1.50', currency: 'EUR' }), 1).draft).toMatchObject({ activityType: 'CREDIT', subtype: 'FEE_REFUND' });
    expect(validateRow(row({ type: 'REWARD', ticker: '', quantity: '', pricePerShare: '', totalAmount: 'EUR 2.00', currency: 'EUR' }), 1).draft).toMatchObject({ activityType: 'CREDIT', subtype: 'BONUS' });
  });

  it('blocks unknown types as UNKNOWN, never skipping', () => {
    const o = validateRow(row({ type: 'BUY - LIMIT' }), 2);
    expect(o.kind).toBe('unknown');
    expect(o.reasons).toContain('type.unknown');
    expect(o.draft).toBeUndefined();
  });

  it('rejects a BUY with nonpositive quantity', () => {
    const o = validateRow(row({ quantity: '0' }), 2);
    expect(o.kind).toBe('invalid');
    expect(o.reasons).toContain('quantity.nonpositive');
  });

  it('rejects a BUY with nonpositive unit price', () => {
    const o = validateRow(row({ pricePerShare: 'USD 0.00' }), 2);
    expect(o.kind).toBe('invalid');
    expect(o.reasons).toContain('price.nonpositive');
  });

  it('rejects malformed quantity on a trade', () => {
    const o = validateRow(row({ quantity: 'abc' }), 2);
    expect(o.kind).toBe('invalid');
    expect(o.reasons).toContain('quantity.invalid');
  });

  it('rejects a currency-prefix mismatch against the Currency column', () => {
    const o = validateRow(row({ pricePerShare: 'EUR 150.00', currency: 'USD' }), 2);
    expect(o.kind).toBe('invalid');
    expect(o.reasons).toContain('price.money.currency-mismatch');
  });

  it('rejects a malformed total amount', () => {
    const o = validateRow(row({ totalAmount: 'no-prefix' }), 2);
    expect(o.kind).toBe('invalid');
    expect(o.reasons).toContain('total.money.format');
  });

  it('rejects an invalid date without coercion', () => {
    const o = validateRow(row({ date: '2025-13-40' }), 2);
    expect(o.kind).toBe('invalid');
    expect(o.reasons).toContain('date.invalid');
  });

  it('rejects a malformed fx rate', () => {
    const o = validateRow(row({ fxRate: 'abc' }), 2);
    expect(o.kind).toBe('invalid');
    expect(o.reasons).toContain('fx.invalid');
  });

  it('preserves the signed raw amount when the source total is negative', () => {
    const o = validateRow(
      row({ totalAmount: 'USD -225.00', pricePerShare: 'USD 150.00' }),
      2
    );
    expect(o.kind).toBe('imported');
    expect(o.draft?.totalAmount.amount).toBe('225');
    expect(o.draft?.rawSignedAmount).toBe('-225');
  });
});
