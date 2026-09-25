/**
 * Occurrence numbering for genuinely repeated statement activities.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * Revolut often books identical activities on one day — e.g. two top-ups of
 * the same amount, or recurring buys of the same ticker. Wealthfolio 3.6.1's
 * import duplicate key is day-level (type, UTC day, asset, quantity, price,
 * amount, currency, comment), so it keeps only the first of those and silently
 * drops the rest.
 *
 * Numbering the repeats lets the adapter give the 2nd and later copies a
 * distinct comment (`#2`), which makes their host keys distinct. The first
 * copy carries no comment, exactly as before, so it still matches copies
 * stored by earlier imports. Numbering is by input order within a key, which
 * is stable across exports because a statement lists rows in time order.
 */

import type { ActivityDraft } from '../domain/activity-draft';

/**
 * Types Wealthfolio always stores as cash: it clears their symbol before
 * computing the duplicate key, so the ticker must not separate them here.
 */
const HOST_CASH_TYPES: ReadonlySet<string> = new Set([
  'DEPOSIT',
  'WITHDRAWAL',
  'FEE',
  'TAX',
  'CREDIT',
]);

function hostLikeKey(a: ActivityDraft): string {
  const d = new Date(a.date);
  const day = Number.isNaN(d.getTime()) ? a.date : d.toISOString().slice(0, 10);
  return [
    a.activityType,
    day,
    HOST_CASH_TYPES.has(a.activityType) ? '' : a.ticker.trim().toUpperCase(),
    a.quantity ?? '',
    a.unitPrice?.amount ?? '',
    a.totalAmount.amount,
    a.currency,
  ].join('|');
}

/**
 * 1-based occurrence of each activity among activities that Wealthfolio would
 * consider the same. `1` for every activity that is not repeated.
 */
export function repeatOccurrences(activities: readonly ActivityDraft[]): number[] {
  const seen = new Map<string, number>();
  return activities.map((a) => {
    const key = hostLikeKey(a);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n;
  });
}

/** The comment for the `occurrence`-th copy of a repeated activity. */
export function occurrenceComment(occurrence: number): string | undefined {
  return occurrence > 1 ? `#${occurrence}` : undefined;
}
