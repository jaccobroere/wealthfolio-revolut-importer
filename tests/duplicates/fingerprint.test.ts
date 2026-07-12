import { describe, expect, it } from 'vitest';
import type { RevolutSourceRow } from '../../src/domain/revolut-row';
import {
  canonicalFingerprintInput,
  fingerprint,
  FINGERPRINT_VERSION,
} from '../../src/duplicates/fingerprint';

function row(partial: Partial<RevolutSourceRow> = {}): RevolutSourceRow {
  return {
    date: '2024-01-01T10:00:00.000000Z',
    ticker: 'SYNTH',
    type: 'BUY - MARKET',
    quantity: '1.5',
    pricePerShare: 'USD 150.00',
    totalAmount: 'USD 225.00',
    currency: 'USD',
    fxRate: '1.0000',
    ...partial,
  };
}

describe('fingerprint', () => {
  it('produces a 64-char lowercase hex SHA-256', async () => {
    const fp = await fingerprint(row());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical source rows', async () => {
    const a = await fingerprint(row());
    const b = await fingerprint(row());
    expect(a).toBe(b);
  });

  it('changes when any canonical field changes', async () => {
    const base = await fingerprint(row());
    expect(await fingerprint(row({ ticker: 'OTHER' }))).not.toBe(base);
    expect(await fingerprint(row({ quantity: '2' }))).not.toBe(base);
    expect(await fingerprint(row({ date: '2024-01-02T10:00:00.000000Z' }))).not.toBe(base);
    expect(await fingerprint(row({ totalAmount: 'USD 226.00' }))).not.toBe(base);
    expect(await fingerprint(row({ fxRate: '1.1000' }))).not.toBe(base);
  });

  it('is robust to surrounding whitespace (stable across re-exports)', async () => {
    const tight = await fingerprint(row({ ticker: 'SYNTH' }));
    const padded = await fingerprint(row({ ticker: '  SYNTH  ' }));
    expect(padded).toBe(tight);
  });

  it('embeds the fingerprint version and schema version in the canonical input', () => {
    const input = canonicalFingerprintInput(row());
    expect(input.startsWith(FINGERPRINT_VERSION + '\u001f')).toBe(true);
    expect(input).toContain('revolut-investment-csv:v1');
  });

  it('distinguishes two rows that differ only by timestamp', async () => {
    const a = await fingerprint(row({ date: '2024-01-01T10:00:00.000000Z' }));
    const b = await fingerprint(row({ date: '2024-01-01T10:00:00.000001Z' }));
    expect(a).not.toBe(b);
  });
});
