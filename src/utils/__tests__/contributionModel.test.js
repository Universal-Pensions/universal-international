// Tests for src/utils/contributionModel.js — THE single source of truth for the
// two-leg employer contribution math and the words the app uses to describe it.
//
// This helper replaced FIVE independent re-implementations of the same formula
// (the employer service mock, the seed, the run-wizard preview, the subscriber
// Home, and the employer test suite), one of which had drifted. That is why it is
// tested this heavily: every leg computation, every funding label and (mirrored in
// PL/pgSQL by migration 0092) the live run RPC now resolve through this one file,
// so a silent change here moves real money on every surface at once.
//
// THE BUG THIS MODEL EXISTS TO KILL. Under the old mode-switched config the
// employer's leg was a percentage OF THE EMPLOYEE LEG (`employerMatchPct`):
//     employerLeg = round(employeeLeg × employerMatchPct / 100)
// so the company's contribution moved whenever the member's did, and a config in
// which the employer pays and the staff do not was inexpressible except through a
// second `mode`. Both legs are now INDEPENDENT shares of the member's monthly
// compensation (or flat UGX amounts). `mode`, `employerMatchPct` and `matchPct` are
// deleted. Either leg may be 0, 0/0 is legal, and there is no cap and no minimum.
//
// Legacy rows are NOT migrated in the database, so the legacy branches below are
// live code paths, not history: they convert an old config MONEY-PRESERVINGLY at
// read time (10% of pay + a 50% match of that leg === 5% of pay).

import { describe, it, expect } from 'vitest';
import {
  CONTRIBUTION_BASES,
  normalizeContributionConfig,
  deriveContributionLegs,
  isLegZero,
  formatLegRate,
  formatLegRateForMember,
  contributionFundingLabel,
  memberFundingSummary,
} from '../contributionModel';

// A realistic Ugandan monthly wage, chosen so every percentage below lands on a
// whole shilling and the assertions read as real money rather than as arithmetic.
const COMP = 1_400_000;

const ZERO_KEYS = {
  employeeBasis: 'percent', employeePct: 0, employeeAmount: 0,
  employerBasis: 'percent', employerPct: 0, employerAmount: 0,
};

describe('CONTRIBUTION_BASES', () => {
  it('is exactly the two ways a leg can be expressed', () => {
    expect(CONTRIBUTION_BASES).toEqual(['percent', 'fixed']);
  });
});

// =============================================================================
// deriveContributionLegs — the canonical run math
// =============================================================================
describe('deriveContributionLegs — both legs percent of pay', () => {
  const config = {
    employeeBasis: 'percent', employeePct: 10, employeeAmount: 0,
    employerBasis: 'percent', employerPct: 5, employerAmount: 0,
  };

  it('derives each leg from COMPENSATION, independently', () => {
    expect(deriveContributionLegs(config, COMP)).toEqual({
      employeeLeg: 140_000, // 10% of 1,400,000
      employerLeg: 70_000, //   5% of 1,400,000
    });
  });

  it('scales both legs with pay, keeping their ratio to pay (not to each other)', () => {
    // Doubling pay doubles both legs. The point of the assertion is the NEXT test:
    // changing only the employee leg must leave the employer leg alone.
    expect(deriveContributionLegs(config, COMP * 2)).toEqual({
      employeeLeg: 280_000, employerLeg: 140_000,
    });
  });

  it('funds nothing at zero compensation (a member with no pay on file)', () => {
    expect(deriveContributionLegs(config, 0)).toEqual({ employeeLeg: 0, employerLeg: 0 });
    expect(deriveContributionLegs(config, undefined)).toEqual({ employeeLeg: 0, employerLeg: 0 });
    expect(deriveContributionLegs(config, null)).toEqual({ employeeLeg: 0, employerLeg: 0 });
  });
});

