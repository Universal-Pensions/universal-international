import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCurrentSubscriber,
  useUpdateSchedule,
  useMakeContribution,
  useFundInsuranceProducts,
  useContributionPaidThisMonth,
} from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { formatUGX } from '../../utils/currency';
import { contributionOwed, buildAnnualSettleLineItems } from '../../utils/periodSettlement';
import PageHeader from '../../components/PageHeader';
import PaySheet from '../../components/PaySheet';
import InlinePayPanel from '../../components/InlinePayPanel';
import SubscriberScheduleForm from '../../components/contribution/SubscriberScheduleForm';
import { MOBILE_MONEY_METHODS } from '../../constants/payment';
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

  async function handleSave(schedule) {
    if (!sub) return;
    setSubmitting(true);
    try {
      // 1) Persist the schedule itself (frequency / amount / split / step-up +
      //    the include-insurance flag). The 0072 funding-mode/target columns are
      //    RPC-locked, so they DON'T ride this PATCH — the funding op below sets
      //    them via the DEFINER RPC.
      await updateSchedule.mutateAsync({
        frequency: schedule.frequency,
        amount: schedule.amount,
        retirementPct: schedule.retirementPct,
        emergencyPct: schedule.emergencyPct,
        includeInsurance: schedule.includeInsurance,
        insuranceTypes: schedule.insuranceTypes,
        contributionIndexationPct: schedule.contributionIndexationPct,
        ...(schedule.nextDueDate ? { nextDueDate: schedule.nextDueDate } : {}),
      });
      addToast('success', isNew ? 'Schedule set up.' : 'Contribution schedule updated.');

      const owed = contributionOwed(schedule.amount, paidThisMonthAmount);
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
      note="You'll receive an SMS prompt to authorise the payment on your mobile money account."
      payLabel={settle ? `Pay ${formatUGX(settle.total, { compact: false })}` : undefined}
      cancelLabel="Maybe later"
      submitting={settleSubmitting}
      success={{ title: 'Payment complete', subtitle: 'Your plan is up to date for this month.' }}
      onPay={handleSettlePay}
      onClose={closeSettle}
    />
  );

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
        <PageHeader
          title={settle ? 'Settle this month' : (isNew ? 'Set up contribution schedule' : 'Tune your schedule')}
          subtitle={
            settle
              ? 'Pay for the changes you just made to this month’s plan.'
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
                  methods={MOBILE_MONEY_METHODS}
                  note="You’ll receive an SMS prompt to authorise the payment on your mobile money account."
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
            {sub && (
              <SubscriberScheduleForm
                initial={existing}
                age={sub.age}
                heldPolicies={sub.policies}
                layout="split"
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
              Your contribution and your family cover, in one place.
            </p>
          </section>
          {sub && (
            <SubscriberScheduleForm
              initial={existing}
              age={sub.age}
              heldPolicies={sub.policies}
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
