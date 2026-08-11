// Pure payload builder for the self-signup write (create_subscriber_from_signup).
//
// Kept in its own module (not ContributionRoute.jsx) so the component file only
// exports a component — exporting a helper alongside it trips react-refresh —
// and so the merge-of-payment-and-contribution logic is unit-testable (mirrors
// the agent-side onboardPayload.js, which is likewise extracted + tested).

import { normalizeFrequency } from '../../utils/finance';
import { buildInsuranceSplit } from '../../utils/insuranceSelection';

/**
 * Build the payload `create_subscriber_from_signup` expects from the
 * SignupContext snapshot + the schedule the user just confirmed. The RPC is
 * forgiving about missing optional fields (it defaults paymentMethod,
 * includeInsurance, etc.) but the required fields must be present.
 *
 * Multi-product insurance is split by the shared `buildInsuranceSplit`
 * (utils/insuranceSelection.js), which the agent path uses too: life →
 * `insurancePolicy`, health/funeral → `insuranceProducts[]`. The shared
 * `_insert_subscriber_chain` (migration 0065) routes `insuranceProducts` into
 * `subscriber_insurance_products`. Cover/premium come from the tier the user
 * picked on the wizard's cover step, falling back to each product's entry tier
 * for legacy single-toggle schedules (no `insuranceTypes`/`insuranceCovers`).
 *
 * @param {object} signup   - SignupContext snapshot
 * @param {object} schedule - the confirmed contribution schedule
 * @param {string} phone    - canonicalised UG phone
 */
export function buildContributionPayload(signup, schedule, phone) {
  const { includeInsurance, insurancePolicy, insuranceProducts } = buildInsuranceSplit(schedule);
  const insurancePremium = schedule.insurancePremium ?? 0;
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
      // Legacy, both inert: `_insert_subscriber_chain` reads neither and
      // `contribution_schedules` has no matching column. Kept in sync with the
      // real rows anyway so a schedule that says 1M can't sit next to an
      // insurance_policies row that says 5M. (onboardPayload emits neither key —
      // that asymmetry is deliberate, see utils/insuranceSelection.js.)
      insurancePremium,
      insuranceCover: insurancePolicy?.cover ?? 0,
      // save-to-cover + indexation (migration 0072). 'pay_now' | 'save_to_cover';
      // target = combined ANNUAL premium of building products; indexation 0..15.
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
    ...(insurancePolicy ? { insurancePolicy } : {}),
    ...(insuranceProducts.length ? { insuranceProducts } : {}),
  };
}