describe('deriveContributionLegs — both legs a flat amount', () => {
  const config = {
    employeeBasis: 'fixed', employeePct: 0, employeeAmount: 30_000,
    employerBasis: 'fixed', employerPct: 0, employerAmount: 50_000,
  };

  it('pays the flat amounts and ignores compensation entirely', () => {
    expect(deriveContributionLegs(config, COMP)).toEqual({ employeeLeg: 30_000, employerLeg: 50_000 });
    // A flat leg funds the same money for a member whose pay is unknown — which is
    // exactly why a fixed basis must never be inferred from, or gated on, pay.
    expect(deriveContributionLegs(config, 0)).toEqual({ employeeLeg: 30_000, employerLeg: 50_000 });
  });

  it('ignores a stale percentage sitting beside a fixed basis', () => {
    // update_employer_profile patches the config by jsonb MERGE, so a row switched
    // from percent to fixed can still carry its old pct. The BASIS decides.
    const stale = { ...config, employeePct: 99, employerPct: 99 };
    expect(deriveContributionLegs(stale, COMP)).toEqual({ employeeLeg: 30_000, employerLeg: 50_000 });
  });
});

describe('deriveContributionLegs — MIXED bases', () => {
  // The case the old mode-switched model could not express at ALL: one leg a share
  // of pay, the other a flat amount. 'co-contribution' forced both legs onto
  // percentages; 'employer-only' forced the employee leg to zero.
  it('handles a percent staff leg beside a flat employer leg', () => {
    const config = {
      employeeBasis: 'percent', employeePct: 10, employeeAmount: 0,
      employerBasis: 'fixed', employerPct: 0, employerAmount: 50_000,
    };
    expect(deriveContributionLegs(config, COMP)).toEqual({ employeeLeg: 140_000, employerLeg: 50_000 });
    // The flat leg holds while the percentage one moves with pay.
    expect(deriveContributionLegs(config, 700_000)).toEqual({ employeeLeg: 70_000, employerLeg: 50_000 });
  });

  it('handles a flat staff leg beside a percent employer leg', () => {
    const config = {
      employeeBasis: 'fixed', employeePct: 0, employeeAmount: 20_000,
      employerBasis: 'percent', employerPct: 7.5, employerAmount: 0,
    };
    expect(deriveContributionLegs(config, COMP)).toEqual({ employeeLeg: 20_000, employerLeg: 105_000 });
  });
});

describe('deriveContributionLegs — a zero leg on either side', () => {
  it('employee leg 0: the company funds the whole pension', () => {
    const config = {
      employeeBasis: 'percent', employeePct: 0, employeeAmount: 0,
      employerBasis: 'percent', employerPct: 5, employerAmount: 0,
    };
    expect(deriveContributionLegs(config, COMP)).toEqual({ employeeLeg: 0, employerLeg: 70_000 });
  });

  it('employer leg 0: staff save through payroll, the company adds nothing', () => {
    const config = {
      employeeBasis: 'percent', employeePct: 10, employeeAmount: 0,
      employerBasis: 'percent', employerPct: 0, employerAmount: 0,
    };
    expect(deriveContributionLegs(config, COMP)).toEqual({ employeeLeg: 140_000, employerLeg: 0 });
  });

  it('0/0 funds no pension and is not an error', () => {
    // A legal, saveable configuration — how create_employer / approve_access_request
    // provision a brand-new employer. The run skips the member; nothing throws.
    expect(deriveContributionLegs(ZERO_KEYS, COMP)).toEqual({ employeeLeg: 0, employerLeg: 0 });
  });

  it('a zero FIXED amount is just as legal as a zero percentage', () => {
    const config = {
      employeeBasis: 'fixed', employeePct: 0, employeeAmount: 0,
      employerBasis: 'fixed', employerPct: 0, employerAmount: 0,
    };
    expect(deriveContributionLegs(config, COMP)).toEqual({ employeeLeg: 0, employerLeg: 0 });
  });
});

