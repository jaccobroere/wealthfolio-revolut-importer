import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { parseRevolutCsv } from '../../src/parser/parse-csv';
import { validateBatch } from '../../src/validation/validate-batch';
import { reconcile } from '../../src/reconciliation/reconcile';
import {
  EXPECTED_CURRENCY_COUNT,
  EXPECTED_MAX_ROUNDING_VARIANCE,
  EXPECTED_NORMALIZED_SUBTYPE_COUNTS,
  EXPECTED_NORMALIZED_TYPE_COUNTS,
  EXPECTED_ROUNDING_DIAGNOSTICS,
  EXPECTED_SOURCE_TYPE_COUNTS,
  EXPECTED_TOTAL_ROWS,
  ROUNDING_DIAGNOSTIC_THRESHOLD,
} from './revolut-real-expected';

const CSV_ENV = 'REVOLUT_ACCEPTANCE_CSV';

/**
 * Resolve the real statement path and fail fast with a clear, summary-only
 * message when it is unset, missing, unreadable, or not a regular file. The
 * path itself is never printed.
 */
function resolveRealCsv(): string {
  const path = process.env[CSV_ENV];
  if (!path || path.trim().length === 0) {
    throw new Error(`${CSV_ENV} is not set: cannot run the real-statement acceptance suite.`);
  }
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`${CSV_ENV} is unreadable or missing: acceptance suite cannot proceed.`);
  }
  if (!stat.isFile()) {
    throw new Error(
      `${CSV_ENV} does not point to a regular file: acceptance suite cannot proceed.`,
    );
  }
  return path;
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

// --- Setup (top-level await is supported by vitest ESM) ---------------------
const path = resolveRealCsv();
const text = readFileSync(path, 'utf8');
const parsed = parseRevolutCsv(text);

if (!parsed.header.ok) {
  throw new Error(`Revolut schema changed: ${parsed.header.error ?? 'unknown failure'}`);
}

const batch = await validateBatch(parsed.rows);
const report = reconcile(batch.outcomes);
const report2 = reconcile(batch.outcomes);

describe('Revolut real statement (local acceptance gate)', () => {
  it('has exactly the reviewed number of source rows', () => {
    expect(parsed.rows.length).toBe(EXPECTED_TOTAL_ROWS);
  });

  it('matches the reviewed source-type counts', () => {
    expect(countBy(parsed.rows.map((r) => r.type))).toEqual(EXPECTED_SOURCE_TYPE_COUNTS);
  });

  it('matches the reviewed normalized activity-type counts', () => {
    expect(
      countBy(batch.outcomes.map((o) => (o.draft ? o.draft.activityType : 'UNKNOWN'))),
    ).toEqual(EXPECTED_NORMALIZED_TYPE_COUNTS);
  });

  it('matches the reviewed normalized subtype counts', () => {
    expect(
      countBy(
        batch.outcomes
          .map((o) => {
            if (!o.draft) return null;
            const sub = o.draft.subtype;
            return sub === undefined ? null : (sub as string);
          })
          .filter((s): s is string => s !== null),
      ),
    ).toEqual(EXPECTED_NORMALIZED_SUBTYPE_COUNTS);
  });

  it('strictly validates EUR and USD prefixed money values', () => {
    expect(batch.counts.invalid).toBe(0);
    const currencies = new Set<string>();
    for (const o of batch.outcomes) {
      if (o.kind !== 'imported' || !o.draft) continue;
      currencies.add(o.draft.currency);
      expect(o.draft.totalAmount.currency).toBe(o.draft.currency);
      if (o.draft.unitPrice) {
        expect(o.draft.unitPrice.currency).toBe(o.draft.currency);
      }
    }
    expect(currencies.size).toBe(EXPECTED_CURRENCY_COUNT);
  });

  it('produces 152 unique source fingerprints with zero collisions', () => {
    expect(batch.fingerprints.length).toBe(EXPECTED_TOTAL_ROWS);
    expect(new Set(batch.fingerprints).size).toBe(EXPECTED_TOTAL_ROWS);
    expect(batch.collisions.length).toBe(0);
  });

  it('reports exactly the reviewed number of trade-rounding diagnostics', () => {
    expect(report.tradeRoundingVariances.length).toBe(EXPECTED_ROUNDING_DIAGNOSTICS);
  });

  it('has the exact reviewed maximum trade-rounding variance', () => {
    const max = report.tradeRoundingVariances
      .map((v) => new Decimal(v.variance))
      .reduce((a, b) => (a.greaterThan(b) ? a : b), new Decimal(0));
    expect(max.toString()).toBe(EXPECTED_MAX_ROUNDING_VARIANCE);
  });

  it('flags only variances strictly above the diagnostic threshold', () => {
    const threshold = new Decimal(ROUNDING_DIAGNOSTIC_THRESHOLD);
    for (const v of report.tradeRoundingVariances) {
      expect(new Decimal(v.variance).greaterThan(threshold)).toBe(true);
    }
  });

  it('has zero unsupported, invalid, or unaccounted outcomes', () => {
    expect(batch.counts.unknown).toBe(0);
    expect(batch.counts.invalid).toBe(0);
    expect(batch.counts.imported).toBe(EXPECTED_TOTAL_ROWS);
    expect(report.accountedRows).toBe(EXPECTED_TOTAL_ROWS);
    expect(report.totalRows).toBe(EXPECTED_TOTAL_ROWS);
  });

  it('yields deterministic position/cash reconciliation across repeated runs', () => {
    expect(JSON.stringify(report)).toEqual(JSON.stringify(report2));

    const accountedSum =
      report.positions.reduce((s, p) => s + p.buyCount + p.sellCount, 0) +
      report.cashByCurrency.reduce((s, c) => s + c.depositCount + c.withdrawalCount, 0) +
      report.creditsByCurrency.reduce((s, c) => s + c.count, 0) +
      report.dividendsByCurrency.reduce((s, d) => s + d.count, 0);
    expect(accountedSum).toBe(report.accountedRows);
  });
});
