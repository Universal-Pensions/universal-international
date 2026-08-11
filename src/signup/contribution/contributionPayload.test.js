// buildContributionPayload — self-signup insurance persistence + payment merge.
//
// Mirrors the agent-side onboardPayload split: the schedule form emits
// `insuranceTypes` (['life'|'health'|'funeral']) plus the legacy
// `includeInsurance` boolean; the builder routes life → `insurancePolicy`
// (insurance_policies) and health/funeral → `insuranceProducts`
// (subscriber_insurance_products), deriving covers/premiums from the savings
// constants. A schedule with no insuranceTypes but includeInsurance=true falls
// back to life-only.

import { describe, it, expect } from 'vitest';
import { buildContributionPayload } from './contributionPayload';
import { INSURANCE_COVER, INSURANCE_PREMIUM_MONTHLY, INSURANCE_PRODUCTS } from '../../constants/savings';

const health = INSURANCE_PRODUCTS.find((p) => p.id === 'health');
const funeral = INSURANCE_PRODUCTS.find((p) => p.id === 'funeral');

const signup = {
  fullName: 'Asha Namubiru',
  dob: '1990-01-01',
  gender: 'female',
  nin: 'CM123',
  email: '  asha@example.com  ',
  occupation: 'Trader',
  districtId: 'd-1',
  consent: true,
  consentTimestamp: '2026-06-05T00:00:00Z',
  pensionBeneficiaries: [{ name: 'K', share: 100 }],
  insuranceBeneficiaries: [],
  insuranceSameAsPension: true,
  insuranceChoiceMade: true,
};

const sched = (extra) => ({
  frequency: 'monthly', amount: 50000, retirementPct: 80, emergencyPct: 20,
  paymentMethod: 'momo', ...extra,
});

