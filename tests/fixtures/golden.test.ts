import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRevolutCsv } from '../../src/parser/parse-csv';
import { validateBatch } from '../../src/validation/validate-batch';
import { reconcile } from '../../src/reconciliation/reconcile';

function fixture(name: string) {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url)).toString('utf8');
}

describe('golden: revolut-all-supported-types fixture', () => {
  const parsed = parseRevolutCsv(fixture('revolut-all-supported-types.csv'));

  it('matches the strict schema', () => {
    expect(parsed.header.ok).toBe(true);
  });

  it('normalizes every supported type with reviewed counts', async () => {
    const r = await validateBatch(parsed.rows);
    expect(r.counts).toEqual({
      total: 7,
      imported: 7,
      unknown: 0,
      invalid: 0,
    });

    const typeCounts: Record<string, number> = {};
    const subtypeCounts: Record<string, number> = {};
    for (const o of r.outcomes) {
      if (!o.draft) continue;
      typeCounts[o.draft.activityType] = (typeCounts[o.draft.activityType] ?? 0) + 1;
      if (o.draft.subtype) {
        subtypeCounts[o.draft.subtype] = (subtypeCounts[o.draft.subtype] ?? 0) + 1;
      }
    }
    expect(typeCounts).toEqual({
      BUY: 1,
      SELL: 1,
      DEPOSIT: 1,
      WITHDRAWAL: 1,
      DIVIDEND: 1,
      CREDIT: 2,
    });
    expect(subtypeCounts).toEqual({ FEE_REFUND: 1, BONUS: 1 });
  });

  it('accounts for every row exactly once', async () => {
    const r = await validateBatch(parsed.rows);
    const rep = reconcile(r.outcomes);
    expect(rep.accountedRows).toBe(7);
    expect(rep.totalRows).toBe(7);

    const accountedSum =
      rep.positions.reduce((s, p) => s + p.buyCount + p.sellCount, 0) +
      rep.cashByCurrency.reduce((s, c) => s + c.depositCount + c.withdrawalCount, 0) +
      rep.creditsByCurrency.reduce((s, c) => s + c.count, 0) +
      rep.dividendsByCurrency.reduce((s, d) => s + d.count, 0);
    expect(accountedSum).toBe(rep.accountedRows);
  });

  it('produces unique fingerprints for every fixture row', async () => {
    const r = await validateBatch(parsed.rows);
    expect(new Set(r.fingerprints).size).toBe(parsed.rows.length);
    expect(r.collisions.length).toBe(0);
  });
});

describe('golden: masked E2E portfolio fixture', () => {
  const parsed = parseRevolutCsv(fixture('revolut-e2e-portfolio.csv'));

  it('keeps the broker schema and all portfolio rows valid', async () => {
    expect(parsed.header.ok).toBe(true);
    const validated = await validateBatch(parsed.rows);
    expect(validated.counts).toEqual({ total: 8, imported: 8, unknown: 0, invalid: 0 });
    expect(validated.collisions).toEqual([]);
  });

  it('covers cash, instrument, dividend, and credit activity families', async () => {
    const validated = await validateBatch(parsed.rows);
    const types = validated.outcomes.flatMap((outcome) =>
      outcome.draft ? [outcome.draft.activityType] : [],
    );
    expect(types).toEqual(
      expect.arrayContaining(['BUY', 'SELL', 'DIVIDEND', 'DEPOSIT', 'WITHDRAWAL', 'CREDIT']),
    );
    expect(reconcile(validated.outcomes)).toMatchObject({ accountedRows: 8, totalRows: 8 });
  });
});
