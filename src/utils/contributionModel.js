// =============================================================================
// Employer contribution model — THE single source of truth for the two-leg math.
//
// One unified model (migration 0092). An employer sets TWO INDEPENDENT legs, and
// each leg is either a percentage of the member's monthly COMPENSATION or a flat
// UGX amount per member per month:
//
//   employeeLeg — deducted from the member's pay by the employer and remitted
//                 on their behalf. Posted with source='own'.
//   employerLeg — the employer's own money. Posted with source='employer'.
//
// Either leg may be zero (0/0 is a legal, saveable configuration — it simply
// funds no pension). There is NO cap and NO minimum. Percentages are 0-100.
//
// What this replaces: the old mode-switched config (`mode: 'employer-only' |
// 'co-contribution'`), in which the employer leg was a percentage OF THE
// EMPLOYEE LEG (`employerMatchPct`) rather than of compensation. That basis is
// gone — the employer leg is never a function of the employee leg. The words
// "co-contribution", "employer-only" and "match" are deliberately absent from
// this module and from every string it produces.
//
// ⚠️ PARITY OBLIGATION. `submit_employer_contribution_run` (migration 0092)
// re-implements `deriveContributionLegs` in PL/pgSQL. Any change to the math
// here MUST land in the same commit as the SQL, or the offline mock path
// (VITE_USE_SUPABASE='false'), the seeded ledger, the run-wizard preview and the
// live RPC diverge. Rounding is a single Math.round per leg, matching SQL
// round() for the non-negative values this model permits.
// =============================================================================

import { formatUGX } from './currency';

/** The two ways a leg can be expressed. */
export const CONTRIBUTION_BASES = ['percent', 'fixed'];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const basisOf = (v) => (v === 'fixed' ? 'fixed' : 'percent');

/**
 * Canonicalise any stored config into the six flat keys the rest of the app
 * reads. Handles three input shapes:
 *
 *   1. NEW (0092)     — has employeeBasis/employerBasis; read as-is.
 *   2. LEGACY v2      — mode + employerBasis/employerPct/employerAmount, or
 *                       mode + employeePct/employerMatchPct. Converted
 *                       MONEY-IDENTICALLY: an employer leg that was
 *                       `employeeLeg × employerMatchPct%` becomes
 *                       `employeePct × employerMatchPct / 100` percent of pay
 *                       (10% + 50% match === 5% of pay).
 *   3. EMPTY / absent — `{}` (how `create_employer` and `approve_access_request`
 *                       provision a new employer) normalises to 0/0, which the
 *                       label surfaces as "No contributions set up yet" rather
 *                       than the old bogus "Employer-only — UGX 0 per member".
 *
 * The group-insurance keys (insuranceEnabled, groupCoverAmount,
 * groupInsuranceProducts) are passed through untouched — they are independent of
 * the pension legs and are normalised by `utils/groupInsurance.js`.
 *
 * @param {object} [config] a raw employers.default_contribution_config
 * @returns {{employeeBasis:'percent'|'fixed', employeePct:number, employeeAmount:number,
 *            employerBasis:'percent'|'fixed', employerPct:number, employerAmount:number}}
 */
export function normalizeContributionConfig(config) {
  const cfg = config ?? {};

  // ORDER MATTERS: `mode` is tested FIRST, before the new basis keys.
  //
  // `update_employer_profile` patches the config by jsonb MERGE, so a row that was
  // switched from employer-only to co-contribution can still carry a stale
  // `employerBasis`/`employerPct` from its previous shape. Detecting the new shape
  // first would read that stale employerPct and silently ignore employerMatchPct —
  // zeroing the employer leg with no error. Since `mode` is never written again
  // from 0092 onward, its presence unambiguously means "this row predates 0092",
  // which makes it the only safe discriminator.
  if (cfg.mode === 'co-contribution') {
    const employeePct = num(cfg.employeePct);
    const matchPct = num(cfg.employerMatchPct ?? cfg.matchPct);
    return {
      employeeBasis: 'percent',
      employeePct,
      employeeAmount: 0,
      employerBasis: 'percent',
      // Money-preserving: % of the employee leg → % of pay.
      employerPct: (employeePct * matchPct) / 100,
      employerAmount: 0,
    };
  }
  if (cfg.mode === 'employer-only') {
    // Within the LEGACY shape, inferring 'fixed' from the presence of an amount is
    // correct — that is exactly what the 0062-era reader did. It is only wrong as a
    // forward-looking rule, which is why the new shape below never infers a basis.
    const legacyBasis = cfg.employerBasis ?? (cfg.employerAmount != null ? 'fixed' : 'percent');
    return {
      employeeBasis: 'percent',
      employeePct: 0,
      employeeAmount: 0,
      employerBasis: basisOf(legacyBasis),
      employerPct: num(cfg.employerPct),
      employerAmount: num(cfg.employerAmount),
    };
  }

  // Already unified (no `mode`). An explicit basis on EITHER leg is the marker;
  // never infer a basis from the presence of an amount — that inference is what
  // silently flipped percent employers to fixed under the old shape.
  if (cfg.employeeBasis != null || cfg.employerBasis != null) {
    return {
      employeeBasis: basisOf(cfg.employeeBasis),
      employeePct: num(cfg.employeePct),
      employeeAmount: num(cfg.employeeAmount),
      employerBasis: basisOf(cfg.employerBasis),
      employerPct: num(cfg.employerPct),
      employerAmount: num(cfg.employerAmount),
    };
  }

  // Empty / unrecognised. Nothing is funded.
  return {
    employeeBasis: 'percent',
    employeePct: 0,
    employeeAmount: 0,
    employerBasis: 'percent',
    employerPct: 0,
    employerAmount: 0,
  };
}

