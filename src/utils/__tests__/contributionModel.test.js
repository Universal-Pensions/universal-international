// Tests for src/utils/contributionModel.js — THE single source of truth for the
// two-leg employer contribution math and the words the app uses to describe it.
//
// This helper replaced FIVE independent re-implementations of the same formula
// (the employer service mock, the seed, the run-wizard preview, the subscriber
// Home, and the employer test suite), one of which had drifted. That is why it is
// tested this heavily: every leg computation, every funding label and (mirrored in
// PL/pgSQL by migration 0093) the live run RPC now resolve through this one file,
// so a silent change here moves real money on every surface at once.
//
// THE BUG THIS MODEL EXISTS TO KILL. Under the old mode-switched config the
// employer's leg was a percentage OF THE EMPLOYEE LEG (`employerMatchPct`):
//     employerLeg = round(employeeLeg × employerMatchPct / 100)
// so the company's contribution moved whenever the member's did, and a config in
// which the employer pays and the staff do not was inexpressible except through a
// second `mode`. Both legs are now INDEPENDENT shares of the member's monthly
// compensation. `mode`, `employerMatchPct` and `matchPct` are deleted. Either leg
// may be 0, 0/0 is legal, and there is no cap and no minimum.
//
// 0093 additionally deleted the per-leg BASIS: a leg can no longer be a flat UGX
// amount, so `employeeBasis`/`employerBasis`/`employeeAmount`/`employerAmount` are
// gone too. Migration 0093 backfilled every live row, so the legacy branch below
// is restore-from-backup insurance rather than a live read path — but it still has
// to convert MONEY-PRESERVINGLY (10% of pay + a 50% match of that leg === 5% of
// pay), which is what the legacy describe pins.

import { describe, it, expect } from 'vitest';
import {
  normalizeContributionConfig,
  deriveContributionLegs,
  contributionParticipants,
  isLegZero,
  formatLegRate,
  formatLegRateForMember,
  contributionFundingLabel,
  memberFundingSummary,
} from '../contributionModel';

// A realistic Ugandan monthly wage, chosen so every percentage below lands on a
// whole shilling and the assertions read as real money rather than as arithmetic.
const COMP = 1_400_000;

const ZERO_KEYS = { employeePct: 0, employerPct: 0 };

// ---------------------------------------------------------------------------
// deriveContributionLegs — the canonical run math
// ---------------------------------------------------------------------------
describe('deriveContributionLegs — both legs are shares of pay', () => {
  const config = { employeePct: 10, employerPct: 5 };

  it('derives each leg independently from the member’s own compensation', () => {
    expect(deriveContributionLegs(config, COMP)).toEqual({
      employeeLeg: 140_000,
      employerLeg: 70_000,
    });
  });

  it('scales with compensation', () => {
    expect(deriveContributionLegs(config, COMP * 2)).toEqual({
      employeeLeg: 280_000,
      employerLeg: 140_000,
    });
  });

  it('funds nothing when compensation is missing or zero', () => {
    expect(deriveContributionLegs(config, 0)).toEqual({ employeeLeg: 0, employerLeg: 0 });
    expect(deriveContributionLegs(config, undefined)).toEqual({ employeeLeg: 0, employerLeg: 0 });
    expect(deriveContributionLegs(config, null)).toEqual({ employeeLeg: 0, employerLeg: 0 });
  });
});

describe('deriveContributionLegs — a zero leg on either side', () => {
  it('supports a company-funded pension with no staff deduction', () => {
    const config = { employeePct: 0, employerPct: 5 };
    expect(deriveContributionLegs(config, COMP)).toEqual({ employeeLeg: 0, employerLeg: 70_000 });
  });

  it('supports a staff-only pension the company does not top up', () => {
    const config = { employeePct: 10, employerPct: 0 };
    expect(deriveContributionLegs(config, COMP)).toEqual({ employeeLeg: 140_000, employerLeg: 0 });
  });

  it('treats 0/0 as legal and simply funds nothing', () => {
    expect(deriveContributionLegs(ZERO_KEYS, COMP)).toEqual({ employeeLeg: 0, employerLeg: 0 });
    expect(deriveContributionLegs({}, COMP)).toEqual({ employeeLeg: 0, employerLeg: 0 });
  });
});

