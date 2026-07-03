import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { calcFV, parseAmount } from '../../utils/finance';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX, formatUGXShort } from '../../utils/currency';
import { useCurrentSubscriber, useRequestWithdrawal } from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { MIN_WITHDRAW, RETIREMENT_AGE } from '../../constants/savings';
import { PillChip, PillChipGroup } from '../../components/PillChip';
import InlinePayPanel from '../../components/InlinePayPanel';
import { goBackOrFallback } from '../shell/navigation';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './WithdrawPage.module.css';
import flow from './desktopFlow.module.css';

// Free-text reason labels. The default value stays "medical" (preserved from
// the prior form) — `value` is the lowercase id, `label` the free-text written
// into the withdrawal payload's `reason`.
const REASONS = [
  { id: 'medical',   value: 'medical',   label: 'Medical' },
  { id: 'education', value: 'education', label: 'Education' },
  { id: 'housing',   value: 'home',      label: 'Home' },
  { id: 'other',     value: 'other',     label: 'Other' },
];

// Payout methods — kept so the WithdrawalsHistory report's method column
// survives. The label is what's written to the payload (default "MTN Mobile
// Money", matching the service default).
const METHODS = [
  { id: 'mtn',    label: 'MTN Mobile Money' },
  { id: 'airtel', label: 'Airtel Money' },
  { id: 'bank',   label: 'Bank transfer' },
];

