/**
 * Revolut Importer page — four-step review/reconciliation wizard (T07).
 *
 * State machine: `upload → mapping → review → reconcile → importing → done`.
 *
 * The wizard is the single React root target for the sandbox route. It uses
 * React state/effects + direct `ctx.api` calls — no QueryClient provider, no
 * router hooks. The pure core (parser, validation, reconciliation) is
 * invoked here; the Wealthfolio adapter is invoked only at the final import
 * step (read-only `checkImport` gate → `saveMany({ creates })`).
 *
 * Privacy: the UI never displays raw rows, balances, or order ids by
 * default. Review shows source row number/type + normalized values.
 * Reconciliation shows decimal-string totals only.
 *
 * Import is disabled until ALL blocking conditions are clear (see
 * `canImport` in `src/state/import-state.ts`):
 *   1. account selected;
 *   2. zero fatal/unknown rows;
 *   3. all traded securities resolved;
 *   4. reconciliation residual rules pass;
 *   5. user acknowledgement checked.
 *
 * No write occurs before explicit confirmation. Upload, mapping, review,
 * and reconciliation never write.
 */
import { useCallback, useMemo, useReducer } from 'react';
import type { AddonContext, AddonRouteLocation } from '@wealthfolio/addon-sdk';
import { Button } from '@wealthfolio/ui';
import { Card, CardContent } from '@wealthfolio/ui';
import {
  INITIAL_STATE,
  reducer,
  canImport,
  type ImportState,
  type ReviewFilter,
  type TickerResolution,
  type TickerEntry,
  type UploadSummary,
} from '../state/import-state';
import type { ActivityDraft } from '../domain/activity-draft';
import type { BatchResult } from '../domain/import-outcome';
import { reconcile } from '../reconciliation/reconcile';
import { runImport } from '../wealthfolio/import';
import type { CanonicalIdentity } from '../wealthfolio/symbol-mappings';
import { UploadStep } from '../components/upload-step';
import { MappingStep } from '../components/mapping-step';
import { ReviewStep } from '../components/review-step';
import { ReconciliationPanel } from '../components/reconciliation-panel';
import { ImportResult } from '../components/import-result';

export interface ImporterPageProps {
  ctx: AddonContext;
  location: AddonRouteLocation;
}