describe('buildContributionPayload', () => {
  it('carries the canonical phone + trims the email', () => {
    const p = buildContributionPayload(signup, sched({}), '+256711000001');
    expect(p.phone).toBe('+256711000001');
    expect(p.email).toBe('asha@example.com');
    expect(p.paymentMethod).toBe('momo');
    expect(p.contributionSchedule.amount).toBe(50000);
  });

  it('nulls an empty/whitespace email + occupation', () => {
    const p = buildContributionPayload({ ...signup, email: '   ', occupation: '' }, sched({}), '+256711000002');
    expect(p.email).toBeNull();
    expect(p.occupation).toBeNull();
  });

  // ── Legacy boolean path (no insuranceTypes) ───────────────────────────────
  it('emits insurancePolicy from constants when includeInsurance is true', () => {
    const p = buildContributionPayload(signup, sched({ includeInsurance: true }), '+256711000001');
    expect(p.insurancePolicy).toEqual({ cover: INSURANCE_COVER, premiumMonthly: INSURANCE_PREMIUM_MONTHLY });
    expect(p).not.toHaveProperty('insuranceProducts');
    expect(p.contributionSchedule.includeInsurance).toBe(true);
    expect(p.contributionSchedule.insuranceCover).toBe(INSURANCE_COVER);
  });

  it('omits insurance when declined', () => {
    const p = buildContributionPayload(signup, sched({ includeInsurance: false }), '+256711000001');
    expect(p).not.toHaveProperty('insurancePolicy');
    expect(p).not.toHaveProperty('insuranceProducts');
    expect(p.contributionSchedule.insuranceCover).toBe(0);
  });

  // ── Multi-product path ────────────────────────────────────────────────────
  it('splits ["life","health"] into insurancePolicy + insuranceProducts', () => {
    const p = buildContributionPayload(signup, sched({ includeInsurance: true, insuranceTypes: ['life', 'health'] }), '+256711000001');
    expect(p.insurancePolicy).toEqual({ cover: INSURANCE_COVER, premiumMonthly: INSURANCE_PREMIUM_MONTHLY });
    expect(p.insuranceProducts).toEqual([
      { product: 'health', cover: health.cover, premiumMonthly: health.premiumMonthly },
    ]);
  });

  it('omits insurancePolicy but emits products for ["health","funeral"] (no life)', () => {
    const p = buildContributionPayload(signup, sched({ includeInsurance: true, insuranceTypes: ['health', 'funeral'] }), '+256711000001');
    expect(p).not.toHaveProperty('insurancePolicy');
    expect(p.insuranceProducts).toEqual([
      { product: 'health', cover: health.cover, premiumMonthly: health.premiumMonthly },
      { product: 'funeral', cover: funeral.cover, premiumMonthly: funeral.premiumMonthly },
    ]);
    expect(p.contributionSchedule.includeInsurance).toBe(true);
  });

  it('treats an empty insuranceTypes array as no insurance', () => {
    const p = buildContributionPayload(signup, sched({ includeInsurance: false, insuranceTypes: [] }), '+256711000001');
    expect(p).not.toHaveProperty('insurancePolicy');
    expect(p).not.toHaveProperty('insuranceProducts');
    expect(p.contributionSchedule.includeInsurance).toBe(false);
  });

  it('passes the insurancePremium through onto the schedule', () => {
    const p = buildContributionPayload(signup, sched({ includeInsurance: true, insuranceTypes: ['life'], insurancePremium: 2000 }), '+256711000001');
    expect(p.contributionSchedule.insurancePremium).toBe(2000);
  });

  // ── Per-product cover amounts ─────────────────────────────────────────────
  // Every case above omits `insuranceCovers`, so they double as the proof that a
  // schedule written before per-product cover existed still produces the old
  // entry-tier payload byte for byte.
  it('carries the chosen cover tier into insurancePolicy + insuranceProducts', () => {
    const p = buildContributionPayload(signup, sched({
      includeInsurance: true,
      insuranceTypes: ['life', 'health'],
      insuranceCovers: { life: 5_000_000, health: 8_000_000 },
    }), '+256711000001');
    expect(p.insurancePolicy).toEqual({ cover: 5_000_000, premiumMonthly: 7_500 });
    expect(p.insuranceProducts).toEqual([
      { product: 'health', cover: 8_000_000, premiumMonthly: 11_000 },
    ]);
  });

  it('prefers the wizard-resolved insuranceSelections over the cover map', () => {
    // insuranceSelections is what the summary card and the pay total were
    // computed from, so it wins when both are present.
    const p = buildContributionPayload(signup, sched({
      includeInsurance: true,
      insuranceTypes: ['life'],
      insuranceCovers: { life: 1_000_000 },
      insuranceSelections: [{ product: 'life', cover: 3_000_000, premiumMonthly: 5_000 }],
    }), '+256711000001');
    expect(p.insurancePolicy).toEqual({ cover: 3_000_000, premiumMonthly: 5_000 });
  });

  it('re-derives the premium from the ladder rather than trusting the snapshot', () => {
    // A hand-edited or stale localStorage draft must not be able to pair a high
    // cover with a cheap premium — no RPC validates the two against each other.
    const p = buildContributionPayload(signup, sched({
      includeInsurance: true,
      insuranceTypes: ['life'],
      insuranceSelections: [{ product: 'life', cover: 5_000_000, premiumMonthly: 1 }],
    }), '+256711000001');
    expect(p.insurancePolicy).toEqual({ cover: 5_000_000, premiumMonthly: 7_500 });
  });

  it('snaps an off-ladder cover down to the nearest tier', () => {
    const p = buildContributionPayload(signup, sched({
      includeInsurance: true,
      insuranceTypes: ['life'],
      insuranceCovers: { life: 4_000_000 },
    }), '+256711000001');
    expect(p.insurancePolicy).toEqual({ cover: 3_000_000, premiumMonthly: 5_000 });
  });

  it('keeps the legacy insuranceCover key in step with the real life row', () => {
    const p = buildContributionPayload(signup, sched({
      includeInsurance: true,
      insuranceTypes: ['life'],
      insuranceCovers: { life: 5_000_000 },
    }), '+256711000001');
    expect(p.contributionSchedule.insuranceCover).toBe(5_000_000);
  });
});
