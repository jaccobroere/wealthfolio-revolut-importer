import type { ActivityDraft } from './activity-draft';

/**
 * The three terminal dispositions for a single source row. Every input row
 * produces exactly one outcome — nothing is silently dropped.
 *
 * - `imported`  — the row mapped and validated into an {@link ActivityDraft}.
 * - `unknown`   — the `Type` is not in the supported Revolut set; blocked.
 * - `invalid`   — the type is known but a value (date, money, currency,
 *                 quantity, price, or fx rate) failed strict validation.
 */
export type OutcomeKind = 'imported' | 'unknown' | 'invalid';

export interface RowOutcome {
  /** 1-based source line index (header is line 1; first data row is line 2). */
  readonly rowIndex: number;
  readonly kind: OutcomeKind;
  readonly sourceType: string;
  readonly draft?: ActivityDraft;
  /** Machine-readable validation reason codes (empty for `imported`). */
  readonly reasons: readonly string[];
}

/** Aggregate counts over a batch of outcomes. */
export interface OutcomeCounts {
  readonly total: number;
  readonly imported: number;
  readonly unknown: number;
  readonly invalid: number;
}

export interface BatchResult {
  readonly outcomes: readonly RowOutcome[];
  readonly imported: readonly ActivityDraft[];
  readonly counts: OutcomeCounts;
  /** Source-row fingerprints, one per input row, in source order. */
  readonly fingerprints: readonly string[];
  /** 1-based row indices that share a fingerprint with an earlier row. */
  readonly collisions: readonly number[];
}
