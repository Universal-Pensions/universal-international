import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { calcFV, parseAmount, FREQUENCY, periodsPerYear } from '../../utils/finance';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX, formatNumber } from '../../utils/currency';
import {
  RETIREMENT_AGE,
  MIN_CONTRIBUTION,
  INSURANCE_PRODUCTS,
} from '../../constants/savings';
import SignupTopbar from '../SignupTopbar';
import { PillChipGroup } from '../../components/PillChip';
import styles from './ContributionSettings.module.css';

export { MIN_CONTRIBUTION };

const FREQUENCIES = [
  { id: FREQUENCY.WEEKLY,      label: 'Weekly',      helper: 'every week',     cadence: 'every week'     },
  { id: FREQUENCY.MONTHLY,     label: 'Monthly',     helper: 'every month',    cadence: 'every month'    },
  { id: FREQUENCY.QUARTERLY,   label: 'Quarterly',   helper: 'every 3 months', cadence: 'every 3 months' },
  { id: FREQUENCY.HALF_YEARLY, label: 'Half-Yearly', helper: 'every 6 months', cadence: 'every 6 months' },
  { id: FREQUENCY.ANNUALLY,    label: 'Annually',    helper: 'every year',     cadence: 'every year'     },
];

const PRESET_AMOUNTS = [10000, 25000, 50000, 100000];

const PAYMENT_METHODS = [
  { id: 'momo',    label: 'Mobile Money',            description: 'MTN or Airtel — instant confirmation' },
  { id: 'gateway', label: 'Pay with another method', description: 'Card, bank or wallet — via Pesapal'   },
];

/** Short per-period suffix for premium chips ("/mo", "/wk", …). */
const PERIOD_SUFFIX = {
  [FREQUENCY.WEEKLY]:      'wk',
  [FREQUENCY.MONTHLY]:     'mo',
  [FREQUENCY.QUARTERLY]:   'qtr',
  [FREQUENCY.HALF_YEARLY]: '6mo',
  [FREQUENCY.ANNUALLY]:    'yr',
};

/**
 * Display order for the insurance list (Life, Health, Funeral — the mockup
 * order). Render-only reorder of INSURANCE_PRODUCTS; the constant and its
 * premium/cover values are untouched, and the default selection stays life-only.
 */
const INSURANCE_DISPLAY_ORDER = ['life', 'health', 'funeral'];
const ORDERED_INSURANCE = INSURANCE_DISPLAY_ORDER
  .map((id) => INSURANCE_PRODUCTS.find((p) => p.id === id))
  .filter(Boolean);

/** Relatable Ugandan milestones — shown at retirement. */
const MILESTONES = [
  { id: 'land',    cost: 8_000_000, one: 'plot of land',        many: 'plots of land' },
  { id: 'tuition', cost: 4_000_000, one: 'year of university',  many: 'years of university' },
  { id: 'income',  cost: 1_000_000, one: 'month of income',     many: 'months of retirement income' },
];

function getFreq(frequencyId) {
  return FREQUENCIES.find((f) => f.id === frequencyId) ?? FREQUENCIES[1];
}