// THE regression that the whole model exists to prevent.
describe('the employer leg is NEVER derived from the employee leg', () => {
  it('leaves the employer leg untouched when the employee leg changes', () => {
    const at10 = deriveContributionLegs({ employeePct: 10, employerPct: 5 }, COMP);
    const at30 = deriveContributionLegs({ employeePct: 30, employerPct: 5 }, COMP);
    const at0 = deriveContributionLegs({ employeePct: 0, employerPct: 5 }, COMP);

    expect(at10.employeeLeg).toBe(140_000);
    expect(at30.employeeLeg).toBe(420_000);
    expect(at0.employeeLeg).toBe(0);
    // The employer leg is 5% of PAY in all three cases — never a share of the
    // employee leg, which would have given 7,000 / 21,000 / 0.
    expect(at10.employerLeg).toBe(70_000);
    expect(at30.employerLeg).toBe(70_000);
    expect(at0.employerLeg).toBe(70_000);
  });
});

describe('rounding — one round per leg, matching SQL round()', () => {
  it('rounds each leg once, never the total', () => {
    const legs = deriveContributionLegs({ employeePct: 7.5, employerPct: 2.5 }, 333_333);
    // 24,999.975 → 25,000 and 8,333.325 → 8,333, each rounded on its own.
    expect(legs).toEqual({ employeeLeg: 25_000, employerLeg: 8_333 });
  });

  it('rounds a half shilling UP, as Postgres round() does for positives', () => {
    expect(deriveContributionLegs({ employeePct: 1.5 }, 33_300).employeeLeg).toBe(500);
    expect(deriveContributionLegs({ employerPct: 1.5 }, 33_300).employerLeg).toBe(500);
  });

  it('does not double-round by deriving one leg from the other', () => {
    const legs = deriveContributionLegs({ employeePct: 3.33, employerPct: 3.33 }, 1_000_001);
    expect(legs.employeeLeg).toBe(legs.employerLeg);
    expect(legs.employeeLeg).toBe(33_300);
  });
});

// ---------------------------------------------------------------------------
// normalizeContributionConfig
// ---------------------------------------------------------------------------
describe('normalizeContributionConfig — the current shape', () => {
  it('reads the two percentages as-is', () => {
    expect(normalizeContributionConfig({ employeePct: 10, employerPct: 5 }))
      .toEqual({ employeePct: 10, employerPct: 5 });
  });

  it('coerces numeric strings', () => {
    const c = normalizeContributionConfig({ employeePct: '10', employerPct: '5' });
    expect(c).toEqual({ employeePct: 10, employerPct: 5 });
    expect(deriveContributionLegs(c, COMP).employeeLeg).toBe(140_000);
  });

  it('reads a non-finite value as 0 rather than propagating NaN', () => {
    expect(normalizeContributionConfig({ employeePct: 'abc', employerPct: null }))
      .toEqual(ZERO_KEYS);
  });

  it('is idempotent — normalising its own output changes nothing', () => {
    const once = normalizeContributionConfig({ employeePct: 10, employerPct: 5 });
    expect(normalizeContributionConfig(once)).toEqual(once);
  });
});

describe('normalizeContributionConfig — an empty / absent config', () => {
  // `create_employer` and `approve_access_request` provision with '{}'.
  it('normalises an empty, null or missing config to 0/0', () => {
    expect(normalizeContributionConfig({})).toEqual(ZERO_KEYS);
    expect(normalizeContributionConfig(null)).toEqual(ZERO_KEYS);
    expect(normalizeContributionConfig(undefined)).toEqual(ZERO_KEYS);
    expect(normalizeContributionConfig()).toEqual(ZERO_KEYS);
  });

  it('ignores the group-insurance keys, which it neither reads nor returns', () => {
    expect(normalizeContributionConfig({ insuranceEnabled: true, groupCoverAmount: 5_000_000 }))
      .toEqual(ZERO_KEYS);
  });
});

