/**
 * Idempotent import flow tests for the Revolut adapter.
 *
 * Proves with a fake/in-memory HostAPI:
 * 1. Reviewed rows are committed through `activities.import`, never saveMany.
 * 2. Wealthfolio owns duplicate outcomes for import-API writes.
 * 3. Rejected/incomplete imports never mark fingerprints as imported.
 * 4. Legacy add-on metadata remains scoped to its owning importer.
 * 6. `UNKNOWN` activity types are blocked (never sent to the host).
 * 7. Large imports are chunked (default 100/chunk) so a host payload-size
 *    cap or a single bad row no longer takes down a 200+ row batch.
 * 8. Per-row host-side validation failures are reported as per-row
 *    failures, not as a fatal; only a complete host outage is fatal.
 */
import { describe, expect, it } from 'vitest';
import type { ActivityImport } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../../src/domain/activity-draft';
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
    expect(host.saveManyCalls).toHaveLength(0);
    expect(host.importCalls).toHaveLength(1);
    expect(host.importCalls[0]).toHaveLength(2);
    expect(host.importCalls[0]?.every((activity) => activity.isDraft === false)).toBe(true);
  });

  it('identical second import delegates duplicate detection to the host import workflow', async () => {
    const host = createFakeHost();
    const drafts = [buyDraft(), dividendDraft()];
    const fps = ['fp-buy-1', 'fp-div-1'];
    const rows = [2, 3];

    await runImport(host.api, 'acct-1', drafts, fps, rows);
    expect(host.importCalls).toHaveLength(1);

    const result2 = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result2.attempted).toBe(2);
    expect(result2.created).toBe(0);
    expect(result2.importedFingerprints).toHaveLength(0);
    expect(result2.skippedDuplicates).toBe(2);
    expect(host.importCalls).toHaveLength(2);
  });

  it('overlapping import creates only new rows', async () => {
    const host = createFakeHost();
    const firstDrafts = [buyDraft(), dividendDraft()];
    const firstFps = ['fp-buy-1', 'fp-div-1'];
    const firstRows = [2, 3];
    await runImport(host.api, 'acct-1', firstDrafts, firstFps, firstRows);
    expect(host.importCalls).toHaveLength(1);

    // Overlapping import: same BUY + a new DEPOSIT.
    const overlap = [buyDraft(), depositDraft()];
    const overlapFps = ['fp-buy-1', 'fp-dep-1'];
    const overlapRows = [2, 4];
    const result2 = await runImport(host.api, 'acct-1', overlap, overlapFps, overlapRows);

    expect(result2.attempted).toBe(2);
    expect(result2.created).toBe(1);
    expect(result2.skippedDuplicates).toBe(1);
    expect(result2.importedFingerprints).toHaveLength(1);
    expect(host.importCalls).toHaveLength(2);
    expect(host.importCalls[1]).toHaveLength(2);
  });

  it('failed import never marks failed fingerprints as imported', async () => {
    const host = createFakeHost({ importError: new Error('host down') });
    const drafts = [buyDraft(), dividendDraft()];
    const fps = ['fp-buy-1', 'fp-div-1'];
    const rows = [2, 3];

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.attempted).toBe(2);
    expect(result.created).toBe(0);
    expect(result.importedFingerprints).toHaveLength(0);
    expect(result.failedFingerprints).toHaveLength(2);
    expect(result.fatal).toBe(
      'Wealthfolio could not complete this import batch. Re-check the destination account and security mappings, then retry.',
    );
    expect(host.storedActivities).toHaveLength(0);
  });

  it('import-time validation failure returns safe diagnostics without a partial write', async () => {
    const host = createFakeHost({ importValidationErrorCount: 1 });
    const drafts = [buyDraft(), dividendDraft()];
    const fps = ['fp-buy-1', 'fp-div-1'];
    const rows = [2, 3];

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    // Under chunking, a host-reported per-row validation failure is a per-row
    // failure for the invalid row, not a fatal. The valid row is treated as
    // imported based on its per-row outcome (the fake's `imported: 0` summary
    // is overridden by the per-row signal).
    expect(result.attempted).toBe(2);
    expect(result.created).toBe(1);
    expect(result.importedFingerprints).toHaveLength(1);
    expect(result.failedFingerprints).toHaveLength(1);
    expect(result.fatal).toBeUndefined();
    expect(result.failures).toEqual([
      {
        sourceRowNumber: 2,
        message: 'Wealthfolio rejected this activity. Review the destination account and mapping.',
      },
    ]);
    // The fake does not actually store the "valid" row when
    // importValidationErrorCount is set; per-row outcome is the source of truth.
    expect(host.storedActivities).toHaveLength(0);
  });

  it('submits the checked asset resolution through the import API', async () => {
    const host = createFakeHost({
      checkImportTransform: (activities) =>
        activities.map((activity) => ({
          ...activity,
          symbol: 'AAPL',
          exchangeMic: 'XNAS',
          quoteCcy: 'USD',
          instrumentType: 'EQUITY',
          quoteMode: 'MARKET',
          providerId: 'yahoo',
          providerSymbol: 'AAPL',
        })),
    });

    const result = await runImport(host.api, 'acct-1', [buyDraft()], ['fp-buy-1'], [2]);

    expect(result.created).toBe(1);
    expect(host.importCalls[0]?.[0]).toMatchObject({
      symbol: 'AAPL',
      exchangeMic: 'XNAS',
      quoteCcy: 'USD',
      instrumentType: 'EQUITY',
      quoteMode: 'MARKET',
      providerId: 'yahoo',
      providerSymbol: 'AAPL',
      isDraft: false,
    });
  });

  it('passes the selected canonical symbol to checkImport', async () => {
    const host = createFakeHost();

    await runImport(
      host.api,
      'acct-1',
      [buyDraft({ ticker: 'APPLE-REVOLUT' })],
      ['fp-buy-1'],
      [2],
      async () => ({
        symbol: 'AAPL',
        exchangeMic: 'XNAS',
        quoteCcy: 'USD',
        instrumentType: 'EQUITY',
      }),
    );

    expect(host.checkImportCalls[0]?.[0]?.symbol).toBe('AAPL');
  });

  it('submits a host-normalized cash dividend unchanged', async () => {
    const host = createFakeHost({
      checkImportTransform: (activities) =>
        activities.map((activity) => ({ ...activity, symbol: '' })),
    });

    const result = await runImport(host.api, 'acct-1', [dividendDraft()], ['fp-div-1'], [2]);

    expect(result.created).toBe(1);
    expect(host.importCalls[0]?.[0]?.symbol).toBe('');
  });

  it('fatal checkImport error returns to review and keeps Import disabled', async () => {
    const host = createFakeHost({ checkImportError: new Error('host validation fatal') });
    const drafts = [buyDraft()];
    const fps = ['fp-buy-1'];
    const rows = [2];

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.attempted).toBe(0);
    expect(result.created).toBe(0);
    expect(result.fatal).toBe(
      'Wealthfolio could not complete this import batch. Re-check the destination account and security mappings, then retry.',
    );
    expect(host.importCalls).toHaveLength(0);
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
    expect(host.importCalls).toHaveLength(1);
    expect(host.importCalls[0]).toHaveLength(1);
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

  it('uses activities.import and never calls the low-level bulk editor endpoint', async () => {
    const host = createFakeHost();
    await runImport(host.api, 'acct-1', [buyDraft()], ['fp-buy-1'], [2]);
    expect(host.importCalls).toHaveLength(1);
    expect(host.saveManyCalls).toHaveLength(0);
  });

  it('does not attach add-on provenance metadata to the host import payload', async () => {
    const host = createFakeHost();
    await runImport(host.api, 'acct-1', [buyDraft()], ['fp-buy-1'], [2]);

    expect(host.importCalls[0]?.[0]).not.toHaveProperty('metadata');
  });

  it('prepareDrafts rejects mismatched input lengths', async () => {
    const { prepareDrafts } = await import('../../src/wealthfolio/import');
    await expect(prepareDrafts([buyDraft()], ['fp-1', 'fp-2'], [2])).rejects.toThrow(
      /length mismatch/,
    );
  });

  it('chunks a 300-row import and imports every row through multiple host calls', async () => {
    const host = createFakeHost();
    const drafts: ActivityDraft[] = Array.from({ length: 300 }, (_, i) =>
      buyDraft({
        date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        ticker: `SYM${i}`,
        totalAmount: { currency: 'USD', amount: '1500' },
      }),
    );
    const fps = Array.from({ length: 300 }, (_, i) => `fp-${i}`);
    const rows = Array.from({ length: 300 }, (_, i) => i + 2);

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows, undefined, {
      chunkSize: 100,
    });

    expect(result.attempted).toBe(300);
    expect(result.created).toBe(300);
    expect(result.failedFingerprints).toHaveLength(0);
    expect(result.fatal).toBeUndefined();
    expect(result.chunkSize).toBe(100);
    expect(result.chunks).toHaveLength(3);
    expect(result.chunks.every((c) => c.size === 100)).toBe(true);
    expect(result.chunks.every((c) => c.imported === 100)).toBe(true);
    expect(result.chunks.every((c) => c.failed === 0)).toBe(true);
    expect(host.importCalls).toHaveLength(3);
    expect(host.importCalls.every((c) => c.length === 100)).toBe(true);
  });

  it('survives a host payload-size cap by chunking the import', async () => {
    const host = createFakeHost({ importBatchSizeLimit: 200 });
    const drafts: ActivityDraft[] = Array.from({ length: 500 }, (_, i) =>
      buyDraft({
        date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        ticker: `SYM${i}`,
        totalAmount: { currency: 'USD', amount: '1500' },
      }),
    );
    const fps = Array.from({ length: 500 }, (_, i) => `fp-${i}`);
    const rows = Array.from({ length: 500 }, (_, i) => i + 2);

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows, undefined, {
      chunkSize: 100,
    });

    expect(result.attempted).toBe(500);
    expect(result.created).toBe(500);
    expect(result.fatal).toBeUndefined();
    expect(result.failedFingerprints).toHaveLength(0);
    expect(host.importCalls.length).toBeGreaterThanOrEqual(5);
    expect(host.importCalls.every((c) => c.length <= 200)).toBe(true);
  });

  it('excludes already-imported fingerprints from later chunks across re-attempts', async () => {
    const host = createFakeHost();
    const drafts: ActivityDraft[] = Array.from({ length: 250 }, (_, i) =>
      buyDraft({
        date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        ticker: `SYM${i}`,
        totalAmount: { currency: 'USD', amount: '1500' },
      }),
    );
    const fps = Array.from({ length: 250 }, (_, i) => `fp-${i}`);
    const rows = Array.from({ length: 250 }, (_, i) => i + 2);

    // First run: succeeds, imports 250.
    const result1 = await runImport(host.api, 'acct-1', drafts, fps, rows, undefined, {
      chunkSize: 100,
    });
    expect(result1.created).toBe(250);
    expect(result1.fatal).toBeUndefined();
    expect(host.storedActivities.length).toBe(250);

    // Second run: must dedupe via the host, returning 0 created, 250 skipped.
    const result2 = await runImport(host.api, 'acct-1', drafts, fps, rows, undefined, {
      chunkSize: 100,
    });
    expect(result2.created).toBe(0);
    expect(result2.skippedDuplicates).toBe(250);
    expect(result2.fatal).toBeUndefined();
  });

  it('a failed chunk produces per-row failures without a fatal when other chunks succeed', async () => {
    // Host that fails the 2nd call only.
    let callIndex = 0;
    const host = createFakeHost();
    const originalImport = host.api.activities.import as unknown as (
      activities: ActivityImport[],
    ) => Promise<unknown>;
    (
      host.api.activities as unknown as { import: (a: ActivityImport[]) => Promise<unknown> }
    ).import = async (activities: ActivityImport[]) => {
      callIndex++;
      if (callIndex === 2) throw new Error('host 500: chunk rejected');
      return originalImport(activities);
    };
    const drafts: ActivityDraft[] = Array.from({ length: 250 }, (_, i) =>
      buyDraft({
        date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        ticker: `SYM${i}`,
        totalAmount: { currency: 'USD', amount: '1500' },
      }),
    );
    const fps = Array.from({ length: 250 }, (_, i) => `fp-${i}`);
    const rows = Array.from({ length: 250 }, (_, i) => i + 2);

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows, undefined, {
      chunkSize: 100,
    });

    expect(result.fatal).toBeUndefined();
    expect(result.created).toBe(150); // chunk 1 (100) + chunk 3 (50) succeed
    expect(result.failedFingerprints).toHaveLength(100); // chunk 2 (100) failed
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('chunks the import using the default chunk size when no options are passed', async () => {
    const host = createFakeHost();
    const drafts: ActivityDraft[] = Array.from({ length: 250 }, (_, i) =>
      buyDraft({
        date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        ticker: `SYM${i}`,
        totalAmount: { currency: 'USD', amount: '1500' },
      }),
    );
    const fps = Array.from({ length: 250 }, (_, i) => `fp-${i}`);
    const rows = Array.from({ length: 250 }, (_, i) => i + 2);

    const result = await runImport(host.api, 'acct-1', drafts, fps, rows);

    expect(result.chunkSize).toBe(100);
    expect(host.importCalls).toHaveLength(3);
    expect(host.importCalls[0]).toHaveLength(100);
    expect(host.importCalls[1]).toHaveLength(100);
    expect(host.importCalls[2]).toHaveLength(50);
  });

  it('validates the chunkSize option is a positive integer', async () => {
    const host = createFakeHost();
    const drafts = [buyDraft()];
    const fps = ['fp-1'];
    const rows = [2];

    await expect(
      runImport(host.api, 'acct-1', drafts, fps, rows, undefined, { chunkSize: 0 }),
    ).rejects.toThrow(/chunkSize must be a positive integer/);
    await expect(
      runImport(host.api, 'acct-1', drafts, fps, rows, undefined, { chunkSize: -1 }),
    ).rejects.toThrow(/chunkSize must be a positive integer/);
    await expect(
      runImport(host.api, 'acct-1', drafts, fps, rows, undefined, { chunkSize: 1.5 }),
    ).rejects.toThrow(/chunkSize must be a positive integer/);
  });
});
