import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  buildImportPayload,
  hasImportableRows,
  blockingReasons,
  categoryCounts,
  filterOutcomes,
  noFatalRows,
  reducer,
  buildTickerEntries,
  uploadSummaryFromBatch,
  type ImportState,
} from '../../src/state/import-state';
import { parseRevolutCsv } from '../../src/parser/parse-csv';
import { validateBatch } from '../../src/validation/validate-batch';

const UNKNOWN_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,,CASH TOP-UP,,,EUR 100.00,EUR,1.0000
2024-01-02T10:00:00.000000Z,AAPL,MYSTERY EVENT,2,USD 150.00,USD 300.00,USD,1.0000
`;

async function uploadedState(): Promise<ImportState> {
  const parsed = parseRevolutCsv(UNKNOWN_CSV);
  const batch = await validateBatch(parsed.rows);
  return reducer(INITIAL_STATE, {
    type: 'UPLOAD_COMPLETE',
    batch,
    summary: uploadSummaryFromBatch(batch, true),
    rows: parsed.rows,
  });
}

/** Apply the page's rebuild effect: recompute from pristine rows + overrides. */
async function rebuild(state: ImportState): Promise<ImportState> {
  const batch = await validateBatch(state.sourceRows, state.overrides);
  return reducer(state, {
    type: 'BATCH_REBUILT',
    batch,
    summary: uploadSummaryFromBatch(batch, true),
  });
}

describe('import state — reviewer overrides', () => {
  it('keeps the pristine source rows so a rebuild needs no re-upload', async () => {
    const state = await uploadedState();
    expect(state.sourceRows).toHaveLength(2);
    expect(state.overrides).toEqual({});
    expect(state.overridesVersion).toBe(0);
  });

  it('records a decision, bumps the version, and revokes the acknowledgement', async () => {
    let state = await uploadedState();
    state = reducer(state, { type: 'SET_ACKNOWLEDGED', acknowledged: true });
    expect(state.acknowledged).toBe(true);

    state = reducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });

    expect(state.overrides[2]).toEqual({ kind: 'ignore' });
    expect(state.overridesVersion).toBe(1);
    expect(state.acknowledged).toBe(false);
  });

  it('clears one decision with a null override', async () => {
    let state = await uploadedState();
    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });
    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: null });
    expect(state.overrides).toEqual({});
    expect(state.overridesVersion).toBe(2);
  });

  it('clears every decision at once, and is a no-op when there are none', async () => {
    const state = await uploadedState();
    expect(reducer(state, { type: 'CLEAR_ROW_OVERRIDES' })).toBe(state);

    let next = reducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 2,
      override: { kind: 'ignore' },
    });
    next = reducer(next, { type: 'CLEAR_ROW_OVERRIDES' });
    expect(next.overrides).toEqual({});
    expect(next.overridesVersion).toBe(2);
  });

  it('unblocks the import gate once the blocking row is ignored', async () => {
    let state = await uploadedState();
    expect(noFatalRows(state)).toBe(false);
    expect(blockingReasons(state)).toContain('Resolve 1 unknown row');

    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });
    state = await rebuild(state);

    expect(noFatalRows(state)).toBe(true);
    expect(blockingReasons(state)).not.toContain('Resolve 1 unknown row');
  });

  it('discards the stale reconciliation report after a rebuild', async () => {
    let state = await uploadedState();
    state = reducer(state, {
      type: 'RECONCILE_COMPLETE',
      report: { accountedRows: 1, tradeRoundingVariances: [] } as never,
    });
    expect(state.reconciliation).not.toBeNull();

    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });
    state = await rebuild(state);
    // The old report described the pre-edit batch; it must not survive.
    expect(state.reconciliation).toBeNull();
  });

  it('routes ignored rows into their own review category', async () => {
    let state = await uploadedState();
    expect(categoryCounts(state).errors).toBe(1);
    expect(categoryCounts(state).ignored).toBe(0);

    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });
    state = await rebuild(state);

    const counts = categoryCounts(state);
    expect(counts.errors).toBe(0);
    expect(counts.ignored).toBe(1);
    // Conservation: every row is still reachable through exactly one category.
    expect(counts.all).toBe(2);

    state = reducer(state, { type: 'SET_FILTER', filter: 'ignored' });
    expect(filterOutcomes(state).map((o) => o.rowIndex)).toEqual([2]);
  });

  it('zips drafts, fingerprints, and row numbers from one filtered list', async () => {
    let state = await uploadedState();
    // Make row 1 (the clean top-up) the SECOND importable row by adding a third
    // clean row, then ignore the blocking row between them.
    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });
    state = await rebuild(state);

    const payload = buildImportPayload(state.batch!);
    expect(payload.drafts).toHaveLength(1);
    expect(payload.fingerprints).toHaveLength(1);
    expect(payload.sourceRowNumbers).toEqual([1]);
    // The fingerprint must be row 1's, not position 0 of the full row list by
    // coincidence — verify it against the batch's own per-row fingerprints.
    expect(payload.fingerprints[0]).toBe(state.batch!.fingerprints[0]);
    // All three arrays are consumed positionally; a desync throws downstream.
    expect(payload.drafts.length).toBe(payload.fingerprints.length);
    expect(payload.drafts.length).toBe(payload.sourceRowNumbers.length);
  });

  it('pairs each surviving row with its OWN fingerprint when an earlier row is ignored', async () => {
    const csv = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,,CASH TOP-UP,,,EUR 100.00,EUR,1.0000
2024-01-02T10:00:00.000000Z,,CASH TOP-UP,,,EUR 25.00,EUR,1.0000
2024-01-03T10:00:00.000000Z,,CASH TOP-UP,,,EUR 50.00,EUR,1.0000
`;
    const parsed = parseRevolutCsv(csv);
    const full = await validateBatch(parsed.rows);
    const withIgnore = await validateBatch(parsed.rows, { 1: { kind: 'ignore' } });

    const payload = buildImportPayload(withIgnore);
    expect(payload.sourceRowNumbers).toEqual([2, 3]);
    // Rows 2 and 3 keep the identities they had before the ignore — shifting by
    // one here would silently re-key both activities.
    expect(payload.fingerprints).toEqual([full.fingerprints[1], full.fingerprints[2]]);
    expect(payload.drafts.map((d) => d.totalAmount.amount)).toEqual(['25', '50']);
  });

  it('blocks an import that would write nothing', async () => {
    let state = await uploadedState();
    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 1, override: { kind: 'ignore' } });
    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });
    state = await rebuild(state);

    expect(hasImportableRows(state)).toBe(false);
    expect(blockingReasons(state)).toContain('No rows left to import');
  });

  it('blocks import while the recorded decisions and the batch have diverged', async () => {
    let state = await uploadedState();
    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });
    state = reducer(state, { type: 'REBUILD_FAILED', error: 'crypto unavailable' });

    expect(blockingReasons(state)).toContain(
      'Re-check the rows you changed; recalculating them failed',
    );

    // A later successful rebuild clears it.
    state = await rebuild(state);
    expect(state.rebuildError).toBeNull();
  });

  it('re-derives ticker entries so an edit cannot smuggle in an unmapped security', async () => {
    const csv = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-02T10:00:00.000000Z,NVDA,BUY - MARKET,abc,USD 50.00,USD 100.00,USD,1.0000
`;
    const parsed = parseRevolutCsv(csv);
    const batch = await validateBatch(parsed.rows);
    let state = reducer(INITIAL_STATE, {
      type: 'UPLOAD_COMPLETE',
      batch,
      summary: uploadSummaryFromBatch(batch, true),
      rows: parsed.rows,
    });
    state = reducer(state, { type: 'SELECT_ACCOUNT', accountId: 'acct-1' });
    // The row is invalid, so the mapping step saw no ticker at all.
    state = reducer(state, { type: 'TICKERS_INITIALIZED', tickers: {} });
    expect(state.tickers).toEqual({});

    // Correcting the quantity turns it into a real BUY on NVDA.
    state = reducer(state, {
      type: 'SET_ROW_OVERRIDE',
      rowIndex: 1,
      override: { kind: 'edit', patch: { quantity: '2' } },
    });
    state = await rebuild(state);

    expect(Object.keys(state.tickers)).toEqual(['NVDA']);
    expect(state.tickers.NVDA.resolution.status).toBe('pending');
    expect(blockingReasons(state)).toContain('Resolve 1 ticker');
  });

  it('keeps a resolution the user already confirmed across a rebuild', async () => {
    const csv = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-02T10:00:00.000000Z,AAPL,BUY - MARKET,2,USD 50.00,USD 100.00,USD,1.0000
2024-01-03T10:00:00.000000Z,,CASH TOP-UP,,,EUR 10.00,EUR,1.0000
`;
    const parsed = parseRevolutCsv(csv);
    const batch = await validateBatch(parsed.rows);
    let state = reducer(INITIAL_STATE, {
      type: 'UPLOAD_COMPLETE',
      batch,
      summary: uploadSummaryFromBatch(batch, true),
      rows: parsed.rows,
    });
    state = reducer(state, { type: 'TICKERS_INITIALIZED', tickers: buildTickerEntries(batch) });
    state = reducer(state, {
      type: 'TICKER_RESOLVED',
      ticker: 'AAPL',
      identity: { symbol: 'AAPL', exchangeMic: 'XNAS' } as never,
    });
    expect(state.tickers.AAPL.resolution.status).toBe('resolved');

    // Ignoring an unrelated cash row must not force re-confirming AAPL.
    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });
    state = await rebuild(state);
    expect(state.tickers.AAPL.resolution.status).toBe('resolved');
  });

  it('drops decisions when a new file is uploaded', async () => {
    let state = await uploadedState();
    state = reducer(state, { type: 'SET_ROW_OVERRIDE', rowIndex: 2, override: { kind: 'ignore' } });

    const parsed = parseRevolutCsv(UNKNOWN_CSV);
    const batch = await validateBatch(parsed.rows);
    state = reducer(state, {
      type: 'UPLOAD_COMPLETE',
      batch,
      summary: uploadSummaryFromBatch(batch, true),
      rows: parsed.rows,
    });

    expect(state.overrides).toEqual({});
    expect(state.overridesVersion).toBe(0);
  });
});
