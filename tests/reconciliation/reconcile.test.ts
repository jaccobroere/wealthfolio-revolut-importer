import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import type { RowOutcome } from '../../src/domain/import-outcome';
import { reconcile } from '../../src/reconciliation/reconcile';
import { validateRow } from '../../src/validation/validate-row';
import type { RevolutSourceRow } from '../../src/domain/revolut-row';

function row(partial: Partial<RevolutSourceRow>): RevolutSourceRow {
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

function outcomes(rows: RevolutSourceRow[]): RowOutcome[] {
  return rows.map((r, i) => validateRow(r, i + 2));
}

describe('reconcile', () => {
  it('aggregates bought/sold/net per ticker', () => {
    const o = outcomes([
      row({ quantity: '1.5', totalAmount: 'USD 225.00' }),
      row({ quantity: '2', totalAmount: 'USD 300.00' }),
      row({
        type: 'SELL - MARKET',
        quantity: '1',
        pricePerShare: 'USD 200.00',
        totalAmount: 'USD 200.00',
      }),
    ]);
    const rep = reconcile(o);
    expect(rep.positions.length).toBe(1);
    expect(rep.positions[0]).toMatchObject({
      ticker: 'SYNTH',
      bought: '3.5',
      sold: '1',
      net: '2.5',
      buyCount: 2,
      sellCount: 1,
    });
    expect(rep.accountedRows).toBe(3);
  });

  it('aggregates deposits/withdrawals per currency', () => {
    const o = outcomes([
      row({
        type: 'CASH TOP-UP',
        ticker: '',
        quantity: '',
        pricePerShare: '',
        totalAmount: 'EUR 100.00',
        currency: 'EUR',
      }),
      row({
        type: 'CASH TOP-UP',
        ticker: '',
        quantity: '',
        pricePerShare: '',
        totalAmount: 'EUR 50.00',
        currency: 'EUR',
      }),
      row({
        type: 'CASH WITHDRAWAL',
        ticker: '',
        quantity: '',
        pricePerShare: '',
        totalAmount: 'EUR 30.00',
        currency: 'EUR',
      }),
    ]);
    const rep = reconcile(o);
    expect(rep.cashByCurrency).toEqual([
      {
        currency: 'EUR',
        deposits: '150',
        withdrawals: '30',
        net: '120',
        depositCount: 2,
        withdrawalCount: 1,
      },
    ]);
  });

  it('splits credits and dividends per currency', () => {
    const o = outcomes([
      row({
        type: 'DIVIDEND',
        quantity: '',
        pricePerShare: '',
        totalAmount: 'EUR 5.00',
        currency: 'EUR',
      }),
      row({
        type: 'COMMISSION REFUND',
        quantity: '',
        pricePerShare: '',
        totalAmount: 'EUR 1.50',
        currency: 'EUR',
      }),
      row({
        type: 'REWARD',
        ticker: '',
        quantity: '',
        pricePerShare: '',
        totalAmount: 'EUR 2.00',
        currency: 'EUR',
      }),
    ]);
    const rep = reconcile(o);
    expect(rep.dividendsByCurrency).toEqual([{ currency: 'EUR', count: 1, total: '5' }]);
    expect(rep.creditsByCurrency).toEqual([
      {
        currency: 'EUR',
        count: 2,
        total: '3.5',
        bySubtype: {
          FEE_REFUND: { count: 1, total: '1.5' },
          BONUS: { count: 1, total: '2' },
        },
      },
    ]);
  });

  it('flags trade-rounding variances strictly above 0.01', () => {
    // quantity x price = 1.5 * 150.00 = 225.00, total = 225.10 -> variance 0.10
    const o = outcomes([row({ totalAmount: 'USD 225.10' })]);
    const rep = reconcile(o);
    expect(rep.tradeRoundingVariances.length).toBe(1);
    expect(rep.tradeRoundingVariances[0].variance).toBe('0.1');
  });

  it('does not flag a tiny within-threshold variance', () => {
    // 1.5 * 150.00 = 225.00, total = 225.005 -> variance 0.005 (<= 0.01)
    const o = outcomes([row({ totalAmount: 'USD 225.005' })]);
    const rep = reconcile(o);
    expect(rep.tradeRoundingVariances.length).toBe(0);
  });

  it('reports deterministic output across repeated runs', () => {
    const o = outcomes([
      row({ ticker: 'B' }),
      row({
        ticker: 'A',
        type: 'SELL - MARKET',
        quantity: '1',
        pricePerShare: 'USD 10.00',
        totalAmount: 'USD 10.00',
      }),
    ]);
    const a = reconcile(o);
    const b = reconcile(o);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    // Tickers are sorted deterministically.
    expect(a.positions.map((p) => p.ticker)).toEqual(['A', 'B']);
  });

  it('computes variance with exact Decimal arithmetic', () => {
    // 0.13 x 0.12 = 0.0156, total = 0.46 -> variance 0.4444
    const o = outcomes([
      row({
        ticker: 'SYNTH',
        quantity: '0.13',
        pricePerShare: 'USD 0.12',
        totalAmount: 'USD 0.46',
      }),
    ]);
    const rep = reconcile(o);
    const variance = new Decimal(rep.tradeRoundingVariances[0].variance);
    expect(variance.toString()).toBe('0.4444');
  });

  it('excludes unknown/invalid rows from accountedRows but keeps totalRows', () => {
    const o = outcomes([
      row({ type: 'BUY - LIMIT' }), // unknown
      row({ quantity: 'abc' }), // invalid
      row({}), // imported
    ]);
    const rep = reconcile(o);
    expect(rep.totalRows).toBe(3);
    expect(rep.accountedRows).toBe(1);
  });
});