// =============================================================================
// The regression the whole change-set exists to prevent
// =============================================================================
describe('the employer leg is NEVER derived from the employee leg', () => {
  it('changing ONLY the staff percentage leaves the employer leg untouched', () => {
    // ⚠️ REGRESSION GUARD for the deleted `employerMatchPct` basis. Under the old
    // formula (employerLeg = employeeLeg × matchPct/100) tripling the staff leg
    // tripled the company's too — the employer could not know what it was
    // committing to without knowing what every member chose. Here the company's
    // 5% of pay is 70,000 whatever the staff leg is.
    const base = { employerBasis: 'percent', employerPct: 5, employerAmount: 0 };
    const at10 = deriveContributionLegs({ ...base, employeeBasis: 'percent', employeePct: 10 }, COMP);
    const at30 = deriveContributionLegs({ ...base, employeeBasis: 'percent', employeePct: 30 }, COMP);
    const at0 = deriveContributionLegs({ ...base, employeeBasis: 'percent', employeePct: 0 }, COMP);

    expect(at10.employeeLeg).toBe(140_000);
    expect(at30.employeeLeg).toBe(420_000);
    expect(at0.employeeLeg).toBe(0);
    // The load-bearing assertion: one constant employer leg across all three.
    expect(at10.employerLeg).toBe(70_000);
    expect(at30.employerLeg).toBe(70_000);
    expect(at0.employerLeg).toBe(70_000);
  });

  it('an employer leg survives a zero staff leg (the old formula collapsed it to 0)', () => {
    // Old math: employerLeg = round(0 × 50/100) = 0. The company's money vanished.
    const legs = deriveContributionLegs({
      employeeBasis: 'percent', employeePct: 0, employeeAmount: 0,
      employerBasis: 'fixed', employerPct: 0, employerAmount: 50_000,
    }, COMP);
    expect(legs).toEqual({ employeeLeg: 0, employerLeg: 50_000 });
  });
});

// =============================================================================
// Rounding — exactly ONE Math.round per leg, mirroring SQL round()
// =============================================================================
describe('rounding', () => {
  it('rounds each leg ONCE, independently, to whole shillings', () => {
    // 1,000,001 × 3.33% = 33,300.03330 → 33,300 ; × 1.11% = 11,100.01110 → 11,100.
    const legs = deriveContributionLegs({
      employeeBasis: 'percent', employeePct: 3.33, employeeAmount: 0,
      employerBasis: 'percent', employerPct: 1.11, employerAmount: 0,
    }, 1_000_001);
    expect(legs).toEqual({ employeeLeg: 33_300, employerLeg: 11_100 });
    expect(Number.isInteger(legs.employeeLeg)).toBe(true);
    expect(Number.isInteger(legs.employerLeg)).toBe(true);
  });

  it('rounds a half-shilling up, matching SQL round() for non-negative money', () => {
    // 33,300 × 1.5% = 499.5 → 500 (round-half-up, not banker's rounding), on BOTH
    // legs — the SQL twin in 0092 must agree or the ledger drifts by a shilling.
    expect(deriveContributionLegs({ employeeBasis: 'percent', employeePct: 1.5 }, 33_300).employeeLeg).toBe(500);
    expect(deriveContributionLegs({ employerBasis: 'percent', employerPct: 1.5 }, 33_300).employerLeg).toBe(500);
  });

  it('never double-rounds: the employer leg is not rounded off a rounded employee leg', () => {
    // Under the deleted match basis, round(round(comp × 10%) × 50%) could differ by
    // a shilling from round(comp × 5%). Compensation 1,000,005:
    //   employee = round(100,000.5) = 100,001 ; a 50% match of THAT = 50,000.5 → 50,001
    //   independent 5% of pay      = round(50,000.25) = 50,000  ← the correct figure
    const legs = deriveContributionLegs({
      employeeBasis: 'percent', employeePct: 10, employeeAmount: 0,
      employerBasis: 'percent', employerPct: 5, employerAmount: 0,
    }, 1_000_005);
    expect(legs.employeeLeg).toBe(100_001);
    expect(legs.employerLeg).toBe(50_000);
    expect(legs.employerLeg).not.toBe(Math.round((legs.employeeLeg * 50) / 100));
  });

  it('rounds a fractional flat amount rather than posting fractions of a shilling', () => {
    expect(deriveContributionLegs({
      employeeBasis: 'fixed', employeeAmount: 30_000.4,
      employerBasis: 'fixed', employerAmount: 50_000.5,
    }, COMP)).toEqual({ employeeLeg: 30_000, employerLeg: 50_001 });
  });
});

