// Savings & contribution constants — shared across signup, subscriber dashboard, and projections.

import { FREQUENCY, normalizeFrequency } from '../utils/finance';

/** Retirement age — when the retirement bucket unlocks. */
export const RETIREMENT_AGE = 60;

/** Working-life start — used for life-progress arc on the home pulse card. */
export const START_AGE = 25;

/** Minimum contribution / withdrawal in UGX. */
export const MIN_CONTRIBUTION = 5_000;
export const MIN_WITHDRAW = 5_000;

/**
 * Default retirement / liquid split for a member's OWN contribution schedule.
 *
 * This is the member's choice to make — 80/20, 60/40, 100/0, whatever suits them
 * — and it governs ONLY money they put in themselves: their scheduled
 * contribution and any ad-hoc top-up on the Save page. 80/20 is what they start
 * on until they change it, and it mirrors the column defaults on
 * `contribution_schedules.retirement_pct` / `.emergency_pct` (migration 0001).
 *
 * ⚠️ NOT to be confused with `EMPLOYER_FUNDED_SPLIT` in utils/contributionModel.
 * That one is where an EMPLOYER's contribution runs land (100% retirement) and is
 * a property of the run engine, not a schedule value. The two are deliberately
 * independent: an employer member on a 60/40 schedule still has every shilling
 * their employer sends go to retirement, and their own 60/40 applies to their own
 * money. Using either constant in the other's place re-couples them.
 */
export const DEFAULT_RETIREMENT_PCT = 80;
export const DEFAULT_SCHEDULE_SPLIT = Object.freeze({
  retirementPct: DEFAULT_RETIREMENT_PCT,
  emergencyPct: 100 - DEFAULT_RETIREMENT_PCT,
});

/* ── Per-product cover ladders ───────────────────────────────────────────────
 * Each product sells FOUR cover levels. Tier 0 is the entry level and doubles as
 * the universal fallback: it holds the value that product shipped as its single
 * fixed cover before per-product amounts existed, so any caller that ignores the
 * ladder (a legacy localStorage draft, an old payload) lands on exactly the old
 * behaviour.
 *
 * `life`'s ladder is lifted VERBATIM from the cover slider that used to live
 * privately in subscriber-dashboard/pages/InsurancePage.jsx — that page and this
 * constant had drifted into two unrelated pricing tables, which is the whole
 * reason this lives here now. Health and funeral extend from their own base on
 * the same shape of curve.
 *
 * Invariant (asserted in savings-cover-tiers.test.js): cover and premium both
 * rise strictly, while the premium PER SHILLING of cover strictly falls — buying
 * more cover is always cheaper per unit. Demo pricing in UGX; there is no NAV,
 * no underwriting, and the server validates nothing beyond `>= 0`, so this table
 * is the only pricing authority in the system.
 */
const PRODUCT_TIERS = {
  life: [
    { cover: 1_000_000, premiumMonthly: 2_000 }, //  24,000/yr · 0.200 %/mo
    { cover: 2_000_000, premiumMonthly: 3_500 }, //  42,000/yr · 0.175 %/mo
    { cover: 3_000_000, premiumMonthly: 5_000 }, //  60,000/yr · 0.167 %/mo
    { cover: 5_000_000, premiumMonthly: 7_500 }, //  90,000/yr · 0.150 %/mo
  ],
  health: [
    { cover: 3_000_000, premiumMonthly: 5_000 }, //  60,000/yr · 0.167 %/mo
    { cover: 5_000_000, premiumMonthly: 7_500 }, //  90,000/yr · 0.150 %/mo
    { cover: 8_000_000, premiumMonthly: 11_000 }, // 132,000/yr · 0.138 %/mo
    { cover: 12_000_000, premiumMonthly: 15_000 }, // 180,000/yr · 0.125 %/mo
  ],
  funeral: [
    { cover: 2_000_000, premiumMonthly: 1_500 }, //  18,000/yr · 0.075 %/mo
    { cover: 3_000_000, premiumMonthly: 2_100 }, //  25,200/yr · 0.070 %/mo
    { cover: 5_000_000, premiumMonthly: 3_250 }, //  39,000/yr · 0.065 %/mo
    { cover: 8_000_000, premiumMonthly: 5_000 }, //  60,000/yr · 0.063 %/mo
  ],
};

/**
 * Days of hospitalisation the hospital-cash benefit pays out over. The product's
 * cover figure is the TOTAL across these days, so the headline the member cares
 * about — what lands in their hand per night — is cover ÷ this.
 */
export const HOSPITAL_CASH_DAYS = 20;

/**
 * Entry-tier (life) cover and monthly premium.
 *
 * Derived from the ladder rather than hand-written so life's tier 0 and these
 * two constants can never disagree. DO NOT repoint them at a higher tier:
 * `utils/groupInsurance.js` divides one by the other to get the employer group
 * rate (0.2 %/mo), so changing either silently reprices group insurance for
 * every covered employee on every roster.
 */
export const INSURANCE_PREMIUM_MONTHLY = PRODUCT_TIERS.life[0].premiumMonthly;
export const INSURANCE_COVER = PRODUCT_TIERS.life[0].cover;

