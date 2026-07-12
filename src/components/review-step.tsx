/**
 * Review step — categorize every row outcome with filters.
 *
 * Filters: all, errors, warnings, duplicates, cash movements, trades,
 * dividends, fees/taxes/credits. Every row is reachable through exactly
 * one category (conservation). The table shows source row number/type +
 * normalized values only — no raw balances/order ids by default.
 */
import { Button } from '@wealthfolio/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import type { ImportState, ReviewFilter } from '../state/import-state';
import { categoryCounts, filterOutcomes } from '../state/import-state';
import { ReviewTable } from './review-table';

export interface ReviewStepProps {
  state: ImportState;
  onFilterChange: (filter: ReviewFilter) => void;
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
];

export function ReviewStep({ state, onFilterChange, onContinue, onBack }: ReviewStepProps) {
  const counts = categoryCounts(state);
  const outcomes = filterOutcomes(state);
  const hasFatal = counts.errors > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 3 — Review rows</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Every row is categorized. Errors (unknown or invalid rows) block
          import. Duplicates are rows whose fingerprint matches an earlier row
          in this file. Warnings are trade-rounding diagnostics (Revolut rounds
          displayed unit prices) — they do not block.
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

        <div className="rounded-md border">
          <ReviewTable outcomes={outcomes} />
        </div>

        {hasFatal && (
          <p className="text-destructive text-sm" role="alert">
            {counts.errors} row{counts.errors === 1 ? '' : 's'} with errors must
            be resolved before import. Unknown or invalid rows cannot be
            imported.
          </p>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack} data-testid="review-back">
            Back
          </Button>
          <Button disabled={hasFatal} onClick={onContinue} data-testid="review-continue">
            Continue to reconciliation
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default ReviewStep;
