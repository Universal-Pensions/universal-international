// Pure payload builder for the agent-onboard write (create_subscriber_from_agent_onboard).
//
// Kept in its own module (not OnboardingComplete.jsx) so the component file only
// exports a component — exporting a helper alongside it trips react-refresh.

import { toCanonicalUGPhone } from '../../utils/phone';
import { normalizeFrequency } from '../../utils/finance';
import { INSURANCE_PRODUCTS, INSURANCE_COVER, INSURANCE_PREMIUM_MONTHLY } from '../../constants/savings';

/**
 * Build the payload `create_subscriber_from_agent_onboard` expects from the
 * SignupContext snapshot + the collected contribution schedule. Same shape as the
 * self-signup path — the RPC distinguishes by validating `calling_agent_id`
 * against the auth JWT. The schedule now comes from the SAME
 * `signup/contribution/ContributionSettings` wizard the subscriber uses, so
 * `paymentMethod` and `insuranceSavingsPct` below finally carry real values (the
 * retired agent-only form emitted neither, and both silently defaulted).
 *
 * Insurance is multi-product: the wizard emits `insuranceTypes` (an array of
 * 'life' | 'health' | 'funeral'). We split it for the signup chain
 * (`_insert_subscriber_chain`, migration 0065):
 *   - life            → `insurancePolicy` (life row in `insurance_policies`).
 *   - health/funeral  → `insuranceProducts` (rows in `subscriber_insurance_products`).
 * Covers/premiums come from `INSURANCE_PRODUCTS` (the form emits ids only).
 * Legacy fallback: a schedule with no `insuranceTypes` but `includeInsurance`
 * true is treated as life-only (preserves the pre-multi-product behaviour).
 */
export function buildPayload(signup) {
  const schedule = signup.contributionSchedule || {};
  const types = Array.isArray(schedule.insuranceTypes) ? schedule.insuranceTypes : null;
  // Any insurance chosen — drives the schedule's legacy include_insurance flag.
  const includeInsurance = types ? types.length > 0 : (schedule.includeInsurance ?? false);

  // Life → insurancePolicy (unchanged contract). Honour insuranceTypes when the
  // form emitted it; otherwise the legacy boolean means life-only.
  const wantsLife = types ? types.includes('life') : includeInsurance;
  const insurancePolicy = wantsLife
    ? { cover: INSURANCE_COVER, premiumMonthly: INSURANCE_PREMIUM_MONTHLY }
    : null;

  // Health/funeral → insuranceProducts array (life never lands here — it belongs
  // in insurance_policies). cover/premium sourced from INSURANCE_PRODUCTS.
  const insuranceProducts = (types ?? [])
    .filter((id) => id === 'health' || id === 'funeral')
    .map((id) => {
      const product = INSURANCE_PRODUCTS.find((p) => p.id === id);
      return { product: id, cover: product?.cover ?? 0, premiumMonthly: product?.premiumMonthly ?? 0 };
    });

  return {
    phone: toCanonicalUGPhone(signup.phone) || signup.phone,
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
      // save-to-cover + indexation (migration 0072). Agent flow supports both
      // routes: 'pay_now' (agent collects the annual premium) | 'save_to_cover'.
      insuranceFundingMode: schedule.insuranceFundingMode ?? 'pay_now',
      insurancePremiumTarget: schedule.insurancePremiumTarget ?? 0,
      insuranceSavingsPct: schedule.insuranceSavingsPct ?? 100,
      contributionIndexationPct: schedule.contributionIndexationPct ?? 0,
    },
    pensionBeneficiaries: signup.pensionBeneficiaries ?? [],
    insuranceBeneficiaries: signup.insuranceBeneficiaries ?? [],
    insuranceSameAsPension: !!signup.insuranceSameAsPension,
    insuranceChoiceMade: !!signup.insuranceChoiceMade,
    paymentMethod: schedule.paymentMethod,
    // Life policy (0065 _insert_subscriber_chain reads payload.insurancePolicy).
    // Omitted when life wasn't selected.
    ...(insurancePolicy ? { insurancePolicy } : {}),
    // Extra products (0065 reads payload.insuranceProducts). Omitted when none.
    ...(insuranceProducts.length ? { insuranceProducts } : {}),
  };
}
