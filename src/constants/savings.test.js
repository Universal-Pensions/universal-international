import { describe, it, expect } from 'vitest';
import { FREQUENCY } from '../utils/finance';
import {
  MIN_CONTRIBUTION,
  PRESETS_BY_FREQUENCY,
  presetsForFrequency,
} from './savings';

describe('presetsForFrequency', () => {
  it('returns a distinct, ascending set for every canonical frequency', () => {
    for (const id of Object.values(FREQUENCY)) {
      const presets = presetsForFrequency(id);
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThanOrEqual(3);
      // strictly ascending
      for (let i = 1; i < presets.length; i += 1) {
        expect(presets[i]).toBeGreaterThan(presets[i - 1]);
      }
    }
  });

  it('never offers a preset below the accepted minimum', () => {
    for (const presets of Object.values(PRESETS_BY_FREQUENCY)) {
      for (const value of presets) {
        expect(value).toBeGreaterThanOrEqual(MIN_CONTRIBUTION);
      }
    }
  });

  it('scales the entry preset up as the period lengthens', () => {
    const daily = presetsForFrequency(FREQUENCY.DAILY)[0];
    const monthly = presetsForFrequency(FREQUENCY.MONTHLY)[0];
    const annually = presetsForFrequency(FREQUENCY.ANNUALLY)[0];
    expect(daily).toBeLessThan(monthly);
    expect(monthly).toBeLessThan(annually);
  });

  it('resolves legacy / alternate frequency spellings', () => {
    expect(presetsForFrequency('halfYearly')).toBe(PRESETS_BY_FREQUENCY[FREQUENCY.HALF_YEARLY]);
    expect(presetsForFrequency('semi-annually')).toBe(PRESETS_BY_FREQUENCY[FREQUENCY.HALF_YEARLY]);
    expect(presetsForFrequency('yearly')).toBe(PRESETS_BY_FREQUENCY[FREQUENCY.ANNUALLY]);
    expect(presetsForFrequency('DAILY')).toBe(PRESETS_BY_FREQUENCY[FREQUENCY.DAILY]);
  });

  it('falls back to the monthly set for an unknown / empty frequency', () => {
    expect(presetsForFrequency(undefined)).toBe(PRESETS_BY_FREQUENCY[FREQUENCY.MONTHLY]);
    expect(presetsForFrequency('fortnightly')).toBe(PRESETS_BY_FREQUENCY[FREQUENCY.MONTHLY]);
  });
});
