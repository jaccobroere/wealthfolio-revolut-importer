/**
 * Adapter between host activities / prepared drafts and the pure-core
 * content matcher (`src/duplicates/existing-match.ts`).
 */
import type { ActivityDetails, AssetResolutionInput } from '@wealthfolio/addon-sdk';

import type { ActivityDraft } from '../domain/activity-draft';
import type { ExistingActivityLike, MatchableActivity } from '../duplicates/existing-match';

/** Map a host activity to the matcher's minimal shape. Voided rows are dropped. */
export function toExistingActivities(activities: ActivityDetails[]): ExistingActivityLike[] {
  return activities
    .filter((a) => a.status !== 'VOID')
    .map((a) => ({
      id: a.id,
      activityType: a.activityType,
      date: a.date,
      quantity: a.quantity,
      unitPrice: a.unitPrice,
      amount: a.amount,
      currency: a.currency,
      assetSymbol: a.assetSymbol,
      assetId: a.assetId,
      assetName: a.assetName ?? null,
      exchangeMic: a.exchangeMic ?? null,
    }));
}

/**
 * Map a draft to the matcher's shape. Ticker-bearing drafts carry their
 * reviewed canonical symbol when one is known, otherwise the source ticker.
 */
export function toMatchable(
  draft: ActivityDraft,
  asset?: Pick<AssetResolutionInput, 'symbol'>,
): MatchableActivity {
  return {
    activityType: draft.activityType as MatchableActivity['activityType'],
    date: draft.date,
    quantity: draft.quantity ?? '',
    unitPrice: draft.unitPrice?.amount ?? '',
    amount: draft.totalAmount.amount,
    currency: draft.currency,
    ...(draft.ticker ? { assetSymbol: asset?.symbol ?? draft.ticker } : {}),
  };
}
