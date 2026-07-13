import { describe, expect, it } from 'vitest';

import type { ActivityDraft } from '../../src/domain/activity-draft';
import { toActivityImport } from '../../src/wealthfolio/convert-activity';
import type { PreparedDraft } from '../../src/wealthfolio/types';

describe('toActivityImport', () => {
  it('supplies the released host-required empty symbol for cash activity validation', () => {
    const draft: ActivityDraft = {
      schemaVersion: 'revolut-investment-csv:v1',
      date: '2024-01-01T10:00:00Z',
      sourceType: 'CASH TOP-UP',
      activityType: 'DEPOSIT',
      ticker: '',
      totalAmount: { currency: 'EUR', amount: '100' },
      currency: 'EUR',
      fxRate: '1',
      rawSignedAmount: '100',
    };
    const prepared: PreparedDraft = { draft, fingerprint: 'synthetic', sourceRowNumber: 2 };

    expect(toActivityImport(prepared, 'account-1')).toMatchObject({
      accountId: 'account-1',
      symbol: '',
      isDraft: true,
      isValid: true,
    });
  });
});
