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
import {
  blockingReasons,
  canImport,
  computeAccountMatch,
  resolvedSecurityFor,
} from '../state/import-state';
import type { ExistingActivityLike, ExistingMatchReport } from '../duplicates/existing-match';
import { countOverrides } from '../domain/row-override';

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
  const overrides = countOverrides(state.overrides);
  const accountMatch = computeAccountMatch(state);
  const alreadyInAccount = accountMatch
    ? accountMatch.report.counts.existing + accountMatch.report.counts.existingUnlinked
    : 0;
  const toWrite = accountMatch ? accountMatch.report.counts.new : report?.accountedRows;
  const unlinkedOnly = accountMatch ? unlinkedOnlyMatches(state, accountMatch.report) : [];

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

        <Section title="Already in Wealthfolio">
          <div data-testid="account-match" className="space-y-2">
            {accountMatch === null ? (
              <p className="text-muted-foreground text-sm">
                Checking the activities already on this account…
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  <Stat label="New activities" value={accountMatch.report.counts.new} />
                  <Stat label="Already in account (skipped)" value={alreadyInAccount} />
                  <Stat
                    label="Stored without security"
                    value={accountMatch.report.counts.existingUnlinked}
                    warn={accountMatch.report.counts.existingUnlinked > 0}
                  />
                  <Stat
                    label="Extra copies in account"
                    value={accountMatch.report.counts.extraCopies}
                    warn={accountMatch.report.counts.extraCopies > 0}
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  Matched on type, day, currency and amount (quantity for trades), so a newer full
                  export only adds what is new.
                </p>
                {accountMatch.report.extraCopies.length > 0 ? (
                  <AccountActivityList
                    testId="extra-copies"
                    title={`${accountMatch.report.extraCopies.length} extra cop${accountMatch.report.extraCopies.length === 1 ? 'y' : 'ies'} of activities in this statement`}
                    explanation="These duplicate an activity that is already in Wealthfolio, usually left behind by an earlier import. They inflate your cash and holdings. Delete them in Wealthfolio's Activities page; this import will not touch them."
                    activities={accountMatch.report.extraCopies}
                  />
                ) : null}
                {unlinkedOnly.length > 0 ? (
                  <AccountActivityList
                    testId="unlinked-matches"
                    title={`${unlinkedOnly.length} activit${unlinkedOnly.length === 1 ? 'y is' : 'ies are'} in Wealthfolio without a security`}
                    explanation="An earlier add-on version stored these before their security existed, so they move cash but not holdings. This import will not add them again. To repair them, delete them in Wealthfolio and run this import again: they will be re-created linked to their security."
                    activities={unlinkedOnly}
                  />
                ) : null}
              </>
            )}
          </div>
        </Section>

        {overrides.ignored + overrides.edited > 0 ? (
          <div
            className="space-y-1 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
            data-testid="override-audit"
          >
            <p className="font-medium">Your changes to this statement</p>
            {overrides.ignored > 0 ? (
              <p>
                {overrides.ignored} row(s) ignored
                <span className="ml-1 text-muted-foreground">
                  — excluded from the import and counted as ignored.
                </span>
              </p>
            ) : null}
            {overrides.edited > 0 ? (
              <p>
                {overrides.edited} row(s) edited
                <span className="ml-1 text-muted-foreground">
                  — flagged as edited in the review table.
                </span>
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              These changes affect this import only; your CSV file is untouched. The totals above
              already reflect them.
            </p>
          </div>
        ) : null}

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
            correct. {writeSummary(toWrite, alreadyInAccount)}
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
            Import {toWrite !== undefined ? `(${toWrite} new)` : ''}
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
          <TableHead>Security</TableHead>
          <TableHead className="text-right">Bought</TableHead>
          <TableHead className="text-right">Sold</TableHead>
          <TableHead className="text-right">Net</TableHead>
          <TableHead className="text-right">Trades</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((p) => (
          <TableRow key={p.ticker}>
            <TableCell>
              <SecurityCell ticker={p.ticker} state={state} />
            </TableCell>
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

/** Mapped Wealthfolio ticker · exchange, with the Revolut ticker underneath. */
function SecurityCell({ ticker, state }: { ticker: string; state: ImportState }) {
  const resolved = resolvedSecurityFor(state, ticker);
  return (
    <span className="inline-flex flex-col" data-testid="security-label">
      {resolved ? (
        <span className="font-mono text-xs">
          <span className="font-semibold">{resolved.symbol}</span>
          {resolved.exchangeMic ? (
            <span className="text-muted-foreground"> · {resolved.exchangeMic}</span>
          ) : null}
        </span>
      ) : (
        <span className="font-mono text-xs text-destructive">{ticker} (unmapped)</span>
      )}
      {resolved ? <span className="text-muted-foreground text-xs">Revolut: {ticker}</span> : null}
    </span>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded border px-2 py-1.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`font-mono ${warn ? 'text-destructive' : ''}`}>{value}</p>
    </div>
  );
}

/** "I understand this will write …" completion for the acknowledgement. */
function writeSummary(toWrite: number | undefined, skipped: number): string {
  if (toWrite === undefined) {
    return 'I understand import will write these activities to the selected account.';
  }
  const noun = toWrite === 1 ? 'activity' : 'activities';
  const skip =
    skipped > 0 ? ` and skip ${skipped} that ${skipped === 1 ? 'is' : 'are'} already there` : '';
  return `I understand this will write ${toWrite} new ${noun} to the selected account${skip}.`;
}

/** Unlinked account copies that are the only copy of a statement activity. */
function unlinkedOnlyMatches(
  state: ImportState,
  report: ExistingMatchReport,
): ExistingActivityLike[] {
  const byId = new Map((state.existingActivities ?? []).map((e) => [e.id, e]));
  const out: ExistingActivityLike[] = [];
  for (const m of report.matches) {
    if (m.kind !== 'existing-unlinked') continue;
    const e = byId.get(m.existingId);
    if (e) out.push(e);
  }
  return out;
}

function formatDay(date: string | Date): string {
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

function AccountActivityList({
  testId,
  title,
  explanation,
  activities,
}: {
  testId: string;
  title: string;
  explanation: string;
  activities: readonly ExistingActivityLike[];
}) {
  return (
    <div
      className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
      data-testid={testId}
    >
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground text-xs">{explanation}</p>
      <div className="max-h-64 overflow-auto rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Security in Wealthfolio</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono text-xs">{formatDay(e.date)}</TableCell>
                <TableCell className="text-xs">{e.activityType}</TableCell>
                <TableCell className="text-xs">
                  {e.assetSymbol ? (
                    <span className="font-mono">{e.assetSymbol}</span>
                  ) : (
                    <span className="text-destructive">none</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-right text-xs">{e.quantity ?? '—'}</TableCell>
                <TableCell className="font-mono text-right text-xs">
                  {e.amount ?? '—'} {e.currency}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