function digitsOnly(str, max = 10) {
  return String(str).replace(/[^\d]/g, '').slice(0, max);
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

/** Default insurance selection: life only (preserves the long-standing demo
 *  default of a single life policy). The user can add Health/Funeral. */
function resolveInitialInsurance(initial) {
  if (Array.isArray(initial?.insuranceTypes)) return initial.insuranceTypes;
  // Legacy single-toggle schedules → life if they opted in, else default to life.
  if (initial?.includeInsurance === false) return [];
  return ['life'];
}

/**
 * Payment-method picker — section 05 at the bottom of the (white) contribution
 * panel. The actual Pay action is the summary aside's CTA; this only collects
 * the method + momo details. State is owned by ContributionSettings.
 */
function PaymentMethodPicker({ method, setMethod, momoProvider, setMomoProvider, momoPhone, setMomoPhone, processing }) {
  return (
    <section className={styles.pmtSection} aria-label="How will you pay?">
      <div className={styles.sectionEyebrow}>How will you pay?</div>

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
                          You’ll be redirected to Pesapal to complete payment securely.
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
 * Full page for /signup/contribution — the "Plan & pay" stage. Sets the
 * contribution schedule, insurance products, and payment method on a single
 * page (no separate payment step), then makes the first contribution.
 */
export default function ContributionSettings({ initial, dob, phone, collectSchedule = true, onClose, onConfirm }) {
  const [frequency, setFrequency] = useState(initial?.frequency ?? 'monthly');
  const [amountStr, setAmountStr] = useState(initial?.amount ? String(initial.amount) : '');
  const [retirementPct, setRetirementPct] = useState(initial?.retirementPct ?? 80);
  const [insuranceTypes, setInsuranceTypes] = useState(() => resolveInitialInsurance(initial));
  const [touched, setTouched] = useState(Boolean(initial?.amount));

  // Payment state (formerly PaymentStep's) — the picker lives in the summary
  // aside and the Pay CTA below it shares this state.
  const [method, setMethod] = useState('momo');
  const [momoProvider, setMomoProvider] = useState('mtn');
  const [momoPhone, setMomoPhone] = useState(phone || '');
  const [processing, setProcessing] = useState(false);

  const amountInputRef = useRef(null);

  // Escape returns without saving.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !processing) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, processing]);

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
  const selectedProducts = useMemo(
    () => ORDERED_INSURANCE.filter((p) => insuranceTypes.includes(p.id)),
    [insuranceTypes],
  );
  const periodLabel = PERIOD_SUFFIX[freq.id] ?? 'mo';
  const insurancePremium = selectedProducts.reduce(
    (sum, p) => sum + perPeriodPremium(p.premiumMonthly),
    0,
  );
  const totalPerPeriod   = hasAmount ? amount + insurancePremium : 0;
  const annualTotal      = hasAmount ? totalPerPeriod * freqPerYear : 0;

  const contribAnnual       = hasAmount ? amount * freqPerYear : 0;
  const contribMonthly      = contribAnnual / 12;
  const retirementPerPeriod = hasAmount ? Math.round(amount * (retirementPct / 100)) : 0;
  const emergencyPerPeriod  = hasAmount ? amount - retirementPerPeriod : 0;

  const yrs = yearsToRetirement(dob);
  const retirementMonthly = contribMonthly * (retirementPct / 100);
  const retirementFV = yrs && yrs > 0 ? calcFV(retirementMonthly, yrs) : 0;
  const retirementYears = yrs != null ? Math.round(yrs) : null;
  const retirementYear  = retirementYears && retirementYears > 0
    ? new Date().getFullYear() + retirementYears
    : null;

  const milestones = useMemo(() => {
    if (!hasAmount || retirementFV <= 0) return [];
    return MILESTONES
      .map((m) => ({ ...m, count: Math.floor(retirementFV / m.cost) }))
      .filter((m) => m.count >= 1);
  }, [hasAmount, retirementFV]);

  const momoValid = digitsOnly(momoPhone).length >= 9;
  const canPay = canConfirm && (method === 'gateway' || momoValid);

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
          insurancePremium,
          paymentMethod: method,
          paymentDetails: details,
        });
      } catch {
        setProcessing(false);
      }
    }, 1200);
  }

  // Employer-only invite: collect ONLY the retirement/emergency split — no
  // frequency, amount, insurance, or payment. Renders a compact card.
  if (!collectSchedule) {
    return (
      <SplitOnlyView
        retirementPct={retirementPct}
        emergencyPct={emergencyPct}
        setRetirementPct={setRetirementPct}
        onClose={onClose}
        onConfirm={() => onConfirm({ retirementPct, emergencyPct })}
      />
    );
  }

  const payLabel = processing
    ? (method === 'gateway' ? 'Redirecting…' : 'Processing…')
    : (method === 'gateway' ? 'Continue with Pesapal' : (hasAmount ? `Pay ${formatUGXExact(totalPerPeriod)}` : 'Pay'));

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
        {/* ── Header ──────────────────────────────────────────── */}
        <header className={styles.header}>
          <div className={styles.headerText}>
            <span className={styles.eyebrow}>Your plan</span>
            <h1 id="contrib-title" className={styles.title}>Set up your contributions &amp; first payment</h1>
            <p className={styles.lede}>
              Choose how you save, then make your first contribution to switch your account on.
              You can change any of this later.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close contribution setup"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* ── Section 1 — Frequency ─────────────────────────────── */}
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

        {/* ── Section 2 — Amount ────────────────────────────────── */}
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
            {PRESET_AMOUNTS.map((v) => {
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

        {/* ── Section 3 — Allocation ────────────────────────────── */}
        <section className={styles.section} aria-label="Split your savings">
          <div className={styles.sectionEyebrow}>03 · Split your savings</div>

          <div className={styles.splitHead}>
            <div className={styles.splitSide}>
              <span className={styles.splitLabel}>Retirement</span>
              <span className={styles.splitPct}>{retirementPct}<em>%</em></span>
            </div>
            <div className={styles.splitSide} data-align="right">
              <span className={styles.splitLabel} data-tone="teal">Emergency</span>
              <span className={styles.splitPct} data-tone="teal">{emergencyPct}<em>%</em></span>
            </div>
          </div>

          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={retirementPct}
            onChange={(e) => setRetirementPct(Number.parseInt(e.target.value, 10))}
            aria-label="Retirement savings percentage"
            aria-valuetext={`${retirementPct} percent to retirement, ${emergencyPct} percent to emergency`}
            className={styles.slider}
            style={{ '--pct': `${retirementPct}%` }}
          />

          <div
            className={styles.allocBar}
            role="img"
            aria-label={`${retirementPct}% retirement, ${emergencyPct}% emergency`}
          >
            <span className={styles.allocFillRetirement} style={{ flexBasis: `${retirementPct}%` }} />
            <span className={styles.allocFillEmergency} style={{ flexBasis: `${emergencyPct}%` }} />
          </div>

          <p className={styles.bucketHelp}>
            <span className={styles.bucketDot} data-tone="retirement" aria-hidden="true" />
            <strong>Retirement</strong> is locked until retirement age
            <span className={styles.bucketSep} aria-hidden="true">·</span>
            <span className={styles.bucketDot} data-tone="emergency" aria-hidden="true" />
            <strong>Emergency</strong> is accessible in cases of hardship
          </p>
        </section>

        {/* ── Section 4 — Insurance (multi-product) ─────────────── */}
        <section className={styles.section} aria-label="Protect your family">
          <div className={styles.sectionEyebrow}>
            04 · Protect your family
            <span className={styles.sectionAside}>optional add-ons</span>
          </div>
          <div className={styles.insuranceList}>
            {ORDERED_INSURANCE.map((p) => {
              const active = insuranceTypes.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  role="switch"
                  aria-checked={active}
                  className={styles.insuranceRow}
                  data-active={active}
                  onClick={() => toggleInsurance(p.id)}
                >
                  <span className={styles.insuranceIcon} aria-hidden="true">
                    <ProductIcon id={p.id} />
                  </span>
                  <span className={styles.insuranceCopy}>
                    <span className={styles.insuranceTitle}>{p.label}</span>
                    <span className={styles.insuranceDetail}>{p.blurb}</span>
                  </span>
                  <span className={styles.insurancePremium}>
                    {`+${formatUGXExact(perPeriodPremium(p.premiumMonthly))}`}
                    <small> /{periodLabel}</small>
                  </span>
                  <span className={styles.insuranceToggle} aria-hidden="true">
                    <span className={styles.insuranceToggleKnob} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>

      </motion.div>

      {/* ── Summary / checkout card ──────────────────────────────── */}
      <motion.aside
        className={styles.summaryCard}
        aria-label="Your plan summary"
        initial={{ opacity: 0, y: 14, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: EASE_OUT_EXPO, delay: 0.08 }}
      >
        <header className={styles.summaryHeader}>
          <span className={styles.summaryEyebrow}>Your plan</span>
          <h2 className={styles.summaryTitle}>What you’ll pay</h2>
        </header>

        <div className={styles.summaryHero}>
          <span className={styles.summaryHeroValue}>
            {hasAmount ? formatUGXExact(totalPerPeriod) : 'UGX —'}
            {hasAmount && <span className={styles.summaryHeroCadence}> /{periodLabel}</span>}
          </span>
        </div>

        <ul className={styles.summaryList}>
          <li className={styles.summaryRow}>
            <span className={styles.summaryRowLabel}>Per year</span>
            <span className={styles.summaryRowValue}>
              {hasAmount ? formatUGXExact(annualTotal) : '—'}
            </span>
          </li>
          <li className={styles.summaryRow}>
            <span className={styles.summaryRowLabel}>
              <span className={styles.summaryDot} data-tone="retirement" aria-hidden="true" />
              Retirement <em>{retirementPct}%</em>
            </span>
            <span className={styles.summaryRowValue}>
              {hasAmount ? formatUGXExact(retirementPerPeriod) : '—'}
            </span>
          </li>
          <li className={styles.summaryRow}>
            <span className={styles.summaryRowLabel}>
              <span className={styles.summaryDot} data-tone="emergency" aria-hidden="true" />
              Emergency <em>{emergencyPct}%</em>
            </span>
            <span className={styles.summaryRowValue}>
              {hasAmount ? formatUGXExact(emergencyPerPeriod) : '—'}
            </span>
          </li>
          {selectedProducts.map((p) => (
            <li key={p.id} className={styles.summaryRow}>
              <span className={styles.summaryRowLabel}>
                <span className={styles.summaryDot} data-tone="insurance" aria-hidden="true" />
                {p.label}
              </span>
              <span className={styles.summaryRowValue}>
                {hasAmount ? `+${formatUGXExact(perPeriodPremium(p.premiumMonthly))}` : '—'}
              </span>
            </li>
          ))}
          <li className={styles.summaryRow} data-due="true">
            <span className={styles.summaryRowLabel}>Due today</span>
            <span className={styles.summaryRowValue}>
              {hasAmount ? formatUGXExact(totalPerPeriod) : '—'}
            </span>
          </li>
        </ul>
        {hasAmount && insurancePremium > 0 && (
          // The contribution grows the member's savings; the premium pays for
          // insurance cover and is NOT added to the pension balance. Spell that
          // out so "Due today" reconciles with the post-signup dashboard balance.
          <p className={styles.dueNote}>
            {formatUGXExact(amount)} goes into your savings; {formatUGXExact(insurancePremium)} pays your insurance premium.
          </p>
        )}

        {/* ── Future value at retirement ──────────────────────────── */}
        <div className={styles.projection}>
          <div className={styles.projectionLabel}>
            At retirement (age {RETIREMENT_AGE})
            {retirementYears != null && retirementYears > 0 && ` · in ${retirementYears} yrs`}
          </div>
          <div className={styles.projectionValue}>
            {hasAmount && retirementFV > 0 ? `≈ ${formatProjection(retirementFV)}` : 'UGX —'}
          </div>
          {retirementYear && (
            <p className={styles.projectionYear}>
              You’ll reach age {RETIREMENT_AGE} in <strong>{retirementYear}</strong>
            </p>
          )}
          <p className={styles.projectionHelp}>
            {retirementYears == null
              ? 'Add your date of birth to see a projection.'
              : retirementYears <= 0
                ? 'You’re already at retirement age — contributions stay accessible.'
                : `At 10% annual return, compounded monthly — retirement bucket only.`}
          </p>
        </div>

        {/* ── What that could buy ─────────────────────────────────── */}
        {milestones.length > 0 && (
          <section className={styles.milestones} aria-label="What your retirement savings could buy">
            <h3 className={styles.milestonesTitle}>That could buy you…</h3>
            <ul className={styles.milestonesList}>
              {milestones.map((m) => (
                <li key={m.id} className={styles.milestone}>
                  <span className={styles.milestoneIcon} aria-hidden="true">
                    {m.id === 'land' && (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                        <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1v-9z"
                              stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                      </svg>
                    )}
                    {m.id === 'tuition' && (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                        <path d="M3 9l9-4 9 4-9 4-9-4z"
                              stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                        <path d="M6 11v4.2c0 1.3 2.7 2.3 6 2.3s6-1 6-2.3V11"
                              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M21 9v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    )}
                    {m.id === 'income' && (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                        <rect x="4" y="5" width="16" height="15" rx="1.5"
                              stroke="currentColor" strokeWidth="1.6" />
                        <path d="M4 10h16M8 3v4M16 3v4"
                              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M9 14h6M9 17h4"
                              stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                    )}
                  </span>
                  <span className={styles.milestoneCount}>{formatNumber(m.count)}</span>
                  <span className={styles.milestoneLabel}>
                    {m.count === 1 ? m.one : m.many}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.milestonesNote}>Rough Uganda estimates — actual prices vary.</p>
          </section>
        )}

        {/* ── Payment method — lives in the summary aside so it opens inline
             beside the plan (no separate page / left-column scroll) ───────── */}
        <PaymentMethodPicker
          method={method}
          setMethod={setMethod}
          momoProvider={momoProvider}
          setMomoProvider={setMomoProvider}
          momoPhone={momoPhone}
          setMomoPhone={setMomoPhone}
          processing={processing}
        />

        {/* ── Pay CTA ─────────────────────────────────────────────── */}
        <button
          type="button"
          className={styles.payNow}
          disabled={!canPay || processing}
          onClick={handlePay}
        >
          {processing ? (
            <>
              <span className={styles.pmtSpinner} aria-hidden="true" />
              <span>{payLabel}</span>
            </>
          ) : (
            <>
              <span>{payLabel}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>
      </motion.aside>
      </div>
    </main>
  );
}

/**
 * Employer-only invite completion — collects ONLY the retirement/emergency split
 * and a "Finish enrolment" action (no frequency/amount/insurance/payment). The
 * employer funds the member via contribution runs; the member starts at 0.
 */
function SplitOnlyView({ retirementPct, emergencyPct, setRetirementPct, onClose, onConfirm }) {
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
              <h1 id="contrib-title" className={styles.title}>Split your savings</h1>
            </div>
            <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <p style={{ margin: '0 0 1.25rem', color: 'var(--color-gray)', lineHeight: 1.6 }}>
            Your employer funds your pension. Choose how your savings are split between long-term
            retirement and accessible emergency funds.
          </p>

          <section className={styles.section} aria-label="Retirement vs emergency">
            <div className={styles.sectionEyebrow}>01 · Retirement vs emergency</div>
            <div className={styles.splitHead}>
              <div className={styles.splitSide}>
                <span className={styles.splitLabel}>Retirement</span>
                <span className={styles.splitPct}>{retirementPct}<em>%</em></span>
              </div>
              <div className={styles.splitSide} data-align="right">
                <span className={styles.splitLabel} data-tone="teal">Emergency</span>
                <span className={styles.splitPct} data-tone="teal">{emergencyPct}<em>%</em></span>
              </div>
            </div>
            <input
              type="range" min={0} max={100} step={5} value={retirementPct}
              onChange={(e) => setRetirementPct(Number.parseInt(e.target.value, 10))}
              aria-label="Retirement savings percentage"
              className={styles.slider}
              style={{ '--pct': `${retirementPct}%` }}
            />
            <div className={styles.allocBar} role="img" aria-label={`${retirementPct}% retirement, ${emergencyPct}% emergency`}>
              <span className={styles.allocFillRetirement} style={{ flexBasis: `${retirementPct}%` }} />
              <span className={styles.allocFillEmergency} style={{ flexBasis: `${emergencyPct}%` }} />
            </div>
            <p className={styles.bucketHelp}>
              <span className={styles.bucketDot} data-tone="retirement" aria-hidden="true" />
              <strong>Retirement</strong> is locked until retirement age
              <span className={styles.bucketSep} aria-hidden="true">·</span>
              <span className={styles.bucketDot} data-tone="emergency" aria-hidden="true" />
              <strong>Emergency</strong> is accessible in hardship
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
