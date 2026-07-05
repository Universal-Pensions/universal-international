import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { calcFV, parseAmount, FREQUENCY, periodsPerYear, normalizeFrequency } from '../../utils/finance';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatNumber, formatUGX } from '../../utils/currency';
import {
  RETIREMENT_AGE,
  MIN_CONTRIBUTION,
  INSURANCE_PRODUCTS,
  presetsForFrequency,
  annualPremium,
  tinFillState,
} from '../../constants/savings';
import styles from './ContributionSettingsForm.module.css';

/** Inline glyph for an insurance product, keyed by its `icon` in INSURANCE_PRODUCTS. */
function InsuranceGlyph({ icon }) {
  if (icon === 'health') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
        <path
          d="M12 20s-6.6-4.3-9-8.4C1.4 8.9 3 6 6 6c2 0 3.2 1.2 4 2.4C10.8 7.2 12 6 14 6c3 0 4.6 2.9 3 5.6C18.6 15.7 12 20 12 20z"
          stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (icon === 'funeral') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="12" cy="7" rx="2.3" ry="3.1" />
        <ellipse cx="12" cy="17" rx="2.3" ry="3.1" />
        <ellipse cx="7" cy="12" rx="3.1" ry="2.3" />
        <ellipse cx="17" cy="12" rx="3.1" ry="2.3" />
        <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  // life (default) — shield with check
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Resolve the initial set of selected insurance product ids.
 *
 * `heldInsuranceTypes` (when the parent passes it) is the authoritative set of
 * products the subscriber CURRENTLY holds — derived from their live policies —
 * and takes precedence so the form pre-checks exactly what they own. It is the
 * same set the settle flow treats as already-paid, so opening a fully-held plan
 * and saving it untouched registers no newly-added product and never re-charges
 * a held premium.
 *
 * When it's absent (agent onboarding, or any caller without held-policy data)
 * we fall back to the stored schedule: an explicit `insuranceTypes` array if one
 * was carried, else Life when the legacy `include_insurance` boolean is on.
 */
function resolveInitialSelection(initial, heldInsuranceTypes) {
  const source = Array.isArray(heldInsuranceTypes)
    ? heldInsuranceTypes
    : (Array.isArray(initial?.insuranceTypes) ? initial.insuranceTypes : null);
  if (source) {
    return INSURANCE_PRODUCTS.filter((p) => source.includes(p.id)).map((p) => p.id);
  }
  return initial?.includeInsurance ? ['life'] : [];
}

function sameSelection(a, b) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Clamp a stored/entered indexation step-up into the slider's 0..15 range. */
function clampIndex(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(15, Math.round(n)));
}

const FREQUENCIES = [
  { id: FREQUENCY.DAILY,       label: 'Daily',       helper: 'every day',      cadence: 'every day'      },
  { id: FREQUENCY.WEEKLY,      label: 'Weekly',      helper: 'every week',     cadence: 'every week'     },
  { id: FREQUENCY.MONTHLY,     label: 'Monthly',     helper: 'every month',    cadence: 'every month'    },
  { id: FREQUENCY.QUARTERLY,   label: 'Quarterly',   helper: 'every 3 months', cadence: 'every 3 months' },
  { id: FREQUENCY.HALF_YEARLY, label: 'Half-yearly', helper: 'every 6 months', cadence: 'every 6 months' },
  { id: FREQUENCY.ANNUALLY,    label: 'Annually',    helper: 'every year',     cadence: 'every year'     },
];

function getFreq(id) {
  return FREQUENCIES.find((f) => f.id === id)
    ?? FREQUENCIES.find((f) => f.id === FREQUENCY.MONTHLY);
}

function yearsToRetirement({ age, dob }) {
  if (typeof age === 'number') return Math.max(0, RETIREMENT_AGE - age);
  if (dob) {
    const ageYears = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000);
    if (Number.isFinite(ageYears) && ageYears >= 0 && ageYears <= 120) {
      return Math.max(0, RETIREMENT_AGE - ageYears);
    }
  }
  return 25;
}

/**
 * Reusable contribution-schedule form. Used by subscriber's SchedulePage,
 * agent's SubscriberSchedulePage, and agent's onboarding schedule step.
 *
 * Owns its internal state. Calls `onSave` with the schedule object. Renders
 * a sticky footer with primary (and optional secondary) buttons.
 */
