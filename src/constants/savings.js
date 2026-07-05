// Savings & contribution constants — shared across signup, subscriber dashboard, and projections.

import { FREQUENCY, normalizeFrequency } from '../utils/finance';

/** Retirement age — when the retirement bucket unlocks. */
export const RETIREMENT_AGE = 60;

/** Working-life start — used for life-progress arc on the home pulse card. */
export const START_AGE = 25;

/** Minimum contribution / withdrawal in UGX. */
export const MIN_CONTRIBUTION = 5_000;
export const MIN_WITHDRAW = 5_000;

/** Default insurance cover and monthly premium for the entry tier (life). */
export const INSURANCE_PREMIUM_MONTHLY = 2_000;
export const INSURANCE_COVER = 1_000_000;

/**
 * Insurance products a subscriber can add to their contribution schedule.
 *
 * Configurable: add, remove, or reprice an entry here and the contribution
 * form (selection list, premium maths, and live summary) picks it up
 * automatically — no component edits needed. `id` is the stable key carried in
 * the schedule's `insuranceTypes` selection; `icon` maps to an inline glyph in
 * ContributionSettingsForm. Premiums/cover are demo values in UGX.
 *
 * `life` deliberately mirrors INSURANCE_PREMIUM_MONTHLY / INSURANCE_COVER so the
 * legacy single-product path (signup, agent onboard) stays consistent.
 */
export const INSURANCE_PRODUCTS = [
  {
    id: 'health',
    label: 'Health insurance',
    blurb: 'Hospital & clinic cover',
    icon: 'health',
    premiumMonthly: 5_000,
    cover: 3_000_000,
  },
  {
    id: 'funeral',
    label: 'Funeral insurance',
    blurb: 'Eases funeral & burial costs',
    icon: 'funeral',
    premiumMonthly: 1_500,
    cover: 2_000_000,
  },
  {
    id: 'life',
    label: 'Life insurance',
    blurb: 'Lump sum for your beneficiaries',
    icon: 'life',
    premiumMonthly: INSURANCE_PREMIUM_MONTHLY,
    cover: INSURANCE_COVER,
  },
];

/**
 * Annual premium for an insurance product, in UGX.
 *
 * Premiums are stored MONTHLY on each `INSURANCE_PRODUCTS` entry
 * (`premiumMonthly`) — that stored rate is the single source of truth for
 * onboarding payloads and group pricing and must not change. The save-to-cover
 * flow (and any "cost for one year" display) charges/accrues on an ANNUAL
 * basis, so derive the yearly figure here rather than re-hardcoding ×12 at each
 * call site. Mirrors the DB anchor `premium_monthly * 12` used by the accrual
 * trigger and `policies.js` renewal maths.
 *
 * @param {{ premiumMonthly?: number }} product
 * @returns {number} annual premium in whole UGX
 */
export function annualPremium(product) {
  return (Number(product?.premiumMonthly) || 0) * 12;
}

/* ── Filling-the-tin: insurance save-up pace gauge ──────────────────────────
 * The insurance save-up "tin" PREVIEWS how fast cover would fill — it is NOT a
 * balance (nothing is saved yet at onboarding). The resting coin height is a
 * bounded, log-scaled function of fill PACE (annual target ÷ monthly-in):
 * faster fill rests higher, slower fill rests lower, and the pile ALWAYS stops
 * well below the green goal line (cap 60 < line 80) so the user is never shown
 * as "covered". Uses the UN-ceiled month count so the pile travels smoothly on
 * edit, while the copy keeps showing the honest ceil'd month count. Shared by
 * both tin renders (signup ContributionSettings + agent ContributionSettingsForm)
 * so they cannot drift numerically.
 */
export const TIN_LINE_PCT = 80; // green "cover starts" goal line — never reached
export const TIN_FILL_FLOOR = 30; // slowest readable pile (%)
export const TIN_FILL_CAP = 60; // fastest pile (%) — keeps coins AND pill clear of the line
export const TIN_FILL_EMPTY = 6; // isZero stub — lavender, no flow
const TIN_MONTHS_MAX = 120; // 10-yr horizon; anything slower pins to the floor

/**
 * Map an annual cover target + the monthly amount flowing into the tin to the
 * pot's resting fill level and its "alive" surface tempo.
 * @returns {{ heightPct: number, sheenDur: number, filling: boolean }}
 *   heightPct — coin height as % of the jar (6 when idle, else 30..60)
 *   sheenDur  — meniscus loop duration in seconds (faster fill laps livelier)
 *   filling   — whether any money reaches the tin
 */
export function tinFillState(target, monthlyIn) {
  if (!(monthlyIn > 0) || !(target > 0)) {
    return { heightPct: TIN_FILL_EMPTY, sheenDur: 0, filling: false };
  }
  const monthsExact = target / monthlyIn; // un-ceiled → smooth pile travel
  const m = Math.min(Math.max(monthsExact, 1), TIN_MONTHS_MAX);
  const t = 1 - Math.log(m) / Math.log(TIN_MONTHS_MAX); // 0 (slow) … 1 (≤1 month)
  const heightPct = TIN_FILL_FLOOR + t * (TIN_FILL_CAP - TIN_FILL_FLOOR); // 30..60
  const sheenDur = 6.4 - t * 3; // 6.4s slow … 3.4s fast
  return { heightPct, sheenDur, filling: true };
}

/**
 * Quick-pick contribution presets tuned PER FREQUENCY, so the chips read like
 * realistic Uganda amounts for the chosen cadence — a daily saver sees daily-
 * sized picks, an annual saver yearly-sized ones — instead of one fixed set that
 * only makes sense monthly. Every value is ≥ MIN_CONTRIBUTION, so a preset can
 * never land below the accepted minimum. Used by the signup contribution page
 * and the schedule-edit form (both drive a live frequency selector).
 */
export const PRESETS_BY_FREQUENCY = {
  [FREQUENCY.DAILY]:       [5_000, 10_000, 20_000, 50_000],
  [FREQUENCY.WEEKLY]:      [10_000, 20_000, 50_000, 100_000],
  [FREQUENCY.MONTHLY]:     [20_000, 50_000, 100_000, 250_000],
  [FREQUENCY.QUARTERLY]:   [50_000, 150_000, 300_000, 600_000],
  [FREQUENCY.HALF_YEARLY]: [100_000, 300_000, 600_000, 1_200_000],
  [FREQUENCY.ANNUALLY]:    [200_000, 500_000, 1_000_000, 2_000_000],
};

/**
 * Presets for a frequency id, tolerant of legacy frequency formats
 * (`normalizeFrequency`). Falls back to the monthly set for an unknown value.
 */
export function presetsForFrequency(frequency) {
  return PRESETS_BY_FREQUENCY[normalizeFrequency(frequency)] ?? PRESETS_BY_FREQUENCY[FREQUENCY.MONTHLY];
}

/**
 * Quick-pick contribution amounts for the subscriber mobile Save (top-up) page.
 * Laid out as a 2×3 grid of PillChips. Distinct from the signup/schedule set
 * above so the mobile redesign can tune its own presets independently.
 */
export const MOBILE_QUICK_CONTRIBUTION_AMOUNTS = [5_000, 10_000, 25_000, 50_000, 100_000, 200_000];
