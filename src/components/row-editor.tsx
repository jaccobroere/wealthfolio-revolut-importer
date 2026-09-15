/**
 * Per-source-row reviewer controls.
 *
 * Lets a reviewer resolve a problem row without leaving the wizard: exclude it
 * from the import, or correct its values in place and watch the pipeline
 * re-validate it live. Nothing is written back to the user's CSV file.
 *
 * Privacy: this is the one place the importer shows raw source values. It is
 * deliberate and user-initiated — the panel only renders for a row the reviewer
 * expanded, and the values shown are the reviewer's own statement. Raw values
 * still never reach summaries, logs, or host metadata.
 */
import { useState } from 'react';
import { Button, Input } from '@wealthfolio/ui';
import { Ban, Check, Pencil, RotateCcw, X } from 'lucide-react';

import type { RevolutSourceRow } from '../domain/revolut-row';
import {
  EDITABLE_FIELDS,
  EDITABLE_FIELD_LABELS,
  applyRowPatch,
  normalizePatch,
  type EditableField,
  type RowOverride,
  type RowPatch,
} from '../domain/row-override';
import { validateRow } from '../validation/validate-row';

export interface RowEditorProps {
  /** The pristine parsed source row. */
  row: RevolutSourceRow;
  /** 1-based source row number. */
  rowIndex: number;
  /** The reviewer's current decision for this row, if any. */
  override: RowOverride | undefined;
  /** Set (or clear, with `null`) the decision for this row. */
  onChange: (rowIndex: number, override: RowOverride | null) => void;
}

/** What the pipeline will do with a row, in one line. */
export function describeRowOutcome(
  row: RevolutSourceRow,
  rowIndex: number,
): { tone: 'ok' | 'bad'; text: string } {
  const outcome = validateRow(row, rowIndex);
  if (outcome.kind === 'imported' && outcome.draft) {
    return { tone: 'ok', text: `Valid — imports as ${outcome.draft.activityType}` };
  }
  if (outcome.kind === 'unknown') {
    return { tone: 'bad', text: 'Unsupported Type — this row still blocks the import' };
  }
  return { tone: 'bad', text: `Invalid — ${outcome.reasons.join(', ')}` };
}

export function RowEditor({ row, rowIndex, override, onChange }: RowEditorProps) {
  const [draft, setDraft] = useState<RowPatch | null>(null);

  const editing = draft !== null;
  const patch = override?.kind === 'edit' ? override.patch : {};
  const effectiveRow = applyRowPatch(row, editing ? draft : patch);
  const preview = describeRowOutcome(effectiveRow, rowIndex);

  function startEditing(): void {
    const initial: RowPatch = {};
    for (const f of EDITABLE_FIELDS) initial[f] = effectiveRow[f];
    setDraft(initial);
  }

  function apply(): void {
    if (!draft) return;
    const normalized = normalizePatch(row, draft);
    onChange(rowIndex, normalized ? { kind: 'edit', patch: normalized } : null);
    setDraft(null);
  }

  if (override?.kind === 'ignore') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
        <div className="text-sm">
          <span className="font-medium">Row {rowIndex} is excluded from this import.</span>
          <span className="ml-1 text-muted-foreground">
            It stays counted as an ignored row so every source row is still accounted for.
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(rowIndex, null)}
          data-testid={`row-restore-${rowIndex}`}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Restore
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-mono text-xs text-muted-foreground">Row {rowIndex}</span>
        <span className="font-medium">{effectiveRow.type || '(no type)'}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {effectiveRow.date}
          {effectiveRow.ticker ? ` · ${effectiveRow.ticker}` : ''}
          {effectiveRow.totalAmount ? ` · ${effectiveRow.totalAmount}` : ''}
        </span>
      </div>

      <p
        className={`text-xs ${preview.tone === 'ok' ? 'text-success' : 'text-destructive'}`}
        data-testid={`row-preview-${rowIndex}`}
      >
        {preview.text}
      </p>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EDITABLE_FIELDS.map((f) => (
              <label key={f} className="space-y-1 text-xs">
                <span className="text-muted-foreground">{EDITABLE_FIELD_LABELS[f]}</span>
                <Input
                  value={draft[f] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                  className="h-8 text-sm"
                  data-testid={`row-field-${rowIndex}-${f}`}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={apply} data-testid={`row-apply-${rowIndex}`}>
              <Check className="mr-1 h-3.5 w-3.5" />
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDraft(null)}
              data-testid={`row-cancel-${rowIndex}`}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={startEditing}
            data-testid={`row-edit-${rowIndex}`}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit values
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange(rowIndex, { kind: 'ignore' })}
            data-testid={`row-ignore-${rowIndex}`}
          >
            <Ban className="mr-1 h-3.5 w-3.5" />
            Ignore row
          </Button>
          {override?.kind === 'edit' ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onChange(rowIndex, null)}
                data-testid={`row-revert-${rowIndex}`}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Revert to original
              </Button>
              <span className="text-xs text-amber-600">
                Edited: {Object.keys(override.patch).map(labelOf).join(', ')}
              </span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function labelOf(field: string): string {
  return EDITABLE_FIELD_LABELS[field as EditableField] ?? field;
}

export default RowEditor;
