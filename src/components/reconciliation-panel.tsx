/**
 * Reconciliation panel — net position movement, cash movement, and
 * trade-rounding diagnostics.
 *
 * Shows:
 * - Net position movement per resolved asset (bought/sold/net per ticker).
 * - Cash movement per currency (deposits/withdrawals/net).
 * - Credits and dividends per currency.
 * - Trade-rounding diagnostics: rows where `qty × displayed price` differs
 *   from `Total Amount` by more than 0.01 (Revolut rounds displayed prices).
 *   These are diagnostic only and never block import.
 *
 * Import is disabled until ALL of: account selected; zero fatal/unknown rows;
 * all traded securities resolved; reconciliation residual rules pass; user
 * acknowledgement checked. The disabled state shows the blocking reasons.
 */
import { Alert, AlertDescription, AlertTitle } from '@wealthfolio/ui';
import { Button } from '@wealthfolio/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@wealthfolio/ui';
import { Checkbox } from '@wealthfolio/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@wealthfolio/ui';
import type { ImportState } from '../state/import-state';
import { blockingReasons, canImport } from '../state/import-state';

export interface ReconciliationPanelProps {
  state: ImportState;
  onAcknowledge: (acknowledged: boolean) => void;
  onImport: () => void;
  onBack: () => void;
}

export function ReconciliationPanel({
  state,
  onAcknowledge,
  onImport,
  onBack,
}: ReconciliationPanelProps) {
  const report = state.reconciliation;
  const enabled = canImport(state);
  const reasons = blockingReasons(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Step 4 — Reconcile &amp; import</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-muted-foreground text-sm">
          Reconciliation verifies that every imported row is accounted for. Net position movement
          per asset and cash movement per currency must match. Trade-rounding diagnostics are
          informational only.
        </p>

        {report ? (
          <>
            <Section title="Net position movement per asset">
              <PositionsTable state={state} />
            </Section>

            <Section title="Cash movement per currency">
              <CashTable state={state} />
            </Section>

            {report.creditsByCurrency.length > 0 && (
              <Section title="Credits per currency">
                <CreditsTable state={state} />
              </Section>
            )}

            {report.dividendsByCurrency.length > 0 && (
              <Section title="Dividends per currency">
                <DividendsTable state={state} />
              </Section>
            )}

            <Section title="Trade-rounding diagnostics">
              <RoundingTable state={state} />
            </Section>

            <div className="rounded-md border p-3 text-sm">
              <div>
                Total rows: <span className="font-mono">{report.totalRows}</span>
              </div>
              <div>
                Accounted rows: <span className="font-mono">{report.accountedRows}</span>
              </div>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Reconciliation not yet computed.</p>
        )}

        <div className="flex items-start gap-3 rounded-md border p-3">
          <Checkbox
            id="revolut-acknowledge"
            aria-label="Acknowledge reconciliation"
            checked={state.acknowledged}
            onCheckedChange={(v) => onAcknowledge(v === true)}
            data-testid="acknowledge-checkbox"
          />
          <label htmlFor="revolut-acknowledge" className="text-sm">
            I have reviewed the reconciliation and confirm the net position and cash movements are
            correct. I understand import will write these activities to the selected account.
          </label>
        </div>

        {!enabled && reasons.length > 0 && (
          <Alert variant="default">
            <AlertTitle>Import is blocked</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button disabled={!enabled} onClick={onImport} data-testid="import-button">
            Import {report ? `(${report.accountedRows} rows)` : ''}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="font-medium text-sm">{title}</h3>
      {children}
    </div>
  );
}

function PositionsTable({ state }: { state: ImportState }) {
  const positions = state.reconciliation?.positions ?? [];
  if (positions.length === 0) {
    return <p className="text-muted-foreground text-sm">No trades in this file.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ticker</TableHead>
          <TableHead className="text-right">Bought</TableHead>
          <TableHead className="text-right">Sold</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">Trades</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((p) => (
          <TableRow key={p.ticker}>
            <TableCell className="font-medium">{p.ticker}</TableCell>
            <TableCell className="font-mono text-right">{p.bought}</TableCell>
            <TableCell className="font-mono text-right">{p.sold}</TableCell>
            <TableCell className="font-mono text-right">{p.net}</TableCell>
            <TableCell className="text-right">{p.buyCount + p.sellCount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CashTable({ state }: { state: ImportState }) {
  const cash = state.reconciliation?.cashByCurrency ?? [];
  if (cash.length === 0) {
    return <p className="text-muted-foreground text-sm">No cash movements.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Currency</TableHead>
          <TableHead className="text-right">Deposits</TableHead>
          <TableHead className="text-right">Withdrawals</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cash.map((c) => (
          <TableRow key={c.currency}>
            <TableCell className="font-medium">{c.currency}</TableCell>
            <TableCell className="font-mono text-right">{c.deposits}</TableCell>
            <TableCell className="font-mono text-right">{c.withdrawals}</TableCell>
            <TableCell className="font-mono text-right">{c.net}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CreditsTable({ state }: { state: ImportState }) {
  const credits = state.reconciliation?.creditsByCurrency ?? [];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Currency</TableHead>
          <TableHead className="text-right">Count</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {credits.map((c) => (
          <TableRow key={c.currency}>
            <TableCell className="font-medium">{c.currency}</TableCell>
            <TableCell className="text-right">{c.count}</TableCell>
            <TableCell className="font-mono text-right">{c.total}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DividendsTable({ state }: { state: ImportState }) {
  const dividends = state.reconciliation?.dividendsByCurrency ?? [];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Currency</TableHead>
          <TableHead className="text-right">Count</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {dividends.map((d) => (
          <TableRow key={d.currency}>
            <TableCell className="font-medium">{d.currency}</TableCell>
            <TableCell className="text-right">{d.count}</TableCell>
            <TableCell className="font-mono text-right">{d.total}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function RoundingTable({ state }: { state: ImportState }) {
  const variances = state.reconciliation?.tradeRoundingVariances ?? [];
  if (variances.length === 0) {
    return <p className="text-muted-foreground text-sm">No trade-rounding variances detected.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {variances.length} trade{variances.length === 1 ? '' : 's'} where the displayed unit price
        differs from the authoritative Total Amount by more than 0.01. This reflects Revolut&apos;s
        rounded displayed price — not an error. Total Amount is authoritative.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Row</TableHead>
            <TableHead className="text-right">Variance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {variances.map((v) => (
            <TableRow key={v.rowIndex}>
              <TableCell className="font-mono text-xs">{v.rowIndex}</TableCell>
              <TableCell className="font-mono text-right">{v.variance}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default ReconciliationPanel;
