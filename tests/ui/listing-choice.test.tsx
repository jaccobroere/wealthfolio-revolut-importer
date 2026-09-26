/**
 * @vitest-environment jsdom
 */
import './setup';

import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SymbolSearchResult } from '@wealthfolio/addon-sdk';

import { cleanupUi, createAddonContext, installFileReaderMock } from './helpers';
import { ImporterPage } from '../../src/pages/importer-page';
import { createFakeHost, type FakeHostOptions } from '../wealthfolio/fake-host';

const EUR_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-02T10:00:00.000000Z,SYNA,BUY - MARKET,2,EUR 50.00,EUR 100.00,EUR,1.0000
`;

const FUND = 'Synthetic MSCI Emerging UCITS ETF USD Acc';
const result = (symbol: string, mic: string, currency: string, longName = FUND) =>
  ({
    symbol,
    canonicalSymbol: symbol.split('.')[0],
    exchange: mic,
    exchangeName: mic,
    exchangeMic: mic,
    canonicalExchangeMic: mic,
    currency,
    longName,
    shortName: longName,
    quoteType: 'ETF',
    providerId: 'YAHOO',
    providerSymbol: symbol,
  }) as unknown as SymbolSearchResult;

const US_OTHER = result('SYNA', 'ARCX', 'USD', 'Another Active ETF');
const LONDON = result('SYNA.L', 'XLON', 'GBp');
const AMSTERDAM = result('SYNA.AS', 'XAMS', 'EUR');

async function openMapping(options: FakeHostOptions) {
  const host = createFakeHost(options);
  const { restore } = installFileReaderMock(EUR_CSV);
  render(
    <ImporterPage
      ctx={createAddonContext(host.api)}
      location={{ pathname: '/addon/revolut-importer', search: '', hash: '', params: {} }}
    />,
  );
  fireEvent.change(await screen.findByLabelText('Revolut CSV file'), {
    target: { files: [new File([EUR_CSV], 'synthetic.csv', { type: 'text/csv' })] },
  });
  const accountSelect = await screen.findByLabelText('Destination account');
  await waitFor(() => expect(accountSelect).toBeEnabled());
  fireEvent.change(accountSelect, { target: { value: 'acct-1' } });
  return { host, restore };
}

describe('Revolut listing choice', () => {
  afterEach(() => cleanupUi());

  it('suggests the listing in the traded currency, not the US namesake or London', async () => {
    const { host, restore } = await openMapping({
      searchResults: { SYNA: [US_OTHER, LONDON, AMSTERDAM], [FUND]: [LONDON, AMSTERDAM] },
    });
    try {
      fireEvent.click(await screen.findByTestId('accept-all-suggested'));
      await waitFor(() => {
        const saved = host.savedMapping?.symbolMappings['revolut-importer::SYNA'];
        expect(saved).toContain('"exchangeMic":"XAMS"');
        expect(saved).toContain('"quoteCcy":"EUR"');
      });
    } finally {
      restore();
    }
  });

  it('lets the reviewer search another ticker and pick it', async () => {
    const MILAN = result('SYNA.MI', 'XMIL', 'EUR');
    const { host, restore } = await openMapping({
      searchResults: { SYNA: [US_OTHER], 'SYNA.MI': [MILAN] },
    });
    try {
      // Wait for the automatic search to finish before searching again.
      await screen.findByTestId('ticker-candidate-SYNA-0');
      await waitFor(() => expect(screen.queryByText('Searching…')).toBeNull());
      fireEvent.change(await screen.findByTestId('custom-query-SYNA'), {
        target: { value: 'SYNA.MI' },
      });
      fireEvent.click(screen.getByTestId('custom-search-SYNA'));
      await waitFor(() =>
        expect(screen.getByTestId('ticker-candidate-SYNA-0')).toHaveTextContent('SYNA.MI'),
      );
      fireEvent.click(screen.getByTestId('ticker-candidate-SYNA-0'));
      await waitFor(() =>
        expect(host.savedMapping?.symbolMappings['revolut-importer::SYNA']).toContain(
          '"exchangeMic":"XMIL"',
        ),
      );
    } finally {
      restore();
    }
  });

  it('forgets every remembered mapping for the account after confirmation', async () => {
    const { host, restore } = await openMapping({
      searchResults: { SYNA: [AMSTERDAM] },
      importMapping: {
        accountId: 'acct-1',
        fieldMappings: {},
        activityMappings: {},
        accountMappings: {},
        symbolMappings: {
          'revolut-importer::SYNA': JSON.stringify({
            symbol: 'SYNA',
            exchangeMic: 'XAMS',
            providerId: 'YAHOO',
          }),
          'degiro-importer::IE00SYN00001': JSON.stringify({ symbol: 'SYNC' }),
        },
      },
    });
    try {
      const forget = await screen.findByTestId('forget-all-mappings');
      await waitFor(() => expect(forget).toBeEnabled());
      fireEvent.click(forget);
      fireEvent.click(await screen.findByTestId('confirm-forget-all-mappings'));
      await waitFor(() => {
        expect(Object.keys(host.savedMapping?.symbolMappings ?? {})).toEqual([
          'degiro-importer::IE00SYN00001',
        ]);
        expect(screen.getByText('No remembered mappings for this account.')).toBeInTheDocument();
      });
    } finally {
      restore();
    }
  });
});
