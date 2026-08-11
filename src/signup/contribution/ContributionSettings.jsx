import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { calcFV, parseAmount, FREQUENCY, periodsPerYear } from '../../utils/finance';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX, formatNumber } from '../../utils/currency';
import {
  RETIREMENT_AGE,
  MIN_CONTRIBUTION,
  INSURANCE_PRODUCTS,
  annualPremium,
  tierForCover,
  tinFillState,
  TIN_LINE_PCT,
  presetsForFrequency,
  DEFAULT_SCHEDULE_SPLIT,
} from '../../constants/savings';
import { resolveCoverMap } from '../../utils/insuranceSelection';
import SignupTopbar from '../SignupTopbar';
import { useOnboardAudience } from '../OnboardAudienceContext';
import { PillChipGroup } from '../../components/PillChip';
import CoverTierPicker from '../../components/insurance/CoverTierPicker';
import styles from './ContributionSettings.module.css';

export { MIN_CONTRIBUTION };

const FREQUENCIES = [
  { id: FREQUENCY.DAILY,       label: 'Daily',       helper: 'every day',      cadence: 'every day'      },
  { id: FREQUENCY.WEEKLY,      label: 'Weekly',      helper: 'every week',     cadence: 'every week'     },
  { id: FREQUENCY.MONTHLY,     label: 'Monthly',     helper: 'every month',    cadence: 'every month'    },
  { id: FREQUENCY.QUARTERLY,   label: 'Quarterly',   helper: 'every 3 months', cadence: 'every 3 months' },
  { id: FREQUENCY.HALF_YEARLY, label: 'Half-Yearly', helper: 'every 6 months', cadence: 'every 6 months' },
  { id: FREQUENCY.ANNUALLY,    label: 'Annually',    helper: 'every year',     cadence: 'every year'     },
];

const PAYMENT_METHODS = [
  { id: 'momo',    label: 'Mobile Money',            description: 'MTN or Airtel — instant confirmation' },
  { id: 'gateway', label: 'Pay with another method', description: 'Card, bank or wallet — via Pesapal'   },
];

/** Short per-period suffix for the "You save …/xx" summary line ("/mo", "/wk", …). */
const PERIOD_SUFFIX = {
  [FREQUENCY.DAILY]:      'day',
  [FREQUENCY.WEEKLY]:     'wk',
  [FREQUENCY.MONTHLY]:    'mo',
  [FREQUENCY.QUARTERLY]:  'qtr',
  [FREQUENCY.HALF_YEARLY]: '6mo',
  [FREQUENCY.ANNUALLY]:   'yr',
};

/* The "cover starts" goal line (TIN_LINE_PCT) and the coin-fill level are shared
 * with the agent form via src/constants/savings.js — the fill is now a live pace
 * gauge (tinFillState) rather than a fixed illustration, so the pot reacts as the
 * user edits their split/products. */

/**
 * Display order for the insurance list (Life, Health, Funeral — the mockup
 * order). Render-only reorder of INSURANCE_PRODUCTS; the constant and its
 * premium/cover values are untouched, and the default selection stays life-only.
 */
const INSURANCE_DISPLAY_ORDER = ['life', 'health', 'funeral'];
const ORDERED_INSURANCE = INSURANCE_DISPLAY_ORDER
  .map((id) => INSURANCE_PRODUCTS.find((p) => p.id === id))
  .filter(Boolean);

function getFreq(frequencyId) {
  return (
    FREQUENCIES.find((f) => f.id === frequencyId) ??
    FREQUENCIES.find((f) => f.id === FREQUENCY.MONTHLY)
  );
}

function digitsOnly(str, max = 10) {
  return String(str).replace(/[^\d]/g, '').slice(0, max);
}

// Single-column breakpoint: below this the summary aside stacks under the wizard
// card (see the @container (max-width:1100px) block in the stylesheet). We mirror
// it in JS so `payMode` can render the payment picker IN the wizard card — right
// above the sticky footer Pay CTA — instead of in the off-screen stacked aside.
//
// This measures the CONTAINER (`.page`, which carries `container-type:
// inline-size`), not the viewport. A viewport media query was wrong for the
// embedded agent-onboarding host: there the available width is the viewport
// minus the 240px agent rail, so a 1101px viewport left a ~797px column while
// JS still reported "wide" and the 2-column grid crushed the left column to
// ~433px. It also could never see the rail collapse. Measuring the very element
// the container query sits on guarantees `showInCardPay` and `.mobilePay
// { display }` can never disagree — one picker, never two, never zero.
const NARROW_MAX = 1100;
function useIsNarrowContainer(ref) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    // No ResizeObserver (jsdom) → stay on the wide layout, which is what the
    // previous matchMedia hook's SSR snapshot also returned.
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    // `observe()` delivers an initial callback in the same frame — the observer
    // loop runs after layout and BEFORE paint — so there is no wrong-layout flash
    // and no need to seed the value synchronously.
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect?.width ?? el.offsetWidth;
      setNarrow(w > 0 && w <= NARROW_MAX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return narrow;
}

/** Short product name for the compact cover cards ("Life insurance" → "Life"). */
function shortProductName(label) {
  return String(label).replace(/\s*insurance$/i, '');
}

/**
 * Projection figures use a hybrid: compact ("UGX 1.2M") above 100K so the
 * big retirement number isn't seven digits wide, but exact ("UGX 50,000")
 * below so smaller projections stay readable. Distinct from the global
 * `formatUGX` (always one or the other).
 */
function formatProjection(n) {
  if (!Number.isFinite(n) || n <= 0) return 'UGX 0';
  if (n >= 1e5) return formatUGX(n, { compact: true });
  return formatUGX(n, { compact: false });
}

// Keep `formatUGXExact` referenced via the unified helper for the rest of
// this file.
const formatUGXExact = (n) => formatUGX(n, { compact: false });

/** Years until age 60, floor 0. Returns null if dob is missing/invalid. */
function yearsToRetirement(dob) {
  if (!dob) return null;
  const then = new Date(dob).getTime();
  if (!Number.isFinite(then)) return null;
  const ageYears = (Date.now() - then) / (365.25 * 24 * 3600 * 1000);
  if (ageYears < 0 || ageYears > 120) return null;
  return Math.max(0, RETIREMENT_AGE - ageYears);
}

function ProductIcon({ id }) {
  if (id === 'health') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 8.5v7M8.5 12h7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === 'funeral') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path d="M4 20V9l8-5 8 5v11" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9.5 20v-5h5v5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  // life — shield + check
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Small inline glyphs used by the two-page flow ────────────────────── */
function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" aria-hidden="true">
      <path d="M5 12l5 5 9-11" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
    </svg>
  );
}
function IconShieldCheck() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 11l2 2 4-4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconCheckCircle() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.9" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconArrowRight({ size = 14 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M11 5l-7 7 7 7M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconAlert() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 8v5M12 16.5v.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Route B "save up for it" tin — a symbolic illustration of the emergency
 * savings filling toward the annual premium. At onboarding nothing is saved
 * yet, so the coins render at a fixed illustrative height; the copy + months
 * projection react to the split + selected products. When the emergency share
 * is zero the tin can never fill → an inline warning replaces the helper note.
 */
