import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRevolutCsv } from '../../src/parser/parse-csv';
import { validateBatch } from '../../src/validation/validate-batch';

function fixture(name: string) {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url)).toString('utf8');
}

async function batch(name: string) {
  const parsed = parseRevolutCsv(fixture(name));
  if (!parsed.header.ok) throw new Error(`bad fixture: ${name}`);
  return validateBatch(parsed.rows);
}

describe('validateBatch', () => {
  it('imports all rows of the all-supported-types fixture', async () => {
    const r = await batch('revolut-all-supported-types.csv');
    expect(r.counts.total).toBe(7);
    expect(r.counts.imported).toBe(7);
    expect(r.counts.unknown).toBe(0);
    expect(r.counts.invalid).toBe(0);
    expect(r.imported.length).toBe(7);
  });

  it('blocks every row of the unknown-type fixture as unknown', async () => {
    const r = await batch('revolut-unknown-type.csv');
    expect(r.counts.unknown).toBe(2);
    expect(r.counts.imported).toBe(0);
  });

  it('marks malformed rows as invalid with reasons', async () => {
    const r = await batch('revolut-malformed-values.csv');
    expect(r.counts.invalid).toBe(6);
    expect(r.counts.imported).toBe(1); // the first valid BUY row
  });

  it('detects input collisions in the overlap fixture', async () => {
    const r = await batch('revolut-overlap.csv');
    expect(r.collisions.length).toBe(1);
    expect(r.collisions).toEqual([2]); // second duplicate row
    expect(new Set(r.fingerprints).size).toBe(2); // two distinct fingerprints
  });

  it('produces one fingerprint per input row in source order', async () => {
    const r = await batch('revolut-all-supported-types.csv');
    expect(r.fingerprints.length).toBe(7);
    expect(new Set(r.fingerprints).size).toBe(7);
  });
});
