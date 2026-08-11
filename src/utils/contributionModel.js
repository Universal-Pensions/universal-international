// =============================================================================
// Employer contribution model — THE single source of truth for the two-leg math.
//
// One unified model. An employer sets TWO INDEPENDENT legs, each a percentage of
// the member's own monthly COMPENSATION:
//
//   employeeLeg — deducted from the member's pay by the employer and remitted
//                 on their behalf. Posted with source='own'.
//   employerLeg — the employer's own money. Posted with source='employer'.
//
// Either leg may be zero (0/0 is a legal, saveable configuration — it simply
// funds no pension). There is NO cap and NO minimum. Percentages are 0-100.
//
// What this replaces, in two steps:
//
//   0092 removed the mode-switched config (`mode: 'employer-only' |
//   'co-contribution'`), in which the employer leg was a percentage OF THE
//   EMPLOYEE LEG (`employerMatchPct`) rather than of compensation. The words
//   "co-contribution", "employer-only" and "match" are deliberately absent from
//   this module and from every string it produces.
//
//   0093 removed the per-leg BASIS (`employeeBasis`/`employerBasis` and their
//   `employeeAmount`/`employerAmount` flat-UGX partners). A leg is now always a
//   percentage of pay, so the config carries two pension numbers and nothing
//   else. No live employer had ever stored a flat amount, and 0093 raises rather
//   than converting if one is ever found — a flat amount cannot be re-expressed
//   as a percentage without each member's pay.
//
// Which side is paying is DERIVED from the two percentages (see
// `contributionParticipants`) and is never stored. A stored discriminator is
// exactly what `mode` was, and re-introducing one would bring back its
// stale-key hazard.
//
// ⚠️ PARITY OBLIGATION. `submit_employer_contribution_run` (migration 0093)
// re-implements `deriveContributionLegs` in PL/pgSQL. Any change to the math
// here MUST land in the same commit as the SQL, or the offline mock path
// (VITE_USE_SUPABASE='false'), the seeded ledger, the run-wizard preview and the
// live RPC diverge. Rounding is a single Math.round per leg, matching SQL
// round() for the non-negative values this model permits.
// =============================================================================

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Canonicalise any stored config into the two pension percentages the rest of
 * the app reads. Handles three input shapes:
 *
 *   1. CURRENT (0093)  — employeePct / employerPct; read as-is.
 *   2. LEGACY          — a pre-0092 `mode: 'co-contribution'` row, whose employer
 *                        leg was a percentage OF THE EMPLOYEE LEG. Converted
 *                        MONEY-IDENTICALLY: `employeePct × employerMatchPct / 100`
 *                        percent of pay (10% + 50% match === 5% of pay).
 *   3. EMPTY / absent  — `{}` (how `create_employer` and `approve_access_request`
 *                        provision a new employer) normalises to 0/0, which the
 *                        label surfaces as "No contributions set up yet".
 *
 * The legacy branch is belt-and-braces only: migration 0093 rewrote every live
 * row to the current shape, and `mode` has not been written since 0092. It earns
 * its six lines by keeping the money identical if a pre-0093 row is ever restored
 * from a backup. The pre-0092 `mode: 'employer-only'` shape is NOT handled — its
 * distinguishing feature was a flat `employerAmount`, which no longer exists;
 * such a row falls through to the plain read below.
 *
 * The group-insurance keys (insuranceEnabled, groupCoverAmount,
 * groupInsuranceProducts) are passed through untouched — they are independent of
 * the pension legs and are normalised by `utils/groupInsurance.js`.
 *
 * @param {object} [config] a raw employers.default_contribution_config
 * @returns {{employeePct:number, employerPct:number}}
 */
export function normalizeContributionConfig(config) {
  const cfg = config ?? {};

  // ORDER MATTERS: `mode` is tested FIRST. Its presence unambiguously means
  // "this row predates 0092", and such a row can also carry an `employerPct`
  // left over from an earlier shape. Reading that stale value instead of
  // converting the match would zero the employer leg with no error.
  if (cfg.mode === 'co-contribution') {
    const employeePct = num(cfg.employeePct);
    const matchPct = num(cfg.employerMatchPct ?? cfg.matchPct);
    return {
      employeePct,
      // Money-preserving: % of the employee leg → % of pay.
      employerPct: (employeePct * matchPct) / 100,
    };
  }

  return {
    employeePct: num(cfg.employeePct),
    employerPct: num(cfg.employerPct),
  };
}

/**
 * The two monthly legs for one member. THE canonical run math — every preview,
 * mock, seed and test derives from this function, and migration 0093 mirrors it
 * in SQL.
 *
 * @param {object} config employers.default_contribution_config (any shape)
 * @param {number} compensation the member's monthly compensation in UGX
 * @returns {{employeeLeg:number, employerLeg:number}} whole shillings
 */
export function deriveContributionLegs(config, compensation) {
  const c = normalizeContributionConfig(config);
  const comp = num(compensation);
  return {
    employeeLeg: Math.round((comp * c.employeePct) / 100),
    employerLeg: Math.round((comp * c.employerPct) / 100),
  };
}

/** True when a leg funds nothing, so callers can hide a leg-specific surface. */
export function isLegZero(pct) {
  return num(pct) <= 0;
}

