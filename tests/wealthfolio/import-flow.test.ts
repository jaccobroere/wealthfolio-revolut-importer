/**
 * Idempotent import flow tests for the Revolut adapter.
 *
 * Proves with a fake/in-memory HostAPI:
 * 1. Identical second import performs zero `saveMany` creates.
 * 2. Overlapping import creates only new rows.
 * 3. Failed/partial `saveMany` never marks failed fingerprints as imported.
 * 4. Each add-on ignores the other's metadata.
 * 5. `saveMany` is always called with `{ creates }` (never a bare array);
 *    `deleteIds` is never produced; metadata is non-sensitive.
 * 6. `UNKNOWN` activity types are blocked (never sent to the host).
 */
import { describe, expect, it } from 'vitest';

import type { ActivityDraft } from '../../src/domain/activity-draft';
import { IMPORTER_ID } from '../../src/wealthfolio/types';
import { runImport } from '../../src/wealthfolio/import';
import { buildDuplicateIndex } from '../../src/wealthfolio/duplicate-index';
import { createFakeHost, foreignSeededActivity, seededActivity } from './fake-host';

/** A minimal valid BUY draft. */
function buyDraft(opts: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    schemaVersion: 'revolut-investment-csv:v1',
    date: '2024-01-15T10:00:00Z',
    sourceType: 'BUY - MARKET',
    activityType: 'BUY',
    ticker: 'AAPL',
    quantity: '10',
    unitPrice: { currency: 'USD', amount: '150' },
    totalAmount: { currency: 'USD', amount: '1500' },
    currency: 'USD',
    fxRate: '1',
    rawSignedAmount: '-1500',
    ...opts,
  };
}

/** A minimal valid DIVIDEND draft. */
function dividendDraft(opts: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    schemaVersion: 'revolut-investment-csv:v1',
    date: '2024-02-15T10:00:00Z',
    sourceType: 'DIVIDEND',
    activityType: 'DIVIDEND',
    ticker: 'AAPL',
    quantity: '10',
    totalAmount: { currency: 'USD', amount: '50' },
    currency: 'USD',
    fxRate: '1',
    rawSignedAmount: '50',
    ...opts,
  };
}

/** A minimal valid DEPOSIT (cash) draft. */
function depositDraft(opts: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    schemaVersion: 'revolut-investment-csv:v1',
    date: '2024-03-01T10:00:00Z',
    sourceType: 'CASH TOP-UP',
    activityType: 'DEPOSIT',
    ticker: '',
    totalAmount: { currency: 'EUR', amount: '500' },
    currency: 'EUR',
    fxRate: '1',
    rawSignedAmount: '500',
    ...opts,
  };
}

/** A blocked UNKNOWN draft. */
function unknownDraft(opts: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    schemaVersion: 'revolut-investment-csv:v1',
    date: '2024-04-01T10:00:00Z',
    sourceType: 'SOME UNKNOWN TYPE',
    activityType: 'UNKNOWN',
    ticker: 'XYZ',
    totalAmount: { currency: 'EUR', amount: '10' },
    currency: 'EUR',
    fxRate: '1',
    rawSignedAmount: '10',
    ...opts,
  };
}