/**
 * Insurance products a subscriber can add to their contribution schedule.
 *
 * Configurable: add, remove, or reprice an entry here (and its ladder above) and
 * the contribution form (selection list, premium maths, and live summary) picks
 * it up automatically — no component edits needed. `id` is the stable key
 * carried in the schedule's `insuranceTypes` selection; `icon` maps to an inline
 * glyph in each consuming form.
 *
 * Each entry spreads its own tier 0, so `cover` / `premiumMonthly` remain
 * present and unchanged for every caller that reads a product without caring
 * about the ladder (`utils/policies.js`, `utils/periodSettlement.js`, …).
 * `tiers` is the opt-in for callers that let the user pick an amount.
 */
export const INSURANCE_PRODUCTS = [
  {
    // `id` stays 'health' — it is the stored enum value in
    // subscriber_insurance_products.product, the RLS/RPC product check, and
    // every existing row. Only the LABEL is the product's public name.
    id: 'health',
    label: 'Hospital cash',
    blurb: 'Hospital & clinic cover',
    // Hospital cash does NOT reimburse bills — it pays a flat daily amount for
    // each night in hospital, up to this many days. The cover figure is the
    // total across those days, so the daily benefit is cover ÷ benefitDays
    // (see `dailyBenefit`). Every tier divides evenly by 20.
    benefitDays: HOSPITAL_CASH_DAYS,
    icon: 'health',
    tiers: PRODUCT_TIERS.health,
    ...PRODUCT_TIERS.health[0],
  },
  {
    id: 'funeral',
    label: 'Funeral insurance',
    blurb: 'Eases funeral & burial costs',
    icon: 'funeral',
    tiers: PRODUCT_TIERS.funeral,
    ...PRODUCT_TIERS.funeral[0],
  },
  {
    id: 'life',
    label: 'Life insurance',
    blurb: 'Lump sum for your beneficiaries',
    icon: 'life',
    tiers: PRODUCT_TIERS.life,
    ...PRODUCT_TIERS.life[0],
  },
];

/**
 * An INSURANCE_PRODUCTS entry by id, or null for an unknown id.
 * @param {string} productId
 */
export function insuranceProduct(productId) {
  return INSURANCE_PRODUCTS.find((p) => p.id === productId) ?? null;
}

/**
 * The cover ladder for a product — `[{ cover, premiumMonthly }]`, ascending.
 * Empty array for an unknown id, so callers can `.length`-check without a guard.
 * @param {string} productId
 */
export function coverTiers(productId) {
  return insuranceProduct(productId)?.tiers ?? [];
}

/**
 * A product's entry tier — the default selection and the universal fallback.
 * @returns {{ cover: number, premiumMonthly: number, index: number } | null}
 */
export function defaultTier(productId) {
  const tiers = coverTiers(productId);
  return tiers.length ? { ...tiers[0], index: 0 } : null;
}

/**
 * A product's tier by ladder position, clamped into range.
 * @returns {{ cover: number, premiumMonthly: number, index: number } | null}
 */
export function coverTierAt(productId, index) {
  const tiers = coverTiers(productId);
  if (!tiers.length) return null;
  const i = Math.min(Math.max(Number(index) || 0, 0), tiers.length - 1);
  return { ...tiers[i], index: i };
}

/**
 * Resolve a cover AMOUNT to its ladder tier.
 *
 * An exact match wins. Otherwise the nearest tier AT OR BELOW the amount is
 * returned — never tier 0 by default. That matters for real data: an
 * employer-set cover, a hand-edited row, or a value left behind by a repricing
 * is off-ladder, and collapsing it to tier 0 makes the UI offer a "downgrade" to
 * the cheapest level (the exact bug the old `findIndex(t => t.cover === cover)`
 * in InsurancePage produced). `exact` lets a caller tell the two cases apart.
 *
 * @param {string} productId
 * @param {number} cover — cover amount in UGX
 * @returns {{ cover: number, premiumMonthly: number, index: number, exact: boolean } | null}
 */
/**
 * The DAILY payout for a product whose cover is spread over a fixed number of
 * days (hospital cash). Returns `null` for products that pay a single lump sum
 * (life, funeral), so callers can render the daily line only where it is true.
 *
 * @param {string} productId
 * @param {number} cover — that product's total cover in UGX
 * @returns {number | null} whole UGX per day
 */
export function dailyBenefit(productId, cover) {
  const days = insuranceProduct(productId)?.benefitDays;
  if (!days) return null;
  return Math.round((Number(cover) || 0) / days);
}

export function tierForCover(productId, cover) {
  const tiers = coverTiers(productId);
  if (!tiers.length) return null;
  const target = Number(cover) || 0;
  const exactIdx = tiers.findIndex((t) => t.cover === target);
  if (exactIdx >= 0) return { ...tiers[exactIdx], index: exactIdx, exact: true };
  let idx = 0;
  for (let i = 0; i < tiers.length; i += 1) {
    if (tiers[i].cover <= target) idx = i;
  }
  return { ...tiers[idx], index: idx, exact: false };
}

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
 * Accepts an INSURANCE_PRODUCTS entry OR one of its `tiers` — both carry
 * `premiumMonthly`, so `annualPremium(tierForCover('life', cover))` is the
 * canonical way to price a chosen cover level.
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
 * both tin renders (the onboarding ContributionSettings, shared by self-signup and
 * agent onboarding, and the SubscriberScheduleForm editor) so they cannot drift
 * numerically.
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
