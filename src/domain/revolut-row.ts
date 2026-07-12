/**
 * Strict schema definition for the supplied Revolut investment CSV.
 *
 * The exact header set Revolut emits is the eight columns below, in this
 * canonical order. Column **reordering** is tolerated (see {@link
 * validateHeader}); renaming, adding, dropping, or duplicating any column is a
 * hard schema failure with an actionable error.
 */

export const REVOLUT_SCHEMA_VERSION = 'revolut-investment-csv:v1';

export const REVOLUT_HEADERS = [
  'Date',
  'Ticker',
  'Type',
  'Quantity',
  'Price per share',
  'Total Amount',
  'Currency',
  'FX Rate',
] as const;

export type RevolutHeader = (typeof REVOLUT_HEADERS)[number];

export const HEADER_COUNT = REVOLUT_HEADERS.length;

/**
 * Raw, untyped source row: every field is the exact string Revolut wrote
 * (whitespace preserved). No parsing, normalization, or coercion happens here.
 * Downstream modules parse and validate each field.
 */
export interface RevolutSourceRow {
  readonly date: string;
  readonly ticker: string;
  readonly type: string;
  readonly quantity: string;
  readonly pricePerShare: string;
  readonly totalAmount: string;
  readonly currency: string;
  readonly fxRate: string;
}

/** Result of checking a CSV header row against the strict schema. */
export interface HeaderValidation {
  readonly ok: boolean;
  /** Required columns that are absent. */
  readonly missing: readonly string[];
  /** Columns not part of the known schema. */
  readonly unknown: readonly string[];
  /** Columns that appear more than once. */
  readonly duplicates: readonly string[];
  /** `true` when all eight names occur once but in a different order. */
  readonly reordered: boolean;
  /** Actionable, single-line error message when `ok === false`. */
  readonly error?: string;
}
