import { Decimal } from 'decimal.js';

import type { ActivityDraft } from '../domain/activity-draft';

/**
 * The unit price Wealthfolio should store for a trade.
 *
 * Wealthfolio derives a trade's cash movement from `quantity × unitPrice`.
 * Revolut's displayed `Price per share` is rounded, so that product drifts
 * from the authoritative `Total Amount` by a few cents per trade and cash
 * totals stop reconciling. For BUY/SELL this returns `Total Amount ÷ Quantity`,
 * which makes the host's product equal the statement's total. Other activity
 * types keep their displayed price (if any).
 */
export function effectiveUnitPrice(draft: ActivityDraft): string | undefined {
  const displayed = draft.unitPrice?.amount || undefined;
  if (draft.activityType !== 'BUY' && draft.activityType !== 'SELL') return displayed;
  if (!draft.quantity) return displayed;
  const quantity = new Decimal(draft.quantity);
  if (quantity.isZero()) return displayed;
  return new Decimal(draft.totalAmount.amount).abs().div(quantity.abs()).toString();
}
