// OnboardingComplete.buildPayload — agent-onboard insurance persistence.
//
// The agent onboarding wizard now renders the SAME ContributionSettings the
// subscriber sees at /signup/contribution, which emits `insuranceTypes` (an array
// of 'life'|'health'|'funeral') plus the legacy `includeInsurance` boolean.
// buildPayload splits it into `insurancePolicy` (life → insurance_policies) and
// `insuranceProducts` (health/funeral → subscriber_insurance_products), deriving
// covers/premiums from the savings constants. A schedule with no insuranceTypes
// but includeInsurance=true falls back to life-only (legacy behaviour).

import { describe, it, expect } from 'vitest';
import { buildPayload } from './onboardPayload';
import { INSURANCE_COVER, INSURANCE_PREMIUM_MONTHLY, INSURANCE_PRODUCTS } from '../../constants/savings';

const health = INSURANCE_PRODUCTS.find((p) => p.id === 'health');
const funeral = INSURANCE_PRODUCTS.find((p) => p.id === 'funeral');

const base = {
  phone: '+256711000001',
  fullName: 'Asha Nam; ',
  dob: '1990-01-01',
  gender: 'female',
  nin: 'CM123',
  email: '',
  occupation: '',
  districtId: 'd-1',
  consent: true,
  consentTimestamp: '2026-06-05T00:00:00Z',
  pensionBeneficiaries: [],
  insuranceBeneficiaries: [],
  insuranceSameAsPension: true,
  insuranceChoiceMade: true,
};

describe('OnboardingComplete.buildPayload', () => {
  // ── Legacy boolean path (no insuranceTypes emitted) ───────────────────────
  it('emits insurancePolicy from the savings constants when includeInsurance is true', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: {
        frequency: 'monthly', amount: 50000, retirementPct: 80, emergencyPct: 20,
        includeInsurance: true,
      },
    });
    expect(payload.insurancePolicy).toEqual({
      cover: INSURANCE_COVER,
      premiumMonthly: INSURANCE_PREMIUM_MONTHLY,
    });
    expect(payload).not.toHaveProperty('insuranceProducts');
    expect(payload.contributionSchedule.includeInsurance).toBe(true);
  });

  it('omits insurancePolicy when insurance was declined', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: { frequency: 'monthly', amount: 50000, includeInsurance: false },
    });
    expect(payload).not.toHaveProperty('insurancePolicy');
    expect(payload).not.toHaveProperty('insuranceProducts');
  });

  it('omits insurancePolicy when there is no schedule', () => {
    const payload = buildPayload({ ...base, contributionSchedule: null });
    expect(payload).not.toHaveProperty('insurancePolicy');
    expect(payload).not.toHaveProperty('insuranceProducts');
  });

  // ── Multi-product path (insuranceTypes emitted by the form) ───────────────
  it('emits both insurancePolicy (life) and insuranceProducts (health) for ["life","health"]', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: {
        frequency: 'monthly', amount: 50000, retirementPct: 80, emergencyPct: 20,
        includeInsurance: true, insuranceTypes: ['life', 'health'],
      },
    });
    expect(payload.insurancePolicy).toEqual({
      cover: INSURANCE_COVER,
      premiumMonthly: INSURANCE_PREMIUM_MONTHLY,
    });
    expect(payload.insuranceProducts).toEqual([
      { product: 'health', cover: health.cover, premiumMonthly: health.premiumMonthly },
    ]);
  });

  it('omits insurancePolicy but emits both products for ["health","funeral"] (no life)', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: {
        frequency: 'monthly', amount: 50000, retirementPct: 80, emergencyPct: 20,
        includeInsurance: true, insuranceTypes: ['health', 'funeral'],
      },
    });
    expect(payload).not.toHaveProperty('insurancePolicy');
    expect(payload.insuranceProducts).toEqual([
      { product: 'health', cover: health.cover, premiumMonthly: health.premiumMonthly },
      { product: 'funeral', cover: funeral.cover, premiumMonthly: funeral.premiumMonthly },
    ]);
    expect(payload.contributionSchedule.includeInsurance).toBe(true);
  });

  it('emits only insurancePolicy for ["life"] and no insuranceProducts', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: {
        frequency: 'monthly', amount: 50000, includeInsurance: true, insuranceTypes: ['life'],
      },
    });
    expect(payload.insurancePolicy).toBeTruthy();
    expect(payload).not.toHaveProperty('insuranceProducts');
  });

  it('treats an empty insuranceTypes array as no insurance', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: {
        frequency: 'monthly', amount: 50000, includeInsurance: false, insuranceTypes: [],
      },
    });
    expect(payload).not.toHaveProperty('insurancePolicy');
    expect(payload).not.toHaveProperty('insuranceProducts');
    expect(payload.contributionSchedule.includeInsurance).toBe(false);
  });

  // ── Fields only the shared ContributionSettings emits ─────────────────────
  // buildPayload has always READ paymentMethod + insuranceSavingsPct, but the old
  // agent-only form emitted neither, so they silently fell through to defaults on
  // every agent-onboarded subscriber. Sharing the signup component fixed that;
  // these cases pin it so a future form swap can't regress it unnoticed.
  it('forwards the chosen paymentMethod (0072 stamps it on the first contribution)', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: {
        frequency: 'monthly', amount: 50000, retirementPct: 80, emergencyPct: 20,
        includeInsurance: false, insuranceTypes: [], paymentMethod: 'momo',
      },
    });
    expect(payload.paymentMethod).toBe('momo');
  });

  it('forwards the save-to-cover trio (funding mode, annual target, savings split)', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: {
        frequency: 'monthly', amount: 50000, retirementPct: 80, emergencyPct: 20,
        includeInsurance: true, insuranceTypes: ['health'],
        insuranceFundingMode: 'save_to_cover',
        insurancePremiumTarget: health.premiumMonthly * 12,
        insuranceSavingsPct: 50,
        contributionIndexationPct: 5,
      },
    });
    expect(payload.contributionSchedule).toMatchObject({
      insuranceFundingMode: 'save_to_cover',
      insurancePremiumTarget: health.premiumMonthly * 12,
      insuranceSavingsPct: 50,
      contributionIndexationPct: 5,
    });
  });

  it('still defaults the save-to-cover trio when a schedule omits them', () => {
    const payload = buildPayload({
      ...base,
      contributionSchedule: { frequency: 'monthly', amount: 50000, includeInsurance: false },
    });
    expect(payload.contributionSchedule).toMatchObject({
      insuranceFundingMode: 'pay_now',
      insurancePremiumTarget: 0,
      insuranceSavingsPct: 100,
      contributionIndexationPct: 0,
    });
  });
});
