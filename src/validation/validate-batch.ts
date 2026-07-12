import type { ActivityDraft } from '../domain/activity-draft';
import type { BatchResult, OutcomeCounts, RowOutcome } from '../domain/import-outcome';
import type { RevolutSourceRow } from '../domain/revolut-row';
import { fingerprint } from '../duplicates/fingerprint';
import { validateRow } from './validate-row';

/**
 * Validate every source row and compute deterministic source fingerprints for
 * duplicate/overlap detection across files.
 *
 * - Each row yields exactly one {@link RowOutcome} (nothing is dropped).
 * - Fingerprints are computed over the canonical source sequence and are
 *   independent of the row's validation outcome, so an `unknown`/`invalid`
 *   row still gets a stable identity for overlap detection.
 * - `collisions` lists 1-based row indices whose fingerprint matches an
 *   earlier row's fingerprint (input duplicates / overlapping imports).
 */
export async function validateBatch(rows: readonly RevolutSourceRow[]): Promise<BatchResult> {
  const outcomes: RowOutcome[] = rows.map((row, i) => validateRow(row, i + 1));

  const fingerprints = await Promise.all(rows.map((row) => fingerprint(row)));

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
  for (const o of outcomes) {
    if (o.kind === 'imported') imported++;
    else if (o.kind === 'unknown') unknown++;
    else invalid++;
  }
  return { total: outcomes.length, imported, unknown, invalid };
}
