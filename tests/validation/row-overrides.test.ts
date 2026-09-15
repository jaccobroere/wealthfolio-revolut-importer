import { describe, expect, it } from 'vitest';
import { parseRevolutCsv } from '../../src/parser/parse-csv';
import { validateBatch } from '../../src/validation/validate-batch';
import {
  applyRowPatch,
  changedFields,
  countOverrides,
  normalizePatch,
  EDITABLE_FIELDS,
  type RowOverrides,
} from '../../src/domain/row-override';
import type { RevolutSourceRow } from '../../src/domain/revolut-row';

/** Row 1 = a clean top-up, row 2 = a Type nothing recognizes. */
const UNKNOWN_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,,CASH TOP-UP,,,EUR 100.00,EUR,1.0000
2024-01-02T10:00:00.000000Z,AAPL,MYSTERY EVENT,2,USD 150.00,USD 300.00,USD,1.0000
`;

/** A BUY with a non-positive quantity → structurally invalid. */
const INVALID_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,AAPL,BUY - MARKET,0,USD 150.00,USD 300.00,USD,1.0000
`;

function rowsOf(csv: string): readonly RevolutSourceRow[] {
  const parsed = parseRevolutCsv(csv);
  if (!parsed.header.ok) throw new Error('fixture header must be valid');
  return parsed.rows;
}

describe('row override model', () => {
  const row = rowsOf(UNKNOWN_CSV)[1];

  it('reports only the fields that actually differ', () => {
    expect(changedFields(row, { type: 'DIVIDEND' })).toEqual(['type']);
    expect(changedFields(row, { type: row.type })).toEqual([]);
    expect(changedFields(row, {})).toEqual([]);
  });

  it('applies only changed fields and leaves the original row untouched', () => {
    const patched = applyRowPatch(row, { type: 'DIVIDEND', totalAmount: 'USD 12.50' });
    expect(patched.type).toBe('DIVIDEND');
    expect(patched.totalAmount).toBe('USD 12.50');
    expect(row.type).toBe('MYSTERY EVENT');
  });

  it('normalizes a no-op patch to null so it is dropped instead of recorded', () => {
    expect(normalizePatch(row, { type: row.type, ticker: row.ticker })).toBeNull();
    expect(normalizePatch(row, { type: 'DIVIDEND', ticker: row.ticker })).toEqual({
      type: 'DIVIDEND',
    });
  });

  it('exposes every column Revolut emits', () => {
    expect(EDITABLE_FIELDS).toHaveLength(8);
  });

  it('counts decisions by kind', () => {
    expect(
      countOverrides({
        1: { kind: 'ignore' },
        2: { kind: 'edit', patch: { type: 'DIVIDEND' } },
      }),
    ).toEqual({ ignored: 1, edited: 1 });
  });
});

describe('validateBatch — reviewer overrides', () => {
  it('leaves the batch untouched when there are no overrides', async () => {
    const batch = await validateBatch(rowsOf(UNKNOWN_CSV));
    expect(batch.counts).toEqual({ total: 2, imported: 1, unknown: 1, invalid: 0, ignored: 0 });
  });

  it('turns an ignored row into an accounted ignored outcome', async () => {
    const overrides: RowOverrides = { 2: { kind: 'ignore' } };
    const batch = await validateBatch(rowsOf(UNKNOWN_CSV), overrides);

    expect(batch.counts).toEqual({ total: 2, imported: 1, unknown: 0, invalid: 0, ignored: 1 });
    // Conservation still holds: the row is excluded, never dropped.
    expect(batch.outcomes).toHaveLength(2);
    expect(batch.outcomes[1]).toMatchObject({
      rowIndex: 2,
      kind: 'ignored',
      reasons: ['user-ignored'],
    });
    // Fingerprints still cover every source row.
    expect(batch.fingerprints).toHaveLength(2);
  });

  it('re-validates an edited row through the normal pipeline', async () => {
    const overrides: RowOverrides = {
      2: { kind: 'edit', patch: { type: 'DIVIDEND' } },
    };
    const batch = await validateBatch(rowsOf(UNKNOWN_CSV), overrides);

    expect(batch.counts.unknown).toBe(0);
    expect(batch.counts.imported).toBe(2);
    const edited = batch.outcomes[1];
    expect(edited.kind).toBe('imported');
    expect(edited.draft?.activityType).toBe('DIVIDEND');
    // The edit stays auditable on the outcome.
    expect(edited.edited).toBe(true);
    expect(batch.outcomes[0].edited).toBeUndefined();
  });

  it('lets an edit rescue a structurally invalid row', async () => {
    const before = await validateBatch(rowsOf(INVALID_CSV));
    expect(before.counts.invalid).toBe(1);

    const batch = await validateBatch(rowsOf(INVALID_CSV), {
      1: { kind: 'edit', patch: { quantity: '2' } },
    });
    expect(batch.counts.invalid).toBe(0);
    expect(batch.outcomes[0].draft?.quantity).toBe('2');
  });

  it('treats a patch that changes nothing as no edit at all', async () => {
    const batch = await validateBatch(rowsOf(UNKNOWN_CSV), {
      2: { kind: 'edit', patch: { type: 'MYSTERY EVENT' } },
    });
    expect(batch.counts.unknown).toBe(1);
    expect(batch.outcomes[1].edited).toBeUndefined();
  });

  it('fingerprints the corrected values, not the originals', async () => {
    const pristine = await validateBatch(rowsOf(UNKNOWN_CSV));
    const edited = await validateBatch(rowsOf(UNKNOWN_CSV), {
      2: { kind: 'edit', patch: { totalAmount: 'USD 400.00' } },
    });
    // A corrected row is a different economic event, so it must not collide
    // with the identity the original row would have had.
    expect(edited.fingerprints[1]).not.toBe(pristine.fingerprints[1]);
    expect(edited.fingerprints[0]).toBe(pristine.fingerprints[0]);
  });

  it('rebuilds from pristine rows so edits never stack', async () => {
    const rows = rowsOf(UNKNOWN_CSV);
    const first = await validateBatch(rows, {
      2: { kind: 'edit', patch: { type: 'DIVIDEND' } },
    });
    const second = await validateBatch(rows, {
      2: { kind: 'edit', patch: { type: 'CASH TOP-UP' } },
    });

    expect(rows[1].type).toBe('MYSTERY EVENT');
    expect(first.outcomes[1].draft?.activityType).toBe('DIVIDEND');
    expect(second.outcomes[1].draft?.activityType).toBe('DEPOSIT');
  });
});
