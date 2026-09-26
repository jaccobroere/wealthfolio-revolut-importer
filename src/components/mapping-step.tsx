/**
 * Mapping step — account selection + explicit ticker resolution.
 *
 * This step:
 * 1. Loads accounts via `ctx.api.accounts.getAll()` (delegated to
 *    {@link AccountSelect}).
 * 2. For every unseen traded-security ticker, runs the broad search
 *    (`broad-search.ts`) and ranks listings with `listing-choice.ts`: same
 *    instrument → traded currency → preferred exchanges. Nothing is accepted
 *    without a reviewer action; "Accept suggested listings" takes only a
 *    listing that is the same instrument, in the traded currency, and
 *    strictly first on exchange preference. A saved mapping is reused only
 *    after canonical-identity (symbol+MIC+provider) re-verification.
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
  countSavedMappings,
  readPreferredExchanges,
  readSavedMappings,
  resultToIdentity,
  resolveSymbol,
  withPreferredExchanges,
  withSavedMapping,
  withoutAllSavedMappings,
  withoutSavedMapping,
  type CanonicalIdentity,
} from '../wealthfolio/symbol-mappings';
import { broadSearch } from '../wealthfolio/broad-search';
import {
  DEFAULT_PREFERRED_EXCHANGES,
  parseExchangeList,
  rankListings,
  suggestListing,
  type RankedListing,
} from '../mapping/listing-choice';
import { IMPORTER_ID } from '../wealthfolio/types';

export interface MappingStepProps {
  api: HostAPI;
  batch: BatchResult;
  /** Privacy-safe aggregate retained after the upload step unmounts. */
  uploadSummary: UploadSummary;
  accountId: string | null;
  tickers: Readonly<Record<string, TickerEntry>>;
  onSelectAccount: (accountId: string) => void;
  onTickersInitialized: (tickers: Readonly<Record<string, TickerEntry>>) => void;
  onTickerResolved: (ticker: string, identity: CanonicalIdentity, fromSaved?: boolean) => void;
  onTickerResolutionSet: (ticker: string, resolution: TickerResolution) => void;
  onContinue: () => void;
  onBack: () => void;
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
  onBack,
}: MappingStepProps) {
  const [savedMappings, setSavedMappings] = useState<Map<string, CanonicalIdentity>>(new Map());
  const [searching, setSearching] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [mappingsReady, setMappingsReady] = useState(false);
  const [preferredExchanges, setPreferredExchanges] = useState<string[]>([
    ...DEFAULT_PREFERRED_EXCHANGES,
  ]);
  const [rememberedCount, setRememberedCount] = useState(0);
  const [accepting, setAccepting] = useState(false);

  // Initialize ticker entries once the batch is available.
  useEffect(() => {
    if (batch.outcomes.length === 0) return;
    const entries = buildTickerEntries(batch);
    onTickersInitialized(entries);
  }, [batch]);

  // When an account is selected, load saved mappings for re-verification.
  useEffect(() => {
    if (!accountId) {
      setSavedMappings(new Map());
      setMappingsReady(false);
      return;
    }
    let cancelled = false;
    setSavedMappings(new Map());
    setMappingsReady(false);
    api.activities
      .getImportMapping(accountId, IMPORTER_ID)
      .then((mapping: ImportMappingData) => {
        if (cancelled) return;
        setSavedMappings(readSavedMappings(mapping));
        setRememberedCount(countSavedMappings(mapping));
        setPreferredExchanges(readPreferredExchanges(mapping) ?? [...DEFAULT_PREFERRED_EXCHANGES]);
      })
      .catch(() => {
        if (cancelled) return;
        // Saved mappings are optional; absence is not fatal.
        setSavedMappings(new Map());
      })
      .finally(() => {
        if (!cancelled) setMappingsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [api, accountId]);

  // Auto-resolve tickers that have a verified saved mapping. For tickers
  // without a saved mapping, run a search so the user can confirm. The first
  // result is NEVER auto-selected.
  useEffect(() => {
    if (!accountId || !mappingsReady) return;
    let cancelled = false;
    (async () => {
      for (const entry of Object.values(tickers)) {
        if (cancelled) return;
        if (entry.resolution.status !== 'pending') continue;
        setSearching(entry.ticker);
        try {
          const found = await searchWithSaved(entry);
          if (cancelled) return;
          applySearch(entry.ticker, found);
        } catch {
          if (cancelled) return;
          setSearchError('Wealthfolio could not search this ticker. Try again before importing.');
        } finally {
          if (!cancelled) setSearching(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    api.market,
    mappingsReady,
    onTickerResolutionSet,
    onTickerResolved,
    savedMappings,
    tickers,
  ]);

  async function handleResolve(ticker: string, identity: CanonicalIdentity): Promise<void> {
    onTickerResolved(ticker, identity);
    if (!accountId) return;
    setPersistError(null);
    try {
      const current = await api.activities.getImportMapping(accountId, IMPORTER_ID);
      const updated = withSavedMapping(current, ticker, identity);
      await api.activities.saveImportMapping(updated);
      setSavedMappings(readSavedMappings(updated));
      setRememberedCount(countSavedMappings(updated));
    } catch {
      setPersistError('Wealthfolio could not save this mapping. You can retry the selection.');
    }
  }

  async function handleForget(ticker: string, results: SymbolSearchResult[]): Promise<void> {
    if (!accountId) return;
    setPersistError(null);
    try {
      const current = await api.activities.getImportMapping(accountId, IMPORTER_ID);
      const updated = withoutSavedMapping(current, ticker);
      await api.activities.saveImportMapping(updated);
      setSavedMappings(readSavedMappings(updated));
      setRememberedCount(countSavedMappings(updated));
      onTickerResolutionSet(
        ticker,
        results.length > 0 ? { status: 'candidates', results } : { status: 'no-results' },
      );
    } catch {
      setPersistError('Wealthfolio could not remove the remembered mapping. Try again.');
    }
  }

  /**
   * Search a ticker. Saved mappings are re-verified against their own listing
   * (e.g. `IWDA.AS`) first, then against the broad search; only when nothing
   * is found at all is a saved mapping trusted as-is (offline re-import).
   */
  async function searchWithSaved(entry: TickerEntry): Promise<SearchOutcome> {
    const saved = savedMappings.get(entry.ticker);
    const direct = saved
      ? await api.market.searchTicker(saved.providerSymbol ?? saved.symbol).catch(() => [])
      : [];
    if (saved && direct.length > 0) {
      const outcome = resolveSymbol(entry.ticker, savedMappings, direct);
      if (outcome.status === 'resolved') return { outcome, results: direct };
    }
    const broad = await broadSearch(api, {
      ticker: entry.ticker,
      ...(entry.tradedCurrency ? { tradedCurrency: entry.tradedCurrency } : {}),
    });
    const results = [...direct, ...broad.results];
    return {
      outcome: resolveSymbol(entry.ticker, savedMappings, results),
      results,
      ...(broad.anchorName ? { anchorName: broad.anchorName } : {}),
    };
  }

  function applySearch(ticker: string, found: SearchOutcome): void {
    const { outcome, results, anchorName } = found;
    const anchor = anchorName ? { anchorName } : {};
    if (outcome.status === 'resolved' && outcome.fromSaved) {
      onTickerResolved(ticker, outcome.identity, true);
    } else if (outcome.status === 'blocked') {
      onTickerResolutionSet(ticker, { status: 'stale', results, ...anchor });
    } else if (results.length === 0) {
      onTickerResolutionSet(ticker, { status: 'no-results' });
    } else {
      onTickerResolutionSet(ticker, { status: 'candidates', results, ...anchor });
    }
  }

  async function handleRetrySearch(ticker: string, query?: string): Promise<void> {
    const entry = tickers[ticker];
    if (!accountId || searching || !entry) return;
    setSearchError(null);
    setSearching(ticker);
    try {
      const custom = query?.trim();
      if (custom) {
        // The reviewer's own search: shown as candidates, ranked against the
        // instrument the broad search anchored on.
        const results = await api.market.searchTicker(custom);
        const previous = entry.resolution;
        const anchorName =
          previous.status === 'candidates' || previous.status === 'stale'
            ? previous.anchorName
            : undefined;
        onTickerResolutionSet(
          ticker,
          results.length === 0
            ? { status: 'no-results' }
            : { status: 'candidates', results, ...(anchorName ? { anchorName } : {}) },
        );
      } else {
        const found = await searchWithSaved(entry);
        // "Change" on a resolved ticker always reopens the choice.
        applySearch(
          ticker,
          entry.resolution.status === 'resolved' && found.outcome.status === 'resolved'
            ? { ...found, outcome: { status: 'ambiguous', results: found.results } }
            : found,
        );
      }
    } catch {
      setSearchError('Wealthfolio could not search this ticker. Try again before importing.');
    } finally {
      setSearching(null);
    }
  }

  function rankFor(entry: TickerEntry): RankedListing<SymbolSearchResult>[] {
    const r = entry.resolution;
    if (r.status !== 'candidates' && r.status !== 'stale') return [];
    return rankListings(r.results, {
      ...(entry.tradedCurrency ? { tradedCurrency: entry.tradedCurrency } : {}),
      ...(r.anchorName ? { anchorName: r.anchorName } : { sourceSymbol: entry.ticker }),
      preferredExchanges,
    });
  }

  /** Accept the suggested listing for every ticker awaiting a choice. */
  async function handleAcceptSuggested(): Promise<void> {
    if (!accountId || accepting) return;
    setAccepting(true);
    setPersistError(null);
    try {
      const accepted: [string, CanonicalIdentity][] = [];
      for (const entry of Object.values(tickers)) {
        if (entry.resolution.status !== 'candidates') continue;
        const suggested = suggestListing(rankFor(entry));
        if (!suggested) continue;
        const identity = resultToIdentity(suggested.candidate);
        onTickerResolved(entry.ticker, identity);
        accepted.push([entry.ticker, identity]);
      }
      if (accepted.length === 0) return;
      const current = await api.activities.getImportMapping(accountId, IMPORTER_ID);
      const updated = accepted.reduce((m, [t, id]) => withSavedMapping(m, t, id), current);
      await api.activities.saveImportMapping(updated);
      setSavedMappings(readSavedMappings(updated));
      setRememberedCount(countSavedMappings(updated));
    } catch {
      setPersistError('Wealthfolio could not save these mappings. They apply to this import.');
    } finally {
      setAccepting(false);
    }
  }

  async function handleForgetAll(): Promise<void> {
    if (!accountId) return;
    const current = await api.activities.getImportMapping(accountId, IMPORTER_ID);
    await api.activities.saveImportMapping(withoutAllSavedMappings(current));
    setSavedMappings(new Map());
    setRememberedCount(0);
    for (const entry of Object.values(tickers)) {
      onTickerResolutionSet(entry.ticker, { status: 'pending' });
    }
  }

  async function handleSavePreferred(exchanges: string[]): Promise<void> {
    const next = exchanges.length > 0 ? exchanges : [...DEFAULT_PREFERRED_EXCHANGES];
    setPreferredExchanges(next);
    if (!accountId) return;
    try {
      const current = await api.activities.getImportMapping(accountId, IMPORTER_ID);
      await api.activities.saveImportMapping(withPreferredExchanges(current, next));
    } catch {
      // Non-fatal: the preference applies to this session.
    }
  }

  const entries = Object.values(tickers);
  const unresolved = entries.filter((e) => e.resolution.status !== 'resolved');
  const canContinue = !!accountId && mappingsReady && unresolved.length === 0;

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
            ticker is searched broadly and its listings are ranked: the same instrument first, then
            the currency you traded it in, then your preferred exchanges. Confirm the listing you
            hold for each ticker below, or search for another one.
          </p>

          {accountId && entries.length > 0 && (
            <MappingSettings
              preferredExchanges={preferredExchanges}
              onSave={handleSavePreferred}
              rememberedCount={rememberedCount}
              onForgetAll={handleForgetAll}
            />
          )}

          {entries.some(
            (e) => e.resolution.status === 'candidates' && suggestListing(rankFor(e)),
          ) && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={accepting}
                onClick={() => void handleAcceptSuggested()}
                data-testid="accept-all-suggested"
              >
                Accept suggested listings
              </Button>
              <p className="text-muted-foreground text-xs">
                Accepts a listing only when it is the same instrument, in the currency you traded it
                in, and first on your exchange preference.
              </p>
            </div>
          )}

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
              onForget={() =>
                entry.resolution.status === 'stale'
                  ? handleForget(entry.ticker, entry.resolution.results)
                  : undefined
              }
              onRetry={(query) => handleRetrySearch(entry.ticker, query)}
              ranked={rankFor(entry)}
            />
          ))}

          {!mappingsReady && accountId && (
            <p className="text-muted-foreground text-sm">Loading account-specific mappings…</p>
          )}

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

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack} data-testid="mapping-back">
          Start over
        </Button>
        <Button disabled={!canContinue} onClick={onContinue} data-testid="mapping-continue">
          Continue to review
        </Button>
      </div>
    </div>
  );
}

interface SearchOutcome {
  outcome: ReturnType<typeof resolveSymbol>;
  results: SymbolSearchResult[];
  anchorName?: string;
}

interface TickerRowProps {
  entry: TickerEntry;
  searching: boolean;
  ranked: RankedListing<SymbolSearchResult>[];
  onResolve: (identity: CanonicalIdentity) => Promise<void> | void;
  onForget: () => Promise<void> | void;
  onRetry: (query?: string) => Promise<void> | void;
}

function TickerRow({ entry, searching, ranked, onResolve, onForget, onRetry }: TickerRowProps) {
  const { resolution } = entry;
  const [query, setQuery] = useState('');
  const suggested = suggestListing(ranked);
  const choosing = resolution.status === 'candidates' || resolution.status === 'stale';
  return (
    <div className="rounded-md border p-3" data-testid={`ticker-row-${entry.ticker}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{entry.ticker}</div>
          <div className="text-muted-foreground text-xs">
            Referenced by {entry.rowIndices.length} row
            {entry.rowIndices.length === 1 ? '' : 's'}
            {entry.tradedCurrency ? ` · traded in ${entry.tradedCurrency}` : ''}
          </div>
        </div>
        <ResolutionBadge status={resolution.status} />
      </div>

      {resolution.status === 'resolved' && (
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>
            Resolved → {resolution.identity.symbol}
            {resolution.identity.exchangeMic ? ` · ${resolution.identity.exchangeMic}` : ''}
            {resolution.identity.quoteCcy ? ` · ${resolution.identity.quoteCcy}` : ''}
            {resolution.fromSaved ? ' (saved mapping)' : ''}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onRetry()}
            disabled={searching}
            data-testid={`change-mapping-${entry.ticker}`}
          >
            Change
          </Button>
        </div>
      )}

      {resolution.status === 'stale' && (
        <p className="mt-2 text-sm text-destructive">
          The remembered mapping for this account no longer matches Wealthfolio’s current results.
          Select a replacement below, or remove the remembered mapping.
        </p>
      )}

      {choosing && (
        <div className="mt-2 space-y-2">
          <div className="text-sm">
            {ranked.length} listing(s), best match first — select the one you hold:
          </div>
          {ranked.map((r) => {
            const c = r.candidate;
            const identity = resultToIdentity(c);
            return (
              <button
                key={`${c.symbol}-${c.exchangeMic ?? ''}-${r.index}`}
                type="button"
                className={`block w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${
                  r === suggested ? 'border-emerald-500' : ''
                } ${r.sameInstrument ? '' : 'opacity-70'}`}
                onClick={() => onResolve(identity)}
                data-testid={`ticker-candidate-${entry.ticker}-${r.index}`}
              >
                <span className="font-medium">{c.symbol}</span>
                {c.exchangeName ? ` · ${c.exchangeName}` : ''}
                {identity.exchangeMic ? ` (${identity.exchangeMic})` : ''}
                {c.currency ? ` · ${c.currency}` : ''}
                {r === suggested ? (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">
                    Suggested
                  </span>
                ) : null}
                {r.currencyMatch ? (
                  <span className="ml-2 rounded bg-muted px-1.5 text-xs">Traded currency</span>
                ) : null}
                {!r.sameInstrument ? (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs text-amber-800">
                    Other instrument?
                  </span>
                ) : null}
                {c.longName || c.shortName ? (
                  <span className="text-muted-foreground block text-xs">
                    {c.longName || c.shortName}
                  </span>
                ) : null}
              </button>
            );
          })}
          {resolution.status === 'stale' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onForget()}
              disabled={searching}
              data-testid={`forget-saved-mapping-${entry.ticker}`}
            >
              Remove remembered mapping
            </Button>
          )}
        </div>
      )}

      {resolution.status === 'no-results' && (
        <p className="text-destructive mt-2 text-sm">
          No instruments found for “{entry.ticker}”. Search for another ticker or name below.
        </p>
      )}

      {resolution.status === 'blocked' && (
        <p className="text-destructive mt-2 text-sm">{resolution.reason}</p>
      )}

      {resolution.status !== 'resolved' && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onRetry(query.trim() || undefined);
          }}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search another ticker or name, e.g. IWDA.AS"
            className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
            aria-label={`Custom search for ${entry.ticker}`}
            data-testid={`custom-query-${entry.ticker}`}
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={searching}
            data-testid={`custom-search-${entry.ticker}`}
          >
            {query.trim() ? 'Search' : 'Search again'}
          </Button>
        </form>
      )}
      {searching && <div className="text-muted-foreground mt-2 text-sm">Searching…</div>}
    </div>
  );
}

/** Exchange preference and "forget remembered mappings" for the account. */
function MappingSettings({
  preferredExchanges,
  onSave,
  rememberedCount,
  onForgetAll,
}: {
  preferredExchanges: string[];
  onSave: (exchanges: string[]) => Promise<void>;
  rememberedCount: number;
  onForgetAll: () => Promise<void>;
}) {
  const [text, setText] = useState(preferredExchanges.join(', '));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(preferredExchanges.join(', ')), [preferredExchanges]);
  const dirty = parseExchangeList(text).join(',') !== preferredExchanges.join(',');

  return (
    <div className="space-y-3 rounded-md border p-3" data-testid="mapping-settings">
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(parseExchangeList(text));
        }}
      >
        <label className="text-sm font-medium" htmlFor="preferred-exchanges">
          Preferred exchanges
        </label>
        <div className="flex items-center gap-2">
          <input
            id="preferred-exchanges"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-8 flex-1 rounded-md border bg-background px-2 font-mono text-sm"
            data-testid="preferred-exchanges"
          />
          <Button type="submit" variant="outline" size="sm" disabled={!dirty}>
            Save
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Exchange codes (MIC) in order of preference, e.g. XAMS (Amsterdam), XETR (Xetra), XPAR
          (Paris), XNAS/XNYS (US), XLON (London). Listings in the currency you traded in always come
          first. Saved for this account.
        </p>
      </form>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <p className="text-muted-foreground flex-1 text-xs">
          {rememberedCount > 0
            ? `${rememberedCount} remembered mapping(s) for this account are applied automatically.`
            : 'No remembered mappings for this account.'}
        </p>
        {confirming ? (
          <>
            <span className="text-xs">Forget all {rememberedCount} for this account?</span>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                onForgetAll()
                  .catch(() => {
                    // Nothing changed; the button can be used again.
                  })
                  .finally(() => {
                    setBusy(false);
                    setConfirming(false);
                  });
              }}
              data-testid="confirm-forget-all-mappings"
            >
              Forget all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={rememberedCount === 0}
            onClick={() => setConfirming(true)}
            data-testid="forget-all-mappings"
          >
            Forget remembered mappings
          </Button>
        )}
      </div>
    </div>
  );
}

function ResolutionBadge({ status }: { status: TickerEntry['resolution']['status'] }) {
  const map: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
    resolved: { label: 'Resolved', className: 'bg-emerald-100 text-emerald-800' },
    candidates: { label: 'Review required', className: 'bg-amber-100 text-amber-800' },
    stale: { label: 'Update mapping', className: 'bg-amber-100 text-amber-800' },
    'no-results': { label: 'No results', className: 'bg-red-100 text-red-800' },
    blocked: { label: 'Blocked', className: 'bg-red-100 text-red-800' },
  };
  const cfg = map[status] ?? map.pending;
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cfg.className}`}>{cfg.label}</span>
  );
}

export default MappingStep;
