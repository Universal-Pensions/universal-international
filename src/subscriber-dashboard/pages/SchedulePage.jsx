import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCurrentSubscriber,
  useUpdateSchedule,
  useMakeContribution,
  useFundInsuranceProducts,
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
  const fundInsurance = useFundInsuranceProducts(sub?.id);
  const { data: paidThisMonthAmount = 0 } = useContributionPaidThisMonth(sub?.id);
  const [submitting, setSubmitting] = useState(false);
  const isDesktop = useIsDesktop();

  // "Settle this period" prompt — opened after a save that leaves a balance owed
  // this month: the contribution top-up and/or a Route-A ("pay now") annual
  // premium for the cover the subscriber just added. Route B ("save up") charges
  // nothing now, so it funds building cover without opening this sheet.
  const [settle, setSettle] = useState(null);
  const [settleView, setSettleView] = useState('confirm'); // confirm | success
  const [settleSubmitting, setSettleSubmitting] = useState(false);

  const existing = sub?.contributionSchedule;
  const isNew = !existing;

  // ── Employer-sponsored members ──────────────────────────────────────────────
  // Both contribution legs are COMPANY-WIDE employer settings (migration 0092),
  // remitted every month by the employer's contribution run. The member has no
  // say in either figure — the only thing on this page that is genuinely theirs
  // is the retirement/liquid split (and any family cover they buy themselves).
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
  // The save-to-cover sweep (migration 0072, `IF NEW.source = 'own'`) accrues ONLY
  // own-source contributions toward a building policy. A member whose employee leg
  // is zero never produces an 'own' row from payroll, so a "save up for it" policy
  // could never complete — they would be saving toward cover that never arrives.
  // The employer leg is pension money and must NOT be diverted into premiums, so
  // the route is refused rather than the trigger widened.
  const buildImpossible = employerFunded && payLegZero;

  // Seed the editor's amount field with the REAL employee leg instead of the
  // employer member's placeholder 0, so the figure they see is the one leaving
  // their pay. It is display-only: `handleSave` discards it and stores 0 (see the
  // comment there). Two side effects this deliberately buys:
  //   • the form's own save gate (`amount >= MIN_CONTRIBUTION`) opens, so an
  //     employer member can finally save a split change — with a stored amount of
  //     0 they could not save at all;
  //   • the dirty check compares against the employer's figure, so merely opening
  //     the page never looks like an edit.
  // Spreading a missing `existing` is deliberate: an employer member with no
  // schedule row still has nothing to "set up" (their amount is already decided),
  // so the editor should open in edit framing rather than first-run framing.
  const formInitial = employerFunded ? { ...existing, amount: legs.employeeLeg } : existing;

  // Handed to SubscriberScheduleForm so the amount input itself renders read-only
  // with a "Set by your employer" chip. The form is owned by another workstream;
  // until it honours this prop the lock is enforced here in `handleSave` (the
  // stored amount can never be the member's typed figure) and stated in the panel
  // copy below. Shape: { label, note } — null for a self-pay member.
  const amountLock = employerFunded
    ? {
        label: 'Set by your employer',
        note: `${employerName} sets this amount and sends it to your pension every month.`,
      }
    : null;

  async function handleSave(schedule) {
    if (!sub) return;
    // Refuse an impossible build up-front, before anything is written: creating the
    // policy would strand the member on cover that can never activate.
    if (
      buildImpossible
      && schedule.insuranceFundingMode === 'save_to_cover'
      && ((schedule.addedProducts ?? []).length > 0
        || (sub.policies ?? []).some((p) => p.status === 'building'))
    ) {
      addToast(
        'error',
        `For family cover, choose “Pay now”. Saving up for it fills from money you send yourself, and nothing comes out of your pay — ${employerName} pays your whole pension.`,
      );
      return;
    }
    setSubmitting(true);
    try {
      // An employer-funded member has NO voluntary schedule of their own: the
      // amount shown to them is the employer's employee leg, which payroll remits.
      // The form's amount field is seeded with that figure so they can SEE it, so
      // whatever it holds is discarded here and the stored amount stays 0. Storing
      // the leg instead would count it twice — the home dashboard adds the stored
      // schedule to the funded legs (`ownMonthly + fundedMonthly`), and
      // `paidThisMonth` deliberately ignores run-posted rows, so the settle sheet
      // below would also bill the member for their own payroll deduction. Their
      // extra saving is an ad-hoc top-up on the Save page instead.
      const amountToStore = employerFunded ? 0 : schedule.amount;

      // 1) Persist the schedule itself (frequency / amount / split / step-up +
      //    the include-insurance flag). The 0072 funding-mode/target columns are
      //    RPC-locked, so they DON'T ride this PATCH — the funding op below sets
      //    them via the DEFINER RPC.
      await updateSchedule.mutateAsync({
        frequency: schedule.frequency,
        amount: amountToStore,
        retirementPct: schedule.retirementPct,
        emergencyPct: schedule.emergencyPct,
        includeInsurance: schedule.includeInsurance,
        insuranceTypes: schedule.insuranceTypes,
        contributionIndexationPct: schedule.contributionIndexationPct,
        ...(schedule.nextDueDate ? { nextDueDate: schedule.nextDueDate } : {}),
      });
      addToast(
        'success',
        employerFunded
          ? 'Saved. Your split is updated.'
          : (isNew ? 'Schedule set up.' : 'Contribution schedule updated.'),
      );

      // Derived from what was STORED, so an employer-funded member is never asked
      // to pay their payroll leg out of pocket here (stored amount 0 → owed 0).
      const owed = contributionOwed(amountToStore, paidThisMonthAmount);
      const added = schedule.addedProducts ?? [];
      const payNow = schedule.insuranceFundingMode !== 'save_to_cover';
      const savingsPct = schedule.insuranceSavingsPct;
      const hasNewCover = added.length > 0;
      const hasBuild = (sub.policies ?? []).some((p) => p.status === 'building');

      // Route B ("save up") funds building cover for FREE, so it must commit NOW —
      // at save time — independent of the settle sheet. Otherwise deferring the
      // (unrelated) owed contribution via "Maybe later" would silently drop the
      // free cover. This also persists a savings-split-only tweak on an existing
      // build (whose columns are RPC-locked, so updateSchedule can't carry it).
      let builtNow = false;
      if (!payNow && hasNewCover) {
        await fundInsurance.mutateAsync({
          fundingMode: 'save_to_cover', products: added, savingsPct, nonce: crypto.randomUUID(),
        });
        builtNow = true;
      } else if (!payNow && !hasNewCover && hasBuild) {
        await fundInsurance.mutateAsync({
          fundingMode: 'save_to_cover', products: [], savingsPct, nonce: crypto.randomUUID(),
        });
      }

      // The settle sheet handles only what's actually CHARGED this period: the
      // owed contribution + any Route-A ("pay now") annual premium. Route-A cover
      // activates only on payment, so its funding op rides the settle sheet.
      const fundOp = (payNow && hasNewCover)
        ? { fundingMode: 'pay_now', products: added, savingsPct }
        : null;
      const { lineItems, total } = buildAnnualSettleLineItems({ owed, addedProducts: added, payNow });

      if (total > 0) {
        // Stable per-leg nonces so a double-tap can't double-charge.
        const nonces = { contribution: crypto.randomUUID(), insurance: crypto.randomUUID() };
        setSettle({ owed, fundOp, lineItems, total, retirementPct: schedule.retirementPct, nonces });
        setSettleView('confirm');
        setSubmitting(false);
        return;
      }

      // Nothing to pay this period.
      if (builtNow) addToast('success', 'Your new cover is now building from your savings.');
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
      if (settle.owed > 0) {
        await makeContribution.mutateAsync({
          amount: settle.owed,
          retirementPct: settle.retirementPct,
          method: methodFull,
          nonce: settle.nonces.contribution,
        });
      }
      if (settle.fundOp) {
        await fundInsurance.mutateAsync({
          ...settle.fundOp,
          method: methodFull,
          nonce: settle.nonces.insurance,
        });
      }
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
    // E4 — a deferred "pay now" premium ("Maybe later") never funds the new cover
    // (Route-A cover activates only on payment), yet the schedule's include_insurance
    // flag was persisted optimistically at save. When the user defers a pending
    // pay-now premium, re-derive the flag from the cover actually in force (held
    // active/building policies) so it can't claim cover that was never bought. No
    // money moves either way — a completed payment leaves the flag true as it should.
    if (!paid && settle?.fundOp) {
      const stillCovered = (sub?.policies ?? []).some(
        (p) => p.status === 'active' || p.status === 'building',
      );
      updateSchedule.mutate({ includeInsurance: stillCovered });
    }
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

  // Employer-funded members: the contribution amount is NOT theirs to set, so it
  // is stated read-only with the same lock affordance the Save page uses for a
  // scheduled amount ("Set by your schedule" → "Set by your employer"), alongside
  // both figures in plain words. Rendered above the editor on mobile and desktop
  // so the split below reads as the one real choice on the page.
  const fundingPanel = employerFunded ? (
    <section className={styles.employer} aria-labelledby="sched-funding-title">
      <p className={styles.employerEyebrow}>How your pension is funded</p>
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
        {employerName} sends this to your pension every month — you do not pay it here, and
        the amount is not yours to change. What you choose below is how your money is split,
        and any family cover you add. To put in extra of your own, use <b>Save</b>.
      </p>
      {buildImpossible && (
        <p className={styles.employerWarn}>
          For family cover, choose <b>Pay now</b>. “Save up for it” fills from money you
          send yourself, and nothing comes out of your pay — so the tin would never fill.
        </p>
      )}
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
        {/* An employer-funded member does not "tune" an amount they never chose —
            the title + subtitle name what is actually theirs to decide. */}
        <PageHeader
          title={
            settle
              ? 'Settle this month'
              : employerFunded
                ? 'Your pension plan'
                : (isNew ? 'Set up contribution schedule' : 'Tune your schedule')
          }
          subtitle={
            settle
              ? 'Pay for the changes you just made to this month’s plan.'
              : employerFunded
                ? `${employerName} sets the amount. You choose how it’s split and what cover you add.`
                : 'Your contribution and your family cover, in one place'
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
                onSave={handleSave}
                submitting={submitting}
                submitLabel={isNew && !employerFunded ? 'Set up schedule' : undefined}
                amountLock={amountLock}
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
              {employerFunded
                ? 'Your pension plan'
                : (isNew ? 'Set up your schedule' : 'Tune your schedule')}
            </p>
            <p className={styles.introSub}>
              {employerFunded
                ? `${employerName} sets the amount. You choose how it’s split and what cover you add.`
                : 'Your contribution and your family cover, in one place.'}
            </p>
          </section>
          {fundingPanel}
          {sub && (
            <SubscriberScheduleForm
              initial={formInitial}
              age={sub.age}
              heldPolicies={sub.policies}
              onSave={handleSave}
              submitting={submitting}
              amountLock={amountLock}
            />
          )}
        </div>
      </div>
      {settleSheet}
    </>
  );
}