// =============================================================================
// normalizeContributionConfig — the six canonical keys, from any stored shape
// =============================================================================
describe('normalizeContributionConfig — the unified shape', () => {
  it('reads an explicit config as-is, dropping the insurance keys from the result', () => {
    const c = normalizeContributionConfig({
      employeeBasis: 'fixed', employeePct: 4, employeeAmount: 25_000,
      employerBasis: 'percent', employerPct: 6, employerAmount: 9_000,
      insuranceEnabled: true, groupCoverAmount: 15_000_000,
    });
    // All six keys, always — a consumer never has to guard for a missing one.
    expect(c).toEqual({
      employeeBasis: 'fixed', employeePct: 4, employeeAmount: 25_000,
      employerBasis: 'percent', employerPct: 6, employerAmount: 9_000,
    });
  });

  it('fills the six keys with zeros when only one basis is stated', () => {
    expect(normalizeContributionConfig({ employerBasis: 'fixed', employerAmount: 50_000 })).toEqual({
      employeeBasis: 'percent', employeePct: 0, employeeAmount: 0,
      employerBasis: 'fixed', employerPct: 0, employerAmount: 50_000,
    });
  });

  it('coerces non-finite numerics to 0 instead of leaking NaN into money', () => {
    const c = normalizeContributionConfig({
      employeeBasis: 'percent', employeePct: 'abc',
      employerBasis: 'fixed', employerAmount: undefined,
    });
    expect(c.employeePct).toBe(0);
    expect(c.employerAmount).toBe(0);
    expect(deriveContributionLegs(c, COMP)).toEqual({ employeeLeg: 0, employerLeg: 0 });
  });

  it('degrades an unrecognised basis to percent rather than guessing "fixed"', () => {
    const c = normalizeContributionConfig({ employeeBasis: 'flat', employeePct: 10, employerBasis: 'FIXED' });
    expect(c.employeeBasis).toBe('percent');
    // Case-sensitive on purpose: only the literal 'fixed' selects the fixed basis.
    expect(c.employerBasis).toBe('percent');
  });

  it('normalises a numeric-string percentage the way the form may emit it', () => {
    const c = normalizeContributionConfig({ employeeBasis: 'percent', employeePct: '10' });
    expect(c.employeePct).toBe(10);
    expect(deriveContributionLegs(c, COMP).employeeLeg).toBe(140_000);
  });
});

describe('normalizeContributionConfig — an empty / absent config', () => {
  it('normalises {} to all zeros', () => {
    // How `create_employer` and `approve_access_request` provision a new employer.
    // The old reader turned this into a bogus "Employer-only — UGX 0 per member".
    expect(normalizeContributionConfig({})).toEqual(ZERO_KEYS);
  });

  it('normalises null / undefined to all zeros without throwing', () => {
    expect(normalizeContributionConfig(null)).toEqual(ZERO_KEYS);
    expect(normalizeContributionConfig(undefined)).toEqual(ZERO_KEYS);
    expect(normalizeContributionConfig()).toEqual(ZERO_KEYS);
  });

  it('normalises a config carrying ONLY the insurance keys to all zeros', () => {
    // Group insurance is independent of the pension legs: cover on, pension off.
    expect(normalizeContributionConfig({ insuranceEnabled: true, groupCoverAmount: 5_000_000 }))
      .toEqual(ZERO_KEYS);
  });
});

