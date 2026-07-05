import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  calcFV,
  parseAmount,
  FREQUENCY,
  periodsPerYear,
  normalizeFrequency,
} from '../../utils/finance';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatNumber, formatUGX } from '../../utils/currency';
import {
  RETIREMENT_AGE,
  MIN_CONTRIBUTION,
  INSURANCE_PRODUCTS,
  presetsForFrequency,
  annualPremium,
  tinFillState,
  TIN_LINE_PCT,
} from '../../constants/savings';
import {
  activePolicies,
  buildingPolicies,
  buildingProgress,
  productName,
} from '../../utils/policies';
import styles from './SubscriberScheduleForm.module.css';

/**
 * SubscriberScheduleForm — the subscriber's post-signup "Tune your schedule"
 * editor, on the annual-premium + save-to-cover model (migrations 0072/0073).
 *
 * Two tabs, mirroring onboarding: "Contribution" (frequency / amount / split /
 * yearly step-up) and "Insurance" (annual cover with a pay-now vs save-up route
 * choice + a savings split). A live summary aside shows WHAT'S PURCHASED — the
 * subscriber's active + building cover — plus a plan snapshot and a "you pay
 * when you save" preview.
 *
 * Deliberately a DEDICATED component (not the shared ContributionSettingsForm):
 * the agent onboarding + agent schedule-edit forks keep using that shared form
 * byte-for-byte, so this money-critical subscriber surface can evolve in
 * isolation. It reuses the same design tokens + save-to-cover primitives
 * (tinFillState, annualPremium, policies helpers) so it can't drift numerically.
 *
 * Owns its state. Calls `onSave(payload)` — the page persists the schedule and
 * funds any newly-chosen cover (via fund_insurance_products) + settles the period.
 *
 * @param {{
 *   initial: object|null,                 // contributionSchedule (null = brand-new)
 *   age?: number,
 *   heldPolicies?: Array,                  // sub.policies — drives the purchased panel + held de-dup
 *   onSave: (payload) => void,
 *   submitting?: boolean,
 *   submitLabel?: string,
 *   layout?: 'split',                      // desktop: inputs left / sticky summary right
 * }} props
 */
