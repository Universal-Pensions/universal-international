import { describe, it, expect } from 'vitest';
import { calcFV, formatUGX, computeProjection, AMOUNTS, MONTHLY_RATE } from './calc';

describe('landing mobile calculator model', () => {
  it('matches the canonical projection (10K/mo × 25yr)', () => {
    // The figure the home preview + calculator sheet must show, identical to the
    // desktop SubscribersPage calculator.
    expect(Math.round(calcFV(10000, 25))).toBe(13268334);
  });

  it('computes contributions and growth as fv − contributed', () => {
    const { fv, contributed, growth } = computeProjection(10000, 25);
    expect(contributed).toBe(10000 * 25 * 12); // 3,000,000
    expect(contributed).toBe(3000000);
    // Growth is derived, NOT the stale mockup literal (10,268,116).
    expect(Math.round(growth)).toBe(Math.round(fv) - contributed);
    expect(Math.round(growth)).toBe(10268334);
  });

  it('returns 0 for a non-positive term', () => {
    expect(calcFV(10000, 0)).toBe(0);
  });

  it('scales linearly with the monthly amount', () => {
    expect(calcFV(20000, 25)).toBeCloseTo(2 * calcFV(10000, 25), 4);
  });

  it('formats UGX with thousands separators', () => {
    expect(formatUGX(13268334)).toBe('UGX 13,268,334');
    expect(formatUGX(0)).toBe('UGX 0');
    expect(formatUGX(1234.6)).toBe('UGX 1,235'); // rounds
  });

  it('exposes the four contribution presets and the monthly rate', () => {
    expect(AMOUNTS).toEqual([5000, 10000, 20000, 50000]);
    expect(MONTHLY_RATE).toBeCloseTo(0.1 / 12, 12);
  });

  it('caps the contributed bar segment at a visible minimum', () => {
    // Long terms make growth dominate; the contributed segment floors at 4%.
    const { contributedPct } = computeProjection(5000, 40);
    expect(contributedPct).toBeGreaterThanOrEqual(4);
    expect(contributedPct).toBeLessThanOrEqual(100);
  });
});
