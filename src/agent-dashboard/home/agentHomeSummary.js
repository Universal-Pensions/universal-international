import { monthlyEquivalent } from '../../utils/finance';
import { activePolicies } from '../../utils/policies';

/**
 * Pure derivation of the agent home dome's summary figures. Extracted from
 * PulseCard so both the mobile dome and the desktop fork compute identical
 * numbers from the same inputs (no behavioural change — the math below is the
 * verbatim body of PulseCard's two useMemo blocks).
 *
 * @param {Array<{contributionSchedule?: object, isActive?: boolean}>} subscribers
 * @param {{totalPaid?: number|null, paidTransactions?: Array<{amount?: number}>}|null|undefined} commissionDetail
 * @returns {{monthly: number, active: number, total: number, activePct: number, commissionsTotal: number}}
 */
export function computeAgentHomeSummary(subscribers, commissionDetail) {
  let monthly = 0;
  let active = 0;
  for (const s of subscribers) {
    monthly += monthlyEquivalent(s.contributionSchedule);
    if (s.isActive) active += 1;
  }
  const total = subscribers.length;
  const activePct = total > 0 ? Math.round((active / total) * 100) : 0;

  // Flat `due → paid` flow: lifetime commissions = the total paid figure the
  // detail already sums (falls back to summing paid lines if absent).
  let commissionsTotal;
  if (commissionDetail?.totalPaid != null) {
    commissionsTotal = commissionDetail.totalPaid;
  } else {
    commissionsTotal = (commissionDetail?.paidTransactions || []).reduce(
      (sum, c) => sum + (c.amount || 0),
      0,
    );
  }

  return { monthly, active, total, activePct, commissionsTotal };
}

/** Start-of-month (local) timestamp for a millisecond instant. */
export function monthStartMs(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Local `YYYY-MM-DD` for a millisecond instant. */
function isoDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * ISO date window [from, to) covering the calendar month that contains `ms`.
 * `to` is the first day of the next month (exclusive), so a transactions query
 * with `.gte('date', from).lt('date', to)` captures the whole month including
 * timestamps on the last day. Used to fetch a month's contributions.
 */
export function monthRangeIso(ms) {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { from: isoDay(start), to: isoDay(next) };
}

/**
 * Derive the "this month" anchor from the agent's book itself. The demo seed is
 * anchored to a fixed MOCK_NOW and components must not import the demo clock
 * (CLAUDE.md §4), so "this month" = the month of the latest date observed.
 *
 * A11-007 — onboarding and contribution used to get SEPARATE anchors (each
 * dimension's own latest date), on the theory that a stale dimension shouldn't
 * skew the other. In practice that let the SAME phrase "this month" resolve to
 * two different calendar months on the same dashboard (e.g. "Payments logged ·
 * June 2026" next to "New subscribers · August 2026") — which reads as a data
 * glitch in a demo even though each figure was individually "correct" for its
 * own dimension. Both anchors now share ONE month: the later of the two
 * dimensions' latest activity. A dimension with no activity in that exact
 * month honestly shows zero for it rather than silently borrowing an older
 * month under the same "this month" label.
 *
 * Shared by MonthlyDataCard (the tile counts) and the Home drill-down pages, so
 * a tile count always equals the length of its drill-down list, and the
 * drill-down pages' own month headings always agree with each other.
 *
 * @returns {{ onboardStart: number, contribStart: number }} start-of-month ms
 *   (both fields always equal — kept as two fields so existing call sites,
 *   which read one or the other by name, don't need to change).
 */
export function deriveMonthAnchors(subscribers = []) {
  let maxReg = 0;
  let maxContrib = 0;
  for (const s of subscribers) {
    const r = s.registeredDate ? new Date(s.registeredDate).getTime() : 0;
    if (r > maxReg) maxReg = r;
    const c = s.lastContributionDate ? new Date(s.lastContributionDate).getTime() : 0;
    if (c > maxContrib) maxContrib = c;
  }
  const anchor = monthStartMs(Math.max(maxReg, maxContrib));
  return { onboardStart: anchor, contribStart: anchor };
}

/** True if the subscriber was onboarded in (or after) the anchor month. */
export function isOnboardedSince(subscriber, onboardStart) {
  return (
    !!subscriber.registeredDate &&
    new Date(subscriber.registeredDate).getTime() >= onboardStart
  );
}

/**
 * "Yet to contribute" = subscribers with NO contribution logged this month.
 * Derived from the actual contribution transactions (the source of truth the
 * Contributions drill-down also uses) rather than the `lastContributionDate`
 * denorm, which can be stale — so a subscriber never appears as both
 * "contributed this month" and "yet to contribute".
 *
 * @param {Array} subscribers
 * @param {Array<{subscriberId: string}>} monthContributions - contributions logged this month
 * @returns {Array} subscribers without a contribution this month
 */
export function pendingContributors(subscribers, monthContributions = []) {
  const contributed = new Set(monthContributions.map((c) => c.subscriberId));
  return subscribers.filter((s) => !contributed.has(s.id));
}

/**
 * Sum of `.amount` across a list of contribution transactions — the ACTUAL
 * money collected, as opposed to computeAgentHomeSummary's `monthly` (the
 * SCHEDULED total, from monthlyEquivalent(contributionSchedule): what members
 * are due to save, not what they have saved).
 *
 * A11-003: the agent Home DESKTOP tile used to show computeAgentHomeSummary's
 * scheduled `monthly` figure under the caption "What members saved this
 * month" — a projection presented as a completed fact (~14% off the real
 * number in the audit's evidence: 331K scheduled vs 291K actually collected).
 * Mobile already computed this real figure inline; this hoists that same sum
 * here so both viewports share one implementation.
 *
 * @param {Array<{amount?: number}>} contributions
 * @returns {number}
 */
export function sumContributions(contributions = []) {
  let total = 0;
  for (const c of contributions) total += c.amount || 0;
  return total;
}

/**
 * True if a subscriber has ANY active insurance policy (life, health OR
 * funeral). Single source of truth shared by the Home insurance card (counts)
 * and the Insured / Uninsured drill-down pages, so the card numbers always equal
 * the list lengths. Reads the agent-facing `policies` list (product + status,
 * built by `buildAgentPolicies`), so a member with only health/funeral cover
 * counts as insured — matching the PolicyChips shown on their detail page.
 * Null/absent policies (e.g. RLS-filtered on live) is treated as uninsured.
 */
export function isInsured(subscriber) {
  return activePolicies(subscriber).length > 0;
}
