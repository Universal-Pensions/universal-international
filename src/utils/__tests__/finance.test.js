import { describe, it, expect } from 'vitest';
import {
  parseAmount,
  normalizeFrequency,
  periodsPerYear,
  monthlyEquivalent,
  calcFV,
  sliderToAmt,
  amtToSlider,
  deriveInvestmentGrowth,
  deriveEmployerSplit,
  txDisplayAmount,
  FREQUENCY,
} from '../finance';

// NOTE: currency formatting (formatUGX compact/exact, formatUGXShort — formerly
// the finance shims formatUGX / formatUGXExact / fmtShort) is now owned by
// src/utils/currency.js and covered exhaustively in currency.test.js.

describe('finance utils', () => {
  describe('parseAmount()', () => {
    it('parses plain digit strings', () => {
      expect(parseAmount('12500')).toBe(12500);
    });

    it('strips grouping separators', () => {
      expect(parseAmount('12,500')).toBe(12500);
      expect(parseAmount('1,200,000')).toBe(1200000);
    });

    it('strips a currency prefix', () => {
      expect(parseAmount('UGX 50,000')).toBe(50000);
    });

    it('rounds decimals to whole UGX (the BL-8 footgun: no off-by-100)', () => {
      // The old implementation stripped the decimal point → "12,500.50" became
      // 1250050 (off by 100×). The canonical parser rounds instead.
      expect(parseAmount('12,500.50')).toBe(12501);
      expect(parseAmount('45000.50')).toBe(45001);
      expect(parseAmount('45000.49')).toBe(45000);
      expect(parseAmount('1.5')).toBe(2);
    });

    it('accepts numeric input and rounds it', () => {
      expect(parseAmount(50000)).toBe(50000);
      expect(parseAmount(45000.5)).toBe(45001);
    });

    it('returns null for blank / non-numeric / non-positive input', () => {
      expect(parseAmount('')).toBeNull();
      expect(parseAmount('   ')).toBeNull();
      expect(parseAmount('abc')).toBeNull();
      expect(parseAmount('-')).toBeNull();
      expect(parseAmount('.')).toBeNull();
      expect(parseAmount(null)).toBeNull();
      expect(parseAmount(undefined)).toBeNull();
      expect(parseAmount('0')).toBeNull();
      expect(parseAmount(0)).toBeNull();
      expect(parseAmount('-500')).toBeNull();
      expect(parseAmount(-500)).toBeNull();
    });
  });

  describe('normalizeFrequency()', () => {
    // Pin the canonical contract so the constants can't silently drift either —
    // a schedule normalises to one of exactly these six string ids.
    it('exposes the canonical frequency ids', () => {
      expect(FREQUENCY).toEqual({
        DAILY: 'daily',
        WEEKLY: 'weekly',
        MONTHLY: 'monthly',
        QUARTERLY: 'quarterly',
        HALF_YEARLY: 'half-yearly',
        ANNUALLY: 'annually',
      });
    });

    it('passes canonical ids through unchanged', () => {
      expect(normalizeFrequency('daily')).toBe(FREQUENCY.DAILY);
      expect(normalizeFrequency('weekly')).toBe(FREQUENCY.WEEKLY);
      expect(normalizeFrequency('monthly')).toBe(FREQUENCY.MONTHLY);
      expect(normalizeFrequency('quarterly')).toBe(FREQUENCY.QUARTERLY);
      expect(normalizeFrequency('half-yearly')).toBe(FREQUENCY.HALF_YEARLY);
      expect(normalizeFrequency('annually')).toBe(FREQUENCY.ANNUALLY);
    });

    // Exhaustive alias map enumerated from src/utils/finance.js. A normalization
    // regression here can silently drift every contribution schedule, so each
    // legacy/alternate spelling is asserted explicitly against its canonical id.
    // The half-yearly cluster is the dangerous one: four historical spellings
    // (kebab, lowercase camel, "semi-annually", "semiannually") all converge.
    it.each([
      // half-yearly cluster
      ['half-yearly', FREQUENCY.HALF_YEARLY],
      ['halfYearly', FREQUENCY.HALF_YEARLY],
      ['halfyearly', FREQUENCY.HALF_YEARLY],
      ['semi-annually', FREQUENCY.HALF_YEARLY],
      ['semiannually', FREQUENCY.HALF_YEARLY],
      // annually cluster
      ['annually', FREQUENCY.ANNUALLY],
      ['yearly', FREQUENCY.ANNUALLY],
    ])('normalizes alias %s -> %s', (alias, canonical) => {
      expect(normalizeFrequency(alias)).toBe(canonical);
    });

    it('resolves every half-yearly alias to the canonical id', () => {
      expect(normalizeFrequency('halfYearly')).toBe(FREQUENCY.HALF_YEARLY);
      expect(normalizeFrequency('halfyearly')).toBe(FREQUENCY.HALF_YEARLY);
      expect(normalizeFrequency('semi-annually')).toBe(FREQUENCY.HALF_YEARLY);
      expect(normalizeFrequency('semiannually')).toBe(FREQUENCY.HALF_YEARLY);
    });

    it('resolves the yearly alias to annually', () => {
      expect(normalizeFrequency('yearly')).toBe(FREQUENCY.ANNUALLY);
    });

    it('is case-insensitive across canonical ids and aliases', () => {
      expect(normalizeFrequency('WEEKLY')).toBe(FREQUENCY.WEEKLY);
      expect(normalizeFrequency('Monthly')).toBe(FREQUENCY.MONTHLY);
      expect(normalizeFrequency('QUARTERLY')).toBe(FREQUENCY.QUARTERLY);
      expect(normalizeFrequency('Half-Yearly')).toBe(FREQUENCY.HALF_YEARLY);
      expect(normalizeFrequency('HALFYEARLY')).toBe(FREQUENCY.HALF_YEARLY);
      expect(normalizeFrequency('Semi-Annually')).toBe(FREQUENCY.HALF_YEARLY);
      expect(normalizeFrequency('Annually')).toBe(FREQUENCY.ANNUALLY);
      expect(normalizeFrequency('Yearly')).toBe(FREQUENCY.ANNUALLY);
    });

    it('normalizes daily (case-insensitively) to the canonical id', () => {
      expect(normalizeFrequency('daily')).toBe(FREQUENCY.DAILY);
      expect(normalizeFrequency('Daily')).toBe(FREQUENCY.DAILY);
      expect(normalizeFrequency('DAILY')).toBe(FREQUENCY.DAILY);
    });

    it('falls back to monthly for empty / unknown input', () => {
      expect(normalizeFrequency('')).toBe(FREQUENCY.MONTHLY);
      expect(normalizeFrequency(null)).toBe(FREQUENCY.MONTHLY);
      expect(normalizeFrequency(undefined)).toBe(FREQUENCY.MONTHLY);
      expect(normalizeFrequency(0)).toBe(FREQUENCY.MONTHLY);
      expect(normalizeFrequency('fortnightly')).toBe(FREQUENCY.MONTHLY);
      expect(normalizeFrequency('biweekly')).toBe(FREQUENCY.MONTHLY);
    });
  });

  describe('periodsPerYear()', () => {
    it('returns the correct count for each canonical frequency', () => {
      expect(periodsPerYear('daily')).toBe(365);
      expect(periodsPerYear('weekly')).toBe(52);
      expect(periodsPerYear('monthly')).toBe(12);
      expect(periodsPerYear('quarterly')).toBe(4);
      expect(periodsPerYear('half-yearly')).toBe(2);
      expect(periodsPerYear('annually')).toBe(1);
    });

    it('handles aliases via normalizeFrequency', () => {
      expect(periodsPerYear('semi-annually')).toBe(2);
      expect(periodsPerYear('yearly')).toBe(1);
    });

    it('falls back to monthly (12) for unknown input', () => {
      expect(periodsPerYear('fortnightly')).toBe(12);
      expect(periodsPerYear(undefined)).toBe(12);
    });
  });

  describe('monthlyEquivalent()', () => {
    it('returns the amount itself for a monthly schedule', () => {
      expect(monthlyEquivalent({ amount: 50000, frequency: 'monthly' })).toBe(50000);
    });

    it('scales weekly / quarterly / annual schedules to a monthly figure', () => {
      expect(monthlyEquivalent({ amount: 12000, frequency: 'annually' })).toBe(1000);
      expect(monthlyEquivalent({ amount: 30000, frequency: 'quarterly' })).toBe(10000);
      expect(monthlyEquivalent({ amount: 12, frequency: 'weekly' })).toBe(52);
    });

    it('returns 0 for zero / negative / non-finite amounts', () => {
      expect(monthlyEquivalent({ amount: 0, frequency: 'monthly' })).toBe(0);
      expect(monthlyEquivalent({ amount: -5000, frequency: 'monthly' })).toBe(0);
      expect(monthlyEquivalent({ amount: Number.NaN, frequency: 'monthly' })).toBe(0);
    });

    it('returns 0 for null / undefined / missing amount', () => {
      expect(monthlyEquivalent(null)).toBe(0);
      expect(monthlyEquivalent(undefined)).toBe(0);
      expect(monthlyEquivalent({})).toBe(0);
    });
  });

  describe('calcFV()', () => {
    it('returns 0 when years is 0 (no contribution periods)', () => {
      expect(calcFV(50000, 0)).toBe(0);
    });

    it('returns 0 when years is negative', () => {
      expect(calcFV(50000, -5)).toBe(0);
    });

    it('grows a positive payment over time', () => {
      const fv = calcFV(50000, 10);
      expect(fv).toBeGreaterThan(50000 * 12 * 10); // exceeds nominal contributions
    });
  });

  describe('sliderToAmt() / amtToSlider()', () => {
    it('maps slider extremes to the configured min / max', () => {
      expect(sliderToAmt(0, 1000, 1000000)).toBe(1000);
      expect(sliderToAmt(100, 1000, 1000000)).toBe(1000000);
    });

    it('rounds amounts to the nearest 1,000', () => {
      const amt = sliderToAmt(50, 1000, 1000000);
      expect(amt % 1000).toBe(0);
    });

    it('amtToSlider returns 0 / 100 at the bounds', () => {
      expect(amtToSlider(1000, 1000, 1000000)).toBe(0);
      expect(amtToSlider(1000000, 1000, 1000000)).toBe(100);
    });

    it('clamps amounts below min to slider position 0', () => {
      expect(amtToSlider(500, 1000, 1000000)).toBe(0);
    });

    it('round-trips a mid-range amount back to (approximately) itself', () => {
      const amt = sliderToAmt(50, 1000, 1000000);
      const back = sliderToAmt(amtToSlider(amt, 1000, 1000000), 1000, 1000000);
      expect(back).toBe(amt);
    });
  });

  // Grace Nakato's live row (empe-002): 4.41M balance, registered 2024-08-24.
  // These two helpers are the single source of truth that keeps the subscriber
  // hero, the desktop KPI tiles, and the employer-benefits split all agreeing.
  describe('deriveInvestmentGrowth()', () => {
    it('returns all-zero for a non-positive / missing balance', () => {
      expect(deriveInvestmentGrowth({ netBalance: 0 })).toEqual({ invested: 0, growth: 0, growthPct: 0 });
      expect(deriveInvestmentGrowth({ netBalance: -100 })).toEqual({ invested: 0, growth: 0, growthPct: 0 });
      expect(deriveInvestmentGrowth(null)).toEqual({ invested: 0, growth: 0, growthPct: 0 });
    });

    it('discounts the balance so invested < balance and balance === invested + growth', () => {
      const { invested, growth, growthPct } = deriveInvestmentGrowth({
        netBalance: 4410000, registeredDate: '2024-08-24', id: 'empe-002',
      });
      expect(invested).toBeGreaterThan(0);
      expect(invested).toBeLessThan(4410000);     // there's a real "growth" story to tell
      expect(invested + growth).toBe(4410000);    // internally coherent with the hero figure
      expect(growthPct).toBeGreaterThan(0);
    });

    it('is deterministic across calls (no Math.random)', () => {
      const sub = { netBalance: 2000000, registeredDate: '2025-01-01', id: 'x-1' };
      expect(deriveInvestmentGrowth(sub)).toEqual(deriveInvestmentGrowth(sub));
    });
  });

  describe('deriveEmployerSplit()', () => {
    const sub = { netBalance: 4410000, registeredDate: '2024-08-24', id: 'empe-002' };

    it('ties the split to the hero principal, NOT the sparsely-seeded raw feed', () => {
      const { invested } = deriveInvestmentGrowth(sub);
      // Raw feed summed to 1.05M (5 own + 5 employer rows) while the balance was
      // 4.41M — the mismatch this fix removes. The split now sums to `invested`.
      const { own, employer, total } = deriveEmployerSplit(sub, { own: 700000, employer: 350000 });
      expect(own + employer).toBe(invested);
      expect(total).toBe(invested);
      expect(invested).toBeGreaterThan(1050000);
    });

    // The ratio comes ENTIRELY from the member's own posted history — it is never
    // read off, or defaulted from, the employer's contribution config. Under the
    // unified two-leg model there is no such thing as a canonical split: an
    // employer may fund 100%, staff may fund 100%, the two legs may use different
    // bases (a % of pay beside a flat UGX amount), and 0/0 is legal. The old
    // hardcoded "1/3 employer" fallback was an artifact of one seeded employer
    // (10% of pay + a 50% match of that leg), and it invented a share for members
    // whose history could not support one.
    it('preserves the member real own:employer ratio, whatever it is', () => {
      // 350k of 1.05M posted by the employer → a one-third employer share for THIS
      // member's feed. Re-derived from the fixture, not a model constant.
      const feed = { own: 700000, employer: 350000 };
      const expectedShare = feed.employer / (feed.own + feed.employer);
      const { own, employer, unknown } = deriveEmployerSplit(sub, feed);
      expect(employer / (own + employer)).toBeCloseTo(expectedShare, 5);
      expect(unknown).toBe(false);
    });

    it('preserves an employer-funded-only ratio (no share is "normal" any more)', () => {
      // A member whose whole pension is paid by their employer — legal under the
      // unified model, and something the deleted 1/3 fallback could never express.
      const { own, employer, total, unknown } = deriveEmployerSplit(sub, { own: 0, employer: 900000 });
      expect(own).toBe(0);
      expect(employer).toBe(total);
      expect(total).toBeGreaterThan(0);
      expect(unknown).toBe(false);
    });

    it('reports an UNKNOWN split (not an invented share) when no contribution rows exist', () => {
      // Callers must hide the funding surface rather than draw a made-up wedge.
      const noFeed = deriveEmployerSplit(sub, undefined);
      const zeroFeed = deriveEmployerSplit(sub, { own: 0, employer: 0 });
      expect(noFeed).toEqual({ own: 0, employer: 0, total: 0, unknown: true });
      expect(zeroFeed).toEqual({ own: 0, employer: 0, total: 0, unknown: true });
    });

    it('returns all-zero for a member with no balance', () => {
      expect(deriveEmployerSplit({ netBalance: 0 }, { own: 0, employer: 0 }))
        .toEqual({ own: 0, employer: 0, total: 0, unknown: true });
    });
  });
});

