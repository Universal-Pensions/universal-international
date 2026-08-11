// Guardrail: the per-product insurance cover ladders.
//
// These tables are the ONLY pricing authority in the system — the RPCs
// (`create_subscriber_from_signup` → `_insert_subscriber_chain`,
// `fund_insurance_products`) store whatever cover/premium the client sends and
// validate nothing beyond `>= 0` and the product enum. So the invariants that
// would normally live in a CHECK constraint live here instead.
//
// Two of these assertions are load-bearing beyond tidiness:
//   • life's ladder must stay byte-identical to the private COVER_TIERS table
//     that used to live in InsurancePage.jsx, or the settings cover slider
//     silently reprices every existing member's upgrade path;
//   • INSURANCE_PREMIUM_MONTHLY / INSURANCE_COVER must stay 2,000 / 1,000,000,
//     because utils/groupInsurance.js divides one by the other to derive the
//     employer group rate — moving either reprices group cover for every
//     covered employee on every roster.

import { describe, it, expect } from 'vitest';
import {
  INSURANCE_PRODUCTS,
  INSURANCE_PREMIUM_MONTHLY,
  INSURANCE_COVER,
  HOSPITAL_CASH_DAYS,
  dailyBenefit,
  annualPremium,
  insuranceProduct,
  coverTiers,
  defaultTier,
  coverTierAt,
  tierForCover,
} from '../savings';

/** The exact table deleted from subscriber-dashboard/pages/InsurancePage.jsx. */
const LEGACY_COVER_TIERS = [
  { cover: 1_000_000, premiumMonthly: 2_000 },
  { cover: 2_000_000, premiumMonthly: 3_500 },
  { cover: 3_000_000, premiumMonthly: 5_000 },
  { cover: 5_000_000, premiumMonthly: 7_500 },
];

const PRODUCT_IDS = ['life', 'health', 'funeral'];

describe('cover ladders', () => {
  it('gives every product a 4-tier ladder', () => {
    for (const id of PRODUCT_IDS) {
      expect(coverTiers(id)).toHaveLength(4);
    }
  });

  it("reproduces InsurancePage's retired COVER_TIERS for life, exactly", () => {
    expect(coverTiers('life')).toEqual(LEGACY_COVER_TIERS);
  });

  it('keeps health and funeral entry cover at their pre-ladder fixed values', () => {
    expect(coverTiers('health')[0]).toEqual({ cover: 3_000_000, premiumMonthly: 5_000 });
    expect(coverTiers('funeral')[0]).toEqual({ cover: 2_000_000, premiumMonthly: 1_500 });
  });

  it("exposes each product's tier 0 as its bare cover/premiumMonthly (back-compat)", () => {
    // Callers that never opted into the ladder (utils/policies.js,
    // utils/periodSettlement.js, group pricing) read these two fields directly.
    for (const product of INSURANCE_PRODUCTS) {
      const tier0 = coverTiers(product.id)[0];
      expect(product.cover).toBe(tier0.cover);
      expect(product.premiumMonthly).toBe(tier0.premiumMonthly);
    }
  });

  it('pins the group-insurance rate denominator', () => {
    expect(INSURANCE_PREMIUM_MONTHLY).toBe(2_000);
    expect(INSURANCE_COVER).toBe(1_000_000);
  });

  it('rises strictly in both cover and premium', () => {
    for (const id of PRODUCT_IDS) {
      const tiers = coverTiers(id);
      for (let i = 1; i < tiers.length; i += 1) {
        expect(tiers[i].cover).toBeGreaterThan(tiers[i - 1].cover);
        expect(tiers[i].premiumMonthly).toBeGreaterThan(tiers[i - 1].premiumMonthly);
      }
    }
  });

  it('gets strictly cheaper per shilling of cover as cover rises', () => {
    // The volume-discount promise the UI makes implicitly by showing a ladder.
    for (const id of PRODUCT_IDS) {
      const rates = coverTiers(id).map((t) => t.premiumMonthly / t.cover);
      for (let i = 1; i < rates.length; i += 1) {
        expect(rates[i]).toBeLessThan(rates[i - 1]);
      }
    }
  });

  it('prices every tier annually', () => {
    for (const id of PRODUCT_IDS) {
      for (const tier of coverTiers(id)) {
        expect(annualPremium(tier)).toBe(tier.premiumMonthly * 12);
      }
    }
  });

  it('returns an empty ladder for an unknown product', () => {
    expect(coverTiers('motor')).toEqual([]);
    expect(insuranceProduct('motor')).toBeNull();
    expect(defaultTier('motor')).toBeNull();
    expect(coverTierAt('motor', 0)).toBeNull();
    expect(tierForCover('motor', 1_000_000)).toBeNull();
  });
});

