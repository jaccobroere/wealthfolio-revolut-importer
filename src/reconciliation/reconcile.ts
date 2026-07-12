import { Decimal } from 'decimal.js';
import type {
  CashMovement,
  CreditEntry,
  DividendEntry,
  ReconciliationReport,
  TickerPosition,
  TradeRoundingVariance,
} from '../domain/reconciliation';
import type { RowOutcome } from '../domain/import-outcome';

const ZERO = new Decimal(0);
const ROUNDING_THRESHOLD = new Decimal('0.01');

interface Accum {
  bought: Decimal;
  sold: Decimal;
  buyCount: number;
  sellCount: number;
}

interface CashAccum {
  deposits: Decimal;
  withdrawals: Decimal;
  depositCount: number;
  withdrawalCount: number;
}

interface CreditAccum {
  count: number;
  total: Decimal;
  bySubtype: Map<string, { count: number; total: Decimal }>;
}

/**
 * Reconcile a batch of outcomes into a deterministic report:
 *
 * - bought / sold / net quantity per source ticker (trades only);
 * - deposit / withdrawal cash movement per currency;
 * - credits (`CREDIT`) and dividends (`DIVIDEND`) totals per currency;
 * - diagnostic `|quantity x displayed price - Total Amount|` variances that
 *   strictly exceed `0.01` (Revolut rounds displayed unit prices).
 *
 * Every `imported` row is accounted for exactly once. `unknown` / `invalid`
 * rows are reported in `totalRows` but excluded from `accountedRows`.
 */
export function reconcile(outcomes: readonly RowOutcome[]): ReconciliationReport {
  const positions = new Map<string, Accum>();
  const cash = new Map<string, CashAccum>();
  const credits = new Map<string, CreditAccum>();
  const dividends = new Map<string, { count: number; total: Decimal }>();
  const variances: TradeRoundingVariance[] = [];

  let accounted = 0;

  for (const outcome of outcomes) {
    if (outcome.kind !== 'imported' || outcome.draft === undefined) continue;
    const draft = outcome.draft;
    accounted++;

    switch (draft.activityType) {
      case 'BUY':
      case 'SELL': {
        const ticker = draft.ticker;
        const acc = positions.get(ticker) ?? {
          bought: ZERO,
          sold: ZERO,
          buyCount: 0,
          sellCount: 0,
        };
        const qty = new Decimal(draft.quantity ?? '0');
        if (draft.activityType === 'BUY') {
          acc.bought = acc.bought.plus(qty);
          acc.buyCount++;
        } else {
          acc.sold = acc.sold.plus(qty);
          acc.sellCount++;
        }
        positions.set(ticker, acc);

        if (draft.unitPrice !== undefined) {
          const calc = qty.times(new Decimal(draft.unitPrice.amount));
          const total = new Decimal(draft.totalAmount.amount);
          const variance = calc.minus(total).abs();
          if (variance.greaterThan(ROUNDING_THRESHOLD)) {
            variances.push({
              rowIndex: outcome.rowIndex,
              variance: variance.toString(),
            });
          }
        }
        break;
      }
      case 'DEPOSIT': {
        const acc = cash.get(draft.currency) ?? {
          deposits: ZERO,
          withdrawals: ZERO,
          depositCount: 0,
          withdrawalCount: 0,
        };
        acc.deposits = acc.deposits.plus(new Decimal(draft.totalAmount.amount));
        acc.depositCount++;
        cash.set(draft.currency, acc);
        break;
      }
      case 'WITHDRAWAL': {
        const acc = cash.get(draft.currency) ?? {
          deposits: ZERO,
          withdrawals: ZERO,
          depositCount: 0,
          withdrawalCount: 0,
        };
        acc.withdrawals = acc.withdrawals.plus(
          new Decimal(draft.totalAmount.amount)
        );
        acc.withdrawalCount++;
        cash.set(draft.currency, acc);
        break;
      }
      case 'CREDIT': {
        const acc = credits.get(draft.currency) ?? {
          count: 0,
          total: ZERO,
          bySubtype: new Map<string, { count: number; total: Decimal }>(),
        };
        acc.count++;
        acc.total = acc.total.plus(new Decimal(draft.totalAmount.amount));
        const subtypeKey = draft.subtype ?? 'UNSPECIFIED';
        const sub = acc.bySubtype.get(subtypeKey) ?? {
          count: 0,
          total: ZERO,
        };
        sub.count++;
        sub.total = sub.total.plus(new Decimal(draft.totalAmount.amount));
        acc.bySubtype.set(subtypeKey, sub);
        credits.set(draft.currency, acc);
        break;
      }
      case 'DIVIDEND': {
        const acc = dividends.get(draft.currency) ?? {
          count: 0,
          total: ZERO,
        };
        acc.count++;
        acc.total = acc.total.plus(new Decimal(draft.totalAmount.amount));
        dividends.set(draft.currency, acc);
        break;
      }
      default:
        break;
    }
  }

  const positionList: TickerPosition[] = [...positions.entries()]
    .map(([ticker, acc]) => ({
      ticker,
      bought: acc.bought.toString(),
      sold: acc.sold.toString(),
      net: acc.bought.minus(acc.sold).toString(),
      buyCount: acc.buyCount,
      sellCount: acc.sellCount,
    }))
    .sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));

  const cashList: CashMovement[] = [...cash.entries()]
    .map(([currency, acc]) => ({
      currency,
      deposits: acc.deposits.toString(),
      withdrawals: acc.withdrawals.toString(),
      net: acc.deposits.minus(acc.withdrawals).toString(),
      depositCount: acc.depositCount,
      withdrawalCount: acc.withdrawalCount,
    }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));

  const creditList: CreditEntry[] = [...credits.entries()]
    .map(([currency, acc]) => ({
      currency,
      count: acc.count,
      total: acc.total.toString(),
      bySubtype: Object.fromEntries(
        [...acc.bySubtype.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, { count: v.count, total: v.total.toString() }])
      ),
    }))
    .sort((a, b) =>
      a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0
    );

  const dividendList: DividendEntry[] = [...dividends.entries()]
    .map(([currency, acc]) => ({
      currency,
      count: acc.count,
      total: acc.total.toString(),
    }))
    .sort((a, b) =>
      a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0
    );

  variances.sort((a, b) => a.rowIndex - b.rowIndex);

  return {
    totalRows: outcomes.length,
    accountedRows: accounted,
    positions: positionList,
    cashByCurrency: cashList,
    creditsByCurrency: creditList,
    dividendsByCurrency: dividendList,
    tradeRoundingVariances: variances,
  };
}
