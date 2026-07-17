/**
 * @vitest-environment jsdom
 */
import './setup';

import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  GOOD_CSV,
  cleanupUi,
  createAddonContext,
  installFileReaderMock,
  renderPageToReconcile,
} from './helpers';
import { ImporterPage } from '../../src/pages/importer-page';
import { createFakeHost } from '../wealthfolio/fake-host';

describe('Revolut importer page', () => {
  afterEach(() => {
    cleanupUi();
  });

  it('reaches reconcile and enables Import only after acknowledgement when every blocker is cleared', async () => {
    const { restoreFileReader } = await renderPageToReconcile();

    try {
      const importButton = await screen.findByTestId('import-button');
      const acknowledgeCheckbox = screen.getByTestId('acknowledge-checkbox');

      expect(importButton).toBeDisabled();
      expect(screen.getByText('Import is blocked')).toBeInTheDocument();

      fireEvent.click(acknowledgeCheckbox);

      expect(importButton).toBeEnabled();
    } finally {
      restoreFileReader();
    }
  });

  it('retains the privacy-safe upload aggregate after automatically advancing to mapping', async () => {
    const host = createFakeHost();
    const { restore } = installFileReaderMock(GOOD_CSV);
    render(
      <ImporterPage
        ctx={createAddonContext(host.api)}
        location={{ pathname: '/addon/revolut-importer', search: '', hash: '', params: {} }}
      />,
    );

    try {
      fireEvent.change(await screen.findByLabelText('Revolut CSV file'), {
        target: { files: [new File([GOOD_CSV], 'synthetic.csv', { type: 'text/csv' })] },
      });

      const summary = await screen.findByTestId('parsed-statement-summary');
      expect(screen.getByTestId('parsed-row-count')).toHaveTextContent('Rows: 3');
      expect(summary).toHaveTextContent('Date range: 2024-01-01 to 2024-01-03');
      expect(screen.queryByLabelText('Revolut CSV file')).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('makes stale remembered mappings reviewable and replaceable', async () => {
    const host = createFakeHost({
      searchResults: {
        AAPL: [
          {
            symbol: 'AAPL',
            canonicalSymbol: 'AAPL',
            exchange: 'NASDAQ',
            exchangeName: 'NASDAQ',
            exchangeMic: 'XNAS',
            canonicalExchangeMic: 'XNAS',
            providerId: 'wf-aapl',
            currency: 'USD',
          } as never,
        ],
      },
      importMapping: {
        accountId: 'acct-1',
        fieldMappings: {},
        activityMappings: {},
        accountMappings: {},
        symbolMappings: {
          'revolut-importer::AAPL': JSON.stringify({
            symbol: 'OUTDATED',
            exchangeMic: 'XNAS',
            providerId: 'old-provider',
          }),
        },
      },
    });
    const { restore } = installFileReaderMock(GOOD_CSV);
    render(
      <ImporterPage
        ctx={createAddonContext(host.api)}
        location={{ pathname: '/addon/revolut-importer', search: '', hash: '', params: {} }}
      />,
    );

    try {
      fireEvent.change(await screen.findByLabelText('Revolut CSV file'), {
        target: { files: [new File([GOOD_CSV], 'synthetic.csv', { type: 'text/csv' })] },
      });
      const accountSelect = await screen.findByLabelText('Destination account');
      await waitFor(() => expect(accountSelect).toBeEnabled());
      fireEvent.change(accountSelect, {
        target: { value: 'acct-1' },
      });

      await waitFor(() => {
        expect(screen.getByLabelText('Destination account')).toHaveValue('acct-1');
      });
      fireEvent.click(await screen.findByRole('button', { name: 'Search now' }));

      expect(
        await screen.findByText(/remembered mapping for this account no longer matches/i),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('ticker-candidate-AAPL-0'));

      await waitFor(() => {
        expect(host.savedMapping?.symbolMappings['revolut-importer::AAPL']).toContain('wf-aapl');
        expect(screen.getByTestId('mapping-continue')).toBeEnabled();
      });
    } finally {
      restore();
    }
  });
});
