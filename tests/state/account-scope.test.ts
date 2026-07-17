import { describe, expect, it } from 'vitest';

import { INITIAL_STATE, reducer } from '../../src/state/import-state';

describe('Revolut account-scoped mapping state', () => {
  it('clears resolved mappings and acknowledgement when the destination changes', () => {
    const state = {
      ...INITIAL_STATE,
      accountId: 'account-a',
      acknowledged: true,
      tickers: {
        AAPL: {
          ticker: 'AAPL',
          rowIndices: [2],
          resolution: {
            status: 'resolved' as const,
            identity: { symbol: 'AAPL', exchangeMic: 'XNAS', providerId: 'yahoo' },
            fromSaved: true,
          },
        },
      },
    };

    const next = reducer(state, { type: 'SELECT_ACCOUNT', accountId: 'account-b' });

    expect(next.acknowledged).toBe(false);
    expect(next.tickers.AAPL?.resolution).toEqual({ status: 'pending' });
  });
});
