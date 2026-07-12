/**
 * Upload step — file input + strict schema validation.
 *
 * Privacy: displays row count + date range only. Never logs or displays
 * raw rows, balances, tickers, or order ids. Uses a browser `<input
 * type="file">` + `FileReader` only; the host file-picker API is out of
 * scope and its permission is not declared.
 *
 * On a valid header, dispatches `UPLOAD_COMPLETE` with the parsed batch and
 * a privacy-safe summary. On an unknown/changed schema, displays the
 * actionable error from the pure parser.
 */
import { useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@wealthfolio/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import { parseRevolutCsv } from '../parser/parse-csv';
import { validateBatch } from '../validation/validate-batch';
import type { BatchResult } from '../domain/import-outcome';
import type { UploadSummary } from '../state/import-state';
import { uploadSummaryFromBatch } from '../state/import-state';

export interface UploadStepProps {
  /** Called when a valid CSV is parsed and the batch is ready. */
  onComplete: (batch: BatchResult, summary: UploadSummary) => void;
  /** Called when the header is invalid; the actionable error is shown inline. */
  onError: (message: string) => void;
  /** Last upload summary, if any (shown when re-entering the step). */
  summary?: UploadSummary | null;
  /** Current error message, if any. */
  error?: string | null;
}

export function UploadStep({ onComplete, onError, summary, error }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setLocalError(null);
    try {
      const text = await readFileAsText(file);
      const parsed = parseRevolutCsv(text);
      if (!parsed.header.ok) {
        const msg = parsed.header.error ?? 'Revolut schema mismatch.';
        setLocalError(msg);
        onError(msg);
        setBusy(false);
        return;
      }
      const batch = await validateBatch(parsed.rows);
      const summary = uploadSummaryFromBatch(batch, parsed.header.ok, parsed.header.error);
      onComplete(batch, summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  };

  const displayError = localError ?? error ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 1 — Upload Revolut CSV</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Select a Revolut investment statement CSV. The file is parsed locally in
          your browser; nothing is uploaded. The strict eight-column schema is
          validated before any row is shown.
        </p>
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Revolut CSV file"
            className="text-sm"
            disabled={busy}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {busy && <span className="text-muted-foreground text-sm">Parsing…</span>}
        </div>

        {summary && summary.headerOk && (
          <div className="rounded-md border p-3 text-sm">
            <div className="font-medium">Parsed successfully</div>
            <div className="text-muted-foreground mt-1">
              Rows: {summary.rowCount}
              {summary.minDate && summary.maxDate
                ? ` · Date range: ${summary.minDate} to ${summary.maxDate}`
                : ''}
            </div>
          </div>
        )}

        {displayError && (
          <Alert variant="destructive">
            <AlertTitle>Could not parse CSV</AlertTitle>
            <AlertDescription>{displayError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsText(file);
  });
}

export default UploadStep;