describe('txDisplayAmount', () => {
  it('keeps inflows positive (contribution, claim payout)', () => {
    expect(txDisplayAmount({ type: 'contribution', amount: 10000 })).toBe(10000);
    expect(txDisplayAmount({ type: 'claim', amount: 500000 })).toBe(500000);
  });

  it('renders premiums as OUTFLOWS even though they are stored positive', () => {
    // The whole point of the helper: premiums are money out, not money received.
    expect(txDisplayAmount({ type: 'premium', amount: 2000 })).toBe(-2000);
    expect(txDisplayAmount({ type: 'insurance_premium', amount: 8500 })).toBe(-8500);
  });

  it('renders a save-to-cover premium_sweep as an OUTFLOW (stored negative)', () => {
    // The sweep marker row posts amount = −target; classified as an outflow so
    // its magnitude reads as money out regardless of the stored sign.
    expect(txDisplayAmount({ type: 'premium_sweep', amount: -24000 })).toBe(-24000);
    expect(txDisplayAmount({ type: 'premium_sweep', amount: 24000 })).toBe(-24000);
  });

  it('normalises withdrawals to negative regardless of stored sign', () => {
    expect(txDisplayAmount({ type: 'withdrawal', amount: 40000 })).toBe(-40000);
    expect(txDisplayAmount({ type: 'withdrawal', amount: -40000 })).toBe(-40000);
  });

  it('is defensive about missing / non-numeric amounts and null rows', () => {
    expect(txDisplayAmount({ type: 'contribution' })).toBe(0);
    expect(txDisplayAmount({ type: 'premium', amount: 'x' })).toBe(0);
    expect(txDisplayAmount(null)).toBe(0);
  });
});
