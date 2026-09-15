/**
 * @vitest-environment jsdom
 *
 * Regressions for the two ways reviewer overrides could previously produce a
 * wrong import, both found in review of the in-place row-fix feature. Every
 * other override test stops at the review step; these drive all the way to the
 * host write, which is where both bugs lived.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ImporterPage } from '../../src/pages/importer-page';
import { createFakeHost, type FakeHost } from '../wealthfolio/fake-host';
import { DEFAULT_SEARCH_RESULTS, createAddonContext, installFileReaderMock } from './helpers';

/** Row 2 has a Type nothing recognizes; rows 1 and 3 are clean cash rows. */
const UNKNOWN_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,,CASH TOP-UP,,,EUR 100.00,EUR,1.0000
2024-01-02T10:00:00.000000Z,,STOCK SPLIT,,,EUR 0.00,EUR,1.0000
2024-01-03T10:00:00.000000Z,,CASH TOP-UP,,,EUR 50.00,EUR,1.0000
`;

/** Row 2 is invalid (non-numeric quantity) but carries a ticker. */
const INVALID_TICKER_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,,CASH TOP-UP,,,EUR 100.00,EUR,1.0000
2024-01-02T10:00:00.000000Z,NVDA,BUY - MARKET,abc,USD 50.00,USD 100.00,USD,1.0000
`;

async function renderPageToReview(csv: string): Promise<{ host: FakeHost; restore: () => void }> {
  const host = createFakeHost({ searchResults: DEFAULT_SEARCH_RESULTS });
  const ctx = createAddonContext(host.api);
  const fileReader = installFileReaderMock(csv);

  render(
    <ImporterPage
      ctx={ctx}
      location={{ pathname: '/addon/revolut-importer', search: '', hash: '', params: {} }}
    />,
  );

  const fileInput = await screen.findByLabelText('Revolut CSV file');
  fireEvent.change(fileInput, {
    target: { files: [new File([csv], 'revolut.csv', { type: 'text/csv' })] },
  });

  await screen.findByTestId('mapping-continue');
  const accountSelect = await screen.findByLabelText('Destination account');
  await waitFor(() => {
    if ((accountSelect as HTMLSelectElement).disabled) throw new Error('accounts still loading');
  });
  fireEvent.change(accountSelect, { target: { value: 'acct-1' } });

  return { host, restore: fileReader.restore };
}

describe('importing after a reviewer override', () => {
  afterEach(() => {
    cleanup();
  });

  it('writes only the surviving rows when a row is ignored', async () => {
    const { host, restore } = await renderPageToReview(UNKNOWN_CSV);
    try {
      await waitFor(() => {
        const b = screen.getByTestId('mapping-continue') as HTMLButtonElement;
        if (b.disabled) throw new Error('mapping continue disabled');
      });
      fireEvent.click(screen.getByTestId('mapping-continue'));

      fireEvent.click(await screen.findByTestId('review-expand-2'));
      fireEvent.click(screen.getByTestId('row-ignore-2'));
      await waitFor(() => {
        expect((screen.getByTestId('review-continue') as HTMLButtonElement).disabled).toBe(false);
      });
      fireEvent.click(screen.getByTestId('review-continue'));

      fireEvent.click(await screen.findByTestId('acknowledge-checkbox'));
      const importButton = await screen.findByTestId('import-button');
      await waitFor(() => {
        if ((importButton as HTMLButtonElement).disabled) throw new Error('import disabled');
      });
      fireEvent.click(importButton);

      // The import must actually complete. Drafts, fingerprints, and source row
      // numbers are zipped positionally downstream, so taking drafts from the
      // imported subset while taking the other two from every row used to throw
      // a length mismatch — and the failure was invisible in the UI.
      await waitFor(() => {
        expect(host.importCalls.length).toBe(1);
      });
      expect(host.importCalls[0]).toHaveLength(2);
      expect(screen.queryByText(/length mismatch/i)).toBeNull();

      // Only the surviving rows are written — the ignored row is not.
      const amounts = host.importCalls[0].map((a) => String(a.amount)).sort();
      expect(amounts).toEqual(['100', '50']);
    } finally {
      restore();
    }
  });

  it('blocks import when an edit introduces a ticker that was never mapped', async () => {
    const { host, restore } = await renderPageToReview(INVALID_TICKER_CSV);
    try {
      // Row 2 is invalid, so it contributes no ticker and the mapping step has
      // nothing to resolve.
      await waitFor(() => {
        const b = screen.getByTestId('mapping-continue') as HTMLButtonElement;
        if (b.disabled) throw new Error('mapping continue disabled');
      });
      fireEvent.click(screen.getByTestId('mapping-continue'));

      // Correcting the quantity makes it a valid BUY on NVDA — a security that
      // was never confirmed against the host.
      fireEvent.click(await screen.findByTestId('review-expand-2'));
      fireEvent.click(screen.getByTestId('row-edit-2'));
      fireEvent.change(screen.getByTestId('row-field-2-quantity'), { target: { value: '2' } });
      fireEvent.click(screen.getByTestId('row-apply-2'));

      await waitFor(() => {
        expect((screen.getByTestId('review-continue') as HTMLButtonElement).disabled).toBe(false);
      });
      fireEvent.click(screen.getByTestId('review-continue'));

      fireEvent.click(await screen.findByTestId('acknowledge-checkbox'));
      const importButton = await screen.findByTestId('import-button');

      // Import must stay blocked: an unverified symbol must never be written.
      await waitFor(() => {
        expect(screen.getByText(/Resolve 1 ticker/i)).toBeTruthy();
      });
      expect((importButton as HTMLButtonElement).disabled).toBe(true);
      expect(host.importCalls).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
