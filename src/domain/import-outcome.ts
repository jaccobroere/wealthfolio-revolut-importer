import type { ActivityDraft } from './activity-draft';

/**
 * The four terminal dispositions for a single source row. Every input row
 * produces exactly one outcome — nothing is silently dropped.
 *
 * - `imported`  — the row mapped and validated into an {@link ActivityDraft}.
 * - `unknown`   — the `Type` is not in the supported Revolut set; blocked.
 * - `invalid`   — the type is known but a value (date, money, currency,
 *                 quantity, price, or fx rate) failed strict validation.
 * - `ignored`   — the reviewer explicitly excluded the row during review. This
 *                 is the only disposition not derived from the row's content;
 *                 it always reflects a deliberate per-row decision.
 */
export type OutcomeKind = 'imported' | 'unknown' | 'invalid' | 'ignored';

export interface RowOutcome {
  /** 1-based source line index (header is line 1; first data row is line 2). */
  readonly rowIndex: number;
  readonly kind: OutcomeKind;
  readonly sourceType: string;
  readonly draft?: ActivityDraft;
  /** Machine-readable validation reason codes (empty for `imported`). */
  readonly reasons: readonly string[];
  /** True when the reviewer corrected this row's values during review. */
  readonly edited?: boolean;
}

/** Aggregate counts over a batch of outcomes. */
export interface OutcomeCounts {
  readonly total: number;
  readonly imported: number;
  readonly unknown: number;
  readonly invalid: number;
  readonly ignored: number;
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