describe('normalizeContributionConfig — legacy back-compat', () => {
  it('converts a pre-0092 co-contribution config money-identically', () => {
    const legacy = { mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 };
    // 10% of pay + a 50% match OF THAT LEG === 10% + 5% of pay.
    expect(normalizeContributionConfig(legacy)).toEqual({ employeePct: 10, employerPct: 5 });
    expect(deriveContributionLegs(legacy, COMP)).toEqual({
      employeeLeg: 140_000,
      employerLeg: 70_000,
    });
  });

  it('accepts the `matchPct` alias', () => {
    const c = normalizeContributionConfig({ mode: 'co-contribution', employeePct: 8, matchPct: 25 });
    expect(c).toEqual({ employeePct: 8, employerPct: 2 });
  });

  it('prefers employerMatchPct over the matchPct alias', () => {
    const c = normalizeContributionConfig({
      mode: 'co-contribution', employeePct: 10, employerMatchPct: 50, matchPct: 90,
    });
    expect(c.employerPct).toBe(5);
  });

  it('reads a missing match as no employer leg rather than NaN', () => {
    expect(normalizeContributionConfig({ mode: 'co-contribution', employeePct: 10 }))
      .toEqual({ employeePct: 10, employerPct: 0 });
  });

  // The legacy branch is tested FIRST in the implementation because a pre-0092
  // row can carry an employerPct left over from an earlier shape. Reading that
  // instead of converting the match would silently zero the employer leg.
  it('lets the legacy branch win when a row carries BOTH mode and a stale employerPct', () => {
    const c = normalizeContributionConfig({
      mode: 'co-contribution', employeePct: 10, employerMatchPct: 50, employerPct: 0,
    });
    expect(c.employerPct).toBe(5);
  });

  it('reads an unrecognised mode through the plain branch', () => {
    expect(normalizeContributionConfig({ mode: 'something-else', employeePct: 10, employerPct: 5 }))
      .toEqual({ employeePct: 10, employerPct: 5 });
  });
});

// ---------------------------------------------------------------------------
// contributionParticipants — who is actually putting money in
// ---------------------------------------------------------------------------
describe('contributionParticipants', () => {
  it('reports both when both legs fund something', () => {
    expect(contributionParticipants({ employeePct: 10, employerPct: 5 })).toBe('both');
  });

  it('reports staff when only the employee leg funds something', () => {
    expect(contributionParticipants({ employeePct: 10, employerPct: 0 })).toBe('staff');
  });

  it('reports company when only the employer leg funds something', () => {
    expect(contributionParticipants({ employeePct: 0, employerPct: 5 })).toBe('company');
  });

  it('reports none for 0/0 and for an unprovisioned employer', () => {
    expect(contributionParticipants(ZERO_KEYS)).toBe('none');
    expect(contributionParticipants({})).toBe('none');
    expect(contributionParticipants(null)).toBe('none');
  });

  it('derives through the legacy branch too', () => {
    expect(contributionParticipants({ mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 }))
      .toBe('both');
    expect(contributionParticipants({ mode: 'co-contribution', employeePct: 10 })).toBe('staff');
  });
});

// ---------------------------------------------------------------------------
// isLegZero + the rate formatters
// ---------------------------------------------------------------------------
describe('isLegZero', () => {
  it('is true for zero, negative, missing and unparseable rates', () => {
    expect(isLegZero(0)).toBe(true);
    expect(isLegZero(-1)).toBe(true);
    expect(isLegZero(undefined)).toBe(true);
    expect(isLegZero(null)).toBe(true);
    expect(isLegZero('abc')).toBe(true);
  });

  it('is false for any positive rate, including a fractional one', () => {
    expect(isLegZero(10)).toBe(false);
    expect(isLegZero(0.5)).toBe(false);
    expect(isLegZero('10')).toBe(false);
  });
});

