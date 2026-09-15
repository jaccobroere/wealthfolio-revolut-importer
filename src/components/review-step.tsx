/**
 * Review step — categorize every row outcome with filters.
 *
 * Filters: all, errors, warnings, duplicates, cash movements, trades,
 * dividends, fees/taxes/credits, ignored. Every row is reachable through
 * exactly one category (conservation). The table shows source row number/type
 * + normalized values only — no raw balances/order ids by default.
 *
 * Blocking rows can be resolved in place: expand a row to correct its values
 * or exclude it from the import, with no need to edit the CSV by hand.
 */
import { Button } from '@wealthfolio/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import { RotateCcw } from 'lucide-react';
import type { ImportState, ReviewFilter } from '../state/import-state';
import { categoryCounts, filterOutcomes } from '../state/import-state';
import { countOverrides, type RowOverride } from '../domain/row-override';
import { ReviewTable } from './review-table';

export interface ReviewStepProps {
  state: ImportState;
  onFilterChange: (filter: ReviewFilter) => void;
  /** Set (or clear, with `null`) the decision for one source row. */
  onOverrideChange: (rowIndex: number, override: RowOverride | null) => void;
  /** Drop every reviewer decision and rebuild from the original file. */
  onClearOverrides: () => void;
  /** Whether the batch is currently being recomputed after a decision. */
  rebuilding: boolean;
  onContinue: () => void;
  onBack: () => void;
}

const FILTER_LABELS: { key: ReviewFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'errors', label: 'Errors' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'duplicates', label: 'Duplicates' },
  { key: 'trades', label: 'Trades' },
  { key: 'cash', label: 'Cash' },
  { key: 'dividends', label: 'Dividends' },
  { key: 'credits', label: 'Credits' },
  { key: 'ignored', label: 'Ignored' },
];

export function ReviewStep({
  state,
  onFilterChange,
  onOverrideChange,
  onClearOverrides,
  rebuilding,
  onContinue,
  onBack,
}: ReviewStepProps) {
  const counts = categoryCounts(state);
  const outcomes = filterOutcomes(state);
  const hasFatal = counts.errors > 0;
  const overrides = countOverrides(state.overrides);
  const overrideCount = overrides.ignored + overrides.edited;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3 — Review rows</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Every row is categorized. Errors (unknown or invalid rows) block import. Duplicates are
          rows whose fingerprint matches an earlier row in this file. Warnings are trade-rounding
          diagnostics (Revolut rounds displayed unit prices) — they do not block. Expand any row to
          correct its values or exclude it, with no need to edit the CSV yourself.
        </p>

        <div className="flex flex-wrap gap-2">
          {FILTER_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={state.filter === key}
              className={`rounded-md border px-3 py-1 text-sm ${
                state.filter === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-accent'
              }`}
              onClick={() => onFilterChange(key)}
            >
              {label} ({counts[key] ?? 0})
            </button>
          ))}
        </div>

        {overrideCount > 0 ? (
          <div
            className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 p-3 text-sm"
            data-testid="override-summary"
          >
            <p>
              <span className="font-medium">
                {overrideCount} row{overrideCount === 1 ? '' : 's'} changed by you
              </span>
              <span className="ml-1 text-muted-foreground">
                {rebuilding
                  ? '· recalculating…'
                  : '· applied to this import only, never to your file'}
              </span>
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={onClearOverrides}
              data-testid="clear-overrides"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset all
            </Button>
          </div>
        ) : null}

        <div className="rounded-md border">
          <ReviewTable
            outcomes={outcomes}
            sourceRows={state.sourceRows}
            overrides={state.overrides}
            onOverrideChange={onOverrideChange}
          />
        </div>

        {hasFatal && (
          <p className="text-destructive text-sm" role="alert">
            {counts.errors} row{counts.errors === 1 ? '' : 's'} with errors must be resolved before
            import. Expand a row to fix its values or exclude it from this import.
          </p>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack} data-testid="review-back">
            Back
          </Button>
          <Button
            disabled={hasFatal || rebuilding}
            onClick={onContinue}
            data-testid="review-continue"
          >
            {rebuilding ? 'Recalculating…' : 'Continue to reconciliation'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default ReviewStep;
