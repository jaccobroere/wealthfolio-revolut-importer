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

  it('shows the mapped ticker and exchange for each position', async () => {
    const state = await buildState();
    renderReconciliation(state);

    const labels = screen.getAllByTestId('security-label').map((el) => el.textContent ?? '');
    expect(labels.some((t) => t.includes('AAPL') && t.includes('XNAS'))).toBe(true);
  });

  it('previews what is already in Wealthfolio and what needs repair', async () => {
    const state = await buildState({
      existing: [
        {
          id: 'linked-topup',
          activityType: 'DEPOSIT',
          date: '2024-01-01T10:00:00.000Z',
          amount: '100',
          currency: 'EUR',
          assetSymbol: '',
          assetId: '',
        },
        {
          id: 'orphan-dividend',
          activityType: 'DIVIDEND',
          date: '2024-01-03T10:00:00.000Z',
          amount: '5',
          currency: 'USD',
          assetSymbol: '',
          assetId: '',
        },
      ],
    });
    renderReconciliation(state);

    const section = screen.getByTestId('account-match');
    expect(section.textContent).toContain('New activities1');
    expect(section.textContent).toContain('Already in account (skipped)2');
    expect(section.textContent).toContain('Stored without security1');
    expect(screen.getByTestId('unlinked-matches').textContent).toContain('DIVIDEND');
    expect(
      screen.getByText(/write 1 new activity to the selected account and skip 2/),
    ).toBeTruthy();
    expect(screen.getByTestId('import-button').textContent).toContain('1 new');
  });

  it('says it is still checking while the account activities load', async () => {
    const state = await buildState();
    renderReconciliation(state);

    expect(screen.getByTestId('account-match').textContent).toContain('Checking');
  });
});
