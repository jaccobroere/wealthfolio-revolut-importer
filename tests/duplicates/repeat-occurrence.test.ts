import { describe, expect, it } from 'vitest';

import type { ActivityDraft } from '../../src/domain/activity-draft';
import { occurrenceComment, repeatOccurrences } from '../../src/duplicates/repeat-occurrence';

function topUp(time: string, opts: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    schemaVersion: 'revolut-investment-csv:v1',
    date: `2024-11-14T${time}:00Z`,
    sourceType: 'CASH TOP-UP',
    activityType: 'DEPOSIT',
    ticker: '',
    totalAmount: { currency: 'EUR', amount: '25' },
    currency: 'EUR',
    fxRate: '1',
    rawSignedAmount: '25',
    ...opts,
  };
}

describe('repeatOccurrences', () => {
  it('numbers identical same-day activities in input order', () => {
    expect(repeatOccurrences([topUp('07:58'), topUp('08:10'), topUp('18:15')])).toEqual([1, 2, 3]);
  });

  it('leaves different days, amounts or securities alone', () => {
    const buy = (ticker: string) =>
      topUp('09:00', {
        activityType: 'BUY',
        ticker,
        quantity: '1',
        unitPrice: { currency: 'EUR', amount: '25' },
      });
    expect(
      repeatOccurrences([
        topUp('07:58'),
        topUp('07:58', { date: '2024-11-15T07:58:00Z' }),
        topUp('07:58', { totalAmount: { currency: 'EUR', amount: '26' } }),
        buy('SYNA'),
        buy('SYNB'),
      ]),
    ).toEqual([1, 1, 1, 1, 1]);
  });

  it('ignores the ticker for types the host stores as cash', () => {
    const credit = (ticker: string) =>
      topUp('09:00', { activityType: 'CREDIT', subtype: 'FEE_REFUND', ticker });
    expect(repeatOccurrences([credit('SYNA'), credit('SYNB')])).toEqual([1, 2]);
  });
});

describe('occurrenceComment', () => {
  it('adds a comment only from the second copy on', () => {
    expect(occurrenceComment(1)).toBeUndefined();
    expect(occurrenceComment(2)).toBe('#2');
  });
});
