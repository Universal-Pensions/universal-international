// Shared finance utilities — single source of truth.
//
// NOTE: Currency formatting lives in `src/utils/currency.js`, date formatting
// in `src/utils/date.js`, and motion curves in `src/utils/motion.js`. Import
// money/date/animation helpers directly from those modules — this file owns
// only the finance-domain logic (frequencies, projections, money parsing).

/** @type {number} Monthly interest rate (annual / 12) */
export const MONTHLY_RATE = 0.10 / 12;
/** @type {number} Annual interest rate (10%) */
export const ANNUAL_RATE  = 0.10;

/**
 * Canonical contribution frequencies. Signup writes these IDs into
 * `subscriber.contributionSchedule.frequency` — every consumer must read
 * them via these helpers, never via inline switch statements.
 */
export const FREQUENCY = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  HALF_YEARLY: 'half-yearly',
  ANNUALLY: 'annually',
};

/**
 * Display labels for canonical frequency IDs. Use this for any user-facing
 * frequency rendering (subscriber detail, analytics, onboarding complete,
 * pulse cards, etc.) so the prose stays consistent across the app.
 */
export const FREQUENCY_LABEL = {
  [FREQUENCY.DAILY]: 'Daily',
  [FREQUENCY.WEEKLY]: 'Weekly',
  [FREQUENCY.MONTHLY]: 'Monthly',
  [FREQUENCY.QUARTERLY]: 'Quarterly',
  [FREQUENCY.HALF_YEARLY]: 'Half-yearly',
  [FREQUENCY.ANNUALLY]: 'Annually',
};

/** Periods per year for each canonical frequency. */
const PERIODS_PER_YEAR = {
  [FREQUENCY.DAILY]: 365,
  [FREQUENCY.WEEKLY]: 52,
  [FREQUENCY.MONTHLY]: 12,
  [FREQUENCY.QUARTERLY]: 4,
  [FREQUENCY.HALF_YEARLY]: 2,
  [FREQUENCY.ANNUALLY]: 1,
};

/**
 * Resolve any historical or alternate frequency key (e.g. 'halfYearly',
 * 'semi-annually') to the canonical one. Defensive — old data may use
 * different shapes; new writes always go through FREQUENCY.
 */
export function normalizeFrequency(value) {
  if (!value) return FREQUENCY.MONTHLY;
  const v = String(value).toLowerCase();
  if (v === 'daily') return FREQUENCY.DAILY;
  if (v === 'weekly') return FREQUENCY.WEEKLY;
  if (v === 'monthly') return FREQUENCY.MONTHLY;
  if (v === 'quarterly') return FREQUENCY.QUARTERLY;
  if (v === 'half-yearly' || v === 'halfyearly' || v === 'semi-annually' || v === 'semiannually') {
    return FREQUENCY.HALF_YEARLY;
  }
  if (v === 'annually' || v === 'yearly') return FREQUENCY.ANNUALLY;
  return FREQUENCY.MONTHLY;
}

/**
 * Number of periods per year for a frequency (handles aliases).
 * @param {string} frequency
 * @returns {number}
 */
export function periodsPerYear(frequency) {
  return PERIODS_PER_YEAR[normalizeFrequency(frequency)] ?? 12;
}

/**
 * Convert a contribution schedule { amount, frequency } into a monthly
 * equivalent value. Used by projections and the home pulse card.
 * @param {{amount?: number, frequency?: string} | null | undefined} schedule
 * @returns {number}
 */
