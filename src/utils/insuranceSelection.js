// Shared insurance selection → signup-payload split.
//
// TWO builders, ONE split. `signup/contribution/contributionPayload.js` (self
// signup) and `agent-dashboard/onboarding/onboardPayload.js` (agent onboard)
// both feed the SAME SQL chain (`_insert_subscriber_chain`, migrations
// 0065/0072) from the SAME wizard (`signup/contribution/ContributionSettings`),
// so they must split insurance identically. They previously held two verbatim
// copies of this logic and were one edit away from disagreeing about what a
// subscriber bought depending on who enrolled them. Change it here only.
//
// The two builders still differ in ONE respect, deliberately: contributionPayload
// emits the legacy `contributionSchedule.insurancePremium` / `.insuranceCover`
// keys and onboardPayload never has. Both are inert (the SQL reads neither, and
// `contribution_schedules` has no such columns) — don't "harmonise" them.

import {
  INSURANCE_PRODUCTS,
  tierForCover,
  defaultTier,
} from '../constants/savings';

/** Products that live in `subscriber_insurance_products`; life is its own table. */
const EXTRA_PRODUCTS = ['health', 'funeral'];

/**
 * Resolve the cover tier a schedule selected for one product.
 *
 * Order of preference:
 *   1. `insuranceSelections` — the wizard's already-resolved `[{product, cover,
 *      premiumMonthly}]`. Preferred because it is what the summary card and the
 *      "you pay today" total were computed from.
 *   2. `insuranceCovers` — the `{ productId: cover }` map kept for restoring the
 *      wizard on a back-nav or a page refresh.
 *   3. Tier 0 — the product's entry level, which is exactly the fixed cover it
 *      shipped before per-product amounts existed. This is what makes a
 *      localStorage draft written by an older build produce a byte-identical
 *      payload.
 *
 * The PREMIUM is always re-derived from the ladder, never taken from the
 * snapshot: a stale or hand-edited draft must not be able to pair a high cover
 * with a low premium, since no RPC validates the two against each other.
 *
 * @param {string} productId
 * @param {object} schedule — the confirmed contribution schedule
 * @returns {{ cover: number, premiumMonthly: number, index: number }}
 */
export function resolveScheduleTier(productId, schedule) {
  const selected = schedule?.insuranceSelections?.find((s) => s.product === productId);
  const cover = Number(selected?.cover ?? schedule?.insuranceCovers?.[productId]) || 0;
  return (cover > 0 ? tierForCover(productId, cover) : null) ?? defaultTier(productId);
}

/**
 * Split a schedule's insurance selection into the two shapes
 * `_insert_subscriber_chain` reads:
 *   - `insurancePolicy`   → the life row in `insurance_policies`
 *   - `insuranceProducts` → health/funeral rows in `subscriber_insurance_products`
 *
 * Legacy fallback: a schedule with no `insuranceTypes` array but a truthy
 * `includeInsurance` is treated as life-only at tier 0, preserving the
 * pre-multi-product behaviour.
 *
 * @param {object} schedule
 * @returns {{
 *   includeInsurance: boolean,
 *   wantsLife: boolean,
 *   insurancePolicy: { cover: number, premiumMonthly: number } | null,
 *   insuranceProducts: Array<{ product: string, cover: number, premiumMonthly: number }>,
 * }}
 */
export function buildInsuranceSplit(schedule = {}) {
  const types = Array.isArray(schedule.insuranceTypes) ? schedule.insuranceTypes : null;
  const includeInsurance = types ? types.length > 0 : (schedule.includeInsurance ?? false);
  const wantsLife = types ? types.includes('life') : includeInsurance;

  const lifeTier = resolveScheduleTier('life', schedule);
  const insurancePolicy = wantsLife && lifeTier
    ? { cover: lifeTier.cover, premiumMonthly: lifeTier.premiumMonthly }
    : null;

  const insuranceProducts = (types ?? [])
    .filter((id) => EXTRA_PRODUCTS.includes(id))
    .map((id) => {
      const tier = resolveScheduleTier(id, schedule);
      return {
        product: id,
        cover: tier?.cover ?? 0,
        premiumMonthly: tier?.premiumMonthly ?? 0,
      };
    });

  return { includeInsurance, wantsLife, insurancePolicy, insuranceProducts };
}

/**
 * Default cover map — every product at its entry tier. The seed for the wizard's
 * `insuranceCovers` state, so a product toggled on always has a cover.
 * @returns {Record<string, number>}
 */
export function defaultCoverMap() {
  return Object.fromEntries(
    INSURANCE_PRODUCTS.map((p) => [p.id, defaultTier(p.id).cover]),
  );
}

/**
 * Restore a cover map from a persisted schedule, falling back to tier 0 per
 * product. Off-ladder values snap via `tierForCover` so the wizard can never
 * show a cover the ladder can't price.
 * @param {object} schedule
 * @returns {Record<string, number>}
 */
export function resolveCoverMap(schedule) {
  return Object.fromEntries(
    INSURANCE_PRODUCTS.map((p) => [p.id, resolveScheduleTier(p.id, schedule).cover]),
  );
}