/**
 * WHERE EMPLOYER-FUNDED MONEY LANDS — 100% retirement, 0% liquid.
 *
 * A property of the RUN ENGINE, not of any member. Everything an employer's
 * contribution settings fund goes to the member's RETIREMENT pot: both pension
 * legs, including the employee leg (that leg is the member's own money, but the
 * employer sets its rate and payroll deducts it — the member never chooses it,
 * so it is not theirs to allocate either).
 *
 * ⚠️ THIS IS NOT A SCHEDULE DEFAULT. A member's own `contribution_schedules`
 * split is a SEPARATE thing they own outright: it starts at
 * `DEFAULT_SCHEDULE_SPLIT` (80/20, constants/savings.js), they may set it to
 * 60/40 or 100/0 or anything else, and it governs only money they put in
 * themselves — their scheduled contribution and Save-page top-ups. The two
 * numbers must never be substituted for one another; that substitution IS the
 * coupling this decoupling removed. An employer member on a 60/40 schedule still
 * has every employer shilling land in retirement, and their own 60/40 still
 * applies to their own money.
 *
 * The old employer-invite completion screen conflated them: it asked a sponsored
 * member for a "split" that in practice only ever re-routed their employer's
 * pension contribution, since they state no amount of their own at enrolment.
 *
 * ⚠️ PARITY: `submit_employer_contribution_run` (migration 0102) hard-codes this
 * allocation, and `_mockSubmitEmployerRun` (services/employer.js) mirrors it for
 * the offline path. No schedule row is ever written from this constant.
 */
export const EMPLOYER_FUNDED_SPLIT = Object.freeze({ retirementPct: 100, emergencyPct: 0 });

/**
 * Split one employer-run leg into its retirement / liquid amounts.
 *
 * Exists so the allocation is applied through ONE named function rather than an
 * inline `× retPct / 100` at each posting site — an inline copy is exactly how
 * the mock, the seed and the RPC drifted apart before (see the parity note at
 * the top of this module).
 *
 * @param {number} leg whole shillings posted by an employer contribution run
 * @returns {{retirement:number, emergency:number}}
 */
export function splitEmployerLeg(leg) {
  const amount = Math.round(num(leg));
  return { retirement: amount, emergency: 0 };
}

/**
 * Which sides are actually putting money in. Derived from the two percentages —
 * never stored. Drives the employer's "Who contributes?" setting, the funding
 * chip on the staff list, and anything else that branches on the shape of the
 * arrangement rather than on the figures.
 *
 * @param {object} config employers.default_contribution_config (any shape)
 * @returns {'staff'|'both'|'company'|'none'}
 */
export function contributionParticipants(config) {
  const { employeePct, employerPct } = normalizeContributionConfig(config);
  const staff = !isLegZero(employeePct);
  const company = !isLegZero(employerPct);
  if (staff && company) return 'both';
  if (staff) return 'staff';
  if (company) return 'company';
  return 'none';
}

/**
 * A leg's RATE as plain words — "10% of pay". Deliberately compensation-free so
 * it can be shown without disclosing a member's pay.
 */
export function formatLegRate(pct) {
  return `${num(pct)}% of pay`;
}

/**
 * The same rate addressed TO the member — "10% of your pay". Second person,
 * because every subscriber-facing string speaks to the member.
 */
export function formatLegRateForMember(pct) {
  return `${num(pct)}% of your pay`;
}

/**
 * The employer-voice one-liner for the company's funding setup.
 *
 *   both legs   → "Staff put in 10% of pay · You add 5% of pay"
 *   staff only  → "Staff put in 10% of pay · You add nothing"
 *   you only    → "You fund 5% of pay · Staff put in nothing"
 *   neither     → "No contributions set up yet"
 */
export function contributionFundingLabel(config) {
  const c = normalizeContributionConfig(config);
  switch (contributionParticipants(c)) {
    case 'none':
      return 'No contributions set up yet';
    case 'company':
      return `You fund ${formatLegRate(c.employerPct)} · Staff put in nothing`;
    case 'staff':
      return `Staff put in ${formatLegRate(c.employeePct)} · You add nothing`;
    default:
      return `Staff put in ${formatLegRate(c.employeePct)} · You add ${formatLegRate(c.employerPct)}`;
  }
}

/**
 * The MEMBER-voice equivalent, for the subscriber dashboard. `employerName`
 * falls back to "your employer" when the name is unavailable.
 *
 *   both legs   → "10% of your pay, plus 5% of your pay from Acme Ltd"
 *   staff only  → "Acme Ltd sends 10% of your pay to your pension"
 *   you only    → "Acme Ltd pays your whole pension — 5% of your pay, at no cost to you"
 *   neither     → null (callers hide the funding surface entirely)
 */
export function memberFundingSummary(config, employerName) {
  const c = normalizeContributionConfig(config);
  const who = employerName || 'your employer';

  switch (contributionParticipants(c)) {
    case 'none':
      return null;
    case 'company':
      return `${who} pays your whole pension — ${formatLegRateForMember(c.employerPct)}, at no cost to you`;
    case 'staff':
      return `${who} sends ${formatLegRateForMember(c.employeePct)} to your pension each month`;
    default:
      return `${formatLegRateForMember(c.employeePct)}, plus ${formatLegRateForMember(c.employerPct)} from ${who}`;
  }
}
