/**
 * Reviewer overrides applied to source rows during the review step.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * The importer never silently drops or guesses a row. When a row has an
 * unsupported `Type` or a malformed value, the reviewer has exactly two
 * explicit escapes:
 *
 *  - `ignore` — the row is excluded from the import and accounted as an
 *    `ignored` outcome, so row conservation still holds and the count stays
 *    visible in every summary.
 *  - `edit`   — the reviewer corrects field values in place; the patched row is
 *    re-validated by the normal pipeline. Outcomes derived from an edited row
 *    are flagged so the change stays auditable through to the reconcile step.
 *
 * Overrides live in wizard state only. They are re-applied to the pristine
 * parsed rows on every rebuild and are never written back to the user's CSV.
 */

import type { RevolutSourceRow } from './revolut-row';

/**
 * Source fields a reviewer may correct.
 *
 * Every column Revolut emits is editable: each one is either validated or read
 * by the mapper, so any of them can be the reason a row fails.
 */
export type EditableField =
  'type' | 'totalAmount' | 'currency' | 'ticker' | 'quantity' | 'pricePerShare' | 'date' | 'fxRate';

/** Ordered most- to least-commonly corrected; the editor renders them in order. */
export const EDITABLE_FIELDS: readonly EditableField[] = [
  'type',
  'totalAmount',
  'currency',
  'ticker',
  'quantity',
  'pricePerShare',
  'date',
  'fxRate',
];

/** Human-readable labels for the editor UI. */
export const EDITABLE_FIELD_LABELS: Record<EditableField, string> = {
  type: 'Type',
  totalAmount: 'Total Amount',
  currency: 'Currency',
  ticker: 'Ticker',
  quantity: 'Quantity',
  pricePerShare: 'Price per share',
  date: 'Date',
  fxRate: 'FX Rate',
};

/** A partial set of corrected field values for one source row. */
export type RowPatch = Partial<Record<EditableField, string>>;

/** What the reviewer decided to do with one source row. */
export type RowOverride = { kind: 'ignore' } | { kind: 'edit'; patch: RowPatch };

/** Overrides keyed by 1-based source row number. */
export type RowOverrides = Readonly<Record<number, RowOverride>>;

/** Fields in `patch` whose value actually differs from the row's current value. */
export function changedFields(row: RevolutSourceRow, patch: RowPatch): EditableField[] {
  return EDITABLE_FIELDS.filter((f) => {
    const next = patch[f];
    return next !== undefined && next !== row[f];
  });
}

/** Apply a patch to a row, returning a new row. Unknown/equal fields are ignored. */
export function applyRowPatch(row: RevolutSourceRow, patch: RowPatch): RevolutSourceRow {
  const next: Record<string, string> = { ...row };
  for (const f of changedFields(row, patch)) {
    next[f] = patch[f] as string;
  }
  return next as unknown as RevolutSourceRow;
}

/**
 * Reduce a patch to the fields that actually change the row.
 *
 * Returns `null` when the patch is a no-op, so callers can drop the override
 * entirely instead of recording an edit that changes nothing.
 */
export function normalizePatch(row: RevolutSourceRow, patch: RowPatch): RowPatch | null {
  const changed = changedFields(row, patch);
  if (changed.length === 0) return null;
  const out: RowPatch = {};
  for (const f of changed) out[f] = patch[f] as string;
  return out;
}

/** Count active reviewer decisions by kind. */
export function countOverrides(overrides: RowOverrides): { ignored: number; edited: number } {
  let ignored = 0;
  let edited = 0;
  for (const o of Object.values(overrides)) {
    if (o.kind === 'ignore') ignored++;
    else edited++;
  }
  return { ignored, edited };
}
