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
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { AlertCircle, CheckCircle2, FileText, Upload } from 'lucide-react';
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
  const [isDragging, setIsDragging] = useState(false);
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
      // Let users retry the same file after fixing a schema issue.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0]);
  };

  const openFilePicker = () => {
    if (!busy) inputRef.current?.click();
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!busy) {
      event.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!busy) void handleFile(event.dataTransfer.files?.[0]);
  };

  const displayError = localError ?? error ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 1 — Upload Revolut statement</h2>
        <p id="revolut-upload-description" className="mt-1 text-sm text-muted-foreground">
          Select a Revolut investment statement CSV. The file is parsed locally in your browser;
          nothing is uploaded.
        </p>
      </div>

      <div
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:p-8 ${
          busy
            ? 'cursor-wait border-border bg-muted/20'
            : isDragging
              ? 'cursor-copy border-primary bg-primary/5'
              : 'cursor-pointer border-border hover:border-primary/50 hover:bg-muted/20'
        }`}
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label="Select Revolut CSV file"
        aria-describedby="revolut-upload-description"
        aria-busy={busy}
        data-testid="revolut-csv-drop-zone"
        onClick={openFilePicker}
        onKeyDown={(event) => {
          if (!busy && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openFilePicker();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Revolut CSV file"
          className="sr-only"
          disabled={busy}
          onChange={handleInputChange}
        />
        <Upload className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium" aria-live="polite">
          {busy
            ? 'Parsing CSV…'
            : isDragging
              ? 'Drop the CSV file to import it'
              : 'Drop a CSV file here, or click to browse'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Revolut investment CSV · 8-column export
        </p>
      </div>

      {displayError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-destructive">Could not parse this file</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{displayError}</p>
          </div>
        </div>
      ) : null}

      {summary && summary.headerOk && !displayError ? (
        <div className="flex items-start gap-2 rounded-md border border-success/50 bg-success/10 p-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-sm font-medium">File parsed successfully</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-4 w-4" aria-hidden="true" />
                {summary.rowCount} rows
              </span>
              {summary.minDate && summary.maxDate ? (
                <span>
                  Date range: {summary.minDate} → {summary.maxDate}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
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
