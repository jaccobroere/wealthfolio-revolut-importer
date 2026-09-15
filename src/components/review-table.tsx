/**
 * Review table — normalized row outcomes with source row number/type.
 *
 * Privacy: shows the source row number, source type, normalized activity
 * type, and normalized values (quantity, total amount currency, date). Raw
 * balances and order ids are NOT displayed by default. The displayed unit
 * price is shown only for trades as a diagnostic (it is not authoritative).
 *
 * Each row expands into per-source-row reviewer controls (`RowEditor`), which
 * is the one place raw source values are shown — only for a row the reviewer
 * chose to open.
 */
import { useState } from 'react';
import { Button } from '@wealthfolio/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@wealthfolio/ui';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { RowOutcome } from '../domain/import-outcome';
import type { RevolutSourceRow } from '../domain/revolut-row';
import type { RowOverride, RowOverrides } from '../domain/row-override';
import { RowEditor } from './row-editor';

export interface ReviewTableProps {
  outcomes: readonly RowOutcome[];
  /** Pristine parsed source rows, in source order. */
  sourceRows: readonly RevolutSourceRow[];
  /** Active reviewer decisions. */
  overrides: RowOverrides;
  /** Set (or clear, with `null`) the decision for one source row. */
  onOverrideChange: (rowIndex: number, override: RowOverride | null) => void;
}

const COLUMN_COUNT = 9;

const KIND_LABEL: Record<RowOutcome['kind'], string> = {
  imported: 'Valid',
  unknown: 'Unknown type',
  invalid: 'Invalid',
  ignored: 'Ignored',
};

const KIND_CLASS: Record<RowOutcome['kind'], string> = {
  imported: 'bg-emerald-100 text-emerald-800',
  unknown: 'bg-red-100 text-red-800',
  invalid: 'bg-red-100 text-red-800',
  ignored: 'bg-muted text-muted-foreground',
};

export function ReviewTable({
  outcomes,
  sourceRows,
  overrides,
  onOverrideChange,
}: ReviewTableProps) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (outcomes.length === 0) {
    return <p className="text-muted-foreground text-sm">No rows in this category.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10" />
          <TableHead className="w-16">Row</TableHead>
          <TableHead className="w-32">Source type</TableHead>
          <TableHead className="w-24">Activity</TableHead>
          <TableHead className="w-24">Status</TableHead>
          <TableHead>Date</TableHead>
          <TableHead className="w-24">Quantity</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead className="w-24">Reasons</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {outcomes.map((o) => {
          const isOpen = expanded === o.rowIndex;
          const source = sourceRows[o.rowIndex - 1];
          return [
            <TableRow key={o.rowIndex} className={o.kind === 'ignored' ? 'opacity-60' : undefined}>
              <TableCell className="p-0">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => setExpanded(isOpen ? null : o.rowIndex)}
                  aria-expanded={isOpen}
                  aria-label={`Reviewer actions for source row ${o.rowIndex}`}
                  data-testid={`review-expand-${o.rowIndex}`}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </TableCell>
              <TableCell className="font-mono text-xs">{o.rowIndex}</TableCell>
              <TableCell className="text-xs">{o.sourceType}</TableCell>
              <TableCell className="text-xs">{o.draft?.activityType ?? '—'}</TableCell>
              <TableCell>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${KIND_CLASS[o.kind]}`}>
                  {KIND_LABEL[o.kind]}
                </span>
                {o.edited ? (
                  <span
                    className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                    data-testid={`review-edited-${o.rowIndex}`}
                  >
                    Edited
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-xs">{o.draft?.date.slice(0, 10) ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{o.draft?.quantity ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">
                {o.draft ? `${o.draft.totalAmount.amount} ${o.draft.currency}` : '—'}
              </TableCell>
              <TableCell className="text-xs">
                {o.reasons.length > 0 ? o.reasons.join(', ') : '—'}
              </TableCell>
            </TableRow>,
            isOpen && source ? (
              <TableRow key={`${o.rowIndex}-detail`} data-testid={`review-detail-${o.rowIndex}`}>
                <TableCell colSpan={COLUMN_COUNT} className="bg-muted/20">
                  <RowEditor
                    row={source}
                    rowIndex={o.rowIndex}
                    override={overrides[o.rowIndex]}
                    onChange={onOverrideChange}
                  />
                </TableCell>
              </TableRow>
            ) : null,
          ];
        })}
      </TableBody>
    </Table>
  );
}

export default ReviewTable;
