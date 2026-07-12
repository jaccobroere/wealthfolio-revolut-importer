/**
 * @vitest-environment jsdom
 */
import './setup';

import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import {
  GOOD_CSV,
  INVALID_CSV,
  UNKNOWN_CSV,
  buildState,
  cleanupUi,
  currentBlockers,
  importEnabled,
  renderReconciliation,
} from './helpers';

describe('Revolut reconciliation gate', () => {
  afterEach(() => {
    cleanupUi();
  });

  it('keeps Import disabled with no account selected', async () => {
    const state = await buildState({ accountId: null, acknowledged: true });
    renderReconciliation(state);

    expect(importEnabled(state)).toBe(false);
    expect(currentBlockers(state)).toContain('Select a destination account');
    expect(screen.getByTestId('import-button')).toBeDisabled();
  });

  it('keeps Import disabled when fatal or unknown rows are present', async () => {
    const unknownState = await buildState({ csv: UNKNOWN_CSV, acknowledged: true });
    renderReconciliation(unknownState);

    expect(importEnabled(unknownState)).toBe(false);
    expect(currentBlockers(unknownState)).toContain('Resolve 1 unknown row');
    expect(screen.getByTestId('import-button')).toBeDisabled();

    cleanupUi();

    const invalidState = await buildState({ csv: INVALID_CSV, acknowledged: true });
    renderReconciliation(invalidState);

    expect(importEnabled(invalidState)).toBe(false);
    expect(currentBlockers(invalidState)).toContain('Resolve 1 invalid row');
    expect(screen.getByTestId('import-button')).toBeDisabled();
  });

  it('keeps Import disabled when traded securities remain unresolved', async () => {
    const state = await buildState({ csv: GOOD_CSV, resolvedTickers: false, acknowledged: true });
    renderReconciliation(state);

    expect(importEnabled(state)).toBe(false);
    expect(currentBlockers(state)).toContain('Resolve 1 ticker');
    expect(screen.getByTestId('import-button')).toBeDisabled();
  });

  it('keeps Import disabled when reconciliation residual rules fail', async () => {
    const state = await buildState({ forceResidualFailure: true, acknowledged: true });
    renderReconciliation(state);

    expect(importEnabled(state)).toBe(false);
    expect(currentBlockers(state)).toContain('Reconciliation residuals must pass');
    expect(screen.getByTestId('import-button')).toBeDisabled();
  });

  it('keeps Import disabled when acknowledgement is unchecked', async () => {
    const state = await buildState({ acknowledged: false });
    renderReconciliation(state);

    expect(importEnabled(state)).toBe(false);
    expect(currentBlockers(state)).toContain('Acknowledge reconciliation');
    expect(screen.getByTestId('import-button')).toBeDisabled();
  });

  it('enables Import when every blocker is cleared', async () => {
    const state = await buildState({ acknowledged: true });
    renderReconciliation(state);

    expect(importEnabled(state)).toBe(true);
    expect(currentBlockers(state)).toHaveLength(0);
    expect(screen.getByTestId('import-button')).toBeEnabled();
  });
});