// =============================================================================
// Legacy back-compat. Existing employers.default_contribution_config rows were NOT
// backfilled, so these are live read paths.
// =============================================================================
describe('normalizeContributionConfig — legacy back-compat', () => {
  it('converts a co-contribution config MONEY-PRESERVINGLY (10% + 50% match → 5% of pay)', () => {
    const legacy = { mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 };
    expect(normalizeContributionConfig(legacy)).toEqual({
      employeeBasis: 'percent', employeePct: 10, employeeAmount: 0,
      employerBasis: 'percent', employerPct: 5, employerAmount: 0,
    });

    // The shillings, not just the shape: the legacy row must post exactly what the
    // deleted formula posted, or a reseed moves every seeded balance.
    const legs = deriveContributionLegs(legacy, COMP);
    const oldEmployeeLeg = Math.round((COMP * 10) / 100);
    const oldEmployerLeg = Math.round((oldEmployeeLeg * 50) / 100);
    expect(legs).toEqual({ employeeLeg: oldEmployeeLeg, employerLeg: oldEmployerLeg });
    expect(legs).toEqual({ employeeLeg: 140_000, employerLeg: 70_000 });
  });

  it('accepts the legacy `matchPct` alias for `employerMatchPct`', () => {
    const c = normalizeContributionConfig({ mode: 'co-contribution', employeePct: 8, matchPct: 25 });
    expect(c.employerPct).toBe(2); // 8 × 25 / 100
    expect(deriveContributionLegs({ mode: 'co-contribution', employeePct: 8, matchPct: 25 }, COMP))
      .toEqual({ employeeLeg: 112_000, employerLeg: 28_000 });
  });

  it('prefers employerMatchPct over matchPct when a row carries both', () => {
    const c = normalizeContributionConfig({
      mode: 'co-contribution', employeePct: 10, employerMatchPct: 50, matchPct: 90,
    });
    expect(c.employerPct).toBe(5);
  });

  it('converts a legacy FIXED employer-only config', () => {
    const legacy = { mode: 'employer-only', employerBasis: 'fixed', employerAmount: 50_000 };
    expect(normalizeContributionConfig(legacy)).toEqual({
      employeeBasis: 'percent', employeePct: 0, employeeAmount: 0,
      employerBasis: 'fixed', employerPct: 0, employerAmount: 50_000,
    });
    expect(deriveContributionLegs(legacy, COMP)).toEqual({ employeeLeg: 0, employerLeg: 50_000 });
  });

  it('converts a legacy PERCENT employer-only config', () => {
    const legacy = { mode: 'employer-only', employerBasis: 'percent', employerPct: 10 };
    expect(normalizeContributionConfig(legacy)).toEqual({
      employeeBasis: 'percent', employeePct: 0, employeeAmount: 0,
      employerBasis: 'percent', employerPct: 10, employerAmount: 0,
    });
    expect(deriveContributionLegs(legacy, COMP)).toEqual({ employeeLeg: 0, employerLeg: 140_000 });
  });

  it('zeroes the employee leg for ANY employer-only row, even one carrying employeePct', () => {
    // A row switched from co-contribution to employer-only keeps its stale
    // employeePct under jsonb MERGE. The mode is authoritative: staff put in nothing.
    const legacy = { mode: 'employer-only', employerBasis: 'percent', employerPct: 10, employeePct: 25 };
    expect(deriveContributionLegs(legacy, COMP)).toEqual({ employeeLeg: 0, employerLeg: 140_000 });
  });

  it('infers fixed from a bare employer-only amount, matching the 0062-era reader', () => {
    // Inference is correct ONLY inside the legacy branch, where it reproduces what
    // the old code did. It is never applied to the unified shape (next block).
    const legacy = { mode: 'employer-only', employerAmount: 50_000 };
    expect(normalizeContributionConfig(legacy).employerBasis).toBe('fixed');
    expect(deriveContributionLegs(legacy, COMP)).toEqual({ employeeLeg: 0, employerLeg: 50_000 });
  });

  it('treats a bare employer-only row with no amount as percent (funding nothing)', () => {
    const c = normalizeContributionConfig({ mode: 'employer-only' });
    expect(c).toEqual(ZERO_KEYS);
  });

  it('ignores an unrecognised mode string and falls through to the zero state', () => {
    expect(normalizeContributionConfig({ mode: 'something-else' })).toEqual(ZERO_KEYS);
  });
});

describe('normalizeContributionConfig — a config with an explicit basis is never re-read as legacy', () => {
  it('never infers a basis from the presence of an amount in the unified shape', () => {
    // The inference that silently flipped percent employers to fixed. A unified
    // config stating percent + carrying a stale employerAmount stays PERCENT.
    const c = normalizeContributionConfig({
      employeeBasis: 'percent', employeePct: 10,
      employerBasis: 'percent', employerPct: 5, employerAmount: 999_999,
    });
    expect(c.employerBasis).toBe('percent');
    expect(deriveContributionLegs(c, COMP)).toEqual({ employeeLeg: 140_000, employerLeg: 70_000 });
  });

  it('never reads employerMatchPct off a config with an explicit basis', () => {
    // A unified row that still carries a legacy match percentage (jsonb MERGE
    // leftovers) must fund 5% of pay, NOT 10% × 50%.
    const c = normalizeContributionConfig({
      employeeBasis: 'percent', employeePct: 10,
      employerBasis: 'percent', employerPct: 5,
      employerMatchPct: 50, matchPct: 90,
    });
    expect(c.employerPct).toBe(5);
  });

  it('the LEGACY branch wins when a row carries BOTH `mode` and a basis', () => {
    // Documented, deliberate precedence: `mode` is tested FIRST. It is never
    // written from 0092 onward, so its presence unambiguously means "this row
    // predates 0092" and any basis beside it is a stale jsonb-MERGE leftover.
    // Detecting the new shape first would read that stale employerPct and silently
    // ignore employerMatchPct — zeroing the employer leg with no error.
    const c = normalizeContributionConfig({
      mode: 'co-contribution', employeePct: 10, employerMatchPct: 50,
      employerBasis: 'fixed', employerAmount: 999_999, // stale, from the previous shape
    });
    expect(c).toEqual({
      employeeBasis: 'percent', employeePct: 10, employeeAmount: 0,
      employerBasis: 'percent', employerPct: 5, employerAmount: 0,
    });
    expect(deriveContributionLegs(c, COMP).employerLeg).toBe(70_000);
  });

  it('an explicit basis is enough on its own — no `mode` needed to select the new path', () => {
    const c = normalizeContributionConfig({ employeeBasis: 'percent', employeePct: 10 });
    expect(c).toMatchObject({ employeeBasis: 'percent', employeePct: 10, employerPct: 0 });
  });
});

