/**
 * Import result — terminal state showing the import outcome summary.
 *
 * Displays counts only (attempted, created, skipped duplicates, blocked,
 * failed). Never displays raw rows or balances. A fatal error, if any, is
 * shown with the actionable message.
 */
import { Alert, AlertDescription, AlertTitle } from '@wealthfolio/ui';
import { Button } from '@wealthfolio/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import type { ImportSummary } from '../state/import-state';

export interface ImportResultProps {
  summary: ImportSummary;
  onReset: () => void;
  onReviewMappings: () => void;
}

export function ImportResult({ summary, onReset, onReviewMappings }: ImportResultProps) {
  const hasFatal = !!summary.fatal;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import {hasFatal ? 'failed' : 'complete'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasFatal && (
          <Alert variant="destructive">
            <AlertTitle>Fatal error</AlertTitle>
            <AlertDescription>
              <p>{summary.fatal}</p>
              <p className="mt-2">
                The host rejected the bulk request before it returned row-level results. The
                importer did not retry automatically, so it cannot create a partial or duplicate
                import.
              </p>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Stat label="Attempted" value={summary.attempted} />
          <Stat label="Created" value={summary.created} />
          <Stat label="Skipped duplicates" value={summary.skippedDuplicates} />
          <Stat label="Blocked" value={summary.blocked} />
          <Stat
            label={hasFatal ? 'Batch status' : 'Failed'}
            value={hasFatal ? 'Not written' : summary.failed}
          />
        </div>

        <p className="text-muted-foreground text-sm">
          {hasFatal
            ? 'No per-activity outcome was returned. Review mappings and retry deliberately.'
            : 'Only activities reported as created by the host were written. Failed or blocked rows were not imported.'}
        </p>

        {summary.failures.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Activity conversion errors</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-5" data-testid="import-failure-details">
                {summary.failures.map((failure, index) => (
                  <li key={`${failure.sourceRowNumber ?? 'batch'}-${index}`}>
                    {failure.sourceRowNumber ? `Row ${failure.sourceRowNumber}: ` : ''}
                    {failure.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-3">
          {hasFatal ? (
            <Button variant="outline" onClick={onReviewMappings}>
              Review mappings
            </Button>
          ) : null}
          <Button onClick={onReset}>Start a new import</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      className="rounded-md border p-3"
      data-testid={`import-summary-${label.toLowerCase().replace(/ /g, '-')}`}
    >
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}

export default ImportResult;