export default function WithdrawPage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub, isError, error, refetch } = useCurrentSubscriber();
  const { addToast } = useToast();
  const requestWithdrawal = useRequestWithdrawal(sub?.id);

  const [bucket, setBucket] = useState('emergency');
  const [amountStr, setAmountStr] = useState('');
  const [reason, setReason] = useState('medical');
  const [method, setMethod] = useState('mtn');
  const [sheetView, setSheetView] = useState(null); // null | 'confirm' | 'success'
  const [submitting, setSubmitting] = useState(false);
  const [resultWd, setResultWd] = useState(null);

  // Stable idempotency nonce for the withdrawal. Minted ONCE when the confirm
  // sheet opens (handleReview) and reused across a double-tap / manual retry so
  // the server-side request_withdrawal RPC collapses the duplicate debit (audit
  // §4a F-1). Reset to null on success or when the sheet closes.
  const withdrawalNonce = useRef(null);

  const emergencyBalance = sub?.emergencyBalance || 0;
  const retirementBalance = sub?.retirementBalance || 0;

  const retirementEligible = useMemo(() => {
    if (typeof sub?.age === 'number') return sub.age >= RETIREMENT_AGE;
    return false;
  }, [sub]);

  const max = bucket === 'emergency' ? emergencyBalance : retirementBalance;
  const locked = bucket === 'retirement' && !retirementEligible;
  // The slider can only operate when the pot holds at least the minimum.
  const sliderDisabled = locked || max < MIN_WITHDRAW;

  // amountStr is the source of truth. Clamp the parsed amount to the slider
  // range so the hero/CTA always reflect a withdrawable figure.
  const rawAmount = parseAmount(amountStr);
  const amount = rawAmount == null ? 0 : Math.min(Math.max(rawAmount, MIN_WITHDRAW), Math.max(max, MIN_WITHDRAW));
  const hasAmount = !sliderDisabled && rawAmount != null && amount >= MIN_WITHDRAW && amount <= max;

  // Reset the amount when the pot changes or when the active pot can't be
  // withdrawn from (locked / below minimum) so a stale figure never lingers.
  useEffect(() => {
    setAmountStr('');
  }, [bucket]);

  const remainingAfter = Math.max(0, max - (hasAmount ? amount : 0));

  const retirementImpact = useMemo(() => {
    if (bucket !== 'retirement' || !hasAmount) return null;
    const age = sub?.age || 40;
    const yrs = Math.max(1, RETIREMENT_AGE - age);
    const perMonthIfInvested = amount / (yrs * 12);
    return calcFV(perMonthIfInvested, yrs);
  }, [bucket, hasAmount, amount, sub]);

  const reasonLabel = REASONS.find((r) => r.value === reason)?.label || reason;
  const methodLabel = METHODS.find((m) => m.id === method)?.label || method;

  function handleBack() {
    goBackOrFallback(navigate, '/dashboard/withdraw');
  }

  function handleSliderChange(e) {
    setAmountStr(String(Number.parseInt(e.target.value, 10)));
  }

  function handleReview() {
    if (!hasAmount) return;
    // Mint the stable idempotency nonce once, as the confirm sheet opens.
    withdrawalNonce.current = crypto.randomUUID();
    setSheetView('confirm');
  }

  function closeSheet() {
    if (submitting) return;
    // Leaving the sheet without withdrawing — drop the nonce so re-opening mints
    // a fresh one.
    withdrawalNonce.current = null;
    setSheetView(null);
  }

  async function handleConfirm() {
    if (!hasAmount || !sub) return;
    // Early-return guard: a fast second tap must NOT fire a second debit —
    // relying on the disabled attr re-render alone loses the race (§4a F-1).
    if (submitting) return;
    setSubmitting(true);
    try {
      const wd = await requestWithdrawal.mutateAsync({
        amount,
        bucket,
        reason: reasonLabel,
        method: methodLabel,
        // Stable nonce → a double-tap / retry is idempotent on the server.
        nonce: withdrawalNonce.current ?? undefined,
      });
      setResultWd(wd);
      setSheetView('success');
      // Settled successfully — drop the nonce so a later withdrawal gets a fresh key.
      withdrawalNonce.current = null;
      addToast('success', `Withdrawal of ${formatUGX(amount, { compact: false })} requested.`);
    } catch (err) {
      addToast('error', err?.message || 'Could not request withdrawal.');
    } finally {
      setSubmitting(false);
    }
  }

  const sliderValue = hasAmount ? amount : MIN_WITHDRAW;
  const sliderPct = max > MIN_WITHDRAW
    ? ((sliderValue - MIN_WITHDRAW) / (max - MIN_WITHDRAW)) * 100
    : 0;

  const potLabel = bucket === 'emergency' ? 'Savings' : 'Retirement';

  // Desktop "available to withdraw" breakdown (sticky summary). Retirement is
  // locked until age 60 unless the member is already eligible.
  const availableNow = emergencyBalance + (retirementEligible ? retirementBalance : 0);
  const lockedRet = retirementEligible ? 0 : retirementBalance;
  const totalPot = emergencyBalance + retirementBalance;
  const lockedPct = totalPot > 0 ? Math.round((lockedRet / totalPot) * 100) : 0;
  const methodHint = method === 'bank' ? 'Bank' : method === 'airtel' ? 'Airtel' : 'MoMo';

  // A cold-start query failure would otherwise render a silent blank/zero
  // withdrawal form — surface a retry card instead (mirrors HomePage).
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
        /* Desktop (>=1024px): genuine 2-column flow — amount slider + pot picker +
           reason + payout form in the action column, beside a sticky summary
           (available/locked breakdown + this-withdrawal recap). Mobile keeps the
           shipped hero + stacked body + footer EXACTLY as-is in the fragment. */
        <div className={flow.canvas}>
          <header className={flow.head}>
            <button type="button" className={flow.backBtn} onClick={handleBack} aria-label="Back">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
                <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className={flow.headText}>
              <p className={flow.eyebrow}>{potLabel} fund</p>
              <h1 className={flow.title}>Withdraw savings</h1>
              <p className={flow.subtitle}>
                {locked
                  ? `Locked until age ${RETIREMENT_AGE} — your retirement savings unlock then. Use your Savings pot any time.`
                  : `UGX ${formatUGXShort(max)} available · paid to your ${method === 'bank' ? 'bank account' : 'Mobile Money'} in 1–2 days.`}
              </p>
            </div>
          </header>

          <div className={flow.split}>
            {/* LEFT — withdrawal form. Locked (inert) once the right column owns
                the confirm/success flow, so the amount/pot/method can't change
                underneath the confirm panel (mirrors the mobile sheet lockout). */}
            <div className={`${flow.col} ${sheetView !== null ? flow.colLocked : ''}`} inert={sheetView !== null}>
              <div className={flow.card}>
                <span className={flow.fieldLabel}>How much do you need?</span>
                <input
                  type="range"
                  min={MIN_WITHDRAW}
                  max={Math.max(max, MIN_WITHDRAW)}
                  step={1000}
                  value={sliderValue}
                  onChange={handleSliderChange}
                  disabled={sliderDisabled}
                  className={styles.slider}
                  style={{ '--pct': `${sliderPct}%` }}
                  aria-label={`Withdrawal amount from your ${potLabel} pot in UGX`}
                  aria-valuetext={`${formatUGX(sliderValue, { compact: false })} of ${formatUGX(Math.max(max, MIN_WITHDRAW), { compact: false })}`}
                />
                <div className={styles.sliderEnds}>
                  <span>{formatUGX(MIN_WITHDRAW, { compact: false })}</span>
                  <span className={styles.sliderMax}>{formatUGX(Math.max(max, MIN_WITHDRAW), { compact: false })}</span>
                </div>
                {sliderDisabled && !locked && (
                  <p className={styles.helperLine}>
                    This pot is below the {formatUGX(MIN_WITHDRAW, { compact: false })} minimum.
                  </p>
                )}
              </div>

              <div className={flow.card}>
                <span className={flow.fieldLabel}>Withdraw from</span>
                <div className={styles.bucketGrid}>
                  <button
                    type="button"
                    className={styles.bucket}
                    data-active={bucket === 'emergency'}
                    data-tone="emergency"
                    onClick={() => setBucket('emergency')}
                  >
                    <span className={styles.bucketName}>
                      <span className={styles.bucketDot} data-tone="emergency" />
                      Savings
                    </span>
                    <span className={styles.bucketBal}>{formatUGX(emergencyBalance, { compact: false })}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.bucket}
                    data-active={bucket === 'retirement'}
                    data-tone="retirement"
                    data-locked={!retirementEligible || undefined}
                    onClick={() => setBucket('retirement')}
                  >
                    <span className={styles.bucketName}>
                      <span className={styles.bucketDot} data-tone="retirement" />
                      Retirement
                    </span>
                    <span className={styles.bucketBal}>{formatUGX(retirementBalance, { compact: false })}</span>
                    {!retirementEligible && (
                      <span className={styles.lockPill}>
                        <svg aria-hidden="true" viewBox="0 0 12 12" width="9" height="9">
                          <rect x="3" y="5.5" width="6" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.2" fill="none" />
                          <path d="M4 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                        </svg>
                        Locked until {RETIREMENT_AGE}
                      </span>
                    )}
                  </button>
                </div>
                {locked && (
                  <p className={styles.helperLine} style={{ marginTop: '10px' }}>
                    Retirement funds unlock at age {RETIREMENT_AGE}. Use your Savings pot any time.
                  </p>
                )}
              </div>

              <div className={flow.card}>
                <span className={flow.fieldLabel}>Reason</span>
                <PillChipGroup label="Withdrawal reason" layout="row">
                  {REASONS.map((r) => (
                    <PillChip key={r.id} selected={reason === r.value} onClick={() => setReason(r.value)}>
                      {r.label}
                    </PillChip>
                  ))}
                </PillChipGroup>
              </div>

              <div className={flow.card}>
                <span className={flow.fieldLabel}>Payout to</span>
                <PillChipGroup label="Payout method" layout="row">
                  {METHODS.map((m) => (
                    <PillChip key={m.id} selected={method === m.id} onClick={() => setMethod(m.id)}>
                      {m.label}
                    </PillChip>
                  ))}
                </PillChipGroup>
                <p className={styles.helperLine} style={{ marginTop: '10px' }}>
                  Funds reach your registered account ({sub?.phone || 'your number'}) within 2 business days.
                </p>
                {/* The action CTA lives on the left in form view; once the user
                    advances to confirm/success the right column owns the actions,
                    so this is hidden to avoid a second, stale CTA. */}
                {sheetView === null && (
                  <button
                    type="button"
                    className={`${flow.cta} ${flow.ctaPrimary}`}
                    disabled={!hasAmount}
                    onClick={handleReview}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
                      <path d="M12 3v12M7 8l5-5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                    {hasAmount ? `Withdraw ${formatUGX(amount, { compact: false })}` : 'Request withdrawal'}
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT — sticky summary; the "This withdrawal" card flips IN PLACE
                to the inline confirm → success panel (no bottom sheet on desktop).
                The "Available to withdraw" context card stays above it throughout. */}
            <aside className={flow.summaryCol}>
              <div className={flow.card}>
                <p className={flow.sumEyebrow}>Available to withdraw</p>
                <div className={flow.sumBig}>{formatUGX(availableNow, { compact: false })}</div>
                <div className={flow.availBar} role="img" aria-label={`${lockedPct}% locked in retirement`}>
                  <span className={flow.availLocked} style={{ flexBasis: `${lockedPct}%` }} />
                  <span className={flow.availOpen} />
                </div>
                <ul className={`${flow.sumList} ${flow.sumListTight}`}>
                  <li className={flow.sumRow}>
                    <span className={flow.sumRowLabel}>
                      <span className={flow.sumDot} style={{ background: 'var(--color-green)' }} />
                      Emergency · available
                    </span>
                    <span className={`${flow.sumVal} ${flow.sumValPos}`}>{formatUGX(emergencyBalance, { compact: false })}</span>
                  </li>
                  <li className={flow.sumRow}>
                    <span className={flow.sumRowLabel}>
                      <span className={flow.sumDot} style={{ background: 'var(--color-indigo)' }} />
                      Retirement · {retirementEligible ? 'available' : `locked to ${RETIREMENT_AGE}`}
                    </span>
                    <span className={flow.sumVal}>{formatUGX(retirementBalance, { compact: false })}</span>
                  </li>
                </ul>
                <p className={flow.note}>
                  {retirementEligible
                    ? 'Both your funds are available to withdraw.'
                    : 'Only your emergency fund can be withdrawn before retirement.'}
                </p>
              </div>

              {sheetView === null ? (
                <div className={flow.card}>
                  <p className={flow.sumEyebrow}>This withdrawal</p>
                  <div className={flow.sumBig}>{formatUGX(hasAmount ? amount : 0, { compact: false })}</div>
                  <ul className={flow.sumList}>
                    <li className={flow.sumRow}>
                      <span>{potLabel} left after</span>
                      <span className={flow.sumVal}>{formatUGX(hasAmount ? remainingAfter : max, { compact: false })}</span>
                    </li>
                    <li className={flow.sumRow}>
                      <span>Pay out to</span>
                      <span className={flow.sumVal}>{methodHint}</span>
                    </li>
                    <li className={flow.sumRow}>
                      <span>Arrives</span>
                      <span className={flow.sumVal}>1–2 days</span>
                    </li>
                  </ul>
                  {bucket === 'retirement' && retirementImpact != null ? (
                    <p className={flow.note}>
                      May reduce your projected retirement by approx <b>{formatUGX(retirementImpact)}</b>.
                    </p>
                  ) : (
                    <p className={flow.note}>Your retirement savings stay locked until age {RETIREMENT_AGE}.</p>
                  )}
                </div>
              ) : (
                <InlinePayPanel
                  view={sheetView === 'success' ? 'success' : 'confirm'}
                  ariaLabel={sheetView === 'success' ? 'Withdrawal requested' : 'Confirm withdrawal'}
                  eyebrow="You’re taking out"
                  total={amount}
                  lineItems={[
                    { label: 'From', value: potLabel },
                    { label: 'Reason', value: reasonLabel },
                    { label: 'Payout method', value: methodLabel },
                    { label: `${potLabel} left after`, value: formatUGX(remainingAfter, { compact: false }) },
                  ]}
                  extra={bucket === 'retirement' && retirementImpact != null ? (
                    <div className={styles.warnBox} style={{ marginTop: 'var(--space-4)' }}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                        <path d="M12 3l10 18H2L12 3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                        <path d="M12 10v5M12 18v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                      </svg>
                      <span>
                        May reduce your projected retirement by approx <strong>{formatUGX(retirementImpact)}</strong>.
                      </span>
                    </div>
                  ) : null}
                  submitting={submitting}
                  canPay={hasAmount}
                  primaryLabel="Confirm withdrawal"
                  submittingLabel="Submitting…"
                  primaryTone="danger"
                  cancelLabel="Back"
                  onPay={handleConfirm}
                  onCancel={closeSheet}
                  success={{
                    title: 'Withdrawal requested',
                    subtitle: `${formatUGX(amount, { compact: false })} will arrive via ${methodLabel} within 2 business days.`,
                    reference: resultWd?.reference,
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
        {/* Amount-first summary (flat card) — the app bar provides the
            "Withdraw savings" title + back, so no dome here. Mirrors the SavePage
            reskin: eyebrow + big centred indigo amount (the live slider value) +
            a sub-line naming the source pot and what remains after. */}
        <section
          className={`${styles.section} ${styles.summaryHero}`}
          aria-labelledby="withdraw-amount-label"
        >
          <span className={styles.heroEyebrow} id="withdraw-amount-label">
            You&apos;re taking out
          </span>
          <div
            className={styles.heroAmtBig}
            role="img"
            aria-label={`Withdrawing ${formatUGX(hasAmount ? amount : 0, { compact: false })} from your ${potLabel} pot.`}
          >
            {formatUGX(hasAmount ? amount : 0, { compact: false })}
          </div>
          <p className={styles.heroNote}>
            From {potLabel} · {formatUGX(hasAmount ? remainingAfter : max, { compact: false })} remaining
          </p>
        </section>

        {/* Amount slider */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionLabel}>Amount</h2>
          </div>
          <input
            type="range"
            min={MIN_WITHDRAW}
            max={Math.max(max, MIN_WITHDRAW)}
            step={1000}
            value={sliderValue}
            onChange={handleSliderChange}
            disabled={sliderDisabled}
            className={styles.slider}
            style={{ '--pct': `${sliderPct}%` }}
            aria-label={`Withdrawal amount from your ${bucket === 'emergency' ? 'Savings' : 'Retirement'} pot in UGX`}
            aria-valuetext={`${formatUGX(sliderValue, { compact: false })} of ${formatUGX(Math.max(max, MIN_WITHDRAW), { compact: false })}`}
          />
          <div className={styles.sliderEnds}>
            <span>{formatUGX(MIN_WITHDRAW, { compact: false })}</span>
            <span className={styles.sliderMax}>{formatUGX(Math.max(max, MIN_WITHDRAW), { compact: false })}</span>
          </div>
          {sliderDisabled && !locked && (
            <p className={styles.helperLine}>
              This pot is below the {formatUGX(MIN_WITHDRAW, { compact: false })} minimum.
            </p>
          )}
        </section>

        {/* Pot picker */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionLabel}>Withdraw from</h2>
          </div>
          <div className={styles.bucketGrid}>
            <button
              type="button"
              className={styles.bucket}
              data-active={bucket === 'emergency'}
              data-tone="emergency"
              onClick={() => setBucket('emergency')}
            >
              <span className={styles.bucketName}>
                <span className={styles.bucketDot} data-tone="emergency" />
                Savings
              </span>
              <span className={styles.bucketBal}>{formatUGX(emergencyBalance, { compact: false })}</span>
            </button>
            <button
              type="button"
              className={styles.bucket}
              data-active={bucket === 'retirement'}
              data-tone="retirement"
              data-locked={!retirementEligible || undefined}
              onClick={() => setBucket('retirement')}
            >
              <span className={styles.bucketName}>
                <span className={styles.bucketDot} data-tone="retirement" />
                Retirement
              </span>
              <span className={styles.bucketBal}>{formatUGX(retirementBalance, { compact: false })}</span>
              {!retirementEligible && (
                <span className={styles.lockPill}>
                  <svg aria-hidden="true" viewBox="0 0 12 12" width="9" height="9">
                    <rect x="3" y="5.5" width="6" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <path d="M4 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                  Locked until {RETIREMENT_AGE}
                </span>
              )}
            </button>
          </div>
          {locked && (
            <p className={styles.helperLine}>
              Retirement funds unlock at age {RETIREMENT_AGE}. Use your Savings pot any time.
            </p>
          )}
        </section>

        {/* Reason */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionLabel}>Reason</h2>
          </div>
          <PillChipGroup label="Withdrawal reason" layout="row">
            {REASONS.map((r) => (
              <PillChip
                key={r.id}
                selected={reason === r.value}
                onClick={() => setReason(r.value)}
              >
                {r.label}
              </PillChip>
            ))}
          </PillChipGroup>
        </section>

        {/* Payout method */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionLabel}>Payout to</h2>
          </div>
          <PillChipGroup label="Payout method" layout="row">
            {METHODS.map((m) => (
              <PillChip
                key={m.id}
                selected={method === m.id}
                onClick={() => setMethod(m.id)}
              >
                {m.label}
              </PillChip>
            ))}
          </PillChipGroup>
          <p className={styles.helperLine}>
            Funds reach your registered account ({sub?.phone || 'your number'}) within 2 business days.
          </p>
        </section>
      </div>

      <footer className={styles.footer}>
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={!hasAmount}
          onClick={handleReview}
        >
          {hasAmount ? `Withdraw ${formatUGX(amount, { compact: false })}` : 'Withdraw'}
        </button>
      </footer>
        </>
      )}

      {/* Confirm → success sheet — portaled to <body> so it escapes the page's
          animated (transformed) ancestor and layers ABOVE the fixed BottomTabBar
          instead of being trapped beneath it (z-index then works against root).
          MOBILE ONLY: on desktop the confirm/success step renders inline in the
          right summary column (InlinePayPanel) instead of a bottom sheet. */}
      {!isDesktop && createPortal(
        <AnimatePresence>
        {sheetView && (
          <motion.div
            className={styles.sheetScrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE_OUT_EXPO }}
            onClick={closeSheet}
          >
            <motion.div
              className={styles.sheet}
              role="dialog"
              aria-modal="true"
              aria-label={sheetView === 'confirm' ? 'Confirm withdrawal' : 'Withdrawal requested'}
              initial={reduceMotion ? false : { y: '100%' }}
              animate={{ y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
              transition={{ duration: reduceMotion ? 0 : 0.34, ease: EASE_OUT_EXPO }}
              onClick={(e) => e.stopPropagation()}
            >
              <span className={styles.sheetGrip} aria-hidden="true" />

              <AnimatePresence mode="wait" initial={false}>
                {sheetView === 'confirm' && (
                  <motion.div
                    key="confirm"
                    initial={reduceMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE_OUT_EXPO }}
                    className={styles.sheetInner}
                  >
                    <span className={styles.confirmEyebrow}>You&apos;re taking out</span>
                    <div className={styles.confirmBig}>{formatUGX(amount, { compact: false })}</div>

                    <ul className={styles.summaryList}>
                      <li className={styles.summaryRow}>
                        <span>From</span>
                        <strong>{bucket === 'emergency' ? 'Savings' : 'Retirement'}</strong>
                      </li>
                      <li className={styles.summaryRow}>
                        <span>Reason</span>
                        <strong>{reasonLabel}</strong>
                      </li>
                      <li className={styles.summaryRow}>
                        <span>Payout method</span>
                        <strong>{methodLabel}</strong>
                      </li>
                      <li className={styles.summaryRow}>
                        <span>Remaining in pot</span>
                        <strong>{formatUGX(remainingAfter, { compact: false })}</strong>
                      </li>
                    </ul>

                    {bucket === 'retirement' && retirementImpact != null && (
                      <div className={styles.warnBox}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                          <path d="M12 3l10 18H2L12 3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                          <path d="M12 10v5M12 18v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                        </svg>
                        <span>
                          May reduce your projected retirement by approx <strong>{formatUGX(retirementImpact)}</strong>.
                        </span>
                      </div>
                    )}

                    <div className={styles.sheetActions}>
                      <button type="button" className={styles.secondaryBtn} onClick={closeSheet} disabled={submitting}>
                        Back
                      </button>
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        disabled={submitting}
                        onClick={handleConfirm}
                      >
                        {submitting ? 'Submitting…' : 'Confirm withdrawal'}
                      </button>
                    </div>
                  </motion.div>
                )}

                {sheetView === 'success' && (
                  <motion.div
                    key="success"
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.3, ease: EASE_OUT_EXPO }}
                    className={styles.successInner}
                  >
                    <div className={styles.successCheck} aria-hidden="true">
                      <svg viewBox="0 0 48 48" width="38" height="38" fill="none">
                        <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
                        <path d="M14 24l7 7 14-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <h2 className={styles.successTitle}>Withdrawal requested</h2>
                    <p className={styles.successSubtitle}>
                      {formatUGX(amount, { compact: false })} will arrive via {methodLabel} within 2 business days.
                    </p>
                    {resultWd?.reference && (
                      <div className={styles.successRef}>Reference <strong>{resultWd.reference}</strong></div>
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
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
