import { REVOLUT_SCHEMA_VERSION, type RevolutSourceRow } from '../domain/revolut-row';

/**
 * Fingerprint format version. Bumped whenever the canonical field sequence or
 * normalization changes; embedded in every fingerprint so old and new
 * fingerprints never collide.
 */
export const FINGERPRINT_VERSION = '1';

const UNIT_SEPARATOR = '\u001f';

function trim(value: string): string {
  return (value ?? '').trim();
}

/**
 * Build the canonical, deterministic fingerprint input for a source row.
 *
 * Field order (per spec): fingerprint version, schema version, full timestamp,
 * source type, ticker, quantity, unit-price amount/currency, total amount /
 * currency, Currency, FX rate.
 *
 * Values are the raw source strings (trimmed for whitespace robustness). The
 * timestamp alone is unique per row in Revolut exports, so the resulting
 * SHA-256 is stable across repeated and overlapping imports while remaining
 * collision-free for distinct rows.
 */
export function canonicalFingerprintInput(row: RevolutSourceRow): string {
  return [
    FINGERPRINT_VERSION,
    REVOLUT_SCHEMA_VERSION,
    trim(row.date),
    trim(row.type),
    trim(row.ticker),
    trim(row.quantity),
    trim(row.pricePerShare),
    trim(row.totalAmount),
    trim(row.currency),
    trim(row.fxRate),
  ].join(UNIT_SEPARATOR);
}

function toHex(digest: ArrayBuffer): string {
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Compute the deterministic SHA-256 fingerprint of a source row via Web Crypto.
 * Returns a 64-character lowercase hex string.
 */
export async function fingerprint(row: RevolutSourceRow): Promise<string> {
  const data = new TextEncoder().encode(canonicalFingerprintInput(row));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}
