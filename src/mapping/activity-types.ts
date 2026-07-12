import type { ActivitySubtype, ActivityType } from '../domain/activity-draft';

export interface TypeMapping {
  readonly activityType: ActivityType;
  readonly subtype?: ActivitySubtype;
}

/**
 * Exact Revolut source-type → Wealthfolio activity-type mapping.
 *
 * - `BUY - MARKET`        → `BUY`
 * - `SELL - MARKET`       → `SELL`
 * - `CASH TOP-UP`         → `DEPOSIT`
 * - `CASH WITHDRAWAL`     → `WITHDRAWAL`
 * - `DIVIDEND`            → `DIVIDEND`
 * - `COMMISSION REFUND`   → `CREDIT` / `FEE_REFUND`
 * - `REWARD`              → `CREDIT` / `BONUS`
 *
 * Anything else returns `null` and becomes a blocked `UNKNOWN` outcome.
 */
const SOURCE_TYPE_MAP: Readonly<Record<string, TypeMapping>> = {
  'BUY - MARKET': { activityType: 'BUY' },
  'SELL - MARKET': { activityType: 'SELL' },
  'CASH TOP-UP': { activityType: 'DEPOSIT' },
  'CASH WITHDRAWAL': { activityType: 'WITHDRAWAL' },
  DIVIDEND: { activityType: 'DIVIDEND' },
  'COMMISSION REFUND': { activityType: 'CREDIT', subtype: 'FEE_REFUND' },
  REWARD: { activityType: 'CREDIT', subtype: 'BONUS' },
};

export const KNOWN_SOURCE_TYPES: readonly string[] = Object.keys(SOURCE_TYPE_MAP);

/** `null` when the source type is not supported. */
export function mapActivityType(sourceType: string): TypeMapping | null {
  return SOURCE_TYPE_MAP[sourceType] ?? null;
}
