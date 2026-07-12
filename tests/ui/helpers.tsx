import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AddonContext, HostAPI, SymbolSearchResult } from '@wealthfolio/addon-sdk';

import { ImporterPage } from '../../src/pages/importer-page';
import { ReconciliationPanel } from '../../src/components/reconciliation-panel';
import {
  INITIAL_STATE,
  blockingReasons,
  buildTickerEntries,
  canImport,
  reducer,
  uploadSummaryFromBatch,
  type ImportState,
} from '../../src/state/import-state';
import { parseRevolutCsv } from '../../src/parser/parse-csv';
import { validateBatch } from '../../src/validation/validate-batch';
import { reconcile } from '../../src/reconciliation/reconcile';
import { createFakeHost, type FakeHostOptions } from '../wealthfolio/fake-host';

export const GOOD_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,,CASH TOP-UP,,,EUR 100.00,EUR,1.0000
2024-01-02T10:00:00.000000Z,AAPL,BUY - MARKET,2,USD 150.00,USD 300.00,USD,1.0000
2024-01-03T10:00:00.000000Z,AAPL,DIVIDEND,,,USD 5.00,USD,1.0000
`;

export const UNKNOWN_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,,CASH TOP-UP,,,EUR 100.00,EUR,1.0000
2024-01-02T10:00:00.000000Z,AAPL,MYSTERY EVENT,2,USD 150.00,USD 300.00,USD,1.0000
`;

export const INVALID_CSV = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2024-01-01T10:00:00.000000Z,AAPL,BUY - MARKET,0,USD 150.00,USD 300.00,USD,1.0000
`;

export const DEFAULT_SEARCH_RESULTS: Record<string, SymbolSearchResult[]> = {
  AAPL: [
    {
      symbol: 'AAPL',
      canonicalSymbol: 'AAPL',
      exchangeName: 'NASDAQ',
      exchange: 'NASDAQ',
      exchangeMic: 'XNAS',
      canonicalExchangeMic: 'XNAS',
      providerId: 'wf-aapl',
      currency: 'USD',
      shortName: 'Apple Inc.',
    } as unknown as SymbolSearchResult,
  ],
};

export function createAddonContext(api: HostAPI): AddonContext {
  return {
    api,
    sidebar: { addItem: () => ({ remove: () => {} }) },
    router: { add: () => {} },
    onDisable: () => {},
    navigation: { navigate: () => {} },
  } as unknown as AddonContext;
}

export async function buildState(
  options: {
    csv?: string;
    accountId?: string | null;
    resolvedTickers?: boolean;
    acknowledged?: boolean;
    forceResidualFailure?: boolean;
  } = {},
): Promise<ImportState> {
  const {
    csv = GOOD_CSV,
    accountId = 'acct-1',
    resolvedTickers = true,
    acknowledged = false,
    forceResidualFailure = false,
  } = options;

  const parsed = parseRevolutCsv(csv);
  if (!parsed.header.ok) {
    throw new Error(parsed.header.error ?? 'Expected valid Revolut test CSV');
  }

  const batch = await validateBatch(parsed.rows);
  let state = reducer(INITIAL_STATE, {
    type: 'UPLOAD_COMPLETE',
    batch,
    summary: uploadSummaryFromBatch(batch, parsed.header.ok, parsed.header.error),
  });

  state = reducer(state, {
    type: 'TICKERS_INITIALIZED',
    tickers: buildTickerEntries(batch),
  });

  if (accountId) {
    state = reducer(state, { type: 'SELECT_ACCOUNT', accountId });
  }

  if (resolvedTickers) {
    for (const ticker of Object.keys(state.tickers)) {
      const result = DEFAULT_SEARCH_RESULTS[ticker]?.[0];
      if (!result) continue;
      state = reducer(state, {
        type: 'TICKER_RESOLVED',
        ticker,
        identity: {
          symbol: result.canonicalSymbol ?? result.symbol,
          exchangeMic: result.canonicalExchangeMic ?? result.exchangeMic,
          providerId: result.providerId,
        },
      });
    }
  }

  state = reducer(state, { type: 'GOTO', step: 'reconcile' });
  const report = reconcile(batch.outcomes);
  state = reducer(state, {
    type: 'RECONCILE_COMPLETE',
    report: forceResidualFailure
      ? { ...report, accountedRows: Math.max(0, report.accountedRows - 1) }
      : report,
  });

  if (acknowledged) {
    state = reducer(state, { type: 'SET_ACKNOWLEDGED', acknowledged: true });
  }

  return state;
}

export function renderReconciliation(state: ImportState) {
  return render(
    <ReconciliationPanel
      state={state}
      onAcknowledge={() => {}}
      onImport={() => {}}
      onBack={() => {}}
    />,
  );
}

export async function renderPageToReconcile(hostOptions: FakeHostOptions = {}) {
  const host = createFakeHost({ searchResults: DEFAULT_SEARCH_RESULTS, ...hostOptions });
  const ctx = createAddonContext(host.api);
  const fileReader = installFileReaderMock(GOOD_CSV);

  const view = render(
    <ImporterPage
      ctx={ctx}
      location={{ pathname: '/addon/revolut-importer', search: '', hash: '', params: {} }}
    />,
  );

  const fileInput = await screen.findByLabelText('Revolut CSV file');
  const file = new File([GOOD_CSV], 'revolut.csv', { type: 'text/csv' });
  fireEvent.change(fileInput, { target: { files: [file] } });

  await screen.findByTestId('mapping-continue');

  fireEvent.change(await screen.findByLabelText('Destination account'), {
    target: { value: 'acct-1' },
  });
  fireEvent.click(await screen.findByTestId('ticker-candidate-AAPL-0'));

  await waitFor(() => {
    const button = screen.getByTestId('mapping-continue') as HTMLButtonElement;
    if (button.disabled) {
      throw new Error('Mapping continue still disabled');
    }
  });
  fireEvent.click(screen.getByTestId('mapping-continue'));
  fireEvent.click(await screen.findByTestId('review-continue'));
  await screen.findByTestId('import-button');

  return {
    ...view,
    ctx,
    host,
    restoreFileReader: fileReader.restore,
  };
}

export function installFileReaderMock(text: string) {
  const original = globalThis.FileReader;

  class MockFileReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsText(): void {
      this.result = text;
      queueMicrotask(() => {
        this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
      });
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

  return {
    restore(): void {
      globalThis.FileReader = original;
    },
  };
}

export function cleanupUi(): void {
  cleanup();
}

export function currentBlockers(state: ImportState): string[] {
  return blockingReasons(state);
}

export function importEnabled(state: ImportState): boolean {
  return canImport(state);
}