/**
 * The two monthly legs for one member. THE canonical run math — every preview,
 * mock, seed and test derives from this function, and migration 0092 mirrors it
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
    employeeLeg: c.employeeBasis === 'percent'
      ? Math.round((comp * c.employeePct) / 100)
      : Math.round(c.employeeAmount),
    employerLeg: c.employerBasis === 'percent'
      ? Math.round((comp * c.employerPct) / 100)
      : Math.round(c.employerAmount),
  };
}

/** True when a leg funds nothing, so callers can hide a leg-specific surface. */
export function isLegZero(basis, pct, amount) {
  return basisOf(basis) === 'percent' ? num(pct) <= 0 : num(amount) <= 0;
}

/**
 * A leg's RATE as plain words — "10% of pay" or "UGX 50,000". Deliberately
 * compensation-free so it can be shown without disclosing a member's pay.
 */
export function formatLegRate(basis, pct, amount) {
  return basisOf(basis) === 'percent'
    ? `${num(pct)}% of pay`
    : formatUGX(num(amount), { compact: false });
}

/**
 * The same rate addressed TO the member — "10% of your pay" / "UGX 50,000".
 * Second person, because every subscriber-facing string speaks to the member.
 */
export function formatLegRateForMember(basis, pct, amount) {
  return basisOf(basis) === 'percent'
    ? `${num(pct)}% of your pay`
    : formatUGX(num(amount), { compact: false });
}

/**
 * The employer-voice one-liner for the company's funding setup. Replaces
 * `companyFundingLabel` and its mode vocabulary.
 *
 *   both legs   → "Staff put in 10% of pay · You add 5% of pay"
 *   staff only  → "Staff put in 10% of pay · You add nothing"
 *   you only    → "You fund 5% of pay · Staff put in nothing"
 *   neither     → "No contributions set up yet"
 */
export function contributionFundingLabel(config) {
  const c = normalizeContributionConfig(config);
  const staffZero = isLegZero(c.employeeBasis, c.employeePct, c.employeeAmount);
  const youZero = isLegZero(c.employerBasis, c.employerPct, c.employerAmount);

  if (staffZero && youZero) return 'No contributions set up yet';
  const staff = `Staff put in ${formatLegRate(c.employeeBasis, c.employeePct, c.employeeAmount)}`;
  const you = `You add ${formatLegRate(c.employerBasis, c.employerPct, c.employerAmount)}`;
  if (staffZero) {
    return `You fund ${formatLegRate(c.employerBasis, c.employerPct, c.employerAmount)} · Staff put in nothing`;
  }
  if (youZero) return `${staff} · You add nothing`;
  return `${staff} · ${you}`;
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
  const staffZero = isLegZero(c.employeeBasis, c.employeePct, c.employeeAmount);
  const youZero = isLegZero(c.employerBasis, c.employerPct, c.employerAmount);
  const staffRate = formatLegRateForMember(c.employeeBasis, c.employeePct, c.employeeAmount);
  const youRate = formatLegRateForMember(c.employerBasis, c.employerPct, c.employerAmount);

  if (staffZero && youZero) return null;
  if (staffZero) return `${who} pays your whole pension — ${youRate}, at no cost to you`;
  if (youZero) return `${who} sends ${staffRate} to your pension each month`;
  return `${staffRate}, plus ${youRate} from ${who}`;
}
