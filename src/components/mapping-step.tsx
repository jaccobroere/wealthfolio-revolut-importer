/**
 * Mapping step — account selection + explicit ticker resolution.
 *
 * This step:
 * 1. Loads accounts via `ctx.api.accounts.getAll()` (delegated to
 *    {@link AccountSelect}).
 * 2. For every unseen traded-security ticker, calls
 *    `ctx.api.market.searchTicker(query)`. The first result is NEVER
 *    auto-accepted. A saved mapping (from `getImportMapping`) is reused
 *    only after canonical-identity (symbol+MIC+provider) re-verification.
 * 3. Unresolved / ambiguous tickers block progression to review.
 *
 * Privacy: shows the normalized source ticker and the resolved canonical
 * identity only. Never displays raw rows or balances.
 */
import { useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@wealthfolio/ui';
import { Button } from '@wealthfolio/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import type { HostAPI, ImportMappingData, SymbolSearchResult } from '@wealthfolio/addon-sdk';
import type { BatchResult } from '../domain/import-outcome';
import type { TickerEntry, TickerResolution, UploadSummary } from '../state/import-state';
import { buildTickerEntries } from '../state/import-state';
import { AccountSelect } from './account-select';
import {
  readSavedMappings,
  resolveSymbol,
  withSavedMapping,
  type CanonicalIdentity,
} from '../wealthfolio/symbol-mappings';

export interface MappingStepProps {
  api: HostAPI;
  batch: BatchResult;
  /** Privacy-safe aggregate retained after the upload step unmounts. */
  uploadSummary: UploadSummary;
  accountId: string | null;
  tickers: Readonly<Record<string, TickerEntry>>;
  onSelectAccount: (accountId: string) => void;
  onTickersInitialized: (tickers: Readonly<Record<string, TickerEntry>>) => void;
  onTickerResolved: (ticker: string, identity: CanonicalIdentity) => void;
  onTickerResolutionSet: (ticker: string, resolution: TickerResolution) => void;
  onContinue: () => void;
}

export function MappingStep({
  api,
  batch,
  uploadSummary,
  accountId,
  tickers,
  onSelectAccount,
  onTickersInitialized,
  onTickerResolved,
  onTickerResolutionSet,
  onContinue,
}: MappingStepProps) {
  const [savedMappings, setSavedMappings] = useState<Map<string, CanonicalIdentity>>(new Map());
  const [searching, setSearching] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  // Initialize ticker entries once the batch is available.
  useEffect(() => {
    if (batch.outcomes.length === 0) return;
    const entries = buildTickerEntries(batch);
    onTickersInitialized(entries);
  }, [batch]);

  // When an account is selected, load saved mappings for re-verification.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    api.activities
      .getImportMapping(accountId, 'revolut')
      .then((mapping: ImportMappingData) => {
        if (cancelled) return;
        setSavedMappings(readSavedMappings(mapping));
      })
      .catch(() => {
        if (cancelled) return;
        // Saved mappings are optional; absence is not fatal.
        setSavedMappings(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [api, accountId]);

  // Auto-resolve tickers that have a verified saved mapping. For tickers
  // without a saved mapping, run a search so the user can confirm. The first
  // result is NEVER auto-selected.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      for (const entry of Object.values(tickers)) {
        if (cancelled) return;
        if (entry.resolution.status !== 'pending') continue;
        setSearching(entry.ticker);
        try {
          const results: SymbolSearchResult[] = await api.market.searchTicker(entry.ticker);
          if (cancelled) return;
          const outcome = resolveSymbol(entry.ticker, savedMappings, results);
          if (outcome.status === 'resolved') {
            if (outcome.fromSaved) {
              onTickerResolved(entry.ticker, outcome.identity);
            } else {
              onTickerResolutionSet(entry.ticker, {
                status: 'candidates',
                results,
              });
            }
          }
          if (outcome.status === 'ambiguous') {
            onTickerResolutionSet(entry.ticker, {
              status: 'candidates',
              results: outcome.results,
            });
          }
          if (outcome.status === 'no-results') {
            onTickerResolutionSet(entry.ticker, { status: 'no-results' });
          }
          if (outcome.status === 'blocked') {
            onTickerResolutionSet(entry.ticker, {
              status: 'blocked',
              reason: outcome.reason,
            });
          }
        } catch (err) {
          if (cancelled) return;
          setSearchError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!cancelled) setSearching(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, api.market, onTickerResolutionSet, onTickerResolved, savedMappings, tickers]);

  async function handleResolve(ticker: string, identity: CanonicalIdentity): Promise<void> {
    onTickerResolved(ticker, identity);
    if (!accountId) return;
    setPersistError(null);
    try {
      const current = await api.activities.getImportMapping(accountId, 'revolut');
      const updated = withSavedMapping(current, ticker, identity);
      await api.activities.saveImportMapping(updated);
      setSavedMappings(readSavedMappings(updated));
    } catch (error) {
      setPersistError(error instanceof Error ? error.message : String(error));
    }
  }

  const entries = Object.values(tickers);
  const unresolved = entries.filter((e) => e.resolution.status !== 'resolved');
  const canContinue = !!accountId && unresolved.length === 0;

  return (
    <div className="space-y-4">
      <Card data-testid="parsed-statement-summary">
        <CardHeader>
          <CardTitle>File parsed successfully</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            <span data-testid="parsed-row-count">Rows: {uploadSummary.rowCount}</span>
            {uploadSummary.minDate && uploadSummary.maxDate
              ? ` · Date range: ${uploadSummary.minDate} to ${uploadSummary.maxDate}`
              : ''}
          </p>
        </CardContent>
      </Card>

      <AccountSelect api={api} accountId={accountId} onSelect={onSelectAccount} />

      <Card>
        <CardHeader>
          <CardTitle>Step 2 — Confirm symbol mappings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Revolut statements identify securities by ticker only (no ISIN or exchange). Each unseen
            ticker is searched against the market-data registry. The first search result is never
            auto-accepted; confirm the canonical instrument for each ticker below.
          </p>

          {entries.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No traded securities in this file — only cash movements. Nothing to map.
            </p>
          )}

          {entries.map((entry) => (
            <TickerRow
              key={entry.ticker}
              entry={entry}
              searching={searching === entry.ticker}
              onResolve={(identity) => handleResolve(entry.ticker, identity)}
            />
          ))}

          {searchError && (
            <Alert variant="destructive">
              <AlertTitle>Search failed</AlertTitle>
              <AlertDescription>{searchError}</AlertDescription>
            </Alert>
          )}

          {persistError && (
            <Alert variant="destructive">
              <AlertTitle>Could not save mapping</AlertTitle>
              <AlertDescription>{persistError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={!canContinue} onClick={onContinue} data-testid="mapping-continue">
          Continue to review
        </Button>
      </div>
    </div>
  );
}

interface TickerRowProps {
  entry: TickerEntry;
  searching: boolean;
  onResolve: (identity: CanonicalIdentity) => Promise<void> | void;
}

function TickerRow({ entry, searching, onResolve }: TickerRowProps) {
  const { resolution } = entry;
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{entry.ticker}</div>
          <div className="text-muted-foreground text-xs">
            Referenced by {entry.rowIndices.length} row
            {entry.rowIndices.length === 1 ? '' : 's'}
          </div>
        </div>
        <ResolutionBadge status={resolution.status} />
      </div>

      {resolution.status === 'resolved' && (
        <div className="text-muted-foreground mt-2 text-sm">
          Resolved → {resolution.identity.symbol}
          {resolution.identity.exchangeMic ? ` · ${resolution.identity.exchangeMic}` : ''}
          {resolution.identity.providerId ? ` · ${resolution.identity.providerId}` : ''}
          {resolution.fromSaved ? ' (saved mapping)' : ''}
        </div>
      )}

      {resolution.status === 'candidates' && (
        <div className="mt-2 space-y-2">
          <div className="text-sm">
            {resolution.results.length === 1
              ? 'Confirm the matched instrument:'
              : 'Multiple instruments matched. Select the correct one:'}
          </div>
          {resolution.results.map((r, i) => {
            const identity: CanonicalIdentity = {
              symbol: r.canonicalSymbol ?? r.symbol,
              exchangeMic: r.canonicalExchangeMic ?? r.exchangeMic,
              providerId: r.providerId,
            };
            return (
              <button
                key={`${r.symbol}-${i}`}
                type="button"
                className="block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => onResolve(identity)}
                data-testid={`ticker-candidate-${entry.ticker}-${i}`}
              >
                <span className="font-medium">{identity.symbol}</span>
                {identity.exchangeMic ? ` · ${identity.exchangeMic}` : ''}
                {r.exchangeName ? ` · ${r.exchangeName}` : ''}
                {r.currency ? ` · ${r.currency}` : ''}
                {r.shortName ? ` — ${r.shortName}` : ''}
              </button>
            );
          })}
        </div>
      )}

      {resolution.status === 'no-results' && (
        <div className="text-destructive mt-2 text-sm">
          No instruments found for “{entry.ticker}”. This ticker must be resolved before import.
        </div>
      )}

      {resolution.status === 'blocked' && (
        <div className="text-destructive mt-2 text-sm">{resolution.reason}</div>
      )}

      {resolution.status === 'pending' && !searching && (
        <div className="text-muted-foreground mt-2 text-sm">Searching…</div>
      )}
      {searching && <div className="text-muted-foreground mt-2 text-sm">Searching…</div>}
    </div>
  );
}

function ResolutionBadge({ status }: { status: TickerEntry['resolution']['status'] }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
    resolved: { label: 'Resolved', className: 'bg-emerald-100 text-emerald-800' },
    candidates: { label: 'Review required', className: 'bg-amber-100 text-amber-800' },
    'no-results': { label: 'No results', className: 'bg-red-100 text-red-800' },
    blocked: { label: 'Blocked', className: 'bg-red-100 text-red-800' },
  };
  const cfg = map[status] ?? map.pending;
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cfg.className}`}>{cfg.label}</span>
  );
}

export default MappingStep;
