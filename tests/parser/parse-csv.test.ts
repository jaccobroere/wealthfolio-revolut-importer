import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRevolutCsv, validateHeader } from '../../src/parser/parse-csv';
import { REVOLUT_HEADERS } from '../../src/domain/revolut-row';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url)).toString('utf8');
}

describe('validateHeader', () => {
  it('accepts the exact canonical header set in order', () => {
    const h = validateHeader([...REVOLUT_HEADERS]);
    expect(h.ok).toBe(true);
    expect(h.reordered).toBe(false);
    expect(h.missing).toEqual([]);
    expect(h.unknown).toEqual([]);
    expect(h.duplicates).toEqual([]);
  });

  it('accepts reordered columns when all eight occur once', () => {
    const reordered = [...REVOLUT_HEADERS].reverse();
    const h = validateHeader(reordered);
    expect(h.ok).toBe(true);
    expect(h.reordered).toBe(true);
  });

  it('rejects a missing column with an actionable error', () => {
    const h = validateHeader(REVOLUT_HEADERS.filter((x) => x !== 'Ticker'));
    expect(h.ok).toBe(false);
    expect(h.missing).toEqual(['Ticker']);
    expect(h.error).toContain('missing columns');
  });

  it('rejects an unknown column', () => {
    const h = validateHeader([...REVOLUT_HEADERS, 'Extra']);
    expect(h.ok).toBe(false);
    expect(h.unknown).toEqual(['Extra']);
    expect(h.error).toContain('unknown columns');
  });

  it('rejects duplicate columns', () => {
    const h = validateHeader([...REVOLUT_HEADERS, 'Date']);
    expect(h.ok).toBe(false);
    expect(h.duplicates).toEqual(['Date']);
    expect(h.error).toContain('duplicate columns');
  });
});

describe('parseRevolutCsv', () => {
  it('parses the all-supported-types fixture and preserves raw fields', () => {
    const parsed = parseRevolutCsv(fixture('revolut-all-supported-types.csv'));
    expect(parsed.header.ok).toBe(true);
    expect(parsed.rows.length).toBe(7);

    const buy = parsed.rows[0];
    expect(buy.type).toBe('BUY - MARKET');
    expect(buy.ticker).toBe('SYNTH');
    expect(buy.quantity).toBe('1.5');
    expect(buy.pricePerShare).toBe('USD 150.00');
    expect(buy.totalAmount).toBe('USD 225.00');
    expect(buy.currency).toBe('USD');
    expect(buy.fxRate).toBe('1.0000');
  });

  it('tolerates reordered columns while mapping fields correctly', () => {
    const reorderedHeader = [
      'Currency',
      'FX Rate',
      'Total Amount',
      'Price per share',
      'Quantity',
      'Type',
      'Ticker',
      'Date',
    ].join(',');
    const line =
      'USD,1.0000,USD 225.00,USD 150.00,1.5,BUY - MARKET,SYNTH,2024-01-01T10:00:00.000000Z';
    const parsed = parseRevolutCsv(`${reorderedHeader}\n${line}\n`);
    expect(parsed.header.ok).toBe(true);
    expect(parsed.header.reordered).toBe(true);
    expect(parsed.rows[0].ticker).toBe('SYNTH');
    expect(parsed.rows[0].currency).toBe('USD');
    expect(parsed.rows[0].type).toBe('BUY - MARKET');
  });

  it('returns no rows but an actionable header error on schema change', () => {
    const parsed = parseRevolutCsv('Wrong,Header,Set\na,b,c\n');
    expect(parsed.header.ok).toBe(false);
    expect(parsed.rows.length).toBe(0);
  });

  it('fails on an empty document', () => {
    const parsed = parseRevolutCsv('');
    expect(parsed.header.ok).toBe(false);
  });
});
