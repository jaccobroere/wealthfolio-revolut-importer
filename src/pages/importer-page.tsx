/**
 * Revolut Importer page — four-step review/reconciliation wizard.
 *
 * State machine: `upload → mapping → review → reconcile → importing → done`.
 *
 * The wizard is the single React root target for the sandbox route. It uses
 * React state/effects + direct `ctx.api` calls — no QueryClient provider, no
 * router hooks. The pure core (parser, validation, reconciliation) is
 * invoked here; the Wealthfolio adapter is invoked only at the final import
 * step (read-only `checkImport` gate → `import(checkedActivities)`).
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
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { AddonContext, AddonRouteLocation } from '@wealthfolio/addon-sdk';
import { Button } from '@wealthfolio/ui';
import { Card, CardContent } from '@wealthfolio/ui';
import {
  INITIAL_STATE,
  reducer,
  canImport,
  buildImportPayload,
  type ImportState,
  type ReviewFilter,
  type TickerResolution,
  type TickerEntry,
  type UploadSummary,
} from '../state/import-state';
import type { ActivityDraft } from '../domain/activity-draft';
import type { BatchResult } from '../domain/import-outcome';
import type { RevolutSourceRow } from '../domain/revolut-row';
import type { RowOverride } from '../domain/row-override';
import { validateBatch } from '../validation/validate-batch';
import { uploadSummaryFromBatch } from '../state/import-state';
import { reconcile } from '../reconciliation/reconcile';
import { runImport } from '../wealthfolio/import';
import { identityToAsset, type CanonicalIdentity } from '../wealthfolio/symbol-mappings';
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

  const [rebuilding, setRebuilding] = useState(false);

  const handleUploadComplete = useCallback(
    (batch: BatchResult, summary: UploadSummary, rows: readonly RevolutSourceRow[]) => {
      dispatch({ type: 'UPLOAD_COMPLETE', batch, summary, rows });
    },
    [],
  );

  const handleOverrideChange = useCallback((rowIndex: number, override: RowOverride | null) => {
    dispatch({ type: 'SET_ROW_OVERRIDE', rowIndex, override });
  }, []);

  const handleClearOverrides = useCallback(() => {
    dispatch({ type: 'CLEAR_ROW_OVERRIDES' });
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

  const handleTickerResolved = useCallback(
    (ticker: string, identity: CanonicalIdentity, fromSaved = false) => {
      dispatch({ type: 'TICKER_RESOLVED', ticker, identity, fromSaved });
    },
    [],
  );

  const handleTickerResolutionSet = useCallback((ticker: string, resolution: TickerResolution) => {
    dispatch({ type: 'TICKER_RESOLUTION_SET', ticker, resolution });
  }, []);

  const handleFilterChange = useCallback((filter: ReviewFilter) => {
    dispatch({ type: 'SET_FILTER', filter });
  }, []);

  const handleAcknowledge = useCallback((acknowledged: boolean) => {
    dispatch({ type: 'SET_ACKNOWLEDGED', acknowledged });
  }, []);

  // Re-run validation whenever the reviewer changes a row decision. The stored
  // source rows stay pristine, so overrides are re-applied from the original
  // values rather than stacked on a previous edit.
  const { sourceRows, overrides, overridesVersion } = state;
  useEffect(() => {
    if (overridesVersion === 0 || sourceRows.length === 0) {
      // A reset clears the decisions; make sure the flag does not stick true
      // when an in-flight rebuild was cancelled before it could settle.
      setRebuilding(false);
      return;
    }
    let cancelled = false;
    setRebuilding(true);
    validateBatch(sourceRows, overrides)
      .then((batch) => {
        if (cancelled) return;
        dispatch({
          type: 'BATCH_REBUILT',
          batch,
          summary: uploadSummaryFromBatch(batch, true),
        });
      })
      .catch((err) => {
        // The recorded decisions and the batch in state have diverged, so the
        // batch must not be imported until a later rebuild succeeds. The raw
        // message is deliberately dropped: a parse error can embed the row's
        // own value, which must not reach a rendered surface.
        if (cancelled) return;
        void err;
        dispatch({ type: 'REBUILD_FAILED', error: 'Could not recalculate the changed rows' });
      })
      .finally(() => {
        if (!cancelled) setRebuilding(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceRows, overrides, overridesVersion]);

  // Compute the reconciliation report whenever the reconcile step lacks one for
  // the current batch. Self-healing by construction: a rebuild that lands after
  // the user has already moved on clears the report, and this recomputes it
  // rather than leaving Import permanently blocked.
  const { step, batch, reconciliation } = state;
  useEffect(() => {
    if (step !== 'reconcile' || !batch || reconciliation !== null || rebuilding) return;
    dispatch({ type: 'RECONCILE_COMPLETE', report: reconcile(batch.outcomes) });
  }, [step, batch, reconciliation, rebuilding]);

  const goToReview = useCallback(() => {
    dispatch({ type: 'GOTO', step: 'review' });
  }, []);

  const goToReconcile = useCallback(() => {
    dispatch({ type: 'GOTO', step: 'reconcile' });
  }, []);

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
      const { drafts, fingerprints, sourceRowNumbers } = buildImportPayload(state.batch);

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
        return identityToAsset(identity);
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
          failures: result.failures,
          ...(result.fatal ? { fatal: result.fatal } : {}),
          chunkSize: result.chunkSize,
          chunks: result.chunks,
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
          onBack={() => dispatch({ type: 'RESET' })}
          onContinue={goToReview}
        />
      )}

      {state.step === 'review' && state.batch && (
        <ReviewStep
          state={state}
          onFilterChange={handleFilterChange}
          onOverrideChange={handleOverrideChange}
          onClearOverrides={handleClearOverrides}
          rebuilding={rebuilding}
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
        <ImportResult
          summary={state.importSummary}
          onReset={handleReset}
          onReviewMappings={() => {
            if (!state.accountId) return;
            dispatch({ type: 'SELECT_ACCOUNT', accountId: state.accountId });
            dispatch({ type: 'GOTO', step: 'mapping' });
          }}
        />
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
