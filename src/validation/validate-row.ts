import { Decimal } from 'decimal.js';
import type { ActivityDraft } from '../domain/activity-draft';
import type { RowOutcome } from '../domain/import-outcome';
import { isCurrencyCode, type MoneyValue } from '../domain/money-value';
import { REVOLUT_SCHEMA_VERSION } from '../domain/revolut-row';
import type { RevolutSourceRow } from '../domain/revolut-row';
import { mapActivityType } from '../mapping/activity-types';
import { parseDate } from '../parser/parse-date';
import { parseMoney } from '../parser/parse-money';

const QUANTITY_REGEX = /^-?\d+(?:\.\d+)?$/;
const FX_RATE_REGEX = /^\d+(?:\.\d+)?$/;
const TRADE_ACTIVITY_TYPES = new Set<string>(['BUY', 'SELL']);

/**
 * Validate and map a single {@link RevolutSourceRow} into a {@link RowOutcome}.
 *
 * Dispositions:
 * - Unknown source type → `unknown` outcome (`type.unknown`).
 * - Known type with any malformed value → `invalid` outcome with reason codes.
 * - Otherwise → `imported` with a fully decimal-safe {@link ActivityDraft}.
 *
 * For trades (`BUY`/`SELL`) the quantity and unit price must be present and
 * strictly positive. `Total Amount` and `Currency` and `FX Rate` are required
 * for every row. `Total Amount` is authoritative for the draft amount.
 */
export function validateRow(row: RevolutSourceRow, rowIndex: number): RowOutcome {
  const reasons: string[] = [];

  // --- Date (full ISO timestamp, no coercion) ---------------------------
  const dateResult = parseDate(row.date);
  if (!dateResult.ok) {
    reasons.push(dateResult.reason);
  }

  // --- Type mapping -----------------------------------------------------
  const mapping = mapActivityType(row.type);
  if (!mapping) {
    return {
      rowIndex,
      kind: 'unknown',
      sourceType: row.type,
      reasons: ['type.unknown'],
    };
  }

  // --- Currency column --------------------------------------------------
  const currency = row.currency.trim();
  if (!isCurrencyCode(currency)) {
    reasons.push('currency.invalid');
  }

  // --- FX rate (required numeric for every row) -------------------------
  const fxRate = row.fxRate.trim();
  if (!FX_RATE_REGEX.test(fxRate)) {
    reasons.push('fx.invalid');
  }

  // --- Total Amount (authoritative, required for every row) -------------
  let totalValue = null;
  {
    const currencyForCheck = isCurrencyCode(currency) ? currency : undefined;
    const totalResult = parseMoney(row.totalAmount, currencyForCheck);
    if (!totalResult.ok) {
      reasons.push(`total.${totalResult.reason}`);
    } else {
      totalValue = totalResult;
    }
  }

  // --- Trade-specific: quantity + unit price ----------------------------
  let quantityCanonical: string | undefined;
  let unitPrice: MoneyValue | undefined;
  if (TRADE_ACTIVITY_TYPES.has(mapping.activityType)) {
    const qtyRaw = row.quantity.trim();
    if (!QUANTITY_REGEX.test(qtyRaw)) {
      reasons.push('quantity.invalid');
    } else {
      const qty = new Decimal(qtyRaw);
      if (!qty.greaterThan(0)) {
        reasons.push('quantity.nonpositive');
      } else {
        quantityCanonical = qty.toString();
      }
    }

    const priceResult = parseMoney(
      row.pricePerShare,
      isCurrencyCode(currency) ? currency : undefined,
    );
    if (!priceResult.ok) {
      reasons.push(`price.${priceResult.reason}`);
    } else {
      const price = new Decimal(priceResult.signed.amount);
      if (!price.greaterThan(0)) {
        reasons.push('price.nonpositive');
      } else {
        unitPrice = priceResult.value;
      }
    }
  }

  if (reasons.length > 0 || dateResult.ok !== true || totalValue === null) {
    return { rowIndex, kind: 'invalid', sourceType: row.type, reasons };
  }

  const draft: ActivityDraft = {
    schemaVersion: REVOLUT_SCHEMA_VERSION,
    date: dateResult.iso,
    sourceType: row.type,
    activityType: mapping.activityType,
    ...(mapping.subtype !== undefined ? { subtype: mapping.subtype } : {}),
    ticker: row.ticker.trim(),
    ...(quantityCanonical !== undefined ? { quantity: quantityCanonical } : {}),
    ...(unitPrice !== undefined ? { unitPrice } : {}),
    totalAmount: totalValue.value,
    currency,
    fxRate,
    rawSignedAmount: totalValue.signed.amount,
  };

  return { rowIndex, kind: 'imported', draft, sourceType: row.type, reasons: [] };
}