// =============================================================================
// isLegZero — judged on the configured RATE, never on the shilling result
// =============================================================================
describe('isLegZero', () => {
  it('reads the percentage for a percent leg and the amount for a fixed leg', () => {
    expect(isLegZero('percent', 0, 50_000)).toBe(true); // the amount is irrelevant
    expect(isLegZero('percent', 10, 0)).toBe(false);
    expect(isLegZero('fixed', 10, 0)).toBe(true); // the percentage is irrelevant
    expect(isLegZero('fixed', 0, 50_000)).toBe(false);
  });

  it('treats a missing / unparseable rate as zero', () => {
    expect(isLegZero('percent', undefined, undefined)).toBe(true);
    expect(isLegZero('fixed', null, 'abc')).toBe(true);
  });

  it('treats a negative rate as zero (nothing is funded)', () => {
    expect(isLegZero('percent', -5, 0)).toBe(true);
    expect(isLegZero('fixed', 0, -1)).toBe(true);
  });

  it('is the right gate for a member whose compensation is not yet recorded', () => {
    // The whole reason callers must judge zero-ness on the RATE: this member's leg
    // computes to 0 shillings today, but the employer HAS configured funding, so
    // the funding surface must still render.
    const config = { employeeBasis: 'percent', employeePct: 10, employerBasis: 'percent', employerPct: 5 };
    const c = normalizeContributionConfig(config);
    expect(deriveContributionLegs(config, 0)).toEqual({ employeeLeg: 0, employerLeg: 0 });
    expect(isLegZero(c.employeeBasis, c.employeePct, c.employeeAmount)).toBe(false);
  });
});

// =============================================================================
// The words. No "co-contribution", no "employer-only", no funding "match".
// =============================================================================
describe('formatLegRate / formatLegRateForMember', () => {
  it('states a percent leg as a share of pay, and the member voice in second person', () => {
    expect(formatLegRate('percent', 10, 0)).toBe('10% of pay');
    expect(formatLegRateForMember('percent', 10, 0)).toBe('10% of your pay');
  });

  it('states a fixed leg as plain shillings, with grouping and no decimals', () => {
    expect(formatLegRate('fixed', 0, 50_000)).toBe('UGX 50,000');
    expect(formatLegRateForMember('fixed', 0, 50_000)).toBe('UGX 50,000');
  });

  it('keeps a fractional percentage readable rather than rounding the rate away', () => {
    expect(formatLegRate('percent', 7.5, 0)).toBe('7.5% of pay');
  });

  it('is compensation-free, so a rate can be shown without disclosing anyone pay', () => {
    // An arity check, deliberately: the property being pinned is that neither
    // function CAN take a compensation argument. That is what lets the employer
    // roster and the member's own page print a rate side by side without either
    // surface leaking a salary. Adding a fourth parameter should fail here.
    expect(formatLegRate).toHaveLength(3);
    expect(formatLegRateForMember).toHaveLength(3);
  });
});

