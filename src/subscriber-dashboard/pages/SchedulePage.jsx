import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useCurrentSubscriber,
  useUpdateSchedule,
  useMakeContribution,
  usePayInsurancePremium,
  useContributionPaidThisMonth,
} from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { periodsPerYear } from '../../utils/finance';
import { formatUGX } from '../../utils/currency';
import {
  contributionOwed,
  newlyAddedProducts,
  buildSettleLineItems,
} from '../../utils/periodSettlement';
import PageHeader from '../../components/PageHeader';
import PaySheet from '../../components/PaySheet';
import InlinePayPanel from '../../components/InlinePayPanel';
import ContributionSettingsForm from '../../components/contribution/ContributionSettingsForm';
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
  const payPremium = usePayInsurancePremium(sub?.id);
  const { data: paidThisMonthAmount = 0 } = useContributionPaidThisMonth(sub?.id);
  const [submitting, setSubmitting] = useState(false);
  const isDesktop = useIsDesktop();

  // "Settle this period" prompt — opened after a save that leaves something owed
  // (a higher contribution this month, and/or newly-added insurance premiums).
  const [settle, setSettle] = useState(null);
  const [settleView, setSettleView] = useState('confirm'); // confirm | success
  const [settleSubmitting, setSettleSubmitting] = useState(false);

  const existing = sub?.contributionSchedule;
  const isNew = !existing;

  // Products the subscriber currently holds (active policies) — the single
  // source of truth shared by the form's pre-checked toggles AND the settle
  // flow's "what's newly added" diff below, so re-saving an unchanged plan can
  // never re-charge an already-held premium.
  const heldActiveTypes = (sub?.policies ?? [])
    .filter((p) => p.status === 'active')
    .map((p) => p.type);

  async function handleSave(schedule) {
    if (!sub) return;
    setSubmitting(true);
    try {
      await updateSchedule.mutateAsync(schedule);
      addToast('success', isNew ? 'Schedule set up.' : 'Contribution schedule updated.');

      // Settle the current period: the contribution top-up still owed this month
      // plus premiums for any newly-added insurance products.
      const owed = contributionOwed(schedule.amount, paidThisMonthAmount);
      const added = newlyAddedProducts(heldActiveTypes, schedule.insuranceTypes ?? []);
      const { lineItems, total, products } = buildSettleLineItems({
        owed,
        addedProductIds: added,
        freqPerYear: periodsPerYear(schedule.frequency),
      });

      if (total > 0) {
        // Mint a stable nonce per leg so a double-tap can't double-charge.
        const nonces = { contribution: crypto.randomUUID() };
        products.forEach((p) => { nonces[p.id] = crypto.randomUUID(); });
        setSettle({ owed, products, lineItems, total, retirementPct: schedule.retirementPct, nonces });
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
      if (settle.owed > 0) {
        await makeContribution.mutateAsync({
          amount: settle.owed,
          retirementPct: settle.retirementPct,
          method: methodFull,
          nonce: settle.nonces.contribution,
        });
      }
      for (const p of settle.products) {
        // Sequential so each premium commits with its own nonce (idempotent).
        await payPremium.mutateAsync({
          product: p.id,
          cover: p.cover,
          premiumMonthly: p.premiumMonthly,
          method: methodFull,
          nonce: settle.nonces[p.id],
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

  // Desktop (>=1024px): mirror the agent's schedule sub-page — a plain header
  // (no indigo hero dome) over a width-capped, centred frame wrapping the SAME
  // form in its 2-column "split" layout (inputs left / sticky summary right).
  // When a save leaves a balance owed, the form is replaced IN PLACE by a
  // 2-column settle checkout (breakdown left, inline pay panel right) — desktop
  // never opens the phone-style bottom sheet.
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
              : 'Frequency, amount, and the retirement/emergency split'
          }
          fallback="/dashboard/save"
        />
        {settle ? (
          <div className={flow.splitHost}>
            <div className={flow.split}>
              {/* LEFT — what's owed this month (the breakdown lives here, so the
                  pay panel on the right stays a focused total + method + pay). */}
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

              {/* RIGHT — the inline pay panel (confirm → success in place). */}
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
              <ContributionSettingsForm
                initial={existing}
                age={sub.age}
                initialInsuranceTypes={heldActiveTypes}
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

  // Mobile: the persistent shell app bar now owns the page title + back arrow, so
  // the in-page hero dome is removed. A flat, light intro card carries the page's
  // brand surface at the top of the body, then the shared form follows.
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
              Frequency, amount, and the retirement/emergency split.
            </p>
          </section>
          {sub && (
            <ContributionSettingsForm
              initial={existing}
              age={sub.age}
              initialInsuranceTypes={heldActiveTypes}
              collapsible
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
