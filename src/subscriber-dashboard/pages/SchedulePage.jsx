import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCurrentSubscriber,
  useUpdateSchedule,
  useMakeContribution,
  useContributionPaidThisMonth,
  useMyEmployerFunding,
} from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { formatUGX, formatNumber } from '../../utils/currency';
import {
  deriveContributionLegs,
  formatLegRateForMember,
  isLegZero,
  memberFundingSummary,
} from '../../utils/contributionModel';
import { contributionOwed, buildAnnualSettleLineItems } from '../../utils/periodSettlement';
import PageHeader from '../../components/PageHeader';
import PaySheet from '../../components/PaySheet';
import InlinePayPanel from '../../components/InlinePayPanel';
import SubscriberScheduleForm from '../../components/contribution/SubscriberScheduleForm';
import { PAYMENT_METHODS } from '../../constants/payment';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './SchedulePage.module.css';
import flow from './desktopFlow.module.css';

export default function SchedulePage() {
  const navigate = useNavigate();
  const { data: sub, isError, error, refetch } = useCurrentSubscriber();
  const { addToast } = useToast();
  const updateSchedule = useUpdateSchedule(sub?.id);
  const makeContribution = useMakeContribution(sub?.id);
  const { data: paidThisMonthAmount = 0 } = useContributionPaidThisMonth(sub?.id);
  const [submitting, setSubmitting] = useState(false);
  const isDesktop = useIsDesktop();

  // "Settle this period" prompt — opened after a save that leaves this month's
  // contribution short. Contribution only: cover is bought on the Insurance page
  // (see the showInsurance note below), so no premium can ever ride this sheet.
  const [settle, setSettle] = useState(null);
  const [settleView, setSettleView] = useState('confirm'); // confirm | success
  const [settleSubmitting, setSettleSubmitting] = useState(false);

  const existing = sub?.contributionSchedule;
  const isNew = !existing;

  // ── Employer-sponsored members ──────────────────────────────────────────────
  // Both contribution legs are COMPANY-WIDE employer settings (migration 0092),
  // remitted every month by the employer's contribution run. The member has no
  // say in either figure, and since 0102 no say in where that money lands either
  // — every shilling an employer funds goes to retirement (EMPLOYER_FUNDED_SPLIT).
  //
  // That is the whole of the employer's involvement. It is DISPLAYED here (the
  // read-only `fundingPanel`) and nothing more: the editor below is the member's
  // own schedule — their own amount, their own split (cover lives elsewhere) —
  // exactly as it is for a self-pay member.
  //
  // `useMyEmployerFunding()` returns null for a self-pay member, and EVERY
  // employer branch below is gated on that, so the self-pay page stays
  // byte-identical in behaviour and copy.
  const { data: funding } = useMyEmployerFunding();
  const legs = funding ? deriveContributionLegs(funding, funding.compensation) : null;
  // A 0/0 employer config is legal under 0092 — it simply funds no pension.
  // `memberFundingSummary` returns null for it, which is the app-wide "hide the
  // funding surface" signal, and that is the right call here too: nothing arrives
  // from payroll, so the member's own schedule really is theirs to set.
  const fundingSummary = funding ? memberFundingSummary(funding, funding.employerName) : null;
  const employerFunded = Boolean(funding) && fundingSummary !== null;
  const employerName = funding?.employerName || 'your employer';
  const payLegZero = !funding || isLegZero(funding.employeePct);
  const topUpLegZero = !funding || isLegZero(funding.employerPct);

  // DECOUPLED. The editor below is the member's OWN schedule for EVERY member,
  // employer-sponsored or not — same initial values, same amount field, same
  // split, same save path.
  //
  // It used to be seeded with the employer's `employeeLeg` and locked ("Set by
  // your employer"), while `handleSave` threw the typed figure away and stored 0.
  // That made one row mean two different things depending on who was looking at
  // it, and it cost the member the ability to run a voluntary schedule at all:
  // their own saving had to go through ad-hoc Save-page top-ups because the only
  // number the schedule could hold was their employer's.
  //
  // The employer's two legs are not a schedule and are not shown as one — they
  // live in `fundingPanel` below, read-only, which is the honest place for them.
  // Nothing on the two sides now shares a field:
  //   • employer legs  → posted by contribution runs, 100% retirement, fixed.
  //   • this schedule  → the member's own amount + split, theirs to set.
  // `paidThisMonth` already excludes run-posted and employer-source rows, so a
  // sponsored member with a real schedule is billed for their own contribution
  // only, and the home dashboard's `ownMonthly + fundedMonthly` counts each side
  // exactly once.
  const formInitial = existing;

  async function handleSave(schedule) {
    if (!sub) return;
    setSubmitting(true);
    try {
      // The member's own figure, stored as typed, for every member. No employer
      // branch: what an employer's runs send is never routed through this row (see
      // the decoupling note above), so there is nothing here to double-count.
      const amountToStore = schedule.amount;

      // Persist the schedule itself (frequency / amount / split / step-up). No
      // insurance keys ride this PATCH: the form is mounted with
      // showInsurance={false} and so emits none, and `updateContributionSchedule`
      // DERIVES include_insurance from `insuranceTypes` — passing even an empty
      // array here would strip the member's cover flag from a page that no longer
      // asks them about cover at all.
      await updateSchedule.mutateAsync({
        frequency: schedule.frequency,
        amount: amountToStore,
        retirementPct: schedule.retirementPct,
        emergencyPct: schedule.emergencyPct,
        contributionIndexationPct: schedule.contributionIndexationPct,
        ...(schedule.nextDueDate ? { nextDueDate: schedule.nextDueDate } : {}),
      });
      addToast('success', isNew ? 'Schedule set up.' : 'Contribution schedule updated.');

      // Their own contribution only. `paidThisMonth` excludes employer-source and
      // run-posted rows, so a sponsored member is never asked to pay their payroll
      // deduction over again here. `buildAnnualSettleLineItems` still single-sources
      // the line label; with no products passed it yields the contribution alone.
      const owed = contributionOwed(amountToStore, paidThisMonthAmount);
      const { lineItems, total } = buildAnnualSettleLineItems({ owed });

      if (total > 0) {
        // A stable nonce so a double-tap can't double-charge.
        setSettle({
          owed, lineItems, total, retirementPct: schedule.retirementPct, nonce: crypto.randomUUID(),
        });
        setSettleView('confirm');
        setSubmitting(false);
        return;
      }

      navigate('/dashboard');
    } catch (err) {
      addToast('error', err?.message || 'Could not save schedule.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSettlePay(methodFull) {
    if (!settle || !sub) return;
    setSettleSubmitting(true);
    try {
      await makeContribution.mutateAsync({
        amount: settle.owed,
        retirementPct: settle.retirementPct,
        method: methodFull,
        nonce: settle.nonce,
      });
      setSettleView('success');
    } catch (err) {
      addToast('error', err?.message || 'Could not complete the payment.');
    } finally {
      setSettleSubmitting(false);
    }
  }

  function closeSettle() {
    if (settleSubmitting) return;
    const paid = settleView === 'success';
    // No insurance-flag repair on the way out any more: this page can no longer
    // buy cover, so deferring ("Maybe later") leaves nothing half-purchased —
    // only an unpaid contribution, which is exactly what the member chose.
    setSettle(null);
    if (paid) addToast('success', 'Payment complete — your plan is up to date.');
    navigate('/dashboard');
  }

  const settleSheet = (
    <PaySheet
      open={!!settle}
      view={settleView}
      ariaLabel="Settle this period"
      eyebrow="Settle this month"
      total={settle?.total ?? 0}
      subtitle="Pay for the changes you just made to this month's plan."
      lineItems={(settle?.lineItems ?? []).map((li) => ({
        label: li.label,
        value: `${li.kind === 'insurance' ? '+' : ''}${formatUGX(li.amount, { compact: false })}`,
      }))}
      payLabel={settle ? `Pay ${formatUGX(settle.total, { compact: false })}` : undefined}
      cancelLabel="Maybe later"
      submitting={settleSubmitting}
      success={{ title: 'Payment complete', subtitle: 'Your plan is up to date for this month.' }}
      onPay={handleSettlePay}
      onClose={closeSettle}
    />
  );

  // What arrives from work, stated read-only in plain words. This is the ONLY
  // place the employer's legs appear on this page — they are not editable, not
  // pre-filled into the schedule below, and not affected by anything the member
  // sets there. Rendered above the editor on both viewports so the reading order
  // is "here is what your job puts in · here is what you add yourself".
  const fundingPanel = employerFunded ? (
    <section className={styles.employer} aria-labelledby="sched-funding-title">
      <p className={styles.employerEyebrow}>What your job puts in</p>
      <p className={styles.employerTitle} id="sched-funding-title">{fundingSummary}</p>
      <span className={styles.employerAmountKey}>Out of your pay each month</span>
      <div
        className={styles.employerAmount}
        role="img"
        aria-label={`${formatUGX(legs.employeeLeg, { compact: false })} of your pay goes to your pension each month. Set by your employer.`}
      >
        <span className={styles.employerCur} aria-hidden="true">UGX</span>
        <span className={styles.employerNum}>{formatNumber(legs.employeeLeg)}</span>
        <span className={styles.employerLock}>
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none">
            <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.25" stroke="currentColor" strokeWidth="1.4" />
            <path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          Set by your employer
        </span>
      </div>
      <ul className={styles.employerLegs}>
        <li className={styles.employerLeg}>
          <span className={styles.employerLegKey}>Your share</span>
          <span className={styles.employerLegVal}>
            {payLegZero
              ? 'Nothing — at no cost to you'
              : formatLegRateForMember(funding.employeePct)}
          </span>
        </li>
        <li className={styles.employerLeg}>
          <span className={styles.employerLegKey}>{employerName} adds</span>
          <span className={styles.employerLegVal}>
            {topUpLegZero
              ? 'Nothing'
              : `${formatLegRateForMember(funding.employerPct)} · ${formatUGX(legs.employerLeg, { compact: false })} each month`}
          </span>
        </li>
      </ul>
      <p className={styles.employerNote}>
        {employerName} sends this to your pension every month. All of it goes to your
        retirement savings, and you do not pay it here. Below is separate — it is your own
        saving, and you decide the amount and how it is split.
      </p>
    </section>
  ) : null;

  // A cold-start query failure would otherwise render a silent blank schedule
  // form — surface a retry card instead (mirrors HomePage's error handling).
  if (isError) {
    return (
      <div className={styles.page}>
        <ErrorCard
          title="We couldn't load your schedule"
          message={error}
          onRetry={refetch}
        />
      </div>
    );
  }

  // Desktop (>=1024px): a plain header over a width-capped, centred frame wrapping
  // the two-tab editor in its "split" layout (inputs left / sticky summary right).
  // When a save leaves a balance owed, the form is replaced IN PLACE by a
  // 2-column settle checkout (breakdown left, inline pay panel right).
  if (isDesktop) {
    const settleItems = (settle?.lineItems ?? []).map((li) => ({
      label: li.label,
      value: `${li.kind === 'insurance' ? '+' : ''}${formatUGX(li.amount, { compact: false })}`,
    }));
    return (
      <div className={styles.page}>
        {/* Same framing for everyone: this page IS the member's own schedule. A
            sponsored member gets one extra sentence naming what arrives from work
            on top of it — their employer's money is separate, not a version of
            this. */}
        <PageHeader
          title={
            settle
              ? 'Settle this month'
              : (isNew ? 'Set up contribution schedule' : 'Tune your schedule')
          }
          subtitle={
            settle
              ? 'Pay for the changes you just made to this month’s plan.'
              : employerFunded
                ? `What you save yourself. ${employerName}’s money comes on top and goes to your retirement savings.`
                : 'How much you save, how often, and how it is split'
          }
          fallback="/dashboard/save"
        />
        {settle ? (
          <div className={flow.splitHost}>
            <div className={flow.split}>
              <div className={flow.col}>
                <div className={flow.card}>
                  <p className={flow.sumEyebrow}>What’s owed this month</p>
                  <ul className={flow.sumList}>
                    {settleItems.map((it) => (
                      <li className={flow.sumRow} key={it.label}>
                        <span>{it.label}</span>
                        <span className={flow.sumVal}>{it.value}</span>
                      </li>
                    ))}
                    <li className={flow.sumRow}>
                      <span><b>Total</b></span>
                      <span className={flow.sumVal}>{formatUGX(settle.total, { compact: false })}</span>
                    </li>
                  </ul>
                  <p className={flow.note}>
                    {settleView === 'success' ? (
                      <>Your contribution schedule is saved and this month’s balance is settled — you’re all caught up.</>
                    ) : (
                      <>Your contribution schedule is saved. This is the balance for the current month from the changes you just made — settle it now to stay on track, or choose <b>Maybe later</b>.</>
                    )}
                  </p>
                </div>
              </div>

              <aside className={flow.summaryCol}>
                <InlinePayPanel
                  view={settleView === 'success' ? 'success' : 'confirm'}
                  ariaLabel="Settle this period"
                  eyebrow="Settle this month"
                  total={settle.total}
                  subtitle="Pay for the changes you just made to this month’s plan."
                  methods={PAYMENT_METHODS}
                  submitting={settleSubmitting}
                  primaryLabel={`Pay ${formatUGX(settle.total, { compact: false })}`}
                  cancelLabel="Maybe later"
                  onPay={handleSettlePay}
                  onCancel={closeSettle}
                  success={{ title: 'Payment complete', subtitle: 'Your plan is up to date for this month.' }}
                  successPrimary={{ label: 'Done', onClick: closeSettle }}
                />
              </aside>
            </div>
          </div>
        ) : (
          <div className={styles.frame}>
            {fundingPanel}
            {sub && (
              <SubscriberScheduleForm
                initial={formInitial}
                age={sub.age}
                heldPolicies={sub.policies}
                layout="split"
                showInsurance={false}
                onSave={handleSave}
                submitting={submitting}
                submitLabel={isNew ? 'Set up schedule' : undefined}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // Mobile: the persistent shell app bar owns the page title + back arrow, so the
  // in-page hero dome is removed. A flat, light intro card carries the brand
  // surface at the top of the body, then the two-tab editor follows.
  return (
    <>
      <div className={styles.page}>
        <div className={styles.body}>
          <section className={styles.intro}>
            <p className={styles.introEyebrow}>Contribution plan</p>
            <p className={styles.introTitle}>
              {isNew ? 'Set up your schedule' : 'Tune your schedule'}
            </p>
            <p className={styles.introSub}>
              {employerFunded
                ? `What you save yourself. ${employerName}’s money comes on top and goes to your retirement savings.`
                : 'How much you save, how often, and how it is split.'}
            </p>
          </section>
          {fundingPanel}
          {sub && (
            <SubscriberScheduleForm
              initial={formInitial}
              age={sub.age}
              heldPolicies={sub.policies}
              showInsurance={false}
              onSave={handleSave}
              submitting={submitting}
            />
          )}
        </div>
      </div>
      {settleSheet}
    </>
  );
}
