import { readFileSync, statSync } from 'node:fs';

/** Load the ignored local acceptance baseline. */
export function loadBaseline<T>(): T {
  const path = process.env.REVOLUT_ACCEPTANCE_BASELINE;
  if (!path) throw new Error('REVOLUT_ACCEPTANCE_BASELINE is not set.');
  if (!statSync(path).isFile()) throw new Error('REVOLUT_ACCEPTANCE_BASELINE is not a file.');
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