describe('tierForCover', () => {
  it('matches an on-ladder cover exactly', () => {
    expect(tierForCover('life', 3_000_000)).toEqual({
      cover: 3_000_000, premiumMonthly: 5_000, index: 2, exact: true,
    });
    expect(tierForCover('health', 12_000_000).index).toBe(3);
    expect(tierForCover('funeral', 2_000_000).index).toBe(0);
  });

  it('snaps an off-ladder cover DOWN to the nearest tier, not to tier 0', () => {
    // The old InsurancePage used `findIndex(t => t.cover === cover)` and fell
    // back to index 0, so a member on 4M was offered a "downgrade" to 1M.
    const tier = tierForCover('life', 4_000_000);
    expect(tier.index).toBe(2);
    expect(tier.cover).toBe(3_000_000);
    expect(tier.exact).toBe(false);
  });

  it('snaps a cover above the top tier down to the top tier', () => {
    expect(tierForCover('life', 50_000_000).index).toBe(3);
  });

  it('falls back to tier 0 for zero, missing, or unparseable cover', () => {
    // This is the fallback both payload builders rely on for legacy drafts.
    for (const value of [0, undefined, null, NaN, 'nonsense', 500_000]) {
      expect(tierForCover('life', value).index).toBe(0);
    }
  });
});

describe('dailyBenefit (hospital cash)', () => {
  it('splits hospital-cash cover evenly across the benefit days', () => {
    // The member is paid per NIGHT, so cover ÷ 20 is the number that matters.
    expect(dailyBenefit('health', 3_000_000)).toBe(150_000);
    expect(dailyBenefit('health', 5_000_000)).toBe(250_000);
    expect(dailyBenefit('health', 8_000_000)).toBe(400_000);
    expect(dailyBenefit('health', 12_000_000)).toBe(600_000);
  });

  it('divides every hospital-cash tier into a whole daily amount', () => {
    // A tier that didn't divide evenly would show a rounded daily figure that
    // doesn't multiply back to the advertised cover.
    for (const tier of coverTiers('health')) {
      expect(dailyBenefit('health', tier.cover) * HOSPITAL_CASH_DAYS).toBe(tier.cover);
    }
  });

  it('returns null for lump-sum products so the daily line is not rendered', () => {
    expect(dailyBenefit('life', 5_000_000)).toBeNull();
    expect(dailyBenefit('funeral', 8_000_000)).toBeNull();
    expect(dailyBenefit('motor', 1_000_000)).toBeNull();
  });

  it('handles a missing or unparseable cover without NaN', () => {
    expect(dailyBenefit('health', 0)).toBe(0);
    expect(dailyBenefit('health', undefined)).toBe(0);
    expect(dailyBenefit('health', 'nonsense')).toBe(0);
  });
});

describe('defaultTier / coverTierAt', () => {
  it('defaults to the entry tier', () => {
    expect(defaultTier('life')).toEqual({ cover: 1_000_000, premiumMonthly: 2_000, index: 0 });
    expect(defaultTier('health').cover).toBe(3_000_000);
  });

  it('clamps an out-of-range index instead of returning undefined', () => {
    expect(coverTierAt('life', -5).index).toBe(0);
    expect(coverTierAt('life', 99).index).toBe(3);
    expect(coverTierAt('life', 1)).toEqual({ cover: 2_000_000, premiumMonthly: 3_500, index: 1 });
  });
});
