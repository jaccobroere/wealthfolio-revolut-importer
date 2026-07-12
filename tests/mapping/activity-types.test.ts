import { describe, expect, it } from 'vitest';
import {
  KNOWN_SOURCE_TYPES,
  mapActivityType,
} from '../../src/mapping/activity-types';

describe('mapActivityType', () => {
  it('maps every supported source type exactly', () => {
    expect(mapActivityType('BUY - MARKET')).toEqual({ activityType: 'BUY' });
    expect(mapActivityType('SELL - MARKET')).toEqual({ activityType: 'SELL' });
    expect(mapActivityType('CASH TOP-UP')).toEqual({ activityType: 'DEPOSIT' });
    expect(mapActivityType('CASH WITHDRAWAL')).toEqual({
      activityType: 'WITHDRAWAL',
    });
    expect(mapActivityType('DIVIDEND')).toEqual({ activityType: 'DIVIDEND' });
    expect(mapActivityType('COMMISSION REFUND')).toEqual({
      activityType: 'CREDIT',
      subtype: 'FEE_REFUND',
    });
    expect(mapActivityType('REWARD')).toEqual({
      activityType: 'CREDIT',
      subtype: 'BONUS',
    });
  });

  it('returns null for unknown types (never silently maps)', () => {
    expect(mapActivityType('SOME UNKNOWN TYPE')).toBeNull();
    expect(mapActivityType('BUY - LIMIT')).toBeNull();
    expect(mapActivityType('')).toBeNull();
  });

  it('exposes the seven known source types', () => {
    expect(KNOWN_SOURCE_TYPES).toHaveLength(7);
    expect(KNOWN_SOURCE_TYPES).toContain('BUY - MARKET');
    expect(KNOWN_SOURCE_TYPES).toContain('REWARD');
  });
});
