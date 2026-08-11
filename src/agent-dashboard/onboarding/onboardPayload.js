// Pure payload builder for the agent-onboard write (create_subscriber_from_agent_onboard).
//
// Kept in its own module (not OnboardingComplete.jsx) so the component file only
// exports a component — exporting a helper alongside it trips react-refresh.

import { toCanonicalUGPhone } from '../../utils/phone';
import { normalizeFrequency } from '../../utils/finance';
import { buildInsuranceSplit } from '../../utils/insuranceSelection';

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
 * 'life' | 'health' | 'funeral') plus the cover amount chosen per product. The
 * shared `buildInsuranceSplit` (utils/insuranceSelection.js — the SAME split the
 * self-signup builder uses) turns that into what the signup chain
 * (`_insert_subscriber_chain`, migrations 0065/0072) reads:
 *   - life            → `insurancePolicy` (life row in `insurance_policies`).
 *   - health/funeral  → `insuranceProducts` (rows in `subscriber_insurance_products`).
 * Covers/premiums come from the tier the agent picked on the cover step, with
 * each product's entry tier as the fallback. Legacy fallback: a schedule with no
 * `insuranceTypes` but `includeInsurance` true is treated as life-only at the
 * entry tier (preserves the pre-multi-product behaviour).
 *
 * NOTE this builder deliberately emits NO `contributionSchedule.insurancePremium`
 * or `.insuranceCover` — it never has, and the SQL reads neither.
 */
export function buildPayload(signup) {
  const schedule = signup.contributionSchedule || {};
  const { includeInsurance, insurancePolicy, insuranceProducts } = buildInsuranceSplit(schedule);

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