describe('Revolut adapter: idempotent import flow', () => {
  it('creates all rows on first import and marks their fingerprints imported', async () => {
    const host = createFakeHost();
    const drafts = [buyDraft(), dividendDraft()];
    const fps = ['fp-buy-1', 'fp-div-1'];
    const rows = [2, 3];

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.attempted).toBe(2);
    expect(result.created).toBe(2);
    expect(result.importedFingerprints).toHaveLength(2);
    expect(result.failedFingerprints).toHaveLength(0);
    expect(result.skippedDuplicates).toBe(0);
    expect(result.fatal).toBeUndefined();
    expect(host.saveManyCalls).toHaveLength(1);
    expect(host.saveManyCalls[0].request.creates).toHaveLength(2);
    expect(host.saveManyCalls[0].request.deleteIds).toBeUndefined();
    expect(host.saveManyCalls[0].request.updates).toBeUndefined();
  });

  it('identical second import performs zero saveMany creates', async () => {
    const host = createFakeHost();
    const drafts = [buyDraft(), dividendDraft()];
    const fps = ['fp-buy-1', 'fp-div-1'];
    const rows = [2, 3];

    await runImport(host.api, 'acct-1', drafts, fps, rows);
    expect(host.saveManyCalls).toHaveLength(1);

    const result2 = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result2.attempted).toBe(0);
    expect(result2.created).toBe(0);
    expect(result2.importedFingerprints).toHaveLength(0);
    expect(result2.skippedDuplicates).toBe(2);
    expect(host.saveManyCalls).toHaveLength(1);
  });

  it('overlapping import creates only new rows', async () => {
    const host = createFakeHost();
    const firstDrafts = [buyDraft(), dividendDraft()];
    const firstFps = ['fp-buy-1', 'fp-div-1'];
    const firstRows = [2, 3];
    await runImport(host.api, 'acct-1', firstDrafts, firstFps, firstRows);
    expect(host.saveManyCalls).toHaveLength(1);

    // Overlapping import: same BUY + a new DEPOSIT.
    const overlap = [buyDraft(), depositDraft()];
    const overlapFps = ['fp-buy-1', 'fp-dep-1'];
    const overlapRows = [2, 4];
    const result2 = await runImport(host.api, 'acct-1', overlap, overlapFps, overlapRows);

    expect(result2.attempted).toBe(1);
    expect(result2.created).toBe(1);
    expect(result2.skippedDuplicates).toBe(1);
    expect(result2.importedFingerprints).toHaveLength(1);
    expect(host.saveManyCalls).toHaveLength(2);
    expect(host.saveManyCalls[1].request.creates).toHaveLength(1);
  });

  it('failed saveMany (throw) never marks failed fingerprints as imported', async () => {
    const host = createFakeHost({ saveManyError: new Error('host down') });
    const drafts = [buyDraft(), dividendDraft()];
    const fps = ['fp-buy-1', 'fp-div-1'];
    const rows = [2, 3];

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.attempted).toBe(2);
    expect(result.created).toBe(0);
    expect(result.importedFingerprints).toHaveLength(0);
    expect(result.failedFingerprints).toHaveLength(2);
    expect(result.fatal).toBe('host down');
    expect(host.storedActivities).toHaveLength(0);
  });

  it('partial saveMany (errors non-empty) never marks failed fingerprints as imported', async () => {
    const host = createFakeHost({ saveManyErrorCount: 1 });
    const drafts = [buyDraft(), dividendDraft()];
    const fps = ['fp-buy-1', 'fp-div-1'];
    const rows = [2, 3];

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.attempted).toBe(2);
    expect(result.created).toBe(1);
    expect(result.importedFingerprints).toHaveLength(1);
    expect(result.failedFingerprints).toHaveLength(1);
    expect(result.fatal).toBeUndefined();
    expect(host.storedActivities).toHaveLength(1);
  });

  it('fatal checkImport error returns to review and keeps Import disabled', async () => {
    const host = createFakeHost({ checkImportError: new Error('host validation fatal') });
    const drafts = [buyDraft()];
    const fps = ['fp-buy-1'];
    const rows = [2];

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.attempted).toBe(0);
    expect(result.created).toBe(0);
    expect(result.fatal).toBe('host validation fatal');
    expect(host.saveManyCalls).toHaveLength(0);
  });

  it('UNKNOWN activity types are blocked and never sent to the host', async () => {
    const host = createFakeHost();
    const drafts = [buyDraft(), unknownDraft()];
    const fps = ['fp-buy-1', 'fp-unk-1'];
    const rows = [2, 3];

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.attempted).toBe(1);
    expect(result.created).toBe(1);
    expect(result.blocked).toBe(1);
    expect(host.saveManyCalls).toHaveLength(1);
    expect(host.saveManyCalls[0].request.creates).toHaveLength(1);
  });

  it('each add-on ignores the other importer metadata', async () => {
    const foreignFp = 'foreign-fingerprint-aaaa';
    const foreign = foreignSeededActivity('acct-1', foreignFp, 'degiro-importer');
    const host = createFakeHost({ activities: [foreign] });

    const drafts = [buyDraft()];
    const fps = ['fp-buy-1'];
    const rows = [2];
    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.attempted).toBe(1);
    expect(result.created).toBe(1);
    expect(result.skippedDuplicates).toBe(0);
  });

  it('duplicate index filters by importerId', () => {
    const fp = 'shared-fp';
    const mine = seededActivity('acct-1', fp);
    const theirs = foreignSeededActivity('acct-1', fp, 'degiro-importer');

    const index = buildDuplicateIndex([mine, theirs]);
    expect(index.importedFingerprints.has(fp)).toBe(true);

    const indexOnlyTheirs = buildDuplicateIndex([theirs]);
    expect(indexOnlyTheirs.importedFingerprints.has(fp)).toBe(false);
  });

  it('saveMany is always called with { creates } and never deleteIds', async () => {
    const host = createFakeHost();
    await runImport(host.api, 'acct-1', [buyDraft()], ['fp-buy-1'], [2]);
    expect(host.saveManyCalls).toHaveLength(1);
    const req = host.saveManyCalls[0].request;
    expect(Array.isArray(req.creates)).toBe(true);
    expect(req.deleteIds).toBeUndefined();
    expect(req.updates).toBeUndefined();
    expect(Array.isArray(host.saveManyCalls[0].request)).toBe(false);
  });

  it('metadata is non-sensitive (no raw rows, balances, filenames, or paths)', async () => {
    const host = createFakeHost();
    await runImport(host.api, 'acct-1', [buyDraft()], ['fp-buy-1'], [2]);

    const meta = host.storedActivities[0].metadata as Record<string, unknown> | undefined;
    expect(meta).toBeDefined();
    expect(meta?.importerId).toBe(IMPORTER_ID);
    expect(meta?.sourceFingerprint).toBe('fp-buy-1');
    expect(meta?.sourceRowNumber).toBe(2);
    expect(meta?.sourceTicker).toBe('AAPL');
    // Forbidden fields must never appear.
    expect(meta?.rawRow).toBeUndefined();
    expect(meta?.rawRecord).toBeUndefined();
    expect(meta?.balance).toBeUndefined();
    expect(meta?.filename).toBeUndefined();
    expect(meta?.path).toBeUndefined();
    expect(meta?.statementPath).toBeUndefined();
  });

  it('prepareDrafts rejects mismatched input lengths', async () => {
    const { prepareDrafts } = await import('../../src/wealthfolio/import');
    await expect(prepareDrafts([buyDraft()], ['fp-1', 'fp-2'], [2])).rejects.toThrow(
      /length mismatch/,
    );
  });
});