describe('contributionFundingLabel — the employer voice', () => {
  it('both legs → names both concrete figures', () => {
    expect(contributionFundingLabel({
      employeeBasis: 'percent', employeePct: 10,
      employerBasis: 'percent', employerPct: 5,
    })).toBe('Staff put in 10% of pay · You add 5% of pay');
  });

  it('both legs, mixed bases → a share of pay beside a flat amount', () => {
    expect(contributionFundingLabel({
      employeeBasis: 'percent', employeePct: 10,
      employerBasis: 'fixed', employerAmount: 50_000,
    })).toBe('Staff put in 10% of pay · You add UGX 50,000');
  });

  it('staff only → says the company adds nothing, out loud', () => {
    expect(contributionFundingLabel({
      employeeBasis: 'percent', employeePct: 10,
      employerBasis: 'percent', employerPct: 0,
    })).toBe('Staff put in 10% of pay · You add nothing');
  });

  it('company only → leads with the company figure', () => {
    expect(contributionFundingLabel({
      employeeBasis: 'percent', employeePct: 0,
      employerBasis: 'fixed', employerAmount: 50_000,
    })).toBe('You fund UGX 50,000 · Staff put in nothing');
  });

  it('neither → "No contributions set up yet"', () => {
    expect(contributionFundingLabel(ZERO_KEYS)).toBe('No contributions set up yet');
    // The same string for a brand-new employer provisioned with `{}`, replacing the
    // old "Company funding: not set" / bogus "UGX 0 per member / month".
    expect(contributionFundingLabel({})).toBe('No contributions set up yet');
    expect(contributionFundingLabel(null)).toBe('No contributions set up yet');
  });

  it('describes a LEGACY config in the new vocabulary', () => {
    expect(contributionFundingLabel({ mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 }))
      .toBe('Staff put in 10% of pay · You add 5% of pay');
    expect(contributionFundingLabel({ mode: 'employer-only', employerBasis: 'fixed', employerAmount: 50_000 }))
      .toBe('You fund UGX 50,000 · Staff put in nothing');
  });

  it('never emits the deleted vocabulary, for any input', () => {
    const configs = [
      { employeeBasis: 'percent', employeePct: 10, employerBasis: 'percent', employerPct: 5 },
      { employeeBasis: 'percent', employeePct: 10, employerBasis: 'fixed', employerAmount: 50_000 },
      { employeeBasis: 'fixed', employeeAmount: 20_000, employerBasis: 'percent', employerPct: 5 },
      { employeeBasis: 'percent', employeePct: 10 },
      { employerBasis: 'fixed', employerAmount: 50_000 },
      {},
      { mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 },
      { mode: 'employer-only', employerAmount: 50_000 },
    ];
    for (const config of configs) {
      const label = contributionFundingLabel(config);
      expect(label).not.toMatch(/co-contribution/i);
      expect(label).not.toMatch(/employer-only/i);
      expect(label).not.toMatch(/match/i);
      expect(label).not.toMatch(/mode/i);
    }
  });
});

describe('memberFundingSummary — the member voice', () => {
  const BOTH = { employeeBasis: 'percent', employeePct: 10, employerBasis: 'percent', employerPct: 5 };

  it('both legs → both figures, naming the employer', () => {
    expect(memberFundingSummary(BOTH, 'Nile Breweries Ltd'))
      .toBe('10% of your pay, plus 5% of your pay from Nile Breweries Ltd');
  });

  it('staff only → the employer sends the member own payroll deduction', () => {
    expect(memberFundingSummary({ ...BOTH, employerPct: 0 }, 'Nile Breweries Ltd'))
      .toBe('Nile Breweries Ltd sends 10% of your pay to your pension each month');
  });

  it('company only → says plainly that it costs the member nothing', () => {
    expect(memberFundingSummary({ ...BOTH, employeePct: 0 }, 'Nile Breweries Ltd'))
      .toBe('Nile Breweries Ltd pays your whole pension — 5% of your pay, at no cost to you');
  });

  it('neither → NULL, the app-wide "hide the funding surface" signal', () => {
    // Not an empty string and not a "nothing set up" sentence: a member must never
    // be shown their employer's unfinished configuration.
    expect(memberFundingSummary(ZERO_KEYS, 'Nile Breweries Ltd')).toBeNull();
    expect(memberFundingSummary({}, 'Nile Breweries Ltd')).toBeNull();
    expect(memberFundingSummary(null, 'Nile Breweries Ltd')).toBeNull();
    expect(memberFundingSummary({ insuranceEnabled: true }, 'Nile Breweries Ltd')).toBeNull();
  });

  it('falls back to "your employer" when the name is missing', () => {
    for (const name of [undefined, null, '']) {
      expect(memberFundingSummary({ ...BOTH, employeePct: 0 }, name))
        .toBe('your employer pays your whole pension — 5% of your pay, at no cost to you');
    }
    expect(memberFundingSummary(BOTH, undefined))
      .toBe('10% of your pay, plus 5% of your pay from your employer');
  });

  it('reads a fixed leg as shillings, in the member voice', () => {
    expect(memberFundingSummary({
      employeeBasis: 'fixed', employeeAmount: 20_000,
      employerBasis: 'fixed', employerAmount: 50_000,
    }, 'Acme Ltd')).toBe('UGX 20,000, plus UGX 50,000 from Acme Ltd');
  });

  it('describes a LEGACY config in the new vocabulary', () => {
    expect(memberFundingSummary({ mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 }, 'Acme Ltd'))
      .toBe('10% of your pay, plus 5% of your pay from Acme Ltd');
  });

  it('never emits the deleted vocabulary, for any input', () => {
    const configs = [
      BOTH,
      { ...BOTH, employeePct: 0 },
      { ...BOTH, employerPct: 0 },
      { employeeBasis: 'fixed', employeeAmount: 20_000, employerBasis: 'percent', employerPct: 5 },
      { mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 },
      { mode: 'employer-only', employerAmount: 50_000 },
    ];
    for (const config of configs) {
      const summary = memberFundingSummary(config, 'Acme Ltd');
      expect(summary).not.toBeNull();
      expect(summary).not.toMatch(/co-contribution/i);
      expect(summary).not.toMatch(/employer-only/i);
      expect(summary).not.toMatch(/match/i);
    }
  });
});

