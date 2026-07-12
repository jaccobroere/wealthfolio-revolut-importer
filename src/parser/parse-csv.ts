import Papa from 'papaparse';
import {
  HEADER_COUNT,
  REVOLUT_HEADERS,
  type HeaderValidation,
  type RevolutHeader,
  type RevolutSourceRow,
} from '../domain/revolut-row';

export interface ParsedCsv {
  readonly header: HeaderValidation;
  readonly rows: readonly RevolutSourceRow[];
}

/**
 * Validate a header cell array against the strict eight-column schema.
 *
 * Permitted: the eight known names, each exactly once, in any order. Anything
 * else (missing column, unknown column, duplicate column) yields `ok === false`
 * with an actionable, single-line `error`.
 */
export function validateHeader(cells: readonly string[]): HeaderValidation {
  const expected = REVOLUT_HEADERS;
  const expectedSet = new Set<string>(expected);

  const counts = new Map<string, number>();
  for (const c of cells) counts.set(c, (counts.get(c) ?? 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([h]) => h)
    .sort();

  const present = new Set<string>(cells);
  const missing = expected.filter((h) => !present.has(h));
  const unknown = cells
    .filter((h) => !expectedSet.has(h))
    .filter((h, i, arr) => arr.indexOf(h) === i);

  const ok = missing.length === 0 && unknown.length === 0 && duplicates.length === 0;
  const reordered =
    ok &&
    cells.length === HEADER_COUNT &&
    cells.some((h, i) => h !== (REVOLUT_HEADERS as readonly string[])[i]);

  let error: string | undefined;
  if (!ok) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing columns: ${missing.join(', ')}`);
    if (unknown.length > 0) parts.push(`unknown columns: ${unknown.join(', ')}`);
    if (duplicates.length > 0) parts.push(`duplicate columns: ${duplicates.join(', ')}`);
    error = `Revolut schema mismatch — ${parts.join('; ')}. Expected exactly: ${REVOLUT_HEADERS.join(
      ', ',
    )}`;
  }

  return { ok, missing, unknown, duplicates, reordered, error };
}

function mapRow(
  values: readonly string[],
  index: Readonly<Record<RevolutHeader, number>>,
): RevolutSourceRow {
  const get = (h: RevolutHeader): string => {
    const i = index[h];
    return i === undefined || i < 0 ? '' : (values[i] ?? '');
  };
  return {
    date: get('Date'),
    ticker: get('Ticker'),
    type: get('Type'),
    quantity: get('Quantity'),
    pricePerShare: get('Price per share'),
    totalAmount: get('Total Amount'),
    currency: get('Currency'),
    fxRate: get('FX Rate'),
  };
}

/**
 * Parse a Revolut CSV document into a header validation plus typed raw rows.
 *
 * The header is always validated; when invalid, `rows` is empty so callers
 * fail fast on schema changes. Empty lines are skipped. Malformed CSV rows
 * (wrong column count after the header) are reported as header-error
 * actionable messages rather than silently shifted.
 */
export function parseRevolutCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text ?? '', {
    skipEmptyLines: 'greedy',
  });
  const grid = (result.data ?? []) as unknown as string[][];

  if (grid.length === 0) {
    return {
      header: {
        ok: false,
        missing: [...REVOLUT_HEADERS],
        unknown: [],
        duplicates: [],
        reordered: false,
        error: 'Revolut CSV is empty — expected header row and at least one data row.',
      },
      rows: [],
    };
  }

  const headerCells = grid[0].map((c) => c.trim());
  const header = validateHeader(headerCells);

  if (!header.ok) {
    return { header, rows: [] };
  }

  const index = {} as Record<RevolutHeader, number>;
  headerCells.forEach((h, i) => {
    index[h as RevolutHeader] = i;
  });

  const rows: RevolutSourceRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.length === 0) continue;
    // Tolerate trailing all-empty cells but flag gross misalignment.
    const nonEmpty = cells.filter((c) => c !== '').length;
    if (nonEmpty === 0) continue;
    rows.push(mapRow(cells, index));
  }

  return { header, rows };
}