export function ImporterPage({ ctx, location }: ImporterPageProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // --- Step transitions -----------------------------------------------------

  const handleUploadComplete = useCallback((batch: BatchResult, summary: UploadSummary) => {
    dispatch({ type: 'UPLOAD_COMPLETE', batch, summary });
  }, []);

  const handleUploadError = useCallback((message: string) => {
    dispatch({ type: 'UPLOAD_FAILED', error: message });
  }, []);

  const handleSelectAccount = useCallback((accountId: string) => {
    dispatch({ type: 'SELECT_ACCOUNT', accountId });
  }, []);

  const handleTickersInitialized = useCallback((tickers: Readonly<Record<string, TickerEntry>>) => {
    dispatch({ type: 'TICKERS_INITIALIZED', tickers });
  }, []);

  const handleTickerResolved = useCallback((ticker: string, identity: CanonicalIdentity) => {
    dispatch({ type: 'TICKER_RESOLVED', ticker, identity });
  }, []);

  const handleTickerResolutionSet = useCallback((ticker: string, resolution: TickerResolution) => {
    dispatch({ type: 'TICKER_RESOLUTION_SET', ticker, resolution });
  }, []);

  const handleFilterChange = useCallback((filter: ReviewFilter) => {
    dispatch({ type: 'SET_FILTER', filter });
  }, []);

  const handleAcknowledge = useCallback((acknowledged: boolean) => {
    dispatch({ type: 'SET_ACKNOWLEDGED', acknowledged });
  }, []);

  // Compute reconciliation when entering the reconcile step.
  const computeReconciliation = useCallback(() => {
    if (!state.batch) return;
    const report = reconcile(state.batch.outcomes);
    dispatch({ type: 'RECONCILE_COMPLETE', report });
  }, [state.batch]);

  const goToReview = useCallback(() => {
    dispatch({ type: 'GOTO', step: 'review' });
  }, []);

  const goToReconcile = useCallback(() => {
    dispatch({ type: 'GOTO', step: 'reconcile' });
    // Compute reconciliation after the step transition.
    // Use a microtask so the reducer applies the GOTO first.
    queueMicrotask(computeReconciliation);
  }, [computeReconciliation]);

  const goBackToMapping = useCallback(() => {
    dispatch({ type: 'GOTO', step: 'mapping' });
  }, []);

  const goBackToReview = useCallback(() => {
    dispatch({ type: 'GOTO', step: 'review' });
  }, []);

  // --- Import ---------------------------------------------------------------

  const handleImport = useCallback(async () => {
    if (!canImport(state) || !state.batch || !state.accountId) return;
    dispatch({ type: 'IMPORT_STARTED' });
    try {
      const drafts: ActivityDraft[] = [...state.batch.imported];
      const fingerprints = state.batch.fingerprints;
      const sourceRowNumbers = state.batch.outcomes.map((o) => o.rowIndex);

      // Build the asset resolver from resolved tickers.
      const tickerMap = new Map<string, CanonicalIdentity>();
      for (const entry of Object.values(state.tickers)) {
        if (entry.resolution.status === 'resolved') {
          tickerMap.set(entry.ticker, entry.resolution.identity);
        }
      }
      const resolveAsset = async (draft: ActivityDraft) => {
        if (!draft.ticker) return undefined;
        const identity = tickerMap.get(draft.ticker);
        if (!identity) return { symbol: draft.ticker };
        return {
          symbol: identity.symbol,
          exchangeMic: identity.exchangeMic,
          providerId: identity.providerId,
        };
      };

      const result = await runImport(
        ctx.api,
        state.accountId,
        drafts,
        [...fingerprints],
        sourceRowNumbers,
        resolveAsset,
      );

      dispatch({
        type: 'IMPORT_COMPLETE',
        summary: {
          attempted: result.attempted,
          created: result.created,
          skippedDuplicates: result.skippedDuplicates,
          blocked: result.blocked,
          failed: result.failedFingerprints.length,
          fatal: result.fatal,
        },
      });
    } catch (err) {
      dispatch({
        type: 'IMPORT_FAILED',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [ctx.api, state]);

  const handleReset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // --- Render ----------------------------------------------------------------

  const stepIndex = useMemo(() => {
    const order: ImportState['step'][] = [
      'upload',
      'mapping',
      'review',
      'reconcile',
      'importing',
      'done',
    ];
    return order.indexOf(state.step);
  }, [state.step]);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Revolut Importer</h1>
        <p className="text-muted-foreground text-sm">
          Import Revolut investment CSV statements with explicit symbol review, duplicate-safe
          imports, and full row-level reconciliation.
        </p>
      </div>

      <Stepper current={stepIndex} />

      {state.error && state.step !== 'reconcile' && (
        <Card>
          <CardContent className="p-4">
            <p className="text-destructive text-sm" role="alert">
              {state.error}
            </p>
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'CLEAR_ERROR' })}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {state.step === 'upload' && (
        <UploadStep
          onComplete={handleUploadComplete}
          onError={handleUploadError}
          summary={state.upload}
          error={state.error}
        />
      )}

      {state.step === 'mapping' && state.batch && state.upload && (
        <MappingStep
          api={ctx.api}
          batch={state.batch}
          uploadSummary={state.upload}
          accountId={state.accountId}
          tickers={state.tickers}
          onSelectAccount={handleSelectAccount}
          onTickersInitialized={handleTickersInitialized}
          onTickerResolved={handleTickerResolved}
          onTickerResolutionSet={handleTickerResolutionSet}
          onContinue={goToReview}
        />
      )}

      {state.step === 'review' && state.batch && (
        <ReviewStep
          state={state}
          onFilterChange={handleFilterChange}
          onContinue={goToReconcile}
          onBack={goBackToMapping}
        />
      )}

      {state.step === 'reconcile' && (
        <ReconciliationPanel
          state={state}
          onAcknowledge={handleAcknowledge}
          onImport={handleImport}
          onBack={goBackToReview}
        />
      )}

      {(state.step === 'importing' || state.step === 'done') && state.importSummary && (
        <ImportResult summary={state.importSummary} onReset={handleReset} />
      )}

      {state.step === 'importing' && !state.importSummary && (
        <Card>
          <CardContent className="p-6">
            <p className="text-muted-foreground">Importing…</p>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">Route: {location.pathname}</p>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  const steps = ['Upload', 'Mapping', 'Review', 'Reconcile', 'Import'];
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((label, i) => {
        const active = i === current;
        const done = i < current;
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : done
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}. {label}
            </span>
            {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
          </div>
        );
      })}
    </div>
  );
}

export default ImporterPage;