// =============================================================================
// Cross-function coherence — the labels and the money must always agree
// =============================================================================
describe('the label and the money never disagree', () => {
  const CASES = [
    { name: 'both percent', config: { employeeBasis: 'percent', employeePct: 10, employerBasis: 'percent', employerPct: 5 } },
    { name: 'both fixed', config: { employeeBasis: 'fixed', employeeAmount: 20_000, employerBasis: 'fixed', employerAmount: 50_000 } },
    { name: 'mixed', config: { employeeBasis: 'percent', employeePct: 10, employerBasis: 'fixed', employerAmount: 50_000 } },
    { name: 'staff only', config: { employeeBasis: 'percent', employeePct: 10, employerBasis: 'percent', employerPct: 0 } },
    { name: 'company only', config: { employeeBasis: 'percent', employeePct: 0, employerBasis: 'fixed', employerAmount: 50_000 } },
    { name: '0/0', config: {} },
    { name: 'legacy co-contribution', config: { mode: 'co-contribution', employeePct: 10, employerMatchPct: 50 } },
    { name: 'legacy employer-only', config: { mode: 'employer-only', employerAmount: 50_000 } },
  ];

  it.each(CASES)('$name: a leg reported non-zero funds real money at real pay', ({ config }) => {
    const c = normalizeContributionConfig(config);
    const { employeeLeg, employerLeg } = deriveContributionLegs(config, COMP);
    // isLegZero is the gate every surface uses to decide whether to show a leg. At
    // a positive compensation it must never disagree with the shillings, or a tile
    // renders "UGX 0" (or a funded leg is hidden).
    expect(isLegZero(c.employeeBasis, c.employeePct, c.employeeAmount)).toBe(employeeLeg === 0);
    expect(isLegZero(c.employerBasis, c.employerPct, c.employerAmount)).toBe(employerLeg === 0);
    // memberFundingSummary returns null exactly when nothing is funded.
    const funded = employeeLeg > 0 || employerLeg > 0;
    expect(memberFundingSummary(config, 'Acme Ltd') !== null).toBe(funded);
    expect(contributionFundingLabel(config) === 'No contributions set up yet').toBe(!funded);
  });

  it('normalizing is idempotent — a normalized config re-normalizes unchanged', () => {
    // Load-bearing because the settings form normalizes on seed and writes the
    // result back, and the SQL twin normalizes it again on read.
    for (const { config } of CASES) {
      const once = normalizeContributionConfig(config);
      expect(normalizeContributionConfig(once)).toEqual(once);
      // …and the money survives the round trip.
      expect(deriveContributionLegs(once, COMP)).toEqual(deriveContributionLegs(config, COMP));
    }
  });
});
