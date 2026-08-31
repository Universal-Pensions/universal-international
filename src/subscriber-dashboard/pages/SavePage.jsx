import { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  parseAmount,
  normalizeFrequency,
  FREQUENCY_LABEL,
  calcFV,
  monthlyEquivalent,
  MONTHLY_RATE,
} from '../../utils/finance';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatNumber, formatUGXShort, formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { getFriendlyErrorMessage } from '../../utils/friendlyError';
import { useCurrentSubscriber, useMakeContribution, useMyEmployerFunding } from '../../hooks/useSubscriber';
import { memberFundingSummary } from '../../utils/contributionModel';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import {
  MIN_CONTRIBUTION,
  MOBILE_QUICK_CONTRIBUTION_AMOUNTS,
  RETIREMENT_AGE,
  DEFAULT_RETIREMENT_PCT,
} from '../../constants/savings';
import InlinePayPanel from '../../components/InlinePayPanel';
import PaymentMethodPicker, { GatewayAuthorising } from '../../components/payment/PaymentMethodPicker';
import { usePaymentMethod, gatewayPause } from '../../components/payment/usePaymentMethod';
import { PAYMENT_METHODS } from '../../constants/payment';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './SavePage.module.css';
import flow from './desktopFlow.module.css';
import DealingDateNote from '../../components/contribution/DealingDateNote';

const PRESET_AMOUNTS = MOBILE_QUICK_CONTRIBUTION_AMOUNTS;

// Hero opens on a valid preset (UGX 25K) so the amount reads as a real figure
// rather than "—" before any interaction — matches mockup 02.
const DEFAULT_AMOUNT = 25_000;