export default function SubscriberScheduleForm({
  initial,
  age,
  heldPolicies = [],
  onSave,
  submitting = false,
  submitLabel,
  layout,
}) {
  const isNew = !initial;
  const [tab, setTab] = useState('contribution');
  const [frequency, setFrequency] = useState(normalizeFrequency(initial?.frequency));
  const [amountStr, setAmountStr] = useState(initial?.amount ? String(initial.amount) : '');
  const [retirementPct, setRetirementPct] = useState(Math.max(60, initial?.retirementPct ?? 80));
  const [indexationPct, setIndexationPct] = useState(clampIndex(initial?.contributionIndexationPct, 0));
  const [touched, setTouched] = useState(Boolean(initial?.amount));

  // Held cover (from the subscriber's live policies) — the source of truth for
  // what's already owned. Active + building products can't be re-added; the user
  // only funds NEW cover, so held products render as locked-on status rows.
  const active = useMemo(() => activePolicies({ policies: heldPolicies }), [heldPolicies]);
  const building = useMemo(() => buildingPolicies({ policies: heldPolicies }), [heldPolicies]);
  const progress = useMemo(
    () => buildingProgress({ policies: heldPolicies, contributionSchedule: initial }),
    [heldPolicies, initial],
  );
  const activeTypes = useMemo(() => new Set(active.map((p) => p.type)), [active]);
  const buildingTypes = useMemo(() => new Set(building.map((p) => p.type)), [building]);
  const heldTypes = useMemo(
    () => new Set([...activeTypes, ...buildingTypes]),
    [activeTypes, buildingTypes],
  );

  // Selection starts at everything held (so the plan reflects what's owned); the
  // user adds NEW products on top. Held products stay selected (locked on).
  const [addedTypes, setAddedTypes] = useState(() => new Set());

  // Route + savings split apply to NEW cover being funded. Default to the current
  // funding mode; a subscriber already building keeps "save up".
  const [route, setRoute] = useState(() =>
    (initial?.insuranceFundingMode === 'save_to_cover' || building.length > 0) ? 'B' : 'A');
  const [savingsPct, setSavingsPct] = useState(() =>
    clampPct(initial?.insuranceSavingsPct, 50));

  const amount = parseAmount(amountStr);
  const freq = getFreq(frequency);
  const freqPerYear = periodsPerYear(freq.id);
  const hasAmount = amount !== null && amount >= MIN_CONTRIBUTION;
  const belowMin = amount !== null && amount < MIN_CONTRIBUTION;
  const emergencyPct = 100 - retirementPct;
  const isPayNow = route === 'A';

  const retirementPerPeriod = hasAmount ? Math.round(amount * (retirementPct / 100)) : 0;
  const emergencyPerPeriod = hasAmount ? amount - retirementPerPeriod : 0;

  // Newly-selected products = the ones the user toggled on that aren't already
  // held. These are what get funded on save (Route A charges / Route B builds).
  const addedProducts = useMemo(
    () => INSURANCE_PRODUCTS.filter((p) => addedTypes.has(p.id) && !heldTypes.has(p.id)),
    [addedTypes, heldTypes],
  );
  const hasNewCover = addedProducts.length > 0;
  const addedAnnualTotal = addedProducts.reduce((s, p) => s + annualPremium(p), 0);

  // ── Save-to-cover projection (Route B) ─────────────────────────────────────
  // Target = annual premium of the cover that will be BUILDING after this save:
  // the newly-added products PLUS any already-building policies. Monthly-in = the
  // assigned share (savingsPct) of the emergency slice, as a monthly rate.
  const buildingAnnualExisting = building.reduce(
    (s, p) => s + (Number(p.premiumMonthly) || 0) * 12, 0);
  const buildTarget = addedAnnualTotal + (isPayNow ? 0 : buildingAnnualExisting);
  const coverPerPeriod = !isPayNow ? Math.round(emergencyPerPeriod * (savingsPct / 100)) : 0;
  const liquidPerPeriod = emergencyPerPeriod - coverPerPeriod;
  const monthlyToCover = (coverPerPeriod * freqPerYear) / 12;
  const coverGetsNothing = !(monthlyToCover > 0);
  const monthsToCover = (monthlyToCover > 0 && buildTarget > 0)
    ? Math.ceil(buildTarget / monthlyToCover)
    : null;
  const fill = tinFillState(buildTarget, monthlyToCover);
  const fxKey = `${Math.round(fill.heightPct)}-${monthsToCover ?? 0}`;

  // ── Projections ────────────────────────────────────────────────────────────
  const years = yearsToRetirement(age);
  const contribMonthly = hasAmount ? (amount * freqPerYear) / 12 : 0;
  const retMonthly = contribMonthly * (retirementPct / 100);
  const retirementFV = useMemo(
    () => (years > 0 && retMonthly > 0 ? calcFV(retMonthly, years) : 0),
    [years, retMonthly],
  );
  // Liquid savings compounds only the take-out money that STAYS liquid — on Route
  // B the assigned share is swept to fund cover.
  const emgMonthly = contribMonthly * (emergencyPct / 100);
  const liquidMonthly = (!isPayNow && (hasNewCover || building.length > 0))
    ? Math.max(0, (liquidPerPeriod * freqPerYear) / 12)
    : emgMonthly;
  const emergencyFV = useMemo(
    () => (years > 0 && liquidMonthly > 0 ? calcFV(liquidMonthly, years) : 0),
    [years, liquidMonthly],
  );

  const nextYearAmount = hasAmount ? Math.round(amount * (1 + indexationPct / 100)) : 0;

  // What Save will charge: the owed contribution is settled by the page; here we
  // preview the insurance side — Route A charges the annual premium, Route B is 0.
  const payPreview = (isPayNow && hasNewCover) ? addedAnnualTotal : 0;

  // ── Dirty check ─────────────────────────────────────────────────────────────
  const savingsChanged = !isPayNow && building.length > 0
    && savingsPct !== clampPct(initial?.insuranceSavingsPct, 50);
  const dirty = isNew || (
    frequency !== normalizeFrequency(initial.frequency)
    || amount !== initial.amount
    || retirementPct !== initial.retirementPct
    || indexationPct !== clampIndex(initial.contributionIndexationPct, 0)
    || hasNewCover
    || savingsChanged
  );
  const canSave = hasAmount && dirty;
  const defaultLabel = isNew ? 'Set up schedule' : (dirty ? 'Save changes' : 'No changes to save');
  const buttonLabel = submitting ? 'Saving…' : (submitLabel ?? defaultLabel);

  function toggleProduct(id) {
    if (heldTypes.has(id)) return;            // held cover is locked on
    setAddedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleSave() {
    setTouched(true);
    if (!canSave || submitting) return;
    // insuranceTypes = everything held + newly added (drives include_insurance).
    const insuranceTypes = [
      ...INSURANCE_PRODUCTS.filter((p) => heldTypes.has(p.id) || addedTypes.has(p.id)).map((p) => p.id),
    ];
    onSave({
      frequency,
      amount,
      retirementPct,
      emergencyPct,
      includeInsurance: insuranceTypes.length > 0,
      insuranceTypes,
      contributionIndexationPct: indexationPct,
      // Route + split for the NEW cover (the page reads these to fund it).
      insuranceFundingMode: isPayNow ? 'pay_now' : 'save_to_cover',
      insuranceSavingsPct: savingsPct,
      addedProducts: addedProducts.map((p) => ({
        product: p.id, cover: p.cover, premiumMonthly: p.premiumMonthly,
      })),
      ...(initial?.nextDueDate ? { nextDueDate: initial.nextDueDate } : {}),
    });
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
          {/* ── Tabs ─────────────────────────────────────────────────── */}
          <div className={styles.tabbar} role="tablist" aria-label="Schedule sections">
            <button
              type="button"
              role="tab"
              id="sched-tab-contribution"
              aria-selected={tab === 'contribution'}
              aria-controls="sched-tabpanel"
              className={styles.tab}
              data-on={tab === 'contribution'}
              onClick={() => setTab('contribution')}
            >
              <span className={styles.tabNum} aria-hidden="true">1</span>
              <span className={styles.tabCopy}>
                Contribution<small>How much &amp; how often</small>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              id="sched-tab-insurance"
              aria-selected={tab === 'insurance'}
              aria-controls="sched-tabpanel"
              className={styles.tab}
              data-on={tab === 'insurance'}
              onClick={() => setTab('insurance')}
            >
              <span className={styles.tabNum} aria-hidden="true">2</span>
              <span className={styles.tabCopy}>
                Insurance<small>Your family cover</small>
              </span>
            </button>
          </div>

          {/* ── Left column: the active tab's inputs ─────────────────── */}
          <div
            className={styles.inputsCol}
            role="tabpanel"
            id="sched-tabpanel"
            aria-labelledby={tab === 'contribution' ? 'sched-tab-contribution' : 'sched-tab-insurance'}
          >
            {tab === 'contribution' ? (
              <>
                {/* 01 Frequency */}
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <span className={styles.sectionIdx}>01</span>
                    <h2 className={styles.sectionTitle}>How often?</h2>
                  </div>
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
                              <path d="M3 8.5l3.2 3 6.3-7" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                {/* 02 Amount */}
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <span className={styles.sectionIdx}>02</span>
                    <h2 className={styles.sectionTitle}>How much {freq.cadence}?</h2>
                    <span className={styles.sectionAside}>Min {formatUGX(MIN_CONTRIBUTION, { compact: false })}</span>
                  </div>
                  <label htmlFor="sched-amount" className={styles.amountField} data-error={(touched && belowMin) || undefined}>
                    <span className={styles.amountPrefix} aria-hidden="true">UGX</span>
                    <input
                      id="sched-amount"
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
                    <span className={styles.amountCadence} aria-hidden="true">{freq.cadence}</span>
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
                </section>

                {/* 03 Split */}
                <section className={styles.section}>
                  <div className={styles.sectionHead}>
                    <span className={styles.sectionIdx}>03</span>
                    <h2 className={styles.sectionTitle}>Split your savings</h2>
                  </div>
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
                </section>

                {/* 04 Yearly step-up (indexation) */}
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
                      {indexationPct === 0 ? 'Off' : <>+{indexationPct}%<small className={styles.idxBadgeUnit}>/yr</small></>}
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
              </>
            ) : (
              /* ── Insurance tab ──────────────────────────────────────── */
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIdx}>05</span>
                  <h2 className={styles.sectionTitle}>Your family cover</h2>
                  <span className={styles.sectionAside}>Pay once a year</span>
                </div>
                <p className={styles.insLede}>
                  Cover is priced per year. Add what you need — pay the year now, or save up
                  for it a little at a time from your liquid savings.
                </p>

                <div className={styles.prods} role="group" aria-label="Choose your cover">
                  {INSURANCE_PRODUCTS.map((p) => {
                    const held = heldTypes.has(p.id);
                    const isActive = activeTypes.has(p.id);
                    const on = held || addedTypes.has(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-disabled={held || undefined}
                        className={styles.prod}
                        data-active={on}
                        data-held={held || undefined}
                        onClick={() => toggleProduct(p.id)}
                      >
                        <span className={styles.prodIcon} aria-hidden="true"><ProductIcon id={p.id} /></span>
                        <span className={styles.prodCopy}>
                          <span className={styles.prodName}>{shortName(p.label)}</span>
                          <span className={styles.prodBlurb}>{p.blurb}</span>
                        </span>
                        <span className={styles.prodRight}>
                          <span className={styles.prodPrice}>
                            {formatUGX(annualPremium(p), { compact: false })}<small>/yr</small>
                          </span>
                          {held ? (
                            <span className={styles.prodHeld} data-state={isActive ? 'active' : 'building'}>
                              {isActive ? 'Active' : 'Building'}
                            </span>
                          ) : (
                            <span className={styles.prodToggle} aria-hidden="true">
                              <span className={styles.prodToggleKnob} />
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {hasNewCover && (
                  <>
                    <div className={styles.target}>
                      <span className={styles.targetLabel}>New cover · cost for one year</span>
                      <span className={styles.targetValue}>
                        {formatUGX(addedAnnualTotal, { compact: false })}<small className={styles.targetUnit}> /year</small>
                      </span>
                    </div>

                    <p className={styles.payQ}>How do you want to pay?</p>
                    <div className={styles.routes} role="radiogroup" aria-label="How do you want to pay for new cover">
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
                      <>
                        <div className={styles.savePct}>
                          <div className={styles.savePctHead}>
                            <span className={styles.savePctLabel}>How much of your liquid savings builds cover?</span>
                            <strong className={styles.savePctVal}>{savingsPct}%</strong>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={savingsPct}
                            onChange={(e) => setSavingsPct(Number.parseInt(e.target.value, 10))}
                            className={styles.slider}
                            style={{ '--pct': `${savingsPct}%` }}
                            aria-label="Percent of liquid savings that builds cover"
                            aria-valuetext={`${savingsPct} percent — ${formatUGX(coverPerPeriod, { compact: false })} to insurance, ${formatUGX(liquidPerPeriod, { compact: false })} stays liquid`}
                          />
                          <div className={styles.savePctMeter} aria-hidden="true">
                            <span className={styles.savePctCell}>
                              <span className={styles.savePctK}>Stays liquid</span>
                              <span className={styles.savePctV}>{formatUGX(liquidPerPeriod, { compact: false })}<small>/{PERIOD_SUFFIX[freq.id] ?? 'period'}</small></span>
                            </span>
                            <span className={styles.savePctCell} data-tone="cover">
                              <span className={styles.savePctK}>Builds cover</span>
                              <span className={styles.savePctV}>{formatUGX(coverPerPeriod, { compact: false })}<small>/{PERIOD_SUFFIX[freq.id] ?? 'period'}</small></span>
                            </span>
                          </div>
                        </div>

                        <div className={styles.tinCard}>
                          <div className={styles.tinCardHead}>
                            <span className={styles.tinCardTitle}>Filling the tin</span>
                            <span className={styles.tinCardProj}>
                              {monthsToCover ? `full in about ${monthsToCover} ${monthsToCover === 1 ? 'month' : 'months'}` : 'not filling yet'}
                            </span>
                          </div>
                          <div className={styles.tinArea}>
                            <div className={styles.tin}>
                              <div className={styles.tinLid} />
                              <div className={styles.tinBody}>
                                <div className={styles.tinLine} style={{ bottom: `${TIN_LINE_PCT}%` }} />
                                <div
                                  className={`${styles.tinCoins} ${coverGetsNothing ? styles.tinCoinsEmpty : ''}`}
                                  style={{ height: `${fill.heightPct}%`, '--tin-pace-dur': `${fill.sheenDur}s` }}
                                >
                                  {!coverGetsNothing && (
                                    <span className={styles.tinPill}>≈ {formatUGX(monthlyToCover, { compact: false })}/mo</span>
                                  )}
                                  {!coverGetsNothing && <span key={fxKey} className={styles.tinFx} aria-hidden="true" />}
                                </div>
                              </div>
                            </div>
                            <div className={styles.tinInfo}>
                              <span className={styles.tinGoal}>
                                Cover starts at&nbsp;{formatUGX(buildTarget, { compact: false })}
                              </span>
                              {coverGetsNothing ? (
                                <p className={styles.tinCap}>Assign some liquid savings to start building.</p>
                              ) : (
                                <p className={styles.tinCap}>Full in about <b>{monthsToCover}</b> {monthsToCover === 1 ? 'month' : 'months'}. Your saved money moves into the tin on its own.</p>
                              )}
                            </div>
                          </div>
                          {coverGetsNothing && (
                            <div className={styles.zeroWarn}>
                              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="9" /><path d="M12 9v4M12 17h.01" />
                              </svg>
                              <span className={styles.zeroWarnTx}>
                                Nothing goes to “take out any time”, so the tin never fills. Add some, or pay the year now.
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}

                {building.length > 0 && !hasNewCover && (
                  <div className={styles.savePct}>
                    <div className={styles.savePctHead}>
                      <span className={styles.savePctLabel}>How much of your liquid savings builds cover?</span>
                      <strong className={styles.savePctVal}>{savingsPct}%</strong>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={savingsPct}
                      onChange={(e) => { setSavingsPct(Number.parseInt(e.target.value, 10)); setRoute('B'); }}
                      className={styles.slider}
                      style={{ '--pct': `${savingsPct}%` }}
                      aria-label="Percent of liquid savings that builds cover"
                      aria-valuetext={`${savingsPct} percent of your liquid savings builds cover`}
                    />
                    <p className={styles.idxSub}>Adjusts how fast your building cover fills from savings.</p>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* ── Right column: the live summary ───────────────────────── */}
          <div className={styles.summaryCol}>
            <section className={styles.summary}>
              {/* Your cover — what's purchased (active + building) */}
              <div className={styles.coverBox}>
                <div className={styles.coverHd}>Your cover</div>
                {active.length === 0 && building.length === 0 ? (
                  <p className={styles.coverEmpty}>No cover yet. Add family cover on the Insurance tab.</p>
                ) : (
                  <ul className={styles.coverList}>
                    {active.map((p) => (
                      <li className={styles.coverRow} key={`a-${p.type}`}>
                        <span className={styles.coverName}>{productName(p.type)}</span>
                        <span className={styles.coverAmt}>{formatUGX(p.cover, { compact: true })}</span>
                        <span className={styles.statusPill} data-state="active">
                          <span className={styles.statusDot} /> Active
                        </span>
                      </li>
                    ))}
                    {building.map((p) => (
                      <li className={styles.coverRow} data-building key={`b-${p.type}`}>
                        <span className={styles.coverName}>{productName(p.type)}</span>
                        <span className={styles.coverAmt}>{formatUGX(p.cover, { compact: true })}</span>
                        <span className={styles.statusPill} data-state="building">
                          <span className={styles.statusDot} /> Building
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {progress.isBuilding && progress.target > 0 && (
                  <div className={styles.progWrap}>
                    <div className={styles.progBar}>
                      <span className={styles.progFill} style={{ width: `${progress.pct}%` }} />
                    </div>
                    <p className={styles.progNote}>
                      <b>{progress.pct}%</b> of premium saved · {formatUGX(progress.accrued, { compact: false })} of {formatUGX(progress.target, { compact: false })}
                    </p>
                  </div>
                )}
              </div>

              {/* Your plan — contribution snapshot + projections */}
              <div className={styles.planBox}>
                <div className={styles.putinLabel}>You put in</div>
                <div className={styles.putinBig}>
                  {hasAmount ? formatUGX(amount, { compact: false }) : 'UGX —'}
                  {hasAmount && <small>/{freq.cadence}</small>}
                </div>
                <ul className={styles.planList}>
                  <li className={styles.planRow}>
                    <span><span className={styles.dot} data-tone="ret" /> Retirement fund</span>
                    <span>{retirementFV > 0 ? `≈ ${formatUGX(retirementFV, { compact: true })}` : '—'}</span>
                  </li>
                  <li className={styles.planRow}>
                    <span><span className={styles.dot} data-tone="emg" /> Liquid savings</span>
                    <span>{emergencyFV > 0 ? `≈ ${formatUGX(emergencyFV, { compact: true })}` : '—'}</span>
                  </li>
                </ul>
                <p className={styles.planNote}>
                  {years > 0 ? `Projected at age ${RETIREMENT_AGE}, if you keep saving.` : 'Add your date of birth for a projection.'}
                </p>
              </div>

              {/* You pay when you save — preview of the settle charge */}
              {hasNewCover && (
                <div className={styles.payBox}>
                  <span className={styles.payKey}>{isPayNow ? 'You pay when you save' : 'Starts building when you save'}</span>
                  <span className={styles.payVal}>
                    {isPayNow ? formatUGX(payPreview, { compact: false }) : formatUGX(0, { compact: false })}
                  </span>
                  <p className={styles.payNote}>
                    {isPayNow
                      ? 'One year of your new cover — plus any contribution still owed this month.'
                      : 'Your new cover builds from your liquid savings — nothing extra to pay now.'}
                  </p>
                </div>
              )}
            </section>
          </div>
        </motion.div>
      </div>

      <footer className={styles.footer}>
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

/* ── helpers ──────────────────────────────────────────────────────────────── */

const FREQUENCIES = [
  { id: FREQUENCY.DAILY,       label: 'Daily',       helper: 'every day',      cadence: 'every day'      },
  { id: FREQUENCY.WEEKLY,      label: 'Weekly',      helper: 'every week',     cadence: 'every week'     },
  { id: FREQUENCY.MONTHLY,     label: 'Monthly',     helper: 'every month',    cadence: 'every month'    },
  { id: FREQUENCY.QUARTERLY,   label: 'Quarterly',   helper: 'every 3 months', cadence: 'every 3 months' },
  { id: FREQUENCY.HALF_YEARLY, label: 'Half-yearly', helper: 'every 6 months', cadence: 'every 6 months' },
  { id: FREQUENCY.ANNUALLY,    label: 'Annually',    helper: 'every year',     cadence: 'every year'     },
];

const PERIOD_SUFFIX = {
  [FREQUENCY.DAILY]: 'day',
  [FREQUENCY.WEEKLY]: 'wk',
  [FREQUENCY.MONTHLY]: 'mo',
  [FREQUENCY.QUARTERLY]: 'qtr',
  [FREQUENCY.HALF_YEARLY]: '6mo',
  [FREQUENCY.ANNUALLY]: 'yr',
};

function getFreq(id) {
  return FREQUENCIES.find((f) => f.id === id) ?? FREQUENCIES.find((f) => f.id === FREQUENCY.MONTHLY);
}

function clampIndex(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(15, Math.round(n)));
}

function clampPct(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function yearsToRetirement(age) {
  if (typeof age === 'number' && Number.isFinite(age)) return Math.max(0, RETIREMENT_AGE - age);
  return 25;
}

function shortName(label) {
  return String(label).replace(/\s*insurance$/i, '');
}

function ProductIcon({ id }) {
  if (id === 'health') {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
        <path d="M12 20s-6.6-4.3-9-8.4C1.4 8.9 3 6 6 6c2 0 3.2 1.2 4 2.4C10.8 7.2 12 6 14 6c3 0 4.6 2.9 3 5.6C18.6 15.7 12 20 12 20z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
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
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
