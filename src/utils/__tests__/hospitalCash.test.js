// Hospital-cash claim maths.
//
// These rules are duplicated in PL/pgSQL by migration 0099's
// `submit_hospital_cash_claim` (the server is the authority; this module drives
// the live preview and mock mode). The assertions here are therefore also the
// written record of what that RPC must do.

import { describe, it, expect } from 'vitest';
import {
  nightsBetween,
  policyYearStart,
  nightsUsed,
  hospitalCashQuote,
} from '../hospitalCash';

const POLICY = { cover: 3_000_000, renewalDate: '2027-01-15', policyStart: '2026-01-15' };
const NOW = new Date('2026-06-01T12:00:00Z');

const claim = (over = {}) => ({
  product: 'health', status: 'submitted', nights: 3, incidentDate: '2026-03-01', ...over,
});

describe('nightsBetween', () => {
  it('counts whole nights', () => {
    expect(nightsBetween('2026-03-12', '2026-03-17')).toBe(5);
    expect(nightsBetween('2026-03-12', '2026-03-13')).toBe(1);
  });

  it('treats a same-day stay as zero nights, not one', () => {
    // Hospital cash pays PER NIGHT — a day case genuinely isn't claimable.
    expect(nightsBetween('2026-03-12', '2026-03-12')).toBe(0);
  });

  it('is not thrown off by a DST boundary', () => {
    // Counted in UTC calendar days rather than by subtracting timestamps.
    expect(nightsBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(nightsBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('returns 0 for missing, unparseable or reversed dates', () => {
    expect(nightsBetween(null, '2026-03-17')).toBe(0);
    expect(nightsBetween('2026-03-12', undefined)).toBe(0);
    expect(nightsBetween('nonsense', '2026-03-17')).toBe(0);
    expect(nightsBetween('2026-03-17', '2026-03-12')).toBe(0);
  });
});

describe('policyYearStart', () => {
  it('opens one year before the renewal date', () => {
    expect(policyYearStart(POLICY, NOW).toISOString().slice(0, 10)).toBe('2026-01-15');
  });

  it('falls back to policyStart when there is no renewal date', () => {
    expect(policyYearStart({ policyStart: '2025-09-01' }, NOW).toISOString().slice(0, 10))
      .toBe('2025-09-01');
  });

  it('falls back to a year before now when the policy carries no dates', () => {
    expect(policyYearStart({}, NOW).toISOString().slice(0, 10)).toBe('2025-06-01');
  });

  it('never narrows the window on bad input', () => {
    // A wider window sums MORE prior nights, so every fallback errs toward
    // paying less — a missing date can't be used to reset the allowance.
    for (const p of [null, undefined, {}, { renewalDate: 'nonsense' }]) {
      expect(policyYearStart(p, NOW).getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });
});

describe('nightsUsed', () => {
  const yearStart = new Date('2026-01-15');

  it('sums nights on hospital-cash claims in this policy year', () => {
    expect(nightsUsed([claim({ nights: 3 }), claim({ nights: 2 })], { yearStart })).toBe(5);
  });

  it('excludes rejected claims but COUNTS ones still under review', () => {
    // Pending nights are allowance we've committed to look at — treating them
    // as free would let a member file 20 nights twice before the first lands.
    expect(nightsUsed([claim({ nights: 4, status: 'rejected' })], { yearStart })).toBe(0);
    for (const status of ['submitted', 'under_review', 'approved', 'paid']) {
      expect(nightsUsed([claim({ nights: 4, status })], { yearStart })).toBe(4);
    }
  });

  it('ignores claims admitted before the policy year opened', () => {
    // Keyed on admission, not submission — a late filing must not reopen last
    // year's allowance.
    expect(nightsUsed([claim({ nights: 6, incidentDate: '2025-12-30' })], { yearStart })).toBe(0);
  });

  it('ignores other products', () => {
    expect(nightsUsed([claim({ product: 'life', nights: 9 })], { yearStart })).toBe(0);
  });

  it('reads the product off legacy rows that only have `type`', () => {
    expect(nightsUsed([{ type: 'health', status: 'paid', nights: 2, incidentDate: '2026-03-01' }],
      { yearStart })).toBe(2);
  });

  it('returns 0 for a first-time claimant', () => {
    expect(nightsUsed([], { yearStart })).toBe(0);
    expect(nightsUsed(undefined, { yearStart })).toBe(0);
  });
});

describe('hospitalCashQuote', () => {
  const quote = (over = {}) => hospitalCashQuote({
    policy: POLICY, admission: '2026-03-12', discharge: '2026-03-17',
    claims: [], now: NOW, ...over,
  });

  it('prices the stay at cover ÷ 20 per night', () => {
    const q = quote();
    expect(q.dailyRate).toBe(150_000);   // 3,000,000 / 20
    expect(q.nights).toBe(5);
    expect(q.payableNights).toBe(5);
    expect(q.payout).toBe(750_000);
    expect(q.capped).toBe(false);
  });

  it('reports the remaining allowance', () => {
    const q = quote({ claims: [claim({ nights: 5 })] });
    expect(q.used).toBe(5);
    expect(q.remaining).toBe(15);
  });

  it('caps a stay that exceeds the remaining nights, and says so', () => {
    const q = quote({ claims: [claim({ nights: 18 })] });
    expect(q.remaining).toBe(2);
    expect(q.nights).toBe(5);
    expect(q.payableNights).toBe(2);
    expect(q.payout).toBe(300_000);
    expect(q.capped).toBe(true);
  });

  it('pays nothing once the allowance is exhausted', () => {
    const q = quote({ claims: [claim({ nights: 20 })] });
    expect(q.remaining).toBe(0);
    expect(q.payableNights).toBe(0);
    expect(q.payout).toBe(0);
    expect(q.capped).toBe(true);
  });

  it('never goes negative when history somehow exceeds the cap', () => {
    const q = quote({ claims: [claim({ nights: 25 })] });
    expect(q.remaining).toBe(0);
    expect(q.payout).toBe(0);
  });

  it('scales the daily rate with the chosen cover tier', () => {
    expect(quote({ policy: { ...POLICY, cover: 12_000_000 } }).dailyRate).toBe(600_000);
    expect(quote({ policy: { ...POLICY, cover: 8_000_000 } }).payout).toBe(5 * 400_000);
  });

  it('yields a zero payout for a same-day stay', () => {
    const q = quote({ discharge: '2026-03-12' });
    expect(q.nights).toBe(0);
    expect(q.payout).toBe(0);
  });
});