function SaveUpTin({ target, monthlyEmergency, monthsToCover, emergencyPct, isZero }) {
  const isAgent = useOnboardAudience() === 'agent';
  const monthsWord = monthsToCover === 1 ? 'month' : 'months';
  // Live pace gauge: coin height + surface tempo are derived from how fast cover
  // would fill, so every split/product edit visibly moves the pile. fxKey remounts
  // the one-shot "settle" flash whenever the settled level or month count changes.
  const fill = tinFillState(target, monthlyEmergency);
  const fxKey = `${Math.round(fill.heightPct)}-${monthsToCover}`;
  return (
    <div className={styles.detail}>
      <div className={styles.detailHd}>
        <span className={styles.detailTitle}>Filling the tin</span>
        <span className={styles.detailProj}>
          {isZero ? 'not filling yet' : `full in about ${monthsToCover} ${monthsWord}`}
        </span>
      </div>
      <div className={styles.detailBody}>
        <p className={styles.buildMsg}>
          {isAgent
            ? 'They’re not covered yet. Cover starts the day their coins reach the line.'
            : 'You are not covered yet. Cover starts the day your coins reach the line.'}
        </p>
        <div className={styles.tinArea}>
          <div className={styles.tin}>
            <div className={styles.tinLid}>
              <span className={styles.tinShield} data-on="false"><IconShield /></span>
            </div>
            <div className={styles.tinBody}>
              <div className={styles.tinLine} style={{ bottom: `${TIN_LINE_PCT}%` }} />
              <div
                className={`${styles.tinCoins} ${isZero ? styles.tinCoinsEmpty : ''}`}
                style={{ height: `${fill.heightPct}%`, '--tin-pace-dur': `${fill.sheenDur}s` }}
              >
                {!isZero && (
                  <span className={styles.tinPill}>≈ {formatUGXExact(monthlyEmergency)}/mo</span>
                )}
                {!isZero && <span key={fxKey} className={styles.tinFx} aria-hidden="true" />}
              </div>
            </div>
          </div>
          <div className={styles.tinInfo}>
            <div className={styles.tinGoal}>
              <IconShieldCheck /> Cover starts at <span>{formatUGXExact(target)}</span>
            </div>
            <div className={styles.tinCap}>
              {isZero ? (
                'Add money you can take out'
              ) : (
                <>Full in about <strong>{monthsToCover}</strong> {monthsWord}</>
              )}
            </div>
            <div className={styles.tinSub}>
              {isZero
                ? 'Right now nothing goes into the tin.'
                : isAgent
                  ? 'Their saved money moves into the tin on its own.'
                  : 'Your saved money moves into the tin on its own.'}
            </div>
          </div>
        </div>
        {isZero ? (
          <div className={styles.warn0}>
            <IconAlert />
            <span className={styles.warn0Tx}>
              Nothing goes to “take out any time”, so the tin never fills. Add some, or pay the
              whole year now.
            </span>
          </div>
        ) : (
          <div className={styles.linkNote}>
            <IconArrowRight />
            <span>
              {emergencyPct >= 60
                ? 'A big “take out” share fills the tin fast.'
                : 'Put more in “take out any time” and the tin fills faster.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Default insurance selection: life only (preserves the long-standing demo
 *  default of a single life policy). The user can add Health/Funeral. */
function resolveInitialInsurance(initial) {
  if (Array.isArray(initial?.insuranceTypes)) return initial.insuranceTypes;
  // Legacy single-toggle schedules → life if they opted in, else default to life.
  if (initial?.includeInsurance === false) return [];
  return ['life'];
}

/**
 * Payment-method picker — collects the method + momo details in the summary
 * aside (shown on the "Protect your family" page, beside "You pay today"). The
 * actual Pay action is the pinned footer CTA; this only collects the method.
 * State is owned by ContributionSettings.
 */
function PaymentMethodPicker({ method, setMethod, momoProvider, setMomoProvider, momoPhone, setMomoPhone, processing }) {
  const isAgent = useOnboardAudience() === 'agent';
  const payQ = isAgent ? 'How will they pay?' : 'How will you pay?';
  return (
    <section className={styles.pmtSection} aria-label={payQ}>
      <div className={styles.sectionEyebrow}>{payQ}</div>

      <PillChipGroup label="Payment method" layout="grid" columns={1} className={styles.pmtMethodList}>
        {PAYMENT_METHODS.map((m) => {
          const active = method === m.id;
          return (
            <div key={m.id} className={styles.pmtMethodCard} data-active={active}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                className={styles.pmtMethodHeader}
                onClick={() => setMethod(m.id)}
                disabled={processing}
              >
                <span className={styles.pmtMethodRadio} data-active={active} aria-hidden="true" />
                <span className={styles.pmtMethodCopy}>
                  <span className={styles.pmtMethodLabel}>{m.label}</span>
                  <span className={styles.pmtMethodDesc}>{m.description}</span>
                </span>
              </button>

              <AnimatePresence initial={false}>
                {active && (
                  <motion.div
                    key="fields"
                    className={styles.pmtFields}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.26, ease: EASE_OUT_EXPO }}
                  >
                    <div className={styles.pmtFieldsInner}>
                      {m.id === 'momo' && (
                        <>
                          <PillChipGroup label="Mobile money provider" layout="grid" columns={2} className={styles.pmtProviderRow}>
                            {['mtn', 'airtel'].map((p) => (
                              <button
                                key={p}
                                type="button"
                                role="radio"
                                aria-checked={momoProvider === p}
                                className={styles.pmtProviderBtn}
                                data-active={momoProvider === p}
                                onClick={() => setMomoProvider(p)}
                              >
                                {p === 'mtn' ? 'MTN MoMo' : 'Airtel Money'}
                              </button>
                            ))}
                          </PillChipGroup>
                          <label className={styles.pmtFieldRow}>
                            <span className={styles.pmtFieldLabel}>Phone number</span>
                            <span className={styles.pmtPhoneField}>
                              <span className={styles.pmtPhonePrefix}>+256</span>
                              <input
                                type="tel"
                                inputMode="numeric"
                                autoComplete="tel-national"
                                spellCheck={false}
                                placeholder="700 000 000"
                                className={styles.pmtPhoneInput}
                                value={momoPhone}
                                onChange={(e) => setMomoPhone(digitsOnly(e.target.value, 10))}
                              />
                            </span>
                          </label>
                        </>
                      )}

                      {m.id === 'gateway' && (
                        <p className={styles.pmtRedirectNote}>
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                            <path d="M12 8v4.5M12 16v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                          </svg>
                          You’ll be redirected to Pesapal to complete
                          {isAgent ? ' the payment ' : ' payment '}securely.
                          Supports Visa, Mastercard, bank transfer and major mobile wallets.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </PillChipGroup>

      <p className={styles.pmtSecure}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
          <path d="M6 11V8a6 6 0 0 1 12 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="4" y="11" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        Secured — encrypted end-to-end
      </p>
    </section>
  );
}

/**
 * Full page for /signup/contribution — the "Plan & pay" stage. A two-page flow:
 * page 1 sets the savings schedule (frequency, amount, split, yearly step-up),
 * page 2 adds optional family cover with a "pay now / save up for it" choice.
 * A live "Your plan" summary aside and a pinned footer CTA drive the payment.
 *
 * Shared by TWO hosts, following the same pattern as the KYC steps (which
 * OnboardKycFlow reuses verbatim under its own chrome):
 *
 *  - `/signup/contribution` (self-signup) — owns the whole viewport: renders
 *    `<main>` + `SignupTopbar`, is `100dvh` tall, and scrolls the card body
 *    internally against a pinned footer.
 *  - The agent onboarding wizard's Schedule stage — passes `embedded`, which
 *    hands chrome + scrolling back to the host (see the prop notes below).
 *
 * Copy switches first-person → third-person via `useOnboardAudience()`, exactly
 * as the shared KYC steps do. `embedded` and audience are deliberately
 * INDEPENDENT: one is layout, the other is voice.
 *
 * @param {object}   initial          existing contributionSchedule, or null
 * @param {string}   dob              drives the retirement-horizon projections
 * @param {string}   phone            9 local digits — prefills the MoMo field.
 *                                    NOT a canonical +256… number (digitsOnly
 *                                    would truncate it to 10 chars).
 * @param {boolean}  collectSchedule  false → the compact employer-invite
 *                                    `EmployerInviteFinishView`, which collects
 *                                    NOTHING (their employer sets every figure)
 *                                    and confirms at `DEFAULT_SCHEDULE_SPLIT`.
 *                                    That branch keeps its own `<main>` +
 *                                    `SignupTopbar` and ignores `embedded`; it is
 *                                    unreachable from the agent path, which
 *                                    always collects.
 * @param {boolean}  embedded         render inside a host that already owns the
 *                                    page chrome and the scrollport: no `<main>`
 *                                    landmark, no `SignupTopbar`, auto height
 *                                    with page-scroll instead of `100dvh` +
 *                                    internal scroll, and no document-level
 *                                    Escape handler.
 * @param {Function} onClose          ✕ / footer-back. Host decides where that goes.
 * @param {Function} onConfirm        awaited with the finished schedule object.
 */
export default function ContributionSettings({ initial, dob, phone, collectSchedule = true, embedded = false, onClose, onConfirm }) {
  // Third-person copy when a field agent is filling this in for someone else —
  // the same switch the eight shared KYC steps use. Independent of `embedded`.
  const isAgent = useOnboardAudience() === 'agent';
  const [page, setPage] = useState('contrib');
  const [frequency, setFrequency] = useState(initial?.frequency ?? 'monthly');
  const [amountStr, setAmountStr] = useState(initial?.amount ? String(initial.amount) : '');
  // Retirement is at least 60% of the split — liquid savings caps at 40%. Clamp
  // the restored value too (an older schedule may carry a lower share).
  const [retirementPct, setRetirementPct] = useState(() => Math.max(60, initial?.retirementPct ?? 80));
  const [insuranceTypes, setInsuranceTypes] = useState(() => resolveInitialInsurance(initial));
  // Chosen cover AMOUNT per product id — stored as amounts, not ladder indices,
  // because cover is the durable business value that reaches the RPC (an index
  // would silently repoint if a ladder were ever reordered or repriced). Seeded
  // for ALL products, not just the selected ones, so toggling a product on
  // always finds a cover and a deselect/reselect keeps the user's choice.
  const [insuranceCovers, setInsuranceCovers] = useState(() => resolveCoverMap(initial));
  const [indexationPct, setIndexationPct] = useState(initial?.contributionIndexationPct ?? 5);
  const [route, setRoute] = useState(initial?.insuranceFundingMode === 'pay_now' ? 'A' : 'B');
  // % of the take-out (emergency) slice redirected to build cover; the rest stays
  // liquid. Only relevant for Route B "save up". Default 50 → half builds cover.
  const [savingsPct, setSavingsPct] = useState(initial?.insuranceSavingsPct ?? 50);
  // Insurance-page sub-state: false = "Your plan" summary; true = the summary box
  // converts in place into the payment-method picker (no stacked scroll).
  const [payMode, setPayMode] = useState(false);
  // Checkout breakdown (the "You pay today" itemisation) — open by default so the
  // split between contribution and cover is visible at the payment step; the
  // chevron collapses it.
  const [breakdownOpen, setBreakdownOpen] = useState(true);
  const [touched, setTouched] = useState(Boolean(initial?.amount));

  // Payment state (formerly PaymentStep's) — the picker lives in the summary
  // aside and the pinned footer Pay CTA shares this state.
  const [method, setMethod] = useState('momo');
  const [momoProvider, setMomoProvider] = useState('mtn');
  const [momoPhone, setMomoPhone] = useState(phone || '');
  const [processing, setProcessing] = useState(false);

  const amountInputRef = useRef(null);
  const pageRef = useRef(null);
  const pbodyRef = useRef(null);
  const shellRef = useRef(null);
  const mobilePayRef = useRef(null);

  // On phones/tablets the summary aside stacks below the tall wizard card, so the
  // payment picker there is off-screen (and the sticky Pay footer scrolls away
  // before you reach it). On narrow layouts we instead render the pay block IN
  // the wizard card, keeping it adjacent to the footer CTA. Measured off `.page`
  // — the container-query element — so JS and CSS always agree.
  const isNarrow = useIsNarrowContainer(pageRef);

  // Escape returns without saving. Only when we own the whole page: embedded, the
  // listener is document-level but `onClose` steps the HOST wizard back a stage, so
  // any Escape anywhere on the agent dashboard — dismissing the Ask-AI panel, the
  // Settings slide-in, the notification popover, a bottom sheet — would silently
  // discard the schedule just entered. The ✕ and the footer Back cover intentional
  // exit there.
  useEffect(() => {
    if (embedded) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && !processing) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [embedded, onClose, processing]);

  // When entering pay mode on a narrow layout, bring the in-card payment block
  // into view so tapping "Continue to payment" visibly reveals the method chooser
  // (rather than silently swapping the off-screen aside far below the fold).
  useEffect(() => {
    if (!(payMode && isNarrow)) return undefined;
    const id = requestAnimationFrame(() => {
      mobilePayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(id);
  }, [payMode, isNarrow]);

  const amount = parseAmount(amountStr);
  const emergencyPct = 100 - retirementPct;
  const freq = getFreq(frequency);
  const cadence = freq.cadence;
  const belowMin = amount !== null && amount < MIN_CONTRIBUTION;
  const hasAmount = amount !== null && amount >= MIN_CONTRIBUTION;
  const canConfirm = hasAmount;

  // ── Projections ────────────────────────────────────────────────
  const freqPerYear = periodsPerYear(freq.id);
  const perPeriodPremium = (monthly) => Math.round((monthly * 12) / freqPerYear);
  // Selected products with their CHOSEN cover tier merged over the catalogue
  // defaults. Resolving the ladder exactly once here is what keeps every
  // downstream figure — the annual target, the per-period premium, the cover
  // payout total, the tin's fill pace, the "you pay today" breakdown — reading
  // the same numbers the user is looking at.
  const selectedProducts = useMemo(
    () => ORDERED_INSURANCE
      .filter((p) => insuranceTypes.includes(p.id))
      .map((p) => {
        const tier = tierForCover(p.id, insuranceCovers[p.id]);
        return tier
          ? { ...p, cover: tier.cover, premiumMonthly: tier.premiumMonthly, tierIndex: tier.index }
          : p;
      }),
    [insuranceTypes, insuranceCovers],
  );
  const periodLabel = PERIOD_SUFFIX[freq.id] ?? 'mo';
  // Legacy per-period premium — retained purely for the write payload's
  // `insurancePremium` field (back-compat); the UI now prices cover annually.
  const insurancePremium = selectedProducts.reduce(
    (sum, p) => sum + perPeriodPremium(p.premiumMonthly),
    0,
  );

  const retirementPerPeriod = hasAmount ? Math.round(amount * (retirementPct / 100)) : 0;
  const emergencyPerPeriod  = hasAmount ? amount - retirementPerPeriod : 0;

  // ── Insurance / save-to-cover ──────────────────────────────────
  const insuranceTarget = useMemo(
    () => selectedProducts.reduce((sum, p) => sum + annualPremium(p), 0),
    [selectedProducts],
  );
  const hasProducts = selectedProducts.length > 0;
  const isRouteA = route === 'A';
  // The take-out (emergency) slice splits: `coverPerPeriod` is redirected to build
  // cover (Route B), the rest stays liquid. Only that share fills the tin.
  const coverPerPeriod  = hasProducts && !isRouteA ? Math.round(emergencyPerPeriod * (savingsPct / 100)) : 0;
  const liquidPerPeriod = emergencyPerPeriod - coverPerPeriod;
  const monthlyToCover  = (coverPerPeriod * freqPerYear) / 12;
  // Cover can't fill if there's no take-out money OR 0% is assigned ([M3] guard).
  const coverGetsNothing = !(monthlyToCover > 0);
  const monthsToCover = (monthlyToCover > 0 && insuranceTarget > 0)
    ? Math.ceil(insuranceTarget / monthlyToCover)
    : Infinity;
  const monthsLabel = Number.isFinite(monthsToCover)
    ? `${monthsToCover} ${monthsToCover === 1 ? 'month' : 'months'}`
    : '—';

  // Route A pays the year's premium today alongside the contribution; Route B
  // (and no-cover) pays only the contribution — the premium fills from the tin.
  const payTotal = hasAmount ? (hasProducts && isRouteA ? amount + insuranceTarget : amount) : 0;
  const dueDisplay = hasAmount ? (page === 'insurance' ? payTotal : amount) : 0;
  // "Their"/"your" saving throughout — the agent is not the data subject.
  const theirSaving = isAgent ? 'Their saving' : 'Your saving';
  const dueBrk = page !== 'insurance'
    ? `This is just ${isAgent ? 'their' : 'your'} saving. Cover comes next.`
    : (!hasProducts
        ? `No cover chosen — just ${isAgent ? 'their' : 'your'} saving.`
        : (isRouteA
            ? `${theirSaving} + one year of cover.`
            : (coverPerPeriod > 0
                ? `${theirSaving} — ${formatUGXExact(coverPerPeriod)} of it builds ${isAgent ? 'their' : 'your'} cover.`
                : `${theirSaving} — assign liquid savings to start building cover.`)));

  // ── Checkout breakdown ("You pay today" itemisation) ──────────────
  // What actually leaves the member's wallet today: the pension contribution,
  // plus (Route A only) one year of insurance premium paid up-front. Route B
  // charges nothing extra — the premium builds out of the liquid-savings slice.
  const payItems = [];
  if (hasAmount) {
    payItems.push({ key: 'contribution', label: 'Pension contribution', value: amount, unit: `/${periodLabel}` });
    if (page === 'insurance' && hasProducts && isRouteA) {
      payItems.push({ key: 'premium', label: 'Insurance · one year of cover', value: insuranceTarget });
    }
  }
  // Only meaningful once there are ≥2 charge lines to sum (Route A). Otherwise the
  // header total already IS the single line, so a "Total" row would just repeat it.
  const showPayTotal = payItems.length > 1;
  // The insurance PAYOUT (Σ cover) — what the family receives, shown as context
  // beneath the charges. Distinct from the premium (what they pay).
  const payoutSub = isRouteA
    ? `Paid to ${isAgent ? 'their' : 'your'} family on a valid claim`
    : (coverPerPeriod > 0
        ? `Starts once ${isAgent ? 'their' : 'your'} savings reach it`
        : 'Assign liquid savings to start it');

  const yrs = yearsToRetirement(dob);
  const contribMonthly = hasAmount ? (amount * freqPerYear) / 12 : 0;
  const retirementMonthly = contribMonthly * (retirementPct / 100);
  const retirementFV = yrs && yrs > 0 ? calcFV(retirementMonthly, yrs) : 0;
  const retirementYears = yrs != null ? Math.round(yrs) : null;
  // "Liquid savings" projects only the take-out money that actually STAYS
  // liquid. On Route B the cover-building slice (coverPerPeriod) is swept to pay
  // premiums, so we compound liquidPerPeriod — keeping this figure consistent
  // with the split slider's "{liquidPerPeriod} stays yours to take out" line.
  // Route A / no cover: the whole take-out slice stays liquid.
  const liquidMonthly = (hasProducts && !isRouteA)
    ? (liquidPerPeriod * freqPerYear) / 12
    : (contribMonthly - retirementMonthly);
  const emergencyFV = yrs && yrs > 0 ? calcFV(liquidMonthly, yrs) : 0;
  // Cover PAYOUT total (Σ product.cover) — distinct from insuranceTarget (the
  // annual PREMIUM). The summary card shows the payout, not the premium.
  const coverTotal = selectedProducts.reduce((sum, p) => sum + (p.cover || 0), 0);
  // Second contribution line: the yearly total on a monthly cadence, or the
  // monthly-equivalent when they save weekly/quarterly (never a redundant repeat).
  const planSubText = freqPerYear === 12
    ? `≈ ${formatUGXExact(amount * 12)} a year`
    : `≈ ${formatUGXExact(contribMonthly)} a month overall`;
  const coverCardSub = !hasProducts
    ? 'Add cover on this step'
    : isRouteA
      ? `Covered when ${isAgent ? 'they' : 'you'} pay`
      : coverGetsNothing
        ? 'Add liquid savings'
        : `Building · about ${monthsLabel}`;

  const momoValid = digitsOnly(momoPhone).length >= 9;
  const canPay = canConfirm && (method === 'gateway' || momoValid);

  function goPage(next) {
    setPayMode(false);
    setPage(next);
    requestAnimationFrame(() => {
      if (embedded) {
        // Embedded, `.pbody`/`.shell` are `overflow: visible` — resetting their
        // scrollTop is a no-op and the real scrollport is the host's. Bring the
        // top of the card back into view instead, or tapping "Next" leaves the
        // agent mid-card looking at the middle of the new page.
        pageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } else {
        if (pbodyRef.current) pbodyRef.current.scrollTop = 0;
        if (shellRef.current) shellRef.current.scrollTop = 0;
      }
    });
    // Focus is deliberately NOT moved here. goPage runs from both the tabs (which
    // take focus natively on click) and the footer CTA (where focus must STAY, so
    // the same button carries the user on to "Continue to payment" without a
    // round-trip back down the page).
  }

  function handlePresetClick(value) {
    setAmountStr(String(value));
    setTouched(true);
    amountInputRef.current?.focus();
  }

  function handleAmountChange(e) {
    const digits = e.target.value.replace(/[^\d]/g, '');
    setAmountStr(digits);
  }

  function toggleInsurance(id) {
    setInsuranceTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  /** Set the cover amount for one product. The map is pre-seeded for every
   *  product, so this never has to create a missing entry. */
  function setProductCover(id, cover) {
    setInsuranceCovers((prev) => ({ ...prev, [id]: cover }));
  }

  function handlePay() {
    setTouched(true);
    if (!canPay || processing) return;
    setProcessing(true);
    const details =
      method === 'momo'
        ? { provider: momoProvider, phone: `+256${digitsOnly(momoPhone)}` }
        : { gateway: 'pesapal', redirected: true };

    // Await onConfirm (handleConfirm in ContributionRoute) so a downstream
    // failure (RPC / JWT / login) can reset `processing` — otherwise the Pay
    // button sticks on "Processing…" with no way to retry. On success the
    // parent unmounts this component, so the catch reset is irrelevant.
    window.setTimeout(async () => {
      try {
        await onConfirm({
          frequency,
          amount,
          retirementPct,
          emergencyPct,
          includeInsurance: insuranceTypes.length > 0,
          insuranceTypes,
          // Cover amounts, two ways. `insuranceCovers` is the full per-product
          // map that restores this step on a back-nav or refresh;
          // `insuranceSelections` is the already-resolved list the payload
          // builders consume, so the RPC stores exactly the tiers these totals
          // were computed from rather than re-resolving the ladder downstream.
          insuranceCovers,
          insuranceSelections: selectedProducts.map((p) => ({
            product: p.id, cover: p.cover, premiumMonthly: p.premiumMonthly,
          })),
          insurancePremium,
          // save-to-cover + step-up contract (consumed by contributionPayload /
          // _insert_subscriber_chain). Route A → charge the year today; Route B
          // → accrue from the emergency tin.
          contributionIndexationPct: indexationPct,
          // Only 'save_to_cover' when cover is actually selected (Route B default
          // must not mislabel a no-cover schedule).
          insuranceFundingMode: (insuranceTypes.length > 0 && !isRouteA) ? 'save_to_cover' : 'pay_now',
          insurancePremiumTarget: insuranceTarget,
          insuranceSavingsPct: savingsPct,
          paymentMethod: method,
          paymentDetails: details,
        });
      } catch {
        setProcessing(false);
      }
    }, 1200);
  }

  function handleCta() {
    if (page === 'contrib') {
      setTouched(true);
      if (!hasAmount) { amountInputRef.current?.focus(); return; }
      goPage('insurance');
      return;
    }
    // Insurance page: first "Continue to payment" converts the summary box into
    // the payment picker; the second (in pay mode) actually pays.
    if (!payMode) { setPayMode(true); return; }
    handlePay();
  }

  // Employer invite: nothing left to collect — no frequency, amount, split,
  // insurance, or payment. Renders a compact confirm card.
  //
  // The schedule row is created at DEFAULT_SCHEDULE_SPLIT (80/20), NOT at
  // EMPLOYER_FUNDED_SPLIT. Those are different things: where the employer's runs
  // land is fixed at 100% retirement by the run engine and is none of this
  // schedule's business, while this row is the member's OWN schedule — dormant at
  // amount 0 until they choose to set one up, and theirs to re-split whenever
  // they like. Stamping 100/0 here would silently pre-decide that for them.
  if (!collectSchedule) {
    return (
      <EmployerInviteFinishView
        onClose={onClose}
        onConfirm={() => onConfirm({ ...DEFAULT_SCHEDULE_SPLIT })}
      />
    );
  }

  const payLabel = processing
    ? (method === 'gateway' ? 'Redirecting…' : 'Processing…')
    : (method === 'gateway' ? 'Continue with Pesapal' : `Pay ${formatUGXExact(payTotal)}`);
  const ctaLabel = page === 'contrib'
    ? `Next: protect ${isAgent ? 'their' : 'your'} family`
    : (payMode ? payLabel : 'Continue to payment');
  const ctaDisabled = page === 'insurance' && payMode && (!canPay || processing);
  const onInsurance = page === 'insurance';
  // Narrow layouts render the pay block inside the wizard card (above the sticky
  // footer); the aside is suppressed there to avoid a duplicate off-screen picker.
  const showInCardPay = payMode && isNarrow;
  // Whether the checkout breakdown has anything to itemise (a cover payout and/or
  // a separate premium charge). Only then is the dropdown offered.
  const hasBreakdown = hasAmount && onInsurance && hasProducts;

  // "You pay today" checkout block — the total, a collapsible line-item
  // breakdown (contribution + premium + insurance payout), and the plain-language
  // note. Rendered ABOVE the payment picker in pay mode (checkout convention) and
  // at the foot of the plan summary otherwise.
  const payTodayNode = (
    <div className={styles.paytoday}>
      <div className={styles.ptHead}>
        <div className={styles.ptHeadMain}>
          <span className={styles.ptKey}>{isAgent ? 'They pay today' : 'You pay today'}</span>
          <span className={styles.ptVal}>{hasAmount ? formatUGXExact(dueDisplay) : 'UGX —'}</span>
        </div>
        {hasBreakdown && (
          <button
            type="button"
            className={styles.ptToggle}
            aria-expanded={breakdownOpen}
            aria-controls="pay-breakdown"
            onClick={() => setBreakdownOpen((o) => !o)}
          >
            <span>Breakdown</span>
            <svg className={styles.ptChevron} data-open={breakdownOpen || undefined} viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {hasBreakdown && breakdownOpen && (
          <motion.div
            key="breakdown"
            id="pay-breakdown"
            className={styles.ptBreak}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
          >
            <dl className={styles.ptItems}>
              {payItems.map((it) => (
                <div key={it.key} className={styles.ptRow}>
                  <dt className={styles.ptRowK}>{it.label}</dt>
                  <dd className={styles.ptRowV}>
                    {formatUGXExact(it.value)}{it.unit && <small>{it.unit}</small>}
                  </dd>
                </div>
              ))}
              {showPayTotal && (
                <div className={styles.ptRow} data-total="true">
                  <dt className={styles.ptRowK}>Total today</dt>
                  <dd className={styles.ptRowV}>{formatUGXExact(dueDisplay)}</dd>
                </div>
              )}
              <div className={styles.ptRow} data-payout="true">
                <dt className={styles.ptRowK}>
                  Insurance payout
                  <span className={styles.ptRowSub}>{payoutSub}</span>
                </dt>
                <dd className={styles.ptRowV}>{formatUGX(coverTotal, { compact: false })}</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>

      <p className={styles.ptNote}>{dueBrk}</p>
      {!onInsurance && (
        <p className={styles.ptMethods}>Pay with MoMo, Airtel or Pesapal</p>
      )}
    </div>
  );

  // Embedded, the host owns the page landmark and the chrome. A second <main>
  // would be a duplicate landmark (both agent shells already render
  // `<main id="main">`, which is also the skip-link target), and SignupTopbar
  // would contradict the host's own stepper AND offer two `<Link to="/">` exits
  // that drop the agent out of their dashboard mid-onboarding.
  const Root = embedded ? 'div' : 'main';

  return (
    <Root
      className={styles.page}
      data-embedded={embedded || undefined}
      aria-label={embedded ? undefined : 'Set up your savings and first payment'}
      ref={pageRef}
    >
      {!embedded && <SignupTopbar stageKey="plan" />}

      <div className={styles.shell} data-pinned={embedded ? undefined : 'true'} ref={shellRef}>
      <motion.div
        className={`${styles.card} ${styles.cardWizard}`}
        initial={{ opacity: 0, y: 14, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
      >
        {/* ── Sub-step tabs ─────────────────────────────────────── */}
        <div className={styles.cardTop}>
          <div className={styles.substeps} role="tablist" aria-label="Set up steps">
            <button
              type="button"
              role="tab"
              aria-selected={page === 'contrib'}
              className={styles.substep}
              data-on={page === 'contrib'}
              data-done={page === 'insurance'}
              onClick={() => goPage('contrib')}
            >
              <span className={styles.substepNum} aria-hidden="true">
                {page === 'insurance' ? <IconCheck /> : '1'}
              </span>
              <span className={styles.substepLabel}>
                {isAgent ? 'Their savings' : 'Your savings'}<small>How much &amp; how often</small>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={page === 'insurance'}
              className={styles.substep}
              data-on={page === 'insurance'}
              onClick={() => goPage('insurance')}
            >
              <span className={styles.substepNum} aria-hidden="true">2</span>
              <span className={styles.substepLabel}>
                {isAgent ? 'Protect their family' : 'Protect your family'}<small>Add cover (optional)</small>
              </span>
            </button>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label={embedded ? 'Back to the KYC step' : 'Close contribution setup'}
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Scroll body: the two pages ────────────────────────── */}
        <div className={styles.pbody} ref={pbodyRef}>
          {/* PAGE 1 — Your savings */}
          <div className={styles.pagePanel} data-on={page === 'contrib'}>
            {/* Section 1 — Frequency */}
            <section className={styles.section} aria-label="How often?">
              <div className={styles.sectionEyebrow}>01 · How often?</div>
              <PillChipGroup
                label="Contribution frequency"
                layout="grid"
                columns={FREQUENCIES.length}
                className={styles.freqGrid}
              >
                {FREQUENCIES.map((f) => {
                  const active = frequency === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-active={active}
                      className={styles.freqCard}
                      onClick={() => setFrequency(f.id)}
                    >
                      <span className={styles.freqLabel}>{f.label}</span>
                      <span className={styles.freqHelper}>{f.helper}</span>
                      <span className={styles.freqCheck} aria-hidden="true">
                        <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
                          <path d="M3 8.5l3.2 3 6.3-7" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                  );
                })}
              </PillChipGroup>
            </section>

            {/* Section 2 — Amount */}
            <section className={styles.section} aria-label="How much each time?">
              <div className={styles.sectionEyebrow}>
                02 · How much each time?
                <span className={styles.sectionAside}>Min {formatUGXExact(MIN_CONTRIBUTION)}</span>
              </div>

              <label className={styles.amountField} data-error={belowMin && touched}>
                <span className={styles.amountPrefix} aria-hidden="true">UGX</span>
                <input
                  ref={amountInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Enter amount"
                  aria-label="Contribution amount in UGX"
                  aria-invalid={belowMin && touched}
                  aria-describedby="amt-helper"
                  className={styles.amountInput}
                  value={amountStr ? formatNumber(Number.parseInt(amountStr, 10)) : ''}
                  onChange={handleAmountChange}
                  onBlur={() => setTouched(true)}
                />
                <span className={styles.amountCadence} aria-hidden="true">{cadence}</span>
              </label>

              <div className={styles.presetRow} role="group" aria-label="Quick-select amounts">
                {presetsForFrequency(freq.id).map((v) => {
                  const active = amount === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      className={styles.presetChip}
                      data-active={active}
                      onClick={() => handlePresetClick(v)}
                    >
                      {formatUGXExact(v)}
                    </button>
                  );
                })}
              </div>

              {belowMin && touched && (
                <p id="amt-helper" className={styles.errorLine}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
                    <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                  Enter at least {formatUGXExact(MIN_CONTRIBUTION)} to continue.
                </p>
              )}
            </section>

            {/* Section 3 — Allocation */}
            <section className={styles.section} aria-label={isAgent ? 'Split their savings' : 'Split your savings'}>
              <div className={styles.sectionEyebrow}>03 · Split {isAgent ? 'their' : 'your'} savings</div>

              <div className={styles.splitHead}>
                <div className={styles.splitSide}>
                  <span className={styles.splitLabel}>Retirement</span>
                  <span className={styles.splitPct}>{retirementPct}<em>%</em></span>
                </div>
                <div className={styles.splitSide} data-align="right">
                  <span className={styles.splitLabel} data-tone="teal">Liquid savings</span>
                  <span className={styles.splitPct} data-tone="teal">{emergencyPct}<em>%</em></span>
                </div>
              </div>

              <input
                type="range"
                min={60}
                max={100}
                step={5}
                value={retirementPct}
                onChange={(e) => setRetirementPct(Number.parseInt(e.target.value, 10))}
                aria-label="Retirement savings percentage"
                aria-valuetext={`${retirementPct} percent to retirement, ${emergencyPct} percent to liquid savings`}
                className={styles.slider}
                style={{ '--pct': `${(retirementPct - 60) * 2.5}%` }}
              />

              <div
                className={styles.allocBar}
                role="img"
                aria-label={`${retirementPct}% retirement, ${emergencyPct}% liquid savings`}
              >
                <span className={styles.allocFillRetirement} style={{ flexBasis: `${retirementPct}%` }} />
                <span className={styles.allocFillEmergency} style={{ flexBasis: `${emergencyPct}%` }} />
              </div>

              <p className={styles.bucketHelp}>
                <span className={styles.bucketDot} data-tone="retirement" aria-hidden="true" />
                <strong>Retirement</strong> is locked until retirement age
                <span className={styles.bucketSep} aria-hidden="true">·</span>
                <span className={styles.bucketDot} data-tone="emergency" aria-hidden="true" />
                <strong>Liquid savings</strong> can be taken out any time
              </p>
            </section>

            {/* Section 4 — Yearly step-up (indexation) */}
            <section className={styles.section} aria-label={isAgent ? 'Grow their saving each year' : 'Grow your saving each year'}>
              <div className={styles.idxTop}>
                <div className={styles.idxTopText}>
                  <div className={styles.sectionEyebrow}>
                    04 · Grow each year
                    <span className={styles.sectionAside}>optional</span>
                  </div>
                  <p className={styles.idxSub}>
                    Prices rise every year. Let {isAgent ? 'their' : 'your'} saving rise a little too, so it keeps its value.
                  </p>
                </div>
                <div className={styles.idxBadge} data-off={indexationPct === 0}>
                  {indexationPct === 0 ? 'Off' : <>+{indexationPct}%<small>/yr</small></>}
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={15}
                step={1}
                value={indexationPct}
                onChange={(e) => setIndexationPct(Number.parseInt(e.target.value, 10))}
                aria-label={isAgent ? 'How much their saving goes up each year' : 'How much your saving goes up each year'}
                aria-valuetext={indexationPct === 0 ? 'Off, saving stays the same' : `Goes up ${indexationPct} percent each year`}
                className={`${styles.slider} ${styles.idxSlider}`}
                style={{ '--pct': `${(indexationPct / 15) * 100}%` }}
              />
              <div className={styles.idxLabels}>
                <span>Off</span>
                <span>Grows fastest</span>
              </div>
              <div className={styles.idxEffect}>
                {indexationPct === 0 ? (
                  `${isAgent ? 'Their' : 'Your'} saving stays the same each year.`
                ) : hasAmount ? (
                  <>
                    {formatUGXExact(amount)} now →{' '}
                    <strong>{formatUGXExact(Math.round(amount * (1 + indexationPct / 100)))}</strong>{' '}
                    next year, then a bit more every year.
                  </>
                ) : (
                  'Enter an amount to see how it grows.'
                )}
              </div>
            </section>
          </div>

          {/* PAGE 2 — Protect your family */}
          <div className={styles.pagePanel} data-on={page === 'insurance'}>
            <section className={styles.section} aria-label={isAgent ? 'Protect their family' : 'Protect your family'}>
              <div className={styles.sectionEyebrow}>
                05 · Protect {isAgent ? 'their' : 'your'} family
                <span className={styles.sectionAside}>optional add-ons</span>
              </div>
              <p className={styles.pageMuted}>
                Pick {isAgent ? 'their' : 'your'} cover and how much it pays. Pay once a year.
              </p>

              <div className={styles.prods} role="group" aria-label={isAgent ? 'Choose their cover' : 'Choose your cover'}>
                {ORDERED_INSURANCE.map((p) => {
                  const active = insuranceTypes.includes(p.id);
                  // Selected products show their CHOSEN tier; unselected ones
                  // preview the entry tier, so a card always quotes a real price.
                  const shown = selectedProducts.find((s) => s.id === p.id) ?? p;
                  const short = shortProductName(p.label);
                  return (
                    // The card is a container, not a control: a range input
                    // cannot live inside a <button>, so the switch is a child
                    // and the cover picker its sibling. The switch keeps the
                    // whole-card accessible name (starting with the short
                    // product name) that the E2E helper anchors on.
                    <div key={p.id} className={styles.prod} data-active={active}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        className={styles.prodToggle}
                        onClick={() => toggleInsurance(p.id)}
                      >
                        <span className={styles.prodTick} aria-hidden="true"><IconCheck /></span>
                        <span className={styles.prodIcon} aria-hidden="true"><ProductIcon id={p.id} /></span>
                        <span className={styles.prodName}>{short}</span>
                        <span className={styles.prodBlurb}>{p.blurb}</span>
                        <span className={styles.prodPrice}>
                          {formatUGXExact(annualPremium(shown))}<small>/year</small>
                        </span>
                        <span className={styles.prodCover}>Pays {formatUGXExact(shown.cover)}</span>
                      </button>
                      {active && (
                        <div className={styles.prodPick}>
                          <CoverTierPicker
                            variant="card"
                            productId={p.id}
                            value={insuranceCovers[p.id]}
                            label={`${short} cover amount`}
                            showReadout={false}
                            onChange={(cover) => setProductCover(p.id, cover)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className={styles.target}>
                <span className={styles.targetKey}>Cost for one year</span>
                <span className={styles.targetVal}>
                  {hasProducts ? <>{formatUGXExact(insuranceTarget)}<small> /year</small></> : '—'}
                </span>
              </div>

              {hasProducts && (
                <>
                  <p className={styles.routesHeading}>{isAgent ? 'How do they want to pay?' : 'How do you want to pay?'}</p>
                  <div className={styles.routes} role="radiogroup" aria-label={isAgent ? 'How do they want to pay' : 'How do you want to pay'}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isRouteA}
                      className={styles.route}
                      data-active={isRouteA}
                      onClick={() => setRoute('A')}
                    >
                      <span className={styles.routeTop}>
                        <span className={styles.routeDot} aria-hidden="true" />
                        <span className={styles.routeLabel}>Pay now</span>
                      </span>
                      <span className={styles.routeSub}>Pay the whole year today. Covered today.</span>
                      <span className={styles.routeTag} data-tone="now">Covered today</span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={!isRouteA}
                      className={styles.route}
                      data-active={!isRouteA}
                      onClick={() => setRoute('B')}
                    >
                      <span className={styles.routeTop}>
                        <span className={styles.routeDot} aria-hidden="true" />
                        <span className={styles.routeLabel}>Save up for it</span>
                      </span>
                      <span className={styles.routeSub}>
                        {isAgent ? 'Their' : 'Your'} saving fills the tin. Cover starts when {isAgent ? 'their' : 'your'} coins reach the line.
                      </span>
                      <span className={styles.routeTag} data-tone="build">Save up</span>
                    </button>
                  </div>

                  {isRouteA ? (
                    <div className={styles.aline}>
                      <IconCheckCircle />
                      <span className={styles.alineTx}>
                        <strong>Pay today, covered today.</strong> It starts again every year on its own.
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className={styles.savePct}>
                        <div className={styles.savePctHead}>
                          <span className={styles.savePctLabel}>How much of {isAgent ? 'their' : 'your'} liquid savings builds cover?</span>
                          <strong className={styles.savePctVal}>{savingsPct}%</strong>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={savingsPct}
                          onChange={(e) => setSavingsPct(Number.parseInt(e.target.value, 10))}
                          aria-label="Percent of liquid savings that builds cover"
                          aria-valuetext={`${savingsPct} percent — ${formatUGXExact(coverPerPeriod)} to insurance, ${formatUGXExact(liquidPerPeriod)} stays liquid`}
                          className={styles.slider}
                          style={{ '--pct': `${savingsPct}%` }}
                        />
                        {/* Where the split lands, minimal: what stays liquid vs what
                            goes to insurance — aligned under the slider's two ends. */}
                        <div className={styles.savePctMeter} aria-hidden="true">
                          <span className={styles.savePctMeterCell}>
                            <span className={styles.savePctMeterK}>Liquid savings</span>
                            <span className={styles.savePctMeterV}>{formatUGXExact(liquidPerPeriod)}<small>/{periodLabel}</small></span>
                          </span>
                          <span className={styles.savePctMeterCell} data-tone="cover">
                            <span className={styles.savePctMeterK}>Insurance</span>
                            <span className={styles.savePctMeterV}>{formatUGXExact(coverPerPeriod)}<small>/{periodLabel}</small></span>
                          </span>
                        </div>
                      </div>
                      <SaveUpTin
                        target={insuranceTarget}
                        monthlyEmergency={monthlyToCover}
                        monthsToCover={monthsToCover}
                        emergencyPct={emergencyPct}
                        isZero={coverGetsNothing}
                      />
                    </>
                  )}
                </>
              )}
            </section>
          </div>

          {/* Narrow-layout payment block: on phones/tablets the summary aside
              stacks off-screen below, so the picker lives here in-card, directly
              above the sticky footer Pay CTA. Desktop uses the aside instead. */}
          {showInCardPay && (
            <div className={styles.mobilePay} ref={mobilePayRef}>
              {payTodayNode}
              <PaymentMethodPicker
                method={method}
                setMethod={setMethod}
                momoProvider={momoProvider}
                setMomoProvider={setMomoProvider}
                momoPhone={momoPhone}
                setMomoPhone={setMomoPhone}
                processing={processing}
              />
            </div>
          )}
        </div>

        {/* ── Pinned footer CTA ─────────────────────────────────── */}
        <div className={styles.pfoot}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => (payMode ? setPayMode(false) : goPage('contrib'))}
            style={{ visibility: onInsurance ? 'visible' : 'hidden' }}
          >
            <IconArrowLeft /> Back
          </button>
          <button
            type="button"
            className={styles.ctaBtn}
            disabled={ctaDisabled}
            onClick={handleCta}
            aria-busy={processing || undefined}
          >
            {onInsurance && processing ? (
              <>
                <span className={styles.pmtSpinner} aria-hidden="true" />
                <span>{ctaLabel}</span>
              </>
            ) : (
              <>
                <span>{ctaLabel}</span>
                <IconArrowRight />
              </>
            )}
          </button>
        </div>
      </motion.div>

      {/* ── Summary / checkout aside ──────────────────────────────── */}
      {/* Suppressed on narrow layouts during pay mode — the pay block renders
          in-card there (showInCardPay) so the picker isn't duplicated off-screen. */}
      {!showInCardPay && (
      <motion.aside
        className={styles.summaryCard}
        aria-label={isAgent ? 'Their plan summary' : 'Your plan summary'}
        initial={{ opacity: 0, y: 14, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: EASE_OUT_EXPO, delay: 0.08 }}
      >
        <header className={styles.sumHd}>
          <div className={styles.sumHdTitle}>{payMode ? 'Payment' : (isAgent ? 'Their plan' : 'Your plan')}</div>
          <div className={styles.sumHdSub}>{payMode ? 'Choose how to pay' : `Step ${onInsurance ? '2' : '1'} of 2`}</div>
        </header>

        {payMode ? (
          <>
            {/* Checkout convention: what you pay today (+ breakdown) sits ABOVE
                the payment-method choice. */}
            {payTodayNode}
            <PaymentMethodPicker
              method={method}
              setMethod={setMethod}
              momoProvider={momoProvider}
              setMomoProvider={setMomoProvider}
              momoPhone={momoPhone}
              setMomoPhone={setMomoPhone}
              processing={processing}
            />
          </>
        ) : (
          <>
        {/* You put in — the contribution now + monthly-overall */}
        <div className={styles.putin}>
          <div className={styles.putinLabel}>{isAgent ? 'They put in' : 'You put in'}</div>
          <div className={styles.putinBig}>
            {hasAmount ? formatUGXExact(amount) : 'UGX —'}
            {hasAmount && <small>/{periodLabel}</small>}
          </div>
          <p className={styles.putinSub}>
            {hasAmount ? planSubText : `Enter an amount to see ${isAgent ? 'their' : 'your'} plan.`}
          </p>
        </div>

        {/* What it grows into — three outcome cards */}
        <div className={styles.ocards}>
          <div className={styles.oc} data-tone="ret">
            <div className={styles.ocTop}>
              <span className={styles.ocName}>Retirement fund</span>
              <span className={styles.ocVal}>
                {hasAmount && retirementFV > 0 ? `≈ ${formatProjection(retirementFV)}` : '—'}
              </span>
            </div>
            <p className={styles.ocSub}>
              {retirementYears == null ? `Add ${isAgent ? 'their' : 'your'} date of birth` : `Locked until age ${RETIREMENT_AGE}`}
            </p>
          </div>

          <div className={styles.oc} data-tone="emg">
            <div className={styles.ocTop}>
              <span className={styles.ocName}>Liquid savings</span>
              <span className={styles.ocVal}>
                {hasAmount && emergencyFV > 0 ? `≈ ${formatProjection(emergencyFV)}` : '—'}
              </span>
            </div>
            <p className={styles.ocSub}>Take out any time</p>
          </div>

          {onInsurance && (
            <div className={styles.oc} data-tone="ins" data-empty={!hasProducts}>
              <div className={styles.ocTop}>
                <span className={styles.ocName}>Insurance cover</span>
                <span className={styles.ocVal}>
                  {hasProducts ? formatUGX(coverTotal, { compact: true }) : 'None'}
                </span>
              </div>
              <p className={styles.ocSub}>{coverCardSub}</p>
            </div>
          )}
        </div>

        {/* You pay today — foot of the plan summary. */}
        {payTodayNode}
          </>
        )}
      </motion.aside>
      )}
      </div>
    </Root>
  );
}

/**
 * Employer-invite completion — a confirmation only: what the member is getting,
 * and a "Finish enrolment" action. No frequency, amount, split, insurance or
 * payment is collected.
 *
 * This is the path for EVERY employer invite (migration 0092 sets
 * employer_invites.collect_schedule to a constant false). Under the unified
 * contribution model the employer sets BOTH legs — what comes out of the member's
 * pay and what the company adds — so the member has no amount to choose and no
 * first deposit to pay; their schedule row is created at 0 and the employer's
 * contribution runs fund them from then on. Insurance is deliberately not offered
 * here either: group cover is employer-funded via the 0067 fan-out, and 0068
 * blocks a member from re-buying a product their employer already pays for.
 *
 * This screen USED to ask for the retirement/liquid split, on the reasoning that
 * it was the one choice still genuinely the member's. It is not: an employer
 * member states no amount at enrolment, so all the question did was offer to
 * divert their employer's pension money into a pot they can withdraw at any time.
 *
 * The two concerns are now separate. Employer money lands wholly in retirement
 * (`EMPLOYER_FUNDED_SPLIT`, fixed in the run engine). The member's own schedule
 * is created dormant here at `DEFAULT_SCHEDULE_SPLIT` (80/20, amount 0) and is
 * theirs to set up and re-split on the Schedule page whenever they want to save
 * something of their own.
 */
function EmployerInviteFinishView({ onClose, onConfirm }) {
  const [processing, setProcessing] = useState(false);
  const [err, setErr] = useState('');

  async function finish() {
    if (processing) return;
    setProcessing(true);
    setErr('');
    try {
      await onConfirm();
    } catch (e) {
      setErr(e?.message || 'Could not complete enrolment. Please try again.');
      setProcessing(false);
    }
  }

  return (
    <main className={styles.page} aria-labelledby="contrib-title">
      <SignupTopbar stageKey="plan" />
      <div className={styles.shell}>
        <motion.div
          className={styles.card}
          initial={{ opacity: 0, y: 14, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
        >
          <header className={styles.header}>
            <div className={styles.headerText}>
              <span className={styles.eyebrow}>Almost done</span>
              <h1 id="contrib-title" className={styles.title}>Finish setting up</h1>
            </div>
            <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <p style={{ margin: '0 0 1.25rem', color: 'var(--color-gray)', lineHeight: 1.6 }}>
            Your pension is paid for through your job. Your employer decides what comes out of
            your pay and what the company adds on top — so there is nothing here for you to set.
          </p>

          <section className={styles.section} aria-label="What happens to your money">
            <div className={styles.sectionEyebrow}>Your money</div>
            <p className={styles.inviteFact}>
              <span className={styles.bucketDot} data-tone="retirement" aria-hidden="true" />
              <span>
                Every shilling your employer sends goes into your <strong>retirement</strong>{' '}
                savings, and stays there until you retire.
              </span>
            </p>
            <p className={styles.inviteFact}>
              <span className={styles.bucketDot} data-tone="emergency" aria-hidden="true" />
              <span>
                Want money you can take out any time? Add your own savings from your
                account once you are signed in.
              </span>
            </p>
          </section>

          {err && <p style={{ color: '#b42318', margin: '0 0 0.75rem' }} role="alert">{err}</p>}

          <button type="button" className={styles.payNow} onClick={finish} disabled={processing} aria-busy={processing || undefined}>
            <span>{processing ? 'Finishing…' : 'Finish enrolment'}</span>
          </button>
        </motion.div>
      </div>
    </main>
  );
}
