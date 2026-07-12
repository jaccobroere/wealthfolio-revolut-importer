export type ParseDateResult = { ok: true; iso: string } | { ok: false; reason: DateParseError };

export type DateParseError = 'date.empty' | 'date.format' | 'date.invalid';

const ISO_PREFIX = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ].+)?$/;
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month] ?? 0;
}

/**
 * Accept a full ISO-8601 timestamp and return it unchanged. The full source
 * timestamp (including fractional seconds and zone designator) is preserved
 * verbatim — no rezoning, no coercion, no rollover.
 *
 * Validation:
 * - The `YYYY-MM-DD` prefix must match and form a real calendar date (month
 *   1-12, day within that month's day count); `2025-02-31` is rejected rather
 *   than rolled over to March.
 * - The full value must parse via `new Date()` without becoming `NaN` (so a
 *   malformed time/zone component still fails).
 */
export function parseDate(raw: string): ParseDateResult {
  const input = (raw ?? '').trim();
  if (input.length === 0) return { ok: false, reason: 'date.empty' };

  const match = ISO_PREFIX.exec(input);
  if (!match) return { ok: false, reason: 'date.format' };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return { ok: false, reason: 'date.invalid' };
  const maxDay = daysInMonth(year, month);
  if (day < 1 || day > maxDay) return { ok: false, reason: 'date.invalid' };

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, reason: 'date.invalid' };
  }

  return { ok: true, iso: input };
}