describe('formatLegRate / formatLegRateForMember', () => {
  it('states the rate in the employer voice', () => {
    expect(formatLegRate(10)).toBe('10% of pay');
    expect(formatLegRate(0)).toBe('0% of pay');
  });

  it('states the same rate in the member voice', () => {
    expect(formatLegRateForMember(10)).toBe('10% of your pay');
  });

  // Both formatters are deliberately COMPENSATION-FREE so a rate can be shown
  // without disclosing anyone's pay. Pinning the arity stops a well-meaning
  // change from threading compensation in.
  it('takes only a rate — never a compensation figure', () => {
    expect(formatLegRate).toHaveLength(1);
    expect(formatLegRateForMember).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The two funding one-liners
// ---------------------------------------------------------------------------
describe('contributionFundingLabel — employer voice', () => {
  it('names both legs when both fund something', () => {
    expect(contributionFundingLabel({ employeePct: 10, employerPct: 5 }))
      .toBe('Staff put in 10% of pay · You add 5% of pay');
  });

  it('says so plainly when the company adds nothing', () => {
    expect(contributionFundingLabel({ employeePct: 10, employerPct: 0 }))
      .toBe('Staff put in 10% of pay · You add nothing');
  });

  it('leads with the company when staff put in nothing', () => {
    expect(contributionFundingLabel({ employeePct: 0, employerPct: 5 }))
      .toBe('You fund 5% of pay · Staff put in nothing');
  });

  it('reports an unconfigured employer as not set up', () => {
    expect(contributionFundingLabel({})).toBe('No contributions set up yet');
    expect(contributionFundingLabel(ZERO_KEYS)).toBe('No contributions set up yet');
  });

  // The deleted vocabulary must never resurface in a user-facing string.
  it('never emits the deleted mode vocabulary', () => {
    const configs = [
      { employeePct: 10, employerPct: 5 },
      { employeePct: 10, employerPct: 0 },
      { employeePct: 0, employerPct: 5 },
      {},
      { mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 },
    ];
    for (const cfg of configs) {
      const label = contributionFundingLabel(cfg);
      expect(label).not.toMatch(/co-?contribution/i);
      expect(label).not.toMatch(/employer-only/i);
      expect(label).not.toMatch(/match/i);
    }
  });
});

describe('memberFundingSummary — member voice', () => {
  it('names both legs and the employer when both fund something', () => {
    expect(memberFundingSummary({ employeePct: 10, employerPct: 5 }, 'Acme Ltd'))
      .toBe('10% of your pay, plus 5% of your pay from Acme Ltd');
  });

  it('describes a staff-only arrangement as the employer remitting their pay', () => {
    expect(memberFundingSummary({ employeePct: 10, employerPct: 0 }, 'Acme Ltd'))
      .toBe('Acme Ltd sends 10% of your pay to your pension each month');
  });

  it('makes a company-funded pension explicitly free to the member', () => {
    expect(memberFundingSummary({ employeePct: 0, employerPct: 5 }, 'Acme Ltd'))
      .toBe('Acme Ltd pays your whole pension — 5% of your pay, at no cost to you');
  });

  // Callers use null as the "hide the funding surface entirely" signal.
  it('returns null when nothing is funded', () => {
    expect(memberFundingSummary({}, 'Acme Ltd')).toBeNull();
    expect(memberFundingSummary(ZERO_KEYS, 'Acme Ltd')).toBeNull();
  });

  it('falls back to "your employer" when the name is unavailable', () => {
    expect(memberFundingSummary({ employeePct: 10, employerPct: 5 }, ''))
      .toBe('10% of your pay, plus 5% of your pay from your employer');
    expect(memberFundingSummary({ employeePct: 10, employerPct: 5 }))
      .toBe('10% of your pay, plus 5% of your pay from your employer');
  });

  it('never emits the deleted mode vocabulary', () => {
    const summary = memberFundingSummary(
      { mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 },
      'Acme Ltd',
    );
    expect(summary).not.toMatch(/co-?contribution/i);
    expect(summary).not.toMatch(/match/i);
  });
});

// ---------------------------------------------------------------------------
// The label and the money must describe the same arrangement
// ---------------------------------------------------------------------------
describe('the label and the money never disagree', () => {
  const cases = [
    { employeePct: 10, employerPct: 5 },
    { employeePct: 10, employerPct: 0 },
    { employeePct: 0, employerPct: 5 },
    { employeePct: 0, employerPct: 0 },
    { mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 },
  ];

  it('mentions a leg in the label exactly when that leg posts money', () => {
    for (const cfg of cases) {
      const { employeeLeg, employerLeg } = deriveContributionLegs(cfg, COMP);
      const label = contributionFundingLabel(cfg);

      if (employeeLeg === 0 && employerLeg === 0) {
        expect(label).toBe('No contributions set up yet');
        continue;
      }
      expect(label).toContain(employeeLeg > 0 ? 'Staff put in' : 'Staff put in nothing');
      if (employerLeg === 0) expect(label).toContain('You add nothing');
    }
  });

  it('hides the member surface exactly when no money moves', () => {
    for (const cfg of cases) {
      const { employeeLeg, employerLeg } = deriveContributionLegs(cfg, COMP);
      const summary = memberFundingSummary(cfg, 'Acme Ltd');
      expect(summary === null).toBe(employeeLeg === 0 && employerLeg === 0);
    }
  });

  it('agrees with contributionParticipants on every case', () => {
    for (const cfg of cases) {
      const { employeeLeg, employerLeg } = deriveContributionLegs(cfg, COMP);
      const who = contributionParticipants(cfg);
      const expected = employeeLeg > 0 && employerLeg > 0 ? 'both'
        : employeeLeg > 0 ? 'staff'
          : employerLeg > 0 ? 'company' : 'none';
      expect(who).toBe(expected);
    }
  });
});
