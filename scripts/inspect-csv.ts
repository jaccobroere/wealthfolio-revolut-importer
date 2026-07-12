#!/usr/bin/env tsx
/**
 * Privacy-safe Revolut CSV inspector.
 *
 * Usage:
 *   pnpm inspect:csv -- <path-to-revolut.csv> [--summary-only]
 *
 * Output is **always summary-only**: schema status, row counts, per-type
 * counts, validation invariants, fingerprint uniqueness, and reconciliation
 * conservation. It never prints raw rows, tickers, holdings, amounts,
 * filenames, or paths. The `--summary-only` flag is accepted as a privacy
 * confirmation and does not unlock any additional detail.
 */
import { readFileSync, statSync } from 'node:fs';
import { parseRevolutCsv } from '../src/parser/parse-csv';
import { validateBatch } from '../src/validation/validate-batch';
import { reconcile } from '../src/reconciliation/reconcile';

interface CliArgs {
  path: string | null;
  summaryOnly: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = argv.slice(2);
  while (args.length > 0 && args[0] === '--') args.shift();

  let path: string | null = null;
  let summaryOnly = false;
  for (const a of args) {
    if (a === '--summary-only') {
      summaryOnly = true;
    } else if (!a.startsWith('--')) {
      path = a;
    }
  }
  return { path, summaryOnly };
}

function readInput(path: string): string {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error('Cannot read input file (unreadable or missing).');
  }
  if (!stat.isFile()) {
    throw new Error('Input path is not a regular file.');
  }
  return readFileSync(path, 'utf8');
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function sortCounts(counts: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(counts).sort()) sorted[k] = counts[k];
  return sorted;
}

const { path, summaryOnly } = parseArgs(process.argv);

if (!path) {
  console.error('Usage: inspect:csv -- <path-to-revolut.csv> [--summary-only]');
  process.exit(2);
}

const text = readInput(path);
const parsed = parseRevolutCsv(text);

if (!parsed.header.ok) {
  console.log('schema.ok=false');
  console.log(`schema.error=${parsed.header.error ?? 'unknown schema failure'}`);
  process.exit(1);
}

const batch = await validateBatch(parsed.rows);
const report = reconcile(batch.outcomes);

const sourceTypeCounts = countBy(parsed.rows.map((r) => r.type));
const normalizedTypeCounts = countBy(
  batch.outcomes.map((o) => (o.draft ? o.draft.activityType : 'UNKNOWN')),
);
const normalizedSubtypeCounts = countBy(
  batch.outcomes
    .map((o) => {
      if (!o.draft) return null;
      const sub = o.draft.subtype;
      return sub === undefined ? null : (sub as string);
    })
    .filter((s): s is string => s !== null),
);

console.log('schema.ok=true');
console.log(`schema.reordered=${parsed.header.reordered}`);
console.log(`rows.total=${parsed.rows.length}`);
console.log(`outcomes.imported=${batch.counts.imported}`);
console.log(`outcomes.unknown=${batch.counts.unknown}`);
console.log(`outcomes.invalid=${batch.counts.invalid}`);
console.log(`outcomes.collisions=${batch.collisions.length}`);
console.log(`fingerprints.unique=${new Set(batch.fingerprints).size}`);
console.log(`fingerprints.total=${batch.fingerprints.length}`);
console.log(`source-types=${JSON.stringify(sortCounts(sourceTypeCounts))}`);
console.log(`normalized-types=${JSON.stringify(sortCounts(normalizedTypeCounts))}`);
console.log(`normalized-subtypes=${JSON.stringify(sortCounts(normalizedSubtypeCounts))}`);
console.log(`reconciliation.accountedRows=${report.accountedRows}`);
console.log(`reconciliation.tickers=${report.positions.length}`);
console.log(`reconciliation.cashCurrencies=${report.cashByCurrency.length}`);
console.log(`reconciliation.creditCurrencies=${report.creditsByCurrency.length}`);
console.log(`reconciliation.dividendCurrencies=${report.dividendsByCurrency.length}`);
console.log(`reconciliation.tradeRoundingDiagnostics=${report.tradeRoundingVariances.length}`);

const accountedSum =
  report.positions.reduce((s, p) => s + p.buyCount + p.sellCount, 0) +
  report.cashByCurrency.reduce((s, c) => s + c.depositCount + c.withdrawalCount, 0) +
  report.creditsByCurrency.reduce((s, c) => s + c.count, 0) +
  report.dividendsByCurrency.reduce((s, d) => s + d.count, 0);
console.log(`invariant.accountedRowsMatch=${accountedSum === report.accountedRows}`);
console.log(`invariant.allRowsAccounted=${report.totalRows === report.accountedRows}`);

// `summaryOnly` is accepted as a privacy confirmation; output is always
// summary-only regardless. Reference the flag so it is not flagged as unused.
if (summaryOnly && (batch.counts.unknown > 0 || batch.counts.invalid > 0)) {
  process.exit(1);
}
if (!summaryOnly && (batch.counts.unknown > 0 || batch.counts.invalid > 0)) {
  process.exit(1);
}
