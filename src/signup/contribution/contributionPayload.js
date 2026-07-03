// Pure payload builder for the self-signup write (create_subscriber_from_signup).
//
// Kept in its own module (not ContributionRoute.jsx) so the component file only
// exports a component — exporting a helper alongside it trips react-refresh —
// and so the merge-of-payment-and-contribution logic is unit-testable (mirrors
// the agent-side onboardPayload.js, which is likewise extracted + tested).

import { normalizeFrequency } from '../../utils/finance';
import { INSURANCE_PRODUCTS, INSURANCE_PREMIUM_MONTHLY, INSURANCE_COVER } from '../../constants/savings';

/**
 * Build the payload `create_subscriber_from_signup` expects from the
 * SignupContext snapshot + the schedule the user just confirmed. The RPC is
 * forgiving about missing optional fields (it defaults paymentMethod,
 * includeInsurance, etc.) but the required fields must be present.
 *
 * Multi-product insurance mirrors the agent onboarding split (onboardPayload.js):
 * life → `insurancePolicy`, health/funeral → `insuranceProducts[]`. The shared
 * `_insert_subscriber_chain` (migration 0065) routes `insuranceProducts` into
 * `subscriber_insurance_products`. Legacy single-toggle schedules (no
 * `insuranceTypes`) fall back to the old `includeInsurance` → life-only behaviour.
 *
 * @param {object} signup   - SignupContext snapshot
 * @param {object} schedule - the confirmed contribution schedule
 * @param {string} phone    - canonicalised UG phone
 */
export function buildContributionPayload(signup, schedule, phone) {
  const types = Array.isArray(schedule.insuranceTypes) ? schedule.insuranceTypes : null;
  const wantsLife = types ? types.includes('life') : (schedule.includeInsurance ?? false);
  const includeInsurance = types ? types.length > 0 : (schedule.includeInsurance ?? false);
  const insurancePremium = schedule.insurancePremium ?? 0;
  const insurancePolicy = wantsLife
    ? { cover: INSURANCE_COVER, premiumMonthly: INSURANCE_PREMIUM_MONTHLY }
    : null;
  const insuranceProducts = (types ?? [])
    .filter((id) => id === 'health' || id === 'funeral')
    .map((id) => {
      const product = INSURANCE_PRODUCTS.find((p) => p.id === id);
      return { product: id, cover: product?.cover ?? 0, premiumMonthly: product?.premiumMonthly ?? 0 };
    });
  return {
    phone,
    fullName: signup.fullName,
    dob: signup.dob,
    gender: signup.gender,
    nin: signup.nin,
    email: signup.email?.trim() ? signup.email.trim() : null,
    occupation: signup.occupation || null,
    districtId: signup.districtId,
    consent: !!signup.consent,
    consentTimestamp: signup.consentTimestamp,
    contributionSchedule: {
      frequency: normalizeFrequency(schedule.frequency),
      amount: schedule.amount,
      retirementPct: schedule.retirementPct,
      emergencyPct: schedule.emergencyPct,
      includeInsurance,
      insurancePremium,
      insuranceCover: wantsLife ? INSURANCE_COVER : 0,
    },
    pensionBeneficiaries: signup.pensionBeneficiaries ?? [],
    insuranceBeneficiaries: signup.insuranceBeneficiaries ?? [],
    insuranceSameAsPension: !!signup.insuranceSameAsPension,
    insuranceChoiceMade: !!signup.insuranceChoiceMade,
    paymentMethod: schedule.paymentMethod,
    ...(insurancePolicy ? { insurancePolicy } : {}),
    ...(insuranceProducts.length ? { insuranceProducts } : {}),
  };
}