export default function ContributionSettingsForm({
  initial,
  age,
  dob,
  // Product ids the subscriber currently holds (active policies). When supplied
  // these pre-check the insurance toggles so the form reflects what's actually
  // owned — not just the stored `include_insurance` boolean — and they baseline
  // the dirty-check so a held plan saved untouched never re-prompts payment.
  // Optional: callers without held-policy data (agent onboarding) omit it.
  initialInsuranceTypes,
  onSave,
  onCancel,
  submitting = false,
  submitLabel,
  cancelLabel = 'Cancel',
  showProjection = true,
  // `layout="split"` tightens spacing and, when the form has room (a container
  // query at ~860px), lays the inputs + live summary side-by-side to cut the
  // long vertical scroll. Used by the agent's desktop schedule page + onboarding;
  // left undefined elsewhere (e.g. the subscriber dashboard) so they're unchanged.
  layout,
  // `collapsible` (subscriber mobile only): when editing an EXISTING schedule,
  // each section collapses to a summary row (current value + Edit) and expands
  // per-section on tap — so the phone view is a short settings list instead of a
  // long scroll. Ignored for a brand-new setup (nothing to summarise) and left
  // off where the full form is wanted (desktop split, agent, onboarding).
  collapsible = false,
  // `showInsurance` (default true): render the insurance multi-select (section
  // 04) and emit the insurance selection on save. The AGENT's schedule-EDIT
  // forks pass `false` — an agent cannot authorise a premium for someone else
  // (pay_insurance_premium requires app_role='subscriber'), so insurance is the
  // subscriber's own post-signup decision. When false the section is hidden AND
  // the save payload omits includeInsurance/insuranceTypes, so the subscriber's
  // existing insurance flag is left untouched.
  showInsurance = true,
  // `enableSaveToCover` (default false): opt-in to the AGENT-ONBOARDING save-to-cover
  // enhancements — the yearly step-up (indexation) slider and the "pay the premium
  // now / save up for it" A/B route choice, plus their live-summary readouts. When
  // true the save payload also carries `contributionIndexationPct` and (when the
  // insurance section is shown) `insuranceFundingMode` + `insurancePremiumTarget`.
  // The subscriber SchedulePage and the agent schedule-EDIT forks DON'T pass it, so
  // they stay byte-identical (those A/B edit surfaces are a later, separate phase).
  enableSaveToCover = false,
  // `enableIndexation` (default false): surface JUST the yearly step-up slider
  // WITHOUT the (money-critical, funding-mode-locked) save-to-cover A/B routes.
  // `contribution_indexation_pct` is editable post-signup (0072 left it out of the
  // column REVOKE), so the subscriber SchedulePage opts into this on its own to
  // bring the schedule editor up to the onboarding model safely. Implied by
  // `enableSaveToCover` (which already shows the step-up).
  enableIndexation = false,
}) {
  const showIndexation = enableSaveToCover || enableIndexation;
  // State is initialized from `initial` once at mount. If the parent is
  // waiting on async data (e.g., a React Query fetch), it should pass a
  // stable `key` so the form remounts when `initial` first becomes available.
  const [frequency, setFrequency] = useState(normalizeFrequency(initial?.frequency));
  const [amountStr, setAmountStr] = useState(initial?.amount ? String(initial.amount) : '');
  // Retirement must be at least 60% of the split (emergency caps at 40%), so
  // clamp any lower stored/legacy value up to the floor when the form opens.
  const [retirementPct, setRetirementPct] = useState(Math.max(60, initial?.retirementPct ?? 80));
  // Insurance is now a multi-select across INSURANCE_PRODUCTS (health/funeral/life)
  // rather than a single life toggle. Held as an array of product ids.
  const [insuranceTypes, setInsuranceTypes] = useState(() =>
    showInsurance ? resolveInitialSelection(initial, initialInsuranceTypes) : []);
  const [touched, setTouched] = useState(Boolean(initial?.amount));
  // Save-to-cover state (only surfaced when enableSaveToCover). Yearly step-up
  // defaults to +5%; the funding route defaults to "save up" (Route B) unless a
  // stored schedule already chose pay-now.
  const [indexationPct, setIndexationPct] = useState(() =>
    clampIndex(initial?.contributionIndexationPct, 5));
  const [route, setRoute] = useState(() =>
    initial?.insuranceFundingMode === 'pay_now' ? 'A' : 'B');

  const amount = parseAmount(amountStr);
  const freq = getFreq(frequency);
  const freqPerYear = periodsPerYear(freq.id);
  const hasAmount = amount !== null && amount >= MIN_CONTRIBUTION;
  const belowMin = amount !== null && amount < MIN_CONTRIBUTION;
  const emergencyPct = 100 - retirementPct;

  const includeInsurance = insuranceTypes.length > 0;
  const selectedProducts = INSURANCE_PRODUCTS.filter((p) => insuranceTypes.includes(p.id));
  const premiumPerPeriod = (product) => Math.round((product.premiumMonthly * 12) / freqPerYear);
  const insurancePremium = selectedProducts.reduce((sum, p) => sum + premiumPerPeriod(p), 0);

  function toggleInsurance(id) {
    setInsuranceTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const totalPerPeriod = hasAmount ? amount + insurancePremium : 0;
  const retirementPerPeriod = hasAmount ? Math.round(amount * (retirementPct / 100)) : 0;
  const emergencyPerPeriod = hasAmount ? amount - retirementPerPeriod : 0;

  // ── Save-to-cover derived values (agent onboarding; inert when disabled) ────
  // Annual premium target = Σ(premium_monthly × 12) of the chosen products — the
  // same yearly anchor the DB accrual trigger and policies.js renewal maths use.
  const productAnnualTotal = selectedProducts.reduce((sum, p) => sum + annualPremium(p), 0);
  // The emergency bucket funds the save-up tin: convert its per-period slice to a
  // monthly rate, then months-to-cover = target ÷ that rate. Zero emergency (100%
  // retirement) means the tin never fills — surfaced as a guard state.
  const monthlyEmergency = hasAmount ? (emergencyPerPeriod * freqPerYear) / 12 : 0;
  const hasEmergencyFlow = monthlyEmergency > 0;
  const monthsToCover = hasEmergencyFlow && productAnnualTotal > 0
    ? Math.ceil(productAnnualTotal / monthlyEmergency)
    : null;
  // Live pace gauge for the "Filling the tin" pot: coin height + surface tempo
  // track how fast cover would fill, so editing the split/products visibly moves
  // the pile. fxKey remounts the one-shot settle flash on each meaningful change.
  const fill = tinFillState(productAnnualTotal, monthlyEmergency);
  const fxKey = `${Math.round(fill.heightPct)}-${monthsToCover ?? 0}`;
  const isPayNow = route === 'A';
  const nextYearAmount = hasAmount ? Math.round(amount * (1 + indexationPct / 100)) : 0;
  // Amount collected at signup: Route A ("pay now") adds the whole annual premium;
  // Route B ("save up") and no-cover are just the contribution.
  const dueToday = hasAmount
    ? (includeInsurance && isPayNow ? amount + productAnnualTotal : amount)
    : 0;
  const bigValue = enableSaveToCover ? dueToday : totalPerPeriod;
  const dueNote = !includeInsurance
    ? 'This is just your saving.'
    : (isPayNow ? 'Your saving + one year of cover.' : 'Just your saving — cover fills from the tin.');

  const years = yearsToRetirement({ age, dob });
  const contribMonthly = hasAmount ? (amount * freqPerYear) / 12 : 0;
  const retMonthly = contribMonthly * (retirementPct / 100);
  const retirementFV = useMemo(
    () => (years > 0 && retMonthly > 0 ? calcFV(retMonthly, years) : 0),
    [years, retMonthly],
  );
  // Liquid (take-out) bucket projected on the same 10% basis for the plan
  // summary's "if you never withdraw" figure. Cover PAYOUT total (Σ product.cover)
  // is distinct from productAnnualTotal (the annual premium).
  const emgMonthly = contribMonthly * (emergencyPct / 100);
  // On Route B the whole take-out slice fuels the tin and ~productAnnualTotal is
  // swept for premiums each year; only the remainder stays as accessible savings,
  // so "Liquid savings" compounds that liquid remainder (not the full slice).
  const liquidEmgMonthly = (includeInsurance && !isPayNow)
    ? Math.max(0, emgMonthly - productAnnualTotal / 12)
    : emgMonthly;
  const emergencyFV = useMemo(
    () => (years > 0 && liquidEmgMonthly > 0 ? calcFV(liquidEmgMonthly, years) : 0),
    [years, liquidEmgMonthly],
  );
  const coverTotal = selectedProducts.reduce((sum, p) => sum + (p.cover || 0), 0);
  const planSubText = freqPerYear === 12
    ? `≈ ${formatUGX(amount * 12, { compact: false })} a year`
    : `≈ ${formatUGX(contribMonthly, { compact: false })} a month overall`;
  const coverCardSub = !includeInsurance
    ? 'Add insurance above'
    : isPayNow
      ? 'Covered when you pay'
      : hasEmergencyFlow
        ? `Building · about ${monthsToCover} ${monthsToCover === 1 ? 'month' : 'months'}`
        : 'Add liquid savings';

  // Baseline the "dirty" check against the SAME set the form pre-checked (held
  // products when supplied), so opening a fully-held plan and saving it untouched
  // reads as "No changes to save" — never re-prompting payment for held cover.
  const baselineInsurance = useMemo(
    () => (showInsurance ? resolveInitialSelection(initial, initialInsuranceTypes) : []),
    [initial, initialInsuranceTypes, showInsurance],
  );

  const isNew = !initial;
  const dirty = !isNew && (
    frequency !== normalizeFrequency(initial.frequency) ||
    amount !== initial.amount ||
    retirementPct !== initial.retirementPct ||
    !sameSelection(insuranceTypes, baselineInsurance) ||
    (showIndexation && indexationPct !== clampIndex(initial.contributionIndexationPct, 5)) ||
    (enableSaveToCover && showInsurance
      && route !== (initial.insuranceFundingMode === 'pay_now' ? 'A' : 'B'))
  );
  const canSave = hasAmount && (isNew || dirty);

  const defaultLabel = isNew ? 'Set up schedule' : (dirty ? 'Save changes' : 'No changes to save');
  const buttonLabel = submitting ? 'Saving…' : (submitLabel ?? defaultLabel);

  // Per-section collapse (subscriber mobile). Only when editing an existing
  // schedule — a fresh setup shows everything expanded. Sections start collapsed
  // and expand independently on tap.
  const collapseMode = collapsible && !isNew;
  const [openSections, setOpenSections] = useState(() => new Set());
  const isOpen = (id) => !collapseMode || openSections.has(id);
  function toggleSection(id) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Collapsed-row summaries — the "current status" shown next to each Edit.
  const freqSummary = freq.label;
  const amountSummary = hasAmount ? formatUGX(amount, { compact: false }) : 'Not set';
  const splitSummary = `${retirementPct}% / ${emergencyPct}%`;
  const insuranceSummary = selectedProducts.length
    ? selectedProducts.map((p) => p.label.replace(/\s*insurance$/i, '')).join(', ')
    : 'None';

  // Section header: the numbered head when expanded/full-form, or a collapsed
  // summary row (title + current value + Edit/Done toggle) in collapse mode.
  function renderHead(id, idx, title, aside, summary) {
    if (!collapseMode) {
      return (
        <div className={styles.sectionHead}>
          <span className={styles.sectionIdx}>{idx}</span>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {aside && <span className={styles.sectionAside}>{aside}</span>}
        </div>
      );
    }
    const open = isOpen(id);
    return (
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {!open && <span className={styles.sectionSummary}>{summary}</span>}
        <button
          type="button"
          className={styles.editToggle}
          aria-expanded={open}
          onClick={() => toggleSection(id)}
        >
          {open ? 'Done' : 'Edit'}
        </button>
      </div>
    );
  }

  function handleSave() {
    setTouched(true);
    if (!canSave || submitting) return;
    const payload = {
      frequency,
      amount,
      retirementPct,
      emergencyPct,
    };
    // Only emit the insurance selection when the section is shown. Omitting it
    // (agent schedule-edit) leaves the subscriber's existing include_insurance
    // untouched (updateContributionSchedule only patches it when sent).
    if (showInsurance) {
      payload.includeInsurance = includeInsurance;
      payload.insuranceTypes = insuranceTypes;
    }
    // Yearly step-up rides with either the full save-to-cover model OR the
    // indexation-only opt-in (subscriber SchedulePage). The funding mode/target
    // ride ONLY with the full save-to-cover model (its columns are RPC-locked).
    if (showIndexation) {
      payload.contributionIndexationPct = indexationPct;
    }
    if (enableSaveToCover && showInsurance) {
      payload.insuranceFundingMode = includeInsurance && !isPayNow ? 'save_to_cover' : 'pay_now';
      payload.insurancePremiumTarget = includeInsurance ? productAnnualTotal : 0;
    }
    if (initial?.nextDueDate) payload.nextDueDate = initial.nextDueDate;
    onSave(payload);
  }

  const isSplit = layout === 'split';

  return (
    <>
      <div className={`${styles.body} ${isSplit ? styles.bodySplit : ''}`}>
        <motion.div
          className={styles.step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        >
          <div className={styles.inputsCol}>
          {/* 01 Frequency */}
          <section className={styles.section}>
            {renderHead('freq', '01', 'How often?', null, freqSummary)}
            {isOpen('freq') && (
            <div className={styles.freqGrid} role="radiogroup" aria-label="Frequency">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={frequency === f.id}
                  className={styles.freqCard}
                  data-active={frequency === f.id}
                  onClick={() => setFrequency(f.id)}
                >
                  <span className={styles.freqLabel}>{f.label}</span>
                  <span className={styles.freqHelper}>{f.helper}</span>
                  {frequency === f.id && (
                    <span className={styles.freqCheck} aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
                        <path d="M3 8.5l3.2 3 6.3-7" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  )}
                </button>
              ))}
            </div>
            )}
          </section>

          {/* 02 Amount */}
          <section className={styles.section}>
            {renderHead('amount', '02', `How much ${freq.cadence}?`, `Min ${formatUGX(MIN_CONTRIBUTION, { compact: false })}`, amountSummary)}
            {isOpen('amount') && (
            <>
            <label className={styles.amountField} data-error={(touched && belowMin) || undefined}>
              <span className={styles.amountPrefix} aria-hidden="true">UGX</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={amountStr ? formatNumber(Number.parseInt(amountStr, 10)) : ''}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^\d]/g, ''))}
                onBlur={() => setTouched(true)}
                placeholder="Enter amount"
                className={styles.amountInput}
                aria-label="Contribution amount"
                aria-invalid={touched && belowMin}
              />
            </label>
            <div className={styles.presetRow}>
              {presetsForFrequency(frequency).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={styles.presetChip}
                  data-active={amount === v}
                  onClick={() => { setAmountStr(String(v)); setTouched(true); }}
                >
                  {formatUGX(v, { compact: false })}
                </button>
              ))}
            </div>
            {touched && belowMin && (
              <p className={styles.errorLine}>Minimum {formatUGX(MIN_CONTRIBUTION, { compact: false })}.</p>
            )}
            </>
            )}
          </section>

          {/* 03 Split */}
          <section className={styles.section}>
            {renderHead('split', '03', 'Split your savings', null, splitSummary)}
            {isOpen('split') && (
            <>
            <div className={styles.splitHead}>
              <div className={styles.splitSide}>
                <span className={styles.splitLabel}>Retirement</span>
                <span className={styles.splitPct}>{retirementPct}%</span>
                <span className={styles.splitNote}>Locked until {RETIREMENT_AGE}</span>
              </div>
              <div className={styles.splitSide} data-align="right">
                <span className={styles.splitLabel} data-tone="teal">Liquid savings</span>
                <span className={styles.splitPct} data-tone="teal">{emergencyPct}%</span>
                <span className={styles.splitNote}>Withdraw anytime</span>
              </div>
            </div>
            <input
              type="range"
              min={60}
              max={100}
              step={5}
              value={retirementPct}
              onChange={(e) => setRetirementPct(Number.parseInt(e.target.value, 10))}
              className={styles.slider}
              style={{ '--pct': `${(retirementPct - 60) * 2.5}%` }}
              aria-label="Retirement percentage"
            />
            </>
            )}
          </section>

          {/* Grow-each-year (indexation) — full save-to-cover onboarding OR the
              indexation-only opt-in (subscriber SchedulePage). */}
          {showIndexation && (
          <section className={styles.section}>
            <div className={styles.idxTop}>
              <div className={styles.idxTitleWrap}>
                <h2 className={styles.sectionTitle}>
                  Grow your saving each year <span className={styles.idxOpt}>· optional</span>
                </h2>
                <p className={styles.idxSub}>
                  Prices rise every year. Let your saving rise a little too, so it keeps its value.
                </p>
              </div>
              <span
                className={`${styles.idxBadge} ${indexationPct === 0 ? styles.idxBadgeOff : ''}`}
                aria-hidden="true"
              >
                {indexationPct === 0
                  ? 'Off'
                  : <>+{indexationPct}%<small className={styles.idxBadgeUnit}>/yr</small></>}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={15}
              step={1}
              value={indexationPct}
              onChange={(e) => setIndexationPct(Number.parseInt(e.target.value, 10))}
              className={styles.slider}
              data-variant="index"
              style={{ '--pct': `${(indexationPct / 15) * 100}%` }}
              aria-label="Yearly step-up percentage"
              aria-valuetext={indexationPct === 0 ? 'Off — saving stays the same' : `Goes up ${indexationPct}% each year`}
            />
            <div className={styles.sliderLabels}>
              <span>Off</span>
              <span>Grows fastest</span>
            </div>
            <p className={styles.idxEffect}>
              {indexationPct === 0
                ? 'Your saving stays the same each year.'
                : (hasAmount
                    ? <>
                        <b>{formatUGX(amount, { compact: false })}</b> now →{' '}
                        <b className={styles.idxEffectUp}>{formatUGX(nextYearAmount, { compact: false })}</b>{' '}
                        next year, then a bit more every year.
                      </>
                    : 'Enter an amount to see how it grows.')}
            </p>
          </section>
          )}

          {/* 04 Insurance (optional, multi-select) — hidden on the agent's
              schedule-edit forks (showInsurance={false}). */}
          {showInsurance && (
          <section className={styles.section}>
            {renderHead('insurance', '04', 'Add insurance', 'Optional · pick any', insuranceSummary)}
            {isOpen('insurance') && (
            <>
            <div className={styles.insuranceList}>
              {INSURANCE_PRODUCTS.map((product) => {
                const active = insuranceTypes.includes(product.id);
                return (
                  <button
                    key={product.id}
                    type="button"
                    role="switch"
                    aria-checked={active}
                    className={styles.insuranceRow}
                    data-active={active}
                    onClick={() => toggleInsurance(product.id)}
                  >
                    <span className={styles.insuranceIcon} aria-hidden="true">
                      <InsuranceGlyph icon={product.icon} />
                    </span>
                    <span className={styles.insuranceCopy}>
                      <span className={styles.insuranceTitle}>{product.label}</span>
                      <span className={styles.insuranceDetail}>
                        {`${formatUGX(product.premiumMonthly, { compact: false })} / mo · ${formatUGX(product.cover, { compact: false })} cover`}
                      </span>
                    </span>
                    <span className={styles.insuranceToggle} aria-hidden="true">
                      <span className={styles.insuranceToggleKnob} />
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Save-to-cover: cost-for-a-year + pay-now / save-up route choice.
                Only meaningful once at least one product is chosen. */}
            {enableSaveToCover && includeInsurance && (
            <div className={styles.saveCover}>
              <div className={styles.target}>
                <span className={styles.targetLabel}>Cost for one year</span>
                <span className={styles.targetValue}>
                  {formatUGX(productAnnualTotal, { compact: false })}
                  <small className={styles.targetUnit}> /year</small>
                </span>
              </div>

              <p className={styles.payQ}>How do you want to pay?</p>
              <div className={styles.routes} role="radiogroup" aria-label="How do you want to pay for cover">
                <button
                  type="button"
                  role="radio"
                  aria-checked={isPayNow}
                  className={styles.route}
                  data-active={isPayNow}
                  onClick={() => setRoute('A')}
                >
                  <span className={styles.routeTop}>
                    <span className={styles.routeDot} aria-hidden="true" />
                    <span className={styles.routeLabel}>Pay now</span>
                  </span>
                  <span className={styles.routeSub}>Pay the whole year today. Covered today.</span>
                  <span className={`${styles.routeTag} ${styles.routeTagNow}`}>Covered today</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!isPayNow}
                  className={styles.route}
                  data-active={!isPayNow}
                  onClick={() => setRoute('B')}
                >
                  <span className={styles.routeTop}>
                    <span className={styles.routeDot} aria-hidden="true" />
                    <span className={styles.routeLabel}>Save up for it</span>
                  </span>
                  <span className={styles.routeSub}>Your saving fills the tin. Cover starts when your coins reach the line.</span>
                  <span className={`${styles.routeTag} ${styles.routeTagBuild}`}>Save up</span>
                </button>
              </div>

              {isPayNow ? (
                <div className={styles.aline}>
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                  <span className={styles.alineTx}>
                    <b>Pay today, covered today.</b> It renews every year on its own.
                  </span>
                </div>
              ) : (
                <div className={styles.detail}>
                  <div className={styles.detailHead}>
                    <span className={styles.detailTitle}>Filling the tin</span>
                    <span className={styles.detailProj}>
                      {monthsToCover
                        ? `full in about ${monthsToCover} ${monthsToCover === 1 ? 'month' : 'months'}`
                        : 'not filling yet'}
                    </span>
                  </div>
                  <div className={styles.detailBody}>
                    <p className={styles.buildMsg}>
                      You are not covered yet. Cover starts the day your coins reach the line.
                    </p>
                    <div className={styles.tinArea}>
                      <div className={styles.tin}>
                        <div className={styles.tinLid}>
                          <span className={styles.tinShield} data-on={hasEmergencyFlow} aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" />
                            </svg>
                          </span>
                        </div>
                        <div className={styles.tinBody}>
                          <div className={styles.tinLine} />
                          <div
                            className={`${styles.tinCoins} ${hasEmergencyFlow ? '' : styles.tinCoinsEmpty}`}
                            style={{ height: `${fill.heightPct}%`, '--tin-pace-dur': `${fill.sheenDur}s` }}
                          >
                            {hasEmergencyFlow && (
                              <span className={styles.tinPill}>≈ {formatUGX(monthlyEmergency, { compact: false })}/mo</span>
                            )}
                            {hasEmergencyFlow && <span key={fxKey} className={styles.tinFx} aria-hidden="true" />}
                          </div>
                        </div>
                      </div>
                      <div className={styles.tinInfo}>
                        <span className={styles.tinGoal}>
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6z" />
                            <path d="M9 11l2 2 4-4" />
                          </svg>
                          Cover starts at&nbsp;{formatUGX(productAnnualTotal, { compact: false })}
                        </span>
                        {hasEmergencyFlow ? (
                          <>
                            <p className={styles.tinCap}>Full in about <b>{monthsToCover}</b> {monthsToCover === 1 ? 'month' : 'months'}</p>
                            <p className={styles.tinSub}>Their saved money moves into the tin on its own.</p>
                          </>
                        ) : (
                          <>
                            <p className={styles.tinCap}>Add money they can take out</p>
                            <p className={styles.tinSub}>Right now nothing goes into the tin.</p>
                          </>
                        )}
                      </div>
                    </div>
                    {hasEmergencyFlow ? (
                      <div className={styles.linkNote}>
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M13 5l7 7-7 7M20 12H4" />
                        </svg>
                        <span>Put more in &ldquo;take out any time&rdquo; and the tin fills faster.</span>
                      </div>
                    ) : (
                      <div className={styles.zeroWarn}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 9v4M12 17h.01" />
                        </svg>
                        <span className={styles.zeroWarnTx}>
                          Nothing goes to &ldquo;take out any time&rdquo;, so the tin never fills. Add some, or pay the whole year now.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.agentNote}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M16 11a4 4 0 1 0-8 0M4 20a8 8 0 0 1 16 0" />
                </svg>
                <span className={styles.agentNoteTx}>
                  <b>You&apos;re helping them decide.</b> Take the whole year&apos;s payment now, or set up the save-up tin — their choice.
                </span>
              </div>
            </div>
            )}
            </>
            )}
          </section>
          )}
          </div>

          <div className={styles.summaryCol}>
          {/* Summary */}
          <section className={styles.summarySection}>
            {enableSaveToCover ? (
              <>
                {/* You put in — the contribution now + monthly-overall */}
                <div className={styles.putin}>
                  <div className={styles.putinLabel}>You put in</div>
                  <div className={styles.putinBig}>
                    {hasAmount ? formatUGX(amount, { compact: false }) : 'UGX —'}
                    {hasAmount && <small>/{freq.cadence}</small>}
                  </div>
                  <p className={styles.putinSub}>
                    {hasAmount ? planSubText : 'Enter an amount to see the plan.'}
                  </p>
                </div>

                {/* What it grows into — three outcome cards */}
                <div className={styles.ocards}>
                  <div className={styles.oc} data-tone="ret">
                    <div className={styles.ocTop}>
                      <span className={styles.ocName}>Retirement fund</span>
                      <span className={styles.ocVal}>
                        {retirementFV > 0 ? `≈ ${formatUGX(retirementFV, { compact: true })}` : '—'}
                      </span>
                    </div>
                    <p className={styles.ocSub}>
                      {years > 0 ? `Locked until age ${RETIREMENT_AGE}` : 'Add date of birth'}
                    </p>
                  </div>

                  <div className={styles.oc} data-tone="emg">
                    <div className={styles.ocTop}>
                      <span className={styles.ocName}>Liquid savings</span>
                      <span className={styles.ocVal}>
                        {emergencyFV > 0 ? `≈ ${formatUGX(emergencyFV, { compact: true })}` : '—'}
                      </span>
                    </div>
                    <p className={styles.ocSub}>Take out any time</p>
                  </div>

                  <div className={styles.oc} data-tone="ins" data-empty={!includeInsurance}>
                    <div className={styles.ocTop}>
                      <span className={styles.ocName}>Insurance cover</span>
                      <span className={styles.ocVal}>
                        {includeInsurance ? formatUGX(coverTotal, { compact: true }) : 'None'}
                      </span>
                    </div>
                    <p className={styles.ocSub}>{coverCardSub}</p>
                  </div>
                </div>

                {/* You pay today */}
                {hasAmount && (
                  <div className={styles.payToday}>
                    <span className={styles.ptKey}>You pay today</span>
                    <span className={styles.ptVal}>{formatUGX(bigValue, { compact: false })}</span>
                    <p className={styles.ptNote}>{dueNote}</p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.summaryHead}>
                  <span className={styles.summaryEyebrow}>What you’ll pay</span>
                  <span className={styles.summaryCadence}>{freq.cadence[0].toUpperCase() + freq.cadence.slice(1)}</span>
                </div>
                <div className={styles.summaryBig}>
                  {hasAmount ? formatUGX(bigValue, { compact: false }) : 'UGX —'}
                </div>
                <ul className={styles.summaryList}>
                  <li className={styles.summaryRow}>
                    <span>
                      <span className={styles.summaryDot} data-tone="retirement" /> Retirement ({retirementPct}%)
                    </span>
                    <span>{hasAmount ? formatUGX(retirementPerPeriod, { compact: false }) : '—'}</span>
                  </li>
                  <li className={styles.summaryRow}>
                    <span>
                      <span className={styles.summaryDot} data-tone="emergency" /> Liquid savings ({emergencyPct}%)
                    </span>
                    <span>{hasAmount ? formatUGX(emergencyPerPeriod, { compact: false }) : '—'}</span>
                  </li>
                  {selectedProducts.map((product) => (
                    <li className={styles.summaryRow} key={product.id}>
                      <span>
                        <span className={styles.summaryDot} data-tone="insurance" /> {product.label}
                      </span>
                      <span>+{formatUGX(premiumPerPeriod(product), { compact: false })}</span>
                    </li>
                  ))}
                </ul>
                {showProjection && retirementFV > 0 && (
                  <div className={styles.projection}>
                    <span className={styles.projLabel}>Projected at age {RETIREMENT_AGE}</span>
                    <span className={styles.projValue}>{formatUGX(Math.round(retirementFV), { compact: false })}</span>
                    <span className={styles.projNote}>Retirement bucket, compounded over {Math.round(years)} years.</span>
                  </div>
                )}
              </>
            )}
          </section>
          </div>
        </motion.div>
      </div>

      <footer className={styles.footer}>
        {onCancel && (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onCancel}
            disabled={submitting}
          >
            {cancelLabel}
          </button>
        )}
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!canSave || submitting}
          onClick={handleSave}
        >
          {buttonLabel}
        </button>
      </footer>
    </>
  );
}