export function monthlyEquivalent(schedule) {
  const amount = Number(schedule?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return (amount * periodsPerYear(schedule?.frequency)) / 12;
}

/**
 * Canonical UGX money parser — the single source of truth for turning a
 * user/upload-entered amount into a whole-shilling integer.
 *
 * UGX is a zero-decimal currency: the platform never stores sub-shilling
 * amounts. Accepts plain numbers and formatted strings ("12,500", "12500",
 * "UGX 12,500", "12,500.50") and returns a non-negative **integer** (rounded
 * to the nearest whole UGX) or `null` for blank / non-finite / non-positive
 * input.
 *
 * Decimals are preserved through parsing and then rounded — the old
 * implementation stripped the decimal point outright (`"12,500.50"` → 1250050,
 * off by 100×). The settlement upload path imports this same parser so there
 * is exactly one money-parsing rule across contributions, withdrawals, claims,
 * and settlement (see `src/utils/settlement.js`, BL-8 / M-C1).
 *
 * @param {string | number} str
 * @returns {number | null}
 */
export function parseAmount(str) {
  if (typeof str === 'number') {
    if (!Number.isFinite(str) || str <= 0) return null;
    return Math.round(str);
  }
  // Strip everything except digits, the decimal point, and a leading sign so a
  // fractional cell ("45000.50") parses, then round to whole UGX.
  const cleaned = String(str ?? '').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/**
 * Transaction types that move money OUT of the member (from their pocket or
 * spent on their behalf). Insurance premiums are stored as positive magnitudes
 * — like withdrawals were historically — but are outflows, so any activity feed
 * that classifies rows by sign must treat them as negative.
 */
export const TX_OUTFLOW_TYPES = new Set(['withdrawal', 'premium', 'insurance_premium', 'premium_sweep']);

/**
 * The display-signed amount for a transaction: positive = money in, negative =
 * money out. Contributions and claim payouts are inflows; withdrawals and
 * insurance premiums (self-paid `premium` and employer-funded
 * `insurance_premium`) are outflows regardless of how the row's raw `amount`
 * happens to be signed. Use this for any in/out classification, running +/−
 * display, or net-flow arithmetic — NOT for report totals that want the raw
 * magnitude of a single category (those use Math.abs on `amount` directly).
 * @param {{type?: string, amount?: number}} tx
 * @returns {number}
 */
export function txDisplayAmount(tx) {
  const n = Number(tx?.amount) || 0;
  if (n === 0) return 0; // avoid a -0 result for a zero-magnitude outflow
  return TX_OUTFLOW_TYPES.has(tx?.type) ? -Math.abs(n) : n;
}

/**
 * Future value of regular monthly contributions.
 * @param {number} pmt - Monthly payment amount
 * @param {number} years - Number of years
 * @returns {number} Future value
 */
export function calcFV(pmt, years) {
  const n = years * 12;
  return n > 0 ? pmt * ((Math.pow(1 + MONTHLY_RATE, n) - 1) / MONTHLY_RATE) : 0;
}

/**
 * Convert slider position (0-100) to amount using log scale.
 * @param {number} v - Slider value (0-100)
 * @param {number} min - Minimum amount
 * @param {number} max - Maximum amount
 * @returns {number} Corresponding amount
 */
export function sliderToAmt(v, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  return Math.round(Math.exp(lo + (v / 100) * (hi - lo)) / 1000) * 1000;
}
/**
 * Convert amount to slider position (0-100) using log scale.
 * @param {number} a - Amount
 * @param {number} min - Minimum amount
 * @param {number} max - Maximum amount
 * @returns {number} Slider value (0-100)
 */
export function amtToSlider(a, min, max) {
  const lo = Math.log(min), hi = Math.log(max);
  return ((Math.log(Math.max(a, min)) - lo) / (hi - lo)) * 100;
}

/** Clamp `n` into the inclusive range [lo, hi]. */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** Whole months elapsed since an ISO date string; `fallback` if absent/invalid. */
function monthsSince(dateStr, fallback) {
  if (!dateStr) return fallback;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return fallback;
  const months = (Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44);
  return months > 0 ? months : fallback;
}

/** Small deterministic djb2 string hash, always returned as a non-negative int. */
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Derive a believable "amount invested" + investment growth for a subscriber.
 *
 * The demo has no real cost basis — every contribution buys units at the fixed
 * 1,000 UGX price, so `total_balance` equals total contributed and raw growth is
 * always zero. To give the dashboards a meaningful "invested vs grown" story we
 * discount the current balance back over the member's tenure at the app's own
 * assumed return (`MONTHLY_RATE` — the same rate `calcFV` projects forward),
 * i.e. invested = what would have compounded up to today's balance.
 *
 * Deterministic per subscriber (no `Math.random`), so figures stay stable across
 * renders and never disagree between the mobile PulseCard and desktop HomeDesktop.
 *
 * @param {{ netBalance?: number, registeredDate?: string, id?: string }} subscriber
 * @returns {{ invested: number, growth: number, growthPct: number }}
 */
export function deriveInvestmentGrowth(subscriber) {
  const balance = Number(subscriber?.netBalance) || 0;
  if (balance <= 0) return { invested: 0, growth: 0, growthPct: 0 };

  // Tenure (months) from registration, fallback 18mo, plus a small stable
  // per-subscriber jitter so equal-tenure members don't show identical growth.
  const base = monthsSince(subscriber?.registeredDate, 18);
  const jitter = (hashString(String(subscriber?.id ?? '')) % 7) - 3; // -3..+3
  const tenureMonths = clamp(base + jitter, 3, 36);

  const factor = Math.pow(1 + MONTHLY_RATE, tenureMonths);
  const invested = Math.round(balance / factor);
  const growth = balance - invested;
  const growthPct = invested > 0 ? (growth / invested) * 100 : 0;
  return { invested, growth, growthPct };
}

/**
 * Split a member's contributed principal into the part that reached the pension
 * from their own pay and the part their employer added on top — the HISTORY
 * figures behind the subscriber Home funding block.
 *
 * Root cause this fixes: the block used to SUM the `transactions` feed, but the
 * seed only ever wrote a handful of contribution rows per member (e.g. 5 months
 * for a 21-month member), so that sum sat far below the member's real
 * `total_balance` snapshot — the block's "total contributed" (1.05M) flatly
 * contradicted the hero balance (4.41M). The two were never the same source.
 *
 * Instead we split the SAME derived principal the hero shows
 * (`deriveInvestmentGrowth().invested`) by the member's REAL own:employer ratio
 * taken from the feed, so `own + employer === invested === balance − growth` and
 * every surface agrees. The raw breakdown is consulted only for the ratio, never
 * the totals.
 *
 * ⚠️ THERE IS DELIBERATELY NO FALLBACK RATIO. This used to assume a 1/3 employer
 * share when the feed had no contribution rows, described as "a common 2:1
 * member-to-employer top-up". It was really an artifact of the deleted
 * mode-switched config, whose seed was 10% of pay plus a 50% employer MATCH OF
 * THAT LEG — exactly 2:1. Under the unified two-leg model
 * (`utils/contributionModel.js`) the two legs are independent shares of
 * compensation, so employer-funds-everything (employee leg 0),
 * member-funds-everything (employer leg 0) and 0/0 are ALL legal configurations
 * and no default share is defensible. With no rows to measure we say so
 * (`unknown: true`) and callers HIDE the funding surface instead of inventing a
 * split the member would read as fact.
 *
 * @param {{ netBalance?: number, registeredDate?: string, id?: string }} subscriber
 * @param {{ own?: number, employer?: number }} [breakdown] raw per-source sums — used only for the ratio
 * @returns {{ own: number, employer: number, total: number, unknown: boolean }}
 *   `unknown: true` means the feed carried no contribution rows, so the split is
 *   genuinely unmeasurable — the three figures are 0 and must not be rendered.
 */
export function deriveEmployerSplit(subscriber, breakdown) {
  const { invested } = deriveInvestmentGrowth(subscriber);
  const rawOwn = Number(breakdown?.own) || 0;
  const rawEmployer = Number(breakdown?.employer) || 0;
  const rawTotal = rawOwn + rawEmployer;
  if (rawTotal <= 0) return { own: 0, employer: 0, total: 0, unknown: true };
  // Preserve the member's real own:employer ratio, re-scaled onto the derived
  // principal so own + employer ties out to `invested` exactly.
  const employer = Math.round(invested * (rawEmployer / rawTotal));
  const own = Math.max(0, invested - employer);
  return { own, employer, total: own + employer, unknown: false };
}
