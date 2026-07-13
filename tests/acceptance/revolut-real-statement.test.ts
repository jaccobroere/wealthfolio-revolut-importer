import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRevolutCsv } from '../../src/parser/parse-csv';
import { validateBatch } from '../../src/validation/validate-batch';
import { reconcile } from '../../src/reconciliation/reconcile';
import { loadBaseline } from './load-baseline';

type Baseline = {
  totalRows: number;
  sourceTypes: Record<string, number>;
  normalizedTypes: Record<string, number>;
  currencyCount: number;
  roundingDiagnostics: number;
};
const countBy = (values: readonly string[]) =>
  values.reduce<Record<string, number>>(
    (out, value) => ({ ...out, [value]: (out[value] ?? 0) + 1 }),
    {},
  );
function statementPath(): string {
  const path = process.env.REVOLUT_ACCEPTANCE_CSV;
  if (!path) throw new Error('REVOLUT_ACCEPTANCE_CSV is not set.');
  if (!statSync(path).isFile()) throw new Error('REVOLUT_ACCEPTANCE_CSV is not a file.');
  return path;
}

describe('Revolut local acceptance gate', () => {
  it('matches the reviewed local structural baseline', async () => {
    const baseline = loadBaseline<Baseline>();
    const parsed = parseRevolutCsv(readFileSync(statementPath(), 'utf8'));
    if (!parsed.header.ok) throw new Error('Revolut schema validation failed.');
    const batch = await validateBatch(parsed.rows);
    const report = reconcile(batch.outcomes);
    expect(parsed.rows).toHaveLength(baseline.totalRows);
    expect(countBy(parsed.rows.map((row) => row.type))).toEqual(baseline.sourceTypes);
    expect(
      countBy(batch.outcomes.map((outcome) => outcome.draft?.activityType ?? 'UNKNOWN')),
    ).toEqual(baseline.normalizedTypes);
    expect(batch.counts.unknown).toBe(0);
    expect(batch.counts.invalid).toBe(0);
    expect(report.accountedRows).toBe(report.totalRows);
    expect(new Set(batch.fingerprints).size).toBe(batch.fingerprints.length);
    expect(report.tradeRoundingVariances).toHaveLength(baseline.roundingDiagnostics);
    expect(new Set(batch.outcomes.filter((o) => o.draft).map((o) => o.draft!.currency)).size).toBe(
      baseline.currencyCount,
    );
  });
});
