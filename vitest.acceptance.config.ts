import { defineConfig } from 'vitest/config';

// Local release-gate config: includes ONLY the real-statement acceptance suite.
// The suite reads the user's real CSV via `REVOLUT_ACCEPTANCE_CSV` and fails
// fast when the env var is unset, missing, unreadable, or not a regular file.
// This config is never run in CI; the real statement is never committed.
export default defineConfig({
  test: {
    include: ['tests/acceptance/**/*.test.ts'],
    exclude: ['node_modules/**'],
    // Fail fast: the real statement is a single hard gate.
    bail: 1,
    reporters: ['default'],
  },
});