export default function SavePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub, isError, error, refetch } = useCurrentSubscriber();
  const { addToast } = useToast();
  const makeContribution = useMakeContribution(sub?.id);

  // This page only ever makes a single payment — either the user's scheduled
  // amount (prefilled by TopUpWidget's "Pay") or an ad-hoc top-up. Frequency
  // and the retirement/emergency split are properties of the saved schedule
  // (configured in SchedulePage), NOT chosen here: the user already set them,
  // so we read the split off the existing schedule and apply it silently. No
  // schedule yet → fall back to the 80/20 default.
  const existing = sub?.contributionSchedule;
  const retirementPct = existing?.retirementPct ?? DEFAULT_RETIREMENT_PCT;
  const emergencyPct = 100 - retirementPct;
  const prefillAmount = location.state?.prefillAmount;

  // Employer-sponsored members. Both contribution legs are company-wide employer
  // settings (migration 0092) that the monthly contribution run remits — the
  // member never pays them, here or anywhere. So this page is purely their EXTRA
  // saving, which the copy has to say out loud (it previously said nothing, and
  // the member simply landed on a bare "Top up" form).
  //
  // `memberFundingSummary` returning null is the app-wide "hide the funding
  // surface" signal — it covers the legal-but-unfunded 0/0 employer config, whose
  // members genuinely do fund their own pension and must see the normal page.
  const { data: funding } = useMyEmployerFunding();
  const employerFunded = Boolean(funding)
    && memberFundingSummary(funding, funding.employerName) !== null;
  const employerName = funding?.employerName || 'your employer';

  // Scheduled-payment mode — reached only via TopUpWidget's "Pay" button, which
  // sets state.scheduled. The amount is LOCKED to the configured schedule amount:
  // no presets, no input, the user can only pay what they set. Requires an actual
  // schedule to lock to, so it degrades to the editable ad-hoc view when the flag
  // is absent (tab nav, "Top up extra") OR there's no schedule yet OR a hard
  // refresh dropped location.state — never a locked card with a missing amount.
  // Lock only when the schedule amount is itself payable (>= the minimum). Legacy
  // weekly seed rows can sit below MIN_CONTRIBUTION; locking one would render a
  // card whose "Pay" button is disabled with no way to edit — a dead end. Such
  // (or missing) schedules fall through to the editable view, which pre-fills the
  // amount (via prefillAmount) and shows the standard raise-to-minimum flow.
  // Never offer "pay the scheduled amount" to an employer-funded member. Their
  // pension money is deducted from their pay and remitted by the employer's run;
  // billing the same figure again through mobile money would take it twice. This
  // holds even if a schedule row carries an amount (they can also be nudged in
  // here with `state.scheduled` from the home widgets) — the guard is on the
  // funding read, not on the row's value.
  const scheduledAmount = Number(existing?.amount);
  const lockableSchedule = !employerFunded
    && Number.isFinite(scheduledAmount) && scheduledAmount >= MIN_CONTRIBUTION;
  const lockedMode = location.state?.scheduled === true && lockableSchedule;
  const cadenceLabel = FREQUENCY_LABEL[normalizeFrequency(existing?.frequency)];

  const [view, setView] = useState('form'); // form | confirm | success
  const [amountStr, setAmountStr] = useState(String(prefillAmount ?? DEFAULT_AMOUNT));
  const [submitting, setSubmitting] = useState(false);
  const [resultTx, setResultTx] = useState(null);

  // This page picks the method on the FORM step (mobile radio rows / desktop
  // chips) rather than inside the confirm surface, so it owns the picker state
  // and — unlike the panel-driven pages — runs the mocked gateway hop itself in
  // handleConfirm. `pay.record` is what lands in `transactions.method`.
  const pay = usePaymentMethod(PAYMENT_METHODS);

  // Desktop (>=1024px) presents the scheduled-vs-top-up choice as an on-page
  // segmented toggle; mobile has none (the locked/editable split there is driven
  // purely by the nav intent via lockedMode). Default the toggle to the entry
  // intent — arriving via the home "Pay" button (location.state.scheduled) opens
  // on the scheduled amount; a direct "Top up extra" / Save-tab entry opens on the
  // editable top-up. With no payable schedule to lock to, only top-up is offered.
  const [saveMode, setSaveMode] = useState(lockedMode ? 'scheduled' : 'topup');

  // Stable idempotency nonce for the one-off contribution. Minted ONCE when the
  // confirm sheet opens (handleContinue) and reused across a double-tap / manual
  // retry so the server-side make_contribution RPC collapses the duplicate
  // (audit §4a F-1). Reset to null on success or when the sheet closes so the
  // next top-up gets a fresh key.
  const contributionNonce = useRef(null);

  // In locked mode the amount IS the configured schedule amount (authoritative,
  // never the possibly-stale nav prefill); otherwise it comes from the editable
  // field. There is no DOM path that can mutate it in locked mode (no chips/input
  // are rendered), so the lock holds by construction.
  // Effective "pay the scheduled amount" flag. On mobile it IS lockedMode (the
  // toggle never renders), so the mobile branch below stays byte-identical; on
  // desktop the toggle drives it. Lock only when there's a payable schedule.
  const payScheduled = isDesktop ? saveMode === 'scheduled' && lockableSchedule : lockedMode;

  const amount = payScheduled ? scheduledAmount : parseAmount(amountStr);
  const hasAmount = amount !== null && amount >= MIN_CONTRIBUTION;
  const belowMin = !payScheduled && amount !== null && amount < MIN_CONTRIBUTION;

  const retAmt = hasAmount ? Math.round(amount * (retirementPct / 100)) : 0;
  const emgAmt = hasAmount ? amount - retAmt : 0;
  const units = hasAmount ? amount / 1000 : 0;

  // Retirement projection at age 60 (desktop scheduled-mode summary only).
  // Grow today's retirement pot at the app's assumed rate and add the future
  // value of the scheduled retirement-leg contributions — the same MONTHLY_RATE
  // / calcFV the rest of the app projects with. Only shown when the member's age
  // is known and below retirement, and a schedule exists to project from.
  const age = sub?.age;
  const canProject =
    payScheduled && lockableSchedule && typeof age === 'number' && age < RETIREMENT_AGE;
  const yearsToRet = canProject ? Math.max(1, RETIREMENT_AGE - age) : 0;
  const projectedAtRet = canProject
    ? Math.round(
        (sub?.retirementBalance || 0) * Math.pow(1 + MONTHLY_RATE, yearsToRet * 12) +
          calcFV(monthlyEquivalent(existing) * (retirementPct / 100), yearsToRet),
      )
    : 0;

  const nextDue = existing?.nextDueDate;

  const newBalance = useMemo(() => {
    if (!sub) return 0;
    return (sub.netBalance || 0) + (hasAmount ? amount : 0);
  }, [sub, hasAmount, amount]);

  function handleContinue() {
    if (!hasAmount || !pay.ready) return;
    // Mint the stable idempotency nonce once, as the confirm sheet opens.
    contributionNonce.current = crypto.randomUUID();
    setView('confirm');
  }

  // Close the confirm sheet without paying — drop the nonce so re-opening mints
  // a fresh one. Guarded against closing mid-submit.
  function closeConfirm() {
    if (submitting) return;
    contributionNonce.current = null;
    setView('form');
  }

  async function handleConfirm() {
    if (!hasAmount || !sub) return;
    // Early-return guard: a fast second tap must NOT fire a second write —
    // relying on the disabled attr re-render alone loses the race (§4a F-1).
    if (submitting) return;
    setSubmitting(true);
    try {
      // Mocked gateway hop (card authorisation / transfer capture) BEFORE the
      // write, so the confirm surface shows the authorising step. No-op for
      // mobile money — see constants/payment GATEWAY_LATENCY_MS.
      await gatewayPause(pay.kind);
      // Ad-hoc contribution. The stable nonce makes a double-tap / retry
      // idempotent on the server (§4a F-1). retirementPct comes from the saved
      // schedule, so the payment lands in the buckets the user already chose.
      const tx = await makeContribution.mutateAsync({
        amount,
        retirementPct,
        method: pay.record,
        nonce: contributionNonce.current ?? undefined,
      });
      setResultTx(tx);
      setView('success');
      // Settled successfully — drop the nonce so a later top-up gets a fresh key.
      contributionNonce.current = null;
      addToast('success', `${formatUGX(amount, { compact: false })} added to your savings.`);
    } catch (err) {
      // A22-004: err.message is always populated (raw fetch/Postgres errors
      // included), so `err?.message || fallback` never actually falls
      // through — a network blip toasted the literal "TypeError: Failed to
      // fetch". Route through the plain-language classifier instead.
      addToast('error', getFriendlyErrorMessage(err, 'Could not complete the top-up.'));
    } finally {
      setSubmitting(false);
    }
  }

  // A cold-start query failure would otherwise render a silent blank/zero page —
  // surface a retry card instead (mirrors HomePage's error handling).
  if (isError) {
    return (
      <div className={styles.page}>
        <ErrorCard
          title="We couldn't load your account"
          message={error}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {isDesktop ? (
        /* Desktop (>=1024px): genuine 2-column flow — an action column (mode
           toggle + amount + pay-from + CTA) beside a sticky summary (split,
           units, new balance, projection). NOT the mobile single-column stack.
           Mobile keeps the shipped <PageHeader> hero + stacked body EXACTLY
           as-is in the fragment below. */
        <div className={flow.canvas}>
          <header className={flow.head}>
            <div className={flow.headText}>
              <p className={flow.eyebrow}>Make a contribution</p>
              <h1 className={flow.title}>Save</h1>
              <p className={flow.subtitle}>
                {employerFunded
                  ? `Your pension money from ${employerName} arrives on its own every month. This page is for extra saving on top.`
                  : lockableSchedule
                    ? 'Pay your scheduled contribution, or top up extra whenever you like.'
                    : 'Top up your savings whenever you like.'}
              </p>
            </div>
          </header>

          <div className={flow.split}>
            {/* LEFT — the contribution action. Locked (inert) once the right
                column owns the confirm/success flow, so the amount/method can't
                be edited underneath the confirm panel (mirrors the mobile sheet's
                effective lockout). */}
            <div className={`${flow.col} ${view !== 'form' ? flow.colLocked : ''}`} inert={view !== 'form'}>
              <div className={flow.card}>
                {lockableSchedule && (
                  <div className={flow.seg} role="group" aria-label="Contribution type">
                    <button
                      type="button"
                      className={`${flow.segBtn} ${payScheduled ? flow.segBtnActive : ''}`}
                      onClick={() => setSaveMode('scheduled')}
                      aria-pressed={payScheduled}
                    >
                      Pay scheduled
                    </button>
                    <button
                      type="button"
                      className={`${flow.segBtn} ${!payScheduled ? flow.segBtnActive : ''}`}
                      onClick={() => setSaveMode('topup')}
                      aria-pressed={!payScheduled}
                    >
                      Top up extra
                    </button>
                  </div>
                )}

                {payScheduled ? (
                  <>
                    <span className={flow.fieldLabel}>This {cadenceLabel.toLowerCase()} contribution</span>
                    <div
                      className={`${flow.amountField} ${flow.amountFieldLocked}`}
                      role="img"
                      aria-label={`Scheduled contribution: ${formatUGX(scheduledAmount, { compact: false })}. Set by your schedule.`}
                    >
                      <span className={flow.amountPrefix} aria-hidden="true">UGX</span>
                      <span className={flow.amountVal}>{formatNumber(scheduledAmount)}</span>
                      <span className={flow.amountLock}>
                        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none">
                          <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.25" stroke="currentColor" strokeWidth="1.4" />
                          <path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                        Set by your schedule
                      </span>
                    </div>
                    <p className={flow.note}>
                      Your fixed {cadenceLabel.toLowerCase()} contribution. To add more on top, switch to <b>Top up extra</b>.
                    </p>
                  </>
                ) : (
                  <>
                    {/* "extra" applies to an employer-funded member too — their
                        payroll pension is already arriving, so anything typed here
                        is on top of it. */}
                    <span className={flow.fieldLabel}>
                      {lockableSchedule || employerFunded ? 'How much extra?' : 'How much?'}
                    </span>
                    <label className={flow.amountField} data-error={belowMin || undefined}>
                      <span className={flow.amountPrefix} aria-hidden="true">UGX</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                        value={amountStr ? formatNumber(Number.parseInt(amountStr, 10)) : ''}
                        onChange={(e) => setAmountStr(e.target.value.replace(/[^\d]/g, ''))}
                        placeholder="Enter an amount"
                        className={flow.amountInput}
                        aria-label="Contribution amount in UGX"
                        aria-invalid={belowMin || undefined}
                      />
                    </label>
                    <div className={flow.presets}>
                      {PRESET_AMOUNTS.map((v) => (
                        <button
                          type="button"
                          key={v}
                          className={`${flow.preset} ${amount === v ? flow.presetActive : ''}`}
                          onClick={() => setAmountStr(String(v))}
                        >
                          {formatUGXShort(v)}
                        </button>
                      ))}
                    </div>
                    {belowMin && (
                      <p className={flow.errorLine} role="alert">
                        Minimum {formatUGX(MIN_CONTRIBUTION, { compact: false })} required.
                      </p>
                    )}
                    <p className={flow.note}>
                      {employerFunded ? (
                        <>Extra saving of your own, on top of what {employerName} already sends.</>
                      ) : lockableSchedule ? (
                        <>A one-off top-up — your {cadenceLabel.toLowerCase()} schedule stays <b>{formatUGX(scheduledAmount, { compact: false })}</b>.</>
                      ) : (
                        'A one-off top-up to your savings.'
                      )}
                    </p>
                  </>
                )}
              </div>

              <div className={flow.card}>
                {/* Method + its gateway (card fields / bank details). Chosen on
                    the form so the right column's confirm panel stays a pure
                    review step. */}
                <PaymentMethodPicker state={pay} variant="chips" label="Pay from" />
                {/* The action CTA lives on the left in form view; once the user
                    advances to confirm/success the right column owns the pay
                    actions, so this is hidden to avoid a second, stale CTA. */}
                {view === 'form' && (
                  <button
                    type="button"
                    className={`${flow.cta} ${flow.ctaPrimary}`}
                    disabled={!hasAmount || !pay.ready}
                    onClick={handleContinue}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                      <rect x="2.5" y="6" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="1.75" />
                      <path d="M2.5 10h19" stroke="currentColor" strokeWidth="1.75" />
                      <path d="M6 15h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                    {hasAmount
                      ? `${payScheduled ? 'Pay' : 'Top up'} ${formatUGX(amount, { compact: false })}`
                      : payScheduled ? 'Pay' : 'Top up'}
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT — sticky summary that flips IN PLACE to the confirm → success
                pay panel (no bottom sheet on desktop). In form view it's the live
                order summary; once the user presses the CTA it becomes the inline
                confirm/pay panel, then the success panel. */}
            <aside className={flow.summaryCol}>
              {view === 'form' ? (
                <div className={flow.card}>
                  <p className={flow.sumEyebrow}>{payScheduled ? 'This contribution' : 'Your top-up'}</p>
                  <div className={flow.sumBig}>{formatUGX(hasAmount ? amount : 0, { compact: false })}</div>
                  <ul className={flow.sumList}>
                    <li className={flow.sumRow}>
                      <span className={flow.sumRowLabel}>
                        <span className={flow.sumDot} style={{ background: 'var(--color-indigo)' }} />
                        Retirement ({retirementPct}%)
                      </span>
                      <span className={flow.sumVal}>{formatUGX(retAmt, { compact: false })}</span>
                    </li>
                    <li className={flow.sumRow}>
                      <span className={flow.sumRowLabel}>
                        <span className={flow.sumDot} style={{ background: 'var(--color-indigo-soft)' }} />
                        Emergency ({emergencyPct}%)
                      </span>
                      <span className={flow.sumVal}>{formatUGX(emgAmt, { compact: false })}</span>
                    </li>
                    <li className={flow.sumRow}>
                      <span>Units it buys</span>
                      <span className={flow.sumVal}>{units.toLocaleString('en-UG', { maximumFractionDigits: 2 })} units</span>
                    </li>
                    <li className={flow.sumRow}>
                      <span>New balance</span>
                      <span className={`${flow.sumVal} ${flow.sumValPos}`}>{formatUGX(newBalance, { compact: false })}</span>
                    </li>
                  </ul>
                  {canProject && (
                    <div className={flow.proj}>
                      <p className={flow.projLabel}>Projected at age {RETIREMENT_AGE}</p>
                      <p className={flow.projValue}>{formatUGX(projectedAtRet, { compact: false })}</p>
                      <p className={flow.projNote}>Retirement bucket, compounded over {yearsToRet} years.</p>
                    </div>
                  )}
                  <p className={flow.note}>
                    {payScheduled ? (
                      nextDue ? (
                        <>Next scheduled payment due <b>{formatDate(nextDue, { variant: 'day-month' })}</b>.</>
                      ) : (
                        'Paid into the buckets you set in your schedule.'
                      )
                    ) : lockableSchedule ? (
                      <>One-off — this doesn&apos;t change your {cadenceLabel.toLowerCase()} schedule.</>
                    ) : employerFunded ? (
                      <>Extra saving of your own. What {employerName} sends each month is separate.</>
                    ) : (
                      'A one-off top-up to your savings.'
                    )}
                  </p>
                </div>
              ) : (
                /* The picker lives in the (now inert) left column, so the
                   authorising step is mirrored into this panel via `extra`,
                   where the member is actually looking. `GatewayAuthorising`
                   renders nothing for the methods with no gateway hop. */
                <InlinePayPanel
                  view={view === 'success' ? 'success' : 'confirm'}
                  ariaLabel={view === 'success' ? 'Top-up complete' : 'Confirm top-up'}
                  eyebrow={payScheduled ? 'Your scheduled payment' : 'You’re paying'}
                  total={amount}
                  lineItems={[
                    { label: `Retirement (${retirementPct}%)`, value: formatUGX(retAmt, { compact: false }), dot: 'var(--color-indigo)' },
                    { label: `Emergency (${emergencyPct}%)`, value: formatUGX(emgAmt, { compact: false }), dot: 'var(--color-indigo-soft)' },
                    { label: 'Payment method', value: pay.record },
                    { label: 'New balance', value: formatUGX(newBalance, { compact: false }), highlight: true, positive: true },
                  ]}
                  extra={submitting ? <GatewayAuthorising state={pay} /> : null}
                  note={pay.note}
                  submitting={submitting}
                  submittingLabel={pay.submittingLabel}
                  canPay={hasAmount}
                  primaryLabel="Confirm & pay"
                  cancelLabel="Back"
                  onPay={handleConfirm}
                  onCancel={closeConfirm}
                  success={{
                    title: 'Contribution added',
                    subtitle: `${formatUGX(amount, { compact: false })} is now working for you. Your new balance is ${formatUGX(newBalance, { compact: false })}.`,
                    reference: resultTx?.reference,
                  }}
                  successPrimary={{ label: 'Back to home', onClick: () => navigate('/dashboard') }}
                  successLink={{ label: 'View your activity', onClick: () => navigate('/dashboard/reports') }}
                />
              )}
            </aside>
          </div>
        </div>
      ) : (
        <>
      <div className={styles.body}>
        {/* Employer-funded members: say plainly that their workplace pension money
            arrives on its own, so this page reads as EXTRA saving rather than a bill
            they have to settle. Placed above the amount hero because it changes how
            the whole page should be read. Self-pay members never see it. */}
        {employerFunded && (
          <p className={styles.employerLede}>
            Your pension money from <b>{employerName}</b> arrives on its own every month.
            This page is for extra saving on top.
          </p>
        )}
        {/* Amount-first hero (flat card) — the app bar provides the "Save" title
            + back, so no dome here. Locked = the fixed scheduled amount; editable
            = big centred input + presets. The retirement/emergency split is not
            surfaced on mobile (it's a property of the saved schedule). */}
        <section className={`${styles.section} ${styles.amountHero}`} aria-labelledby="save-amount-label">
          {lockedMode ? (
            <>
              <span className={styles.heroEyebrow} id="save-amount-label">
                Scheduled {cadenceLabel?.toLowerCase()} contribution
              </span>
              <div
                className={styles.heroAmtBig}
                role="img"
                aria-label={`Scheduled contribution: ${formatUGX(amount, { compact: false })}. Amount is fixed.`}
              >
                <span className={styles.heroCur} aria-hidden="true">UGX</span>
                <span className={styles.heroNum}>{formatNumber(amount)}</span>
              </div>
              <p className={styles.heroNote}>
                Set in your savings schedule ·{' '}
                <button type="button" className={styles.resetBtn} onClick={() => navigate('/dashboard/save/schedule')}>
                  Change
                </button>
              </p>
            </>
          ) : (
            <>
              <span className={styles.heroEyebrow} id="save-amount-label">Enter an amount</span>
              <label className={styles.heroField} data-error={belowMin || undefined}>
                <span className={styles.heroCur} aria-hidden="true">UGX</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  value={amountStr ? formatNumber(Number.parseInt(amountStr, 10)) : ''}
                  onChange={(e) => setAmountStr(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="0"
                  className={styles.heroInput}
                  aria-label="Contribution amount in UGX"
                  aria-invalid={belowMin || undefined}
                  aria-describedby={belowMin ? 'save-amount-error' : undefined}
                />
                <span className={styles.heroEditHint} aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </svg>
                </span>
              </label>
              <p className={styles.heroFieldHint}>
                Type your own amount, or pick a preset below · min {formatUGX(MIN_CONTRIBUTION, { compact: false })}
              </p>
              <div className={styles.presets}>
                {PRESET_AMOUNTS.map((v) => (
                  <button
                    type="button"
                    key={v}
                    className={`${styles.preset} ${amount === v ? styles.presetOn : ''}`}
                    onClick={() => setAmountStr(String(v))}
                  >
                    {formatUGXShort(v)}
                  </button>
                ))}
              </div>
              {belowMin && (
                <p id="save-amount-error" className={styles.errorLine} role="alert">
                  Minimum {formatUGX(MIN_CONTRIBUTION, { compact: false })} required.
                </p>
              )}
            </>
          )}
        </section>

        {/* Pay with — full-width radio rows, plus the card / bank gateway the
            chosen method reveals. */}
        <section className={styles.section} aria-labelledby="save-method-label">
          <h2 className={styles.sectionTitle} id="save-method-label">Pay with</h2>
          <PaymentMethodPicker state={pay} variant="rows" label="Payment method" hideLabel />
        </section>
      </div>

      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!hasAmount || !pay.ready}
          onClick={handleContinue}
        >
          <span>{lockedMode ? 'Pay' : 'Top up'}</span>
          {hasAmount && <span className={styles.primaryAmt}>{formatUGX(amount, { compact: false })}</span>}
        </button>
      </footer>
        </>
      )}

      {/* Confirm → success sheet (state-based, not routed) — portaled to <body>
          so it escapes the page's animated (transformed) ancestor and layers
          ABOVE the fixed BottomTabBar instead of being trapped beneath it.
          MOBILE ONLY: on desktop the confirm/success step renders inline in the
          right summary column (InlinePayPanel) instead of a bottom sheet. */}
      {!isDesktop && createPortal(
        <AnimatePresence>
        {(view === 'confirm' || view === 'success') && (
          <motion.div
            className={styles.sheetScrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={() => { if (view === 'confirm') closeConfirm(); }}
          >
            <motion.div
              className={styles.sheet}
              role="dialog"
              aria-modal="true"
              aria-label={view === 'confirm' ? 'Confirm top-up' : 'Top-up complete'}
              initial={reduceMotion ? false : { y: '100%' }}
              animate={{ y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
              transition={{ duration: reduceMotion ? 0 : 0.34, ease: EASE_OUT_EXPO }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className={styles.sheetGrip} aria-hidden="true" />

              {view === 'confirm' && (
                <div className={styles.sheetBody}>
                  <span className={styles.confirmEyebrow}>{payScheduled ? 'Your scheduled payment' : 'You’re paying'}</span>
                  <div className={styles.confirmBig}>{formatUGX(amount, { compact: false })}</div>

                  <ul className={styles.confirmList}>
                    {/* This sheet is mobile-only (gated !isDesktop above); the
                        retirement/emergency split is a property of the saved
                        schedule and intentionally not surfaced on mobile. The
                        desktop confirm (with the split) renders via InlinePayPanel. */}
                    <li className={styles.confirmRow}>
                      <span>Payment method</span>
                      <strong>{pay.record}</strong>
                    </li>
                    <li className={styles.confirmRow} data-highlight="true">
                      <span>New balance</span>
                      <strong>{formatUGX(newBalance, { compact: false })}</strong>
                    </li>
                  </ul>
                  {/* The picker sits on the page BEHIND this sheet, so mirror
                      the authorising step in here. No-op for non-card methods. */}
                  {submitting && <GatewayAuthorising state={pay} />}
                  <p className={styles.confirmNote}>{pay.note}</p>

                  <div className={styles.sheetActions}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={closeConfirm}
                      disabled={submitting}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className={styles.primaryBtn}
                      disabled={submitting}
                      onClick={handleConfirm}
                    >
                      {submitting ? pay.submittingLabel : 'Confirm & pay'}
                    </button>
                  </div>
                </div>
              )}

              {view === 'success' && (
                <div className={styles.sheetBody} data-center="true">
                  <div className={styles.successCheck} aria-hidden="true">
                    <svg viewBox="0 0 48 48" width="40" height="40" fill="none">
                      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
                      <path d="M14 24l7 7 14-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  {/* Phase 5 (unitization): "is now working for you" is only
                      true when the money bought savings the moment it landed.
                      Once pricing is asynchronous, a Saturday top-up starts
                      working on Monday, and saying otherwise is the single most
                      misleading sentence in the app. The balance shown is the
                      TOTAL either way — the money is theirs from the instant it
                      arrives, so nothing appears to vanish while it waits. */}
                  <h2 className={styles.successTitle}>
                    {resultTx?.pricingStatus === 'pending' ? 'Money received' : 'Contribution added'}
                  </h2>
                  {resultTx?.pricingStatus === 'pending' ? (
                    <>
                      <DealingDateNote
                        className={styles.successSubtitle}
                        dealingDate={resultTx?.dealingDate}
                        direction="in"
                        received
                      />
                      <p className={styles.successSubtitle}>
                        {`Your balance is now ${formatUGX(newBalance, { compact: false })}.`}
                      </p>
                    </>
                  ) : (
                    <p className={styles.successSubtitle}>
                      {`${formatUGX(amount, { compact: false })} is now working for you. Your new balance is ${formatUGX(newBalance, { compact: false })}.`}
                    </p>
                  )}
                  {resultTx?.reference && (
                    <div className={styles.successRef}>
                      Reference <strong>{resultTx.reference}</strong>
                    </div>
                  )}
                  <button
                    type="button"
                    className={styles.trackLink}
                    onClick={() => navigate('/dashboard/reports')}
                  >
                    View your activity
                    <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10">
                      <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </button>
                  <button type="button" className={styles.primaryBtn} onClick={() => navigate('/dashboard')}>
                    Back to home
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
