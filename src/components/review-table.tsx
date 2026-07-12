/**
 * Review table — normalized row outcomes with source row number/type.
 *
 * Privacy: shows the source row number, source type, normalized activity
 * type, and normalized values (quantity, total amount currency, date). Raw
 * balances and order ids are NOT displayed by default. The displayed unit
 * price is shown only for trades as a diagnostic (it is not authoritative).
 */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@wealthfolio/ui';
import type { RowOutcome } from '../domain/import-outcome';

export interface ReviewTableProps {
  outcomes: readonly RowOutcome[];
}

const KIND_LABEL: Record<RowOutcome['kind'], string> = {
  imported: 'Valid',
  unknown: 'Unknown type',
  invalid: 'Invalid',
};

const KIND_CLASS: Record<RowOutcome['kind'], string> = {
  imported: 'bg-emerald-100 text-emerald-800',
  unknown: 'bg-red-100 text-red-800',
  invalid: 'bg-red-100 text-red-800',
};

export function ReviewTable({ outcomes }: ReviewTableProps) {
  if (outcomes.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No rows in this category.</p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
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
        {outcomes.map((o) => (
          <TableRow key={o.rowIndex}>
            <TableCell className="font-mono text-xs">{o.rowIndex}</TableCell>
            <TableCell className="text-xs">{o.sourceType}</TableCell>
            <TableCell className="text-xs">
              {o.draft?.activityType ?? '—'}
            </TableCell>
            <TableCell>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${KIND_CLASS[o.kind]}`}
              >
                {KIND_LABEL[o.kind]}
              </span>
            </TableCell>
            <TableCell className="text-xs">
              {o.draft?.date.slice(0, 10) ?? '—'}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {o.draft?.quantity ?? '—'}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {o.draft ? `${o.draft.totalAmount.amount} ${o.draft.currency}` : '—'}
            </TableCell>
            <TableCell className="text-xs">
              {o.reasons.length > 0 ? o.reasons.join(', ') : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default ReviewTable;