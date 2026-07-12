import type { Currency } from './money-value';

/**
 * Net traded quantity for a single source ticker. `bought` and `sold` are
 * canonical decimal strings (absolute); `net = bought - sold`.
 */
export interface TickerPosition {
  readonly ticker: string;
  readonly bought: string;
  readonly sold: string;
  readonly net: string;
  readonly buyCount: number;
  readonly sellCount: number;
}

/** Cash movement per currency from `CASH TOP-UP` / `CASH WITHDRAWAL`. */
export interface CashMovement {
  readonly currency: Currency;
  readonly deposits: string;
  readonly withdrawals: string;
  readonly net: string;
  readonly depositCount: number;
  readonly withdrawalCount: number;
}

export interface CreditEntry {
  readonly currency: Currency;
  readonly count: number;
  readonly total: string;
  readonly bySubtype: Readonly<Record<string, { count: number; total: string }>>;
}

export interface DividendEntry {
  readonly currency: Currency;
  readonly count: number;
  readonly total: string;
}

/**
 * Diagnostic variance between `quantity x displayed unit price` and the
 * authoritative source `Total Amount`. Variance is absolute, computed with
 * `decimal.js`. Only entries strictly greater than `0.01` are reported; these
 * reflect Revolut's rounded displayed unit price, **not** an error.
 */
export interface TradeRoundingVariance {
  readonly rowIndex: number;
  readonly variance: string;
}

export interface ReconciliationReport {
  readonly totalRows: number;
  readonly accountedRows: number;
  readonly positions: readonly TickerPosition[];
  readonly cashByCurrency: readonly CashMovement[];
  readonly creditsByCurrency: readonly CreditEntry[];
  readonly dividendsByCurrency: readonly DividendEntry[];
  readonly tradeRoundingVariances: readonly TradeRoundingVariance[];
}
