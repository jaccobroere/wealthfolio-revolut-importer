import type { ActivityDraft } from '../domain/activity-draft';
import type { BatchResult, OutcomeCounts, RowOutcome } from '../domain/import-outcome';
import type { RevolutSourceRow } from '../domain/revolut-row';
import { applyRowPatch, changedFields, type RowOverrides } from '../domain/row-override';
import { fingerprint } from '../duplicates/fingerprint';
import { validateRow } from './validate-row';

/**
 * Validate every source row and compute deterministic source fingerprints for
 * duplicate/overlap detection across files.
 *
 * - Each row yields exactly one {@link RowOutcome} (nothing is dropped).
 * - Reviewer overrides are applied first: an ignored row short-circuits to an
 *   `ignored` outcome, and an edited row is validated with its patched values
 *   and flagged `edited` so the change stays visible.
 * - Fingerprints are computed over the canonical source sequence — using the
 *   effective (patched) row, so a corrected row gets the identity it will
 *   actually be imported under — and are independent of the row's validation
 *   outcome, so an `unknown`/`invalid` row still gets a stable identity for
 *   overlap detection.
 * - `collisions` lists 1-based row indices whose fingerprint matches an
 *   earlier row's fingerprint (input duplicates / overlapping imports).
 */
export async function validateBatch(
  rows: readonly RevolutSourceRow[],
  overrides: RowOverrides = {},
): Promise<BatchResult> {
  const effectiveRows: RevolutSourceRow[] = [];
  const editedRowIndices = new Set<number>();
  for (const [i, row] of rows.entries()) {
    const rowIndex = i + 1;
    const override = overrides[rowIndex];
    if (override?.kind === 'edit' && changedFields(row, override.patch).length > 0) {
      editedRowIndices.add(rowIndex);
      effectiveRows.push(applyRowPatch(row, override.patch));
    } else {
      effectiveRows.push(row);
    }
  }

  const outcomes: RowOutcome[] = effectiveRows.map((row, i) => {
    const rowIndex = i + 1;
    if (overrides[rowIndex]?.kind === 'ignore') {
      return {
        rowIndex,
        kind: 'ignored',
        sourceType: row.type,
        reasons: ['user-ignored'],
      };
    }
    const outcome = validateRow(row, rowIndex);
    return editedRowIndices.has(rowIndex) ? { ...outcome, edited: true } : outcome;
  });

  const fingerprints = await Promise.all(effectiveRows.map((row) => fingerprint(row)));

  const seen = new Map<string, number>();
  const collisions: number[] = [];
  fingerprints.forEach((fp, i) => {
    const earlier = seen.get(fp);
    if (earlier !== undefined) {
      collisions.push(i + 1);
    } else {
      seen.set(fp, i + 1);
    }
  });

  const counts: OutcomeCounts = countOutcomes(outcomes);
  const imported: ActivityDraft[] = [];
  for (const o of outcomes) {
    if (o.kind === 'imported' && o.draft !== undefined) {
      imported.push(o.draft);
    }
  }

  return { outcomes, imported, counts, fingerprints, collisions };
}

export function countOutcomes(outcomes: readonly RowOutcome[]): OutcomeCounts {
  let imported = 0;
  let unknown = 0;
  let invalid = 0;
  let ignored = 0;
  for (const o of outcomes) {
    if (o.kind === 'imported') imported++;
    else if (o.kind === 'unknown') unknown++;
    else if (o.kind === 'ignored') ignored++;
    else invalid++;
  }
  return { total: outcomes.length, imported, unknown, invalid, ignored };
}
