import { describe, expect, it } from 'vitest';
import { parseDate } from '../../src/parser/parse-date';

describe('parseDate', () => {
  it('preserves the full ISO timestamp verbatim', () => {
    const iso = '2025-01-01T23:11:47.661492Z';
    const r = parseDate(iso);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.iso).toBe(iso);
  });

  it('accepts a bare ISO date', () => {
    const r = parseDate('2025-01-01');
    expect(r.ok).toBe(true);
  });

  it('rejects empty input', () => {
    expect(parseDate('').ok).toBe(false);
    expect(parseDate('   ').ok).toBe(false);
  });

  it('rejects non-ISO formats', () => {
    expect(parseDate('01/02/2025').ok).toBe(false);
    expect(parseDate('Jan 1 2025').ok).toBe(false);
    expect(parseDate('yesterday').ok).toBe(false);
  });

  it('rejects structurally-plausible but invalid dates', () => {
    expect(parseDate('2025-13-40').ok).toBe(false);
    expect(parseDate('2025-02-31').ok).toBe(false);
  });
});
