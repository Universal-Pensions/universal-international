import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';

import { formatDate } from '../../utils/date';
import { getInitials } from '../../utils/dashboard';
import { useCurrentSubscriber, useUpdateInsuranceCover, useFundInsuranceProducts } from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import PageHeader from '../../components/PageHeader';
import PaySheet from '../../components/PaySheet';
import InlinePayPanel from '../../components/InlinePayPanel';
import { MOBILE_MONEY_METHODS } from '../../constants/payment';
import styles from './InsurancePage.module.css';
import flow from './desktopFlow.module.css';

const COVER_TIERS = [
  { cover: 1_000_000, premium: 2000 },
  { cover: 2_000_000, premium: 3500 },
  { cover: 3_000_000, premium: 5000 },
  { cover: 5_000_000, premium: 7500 },
];

export default function InsurancePage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub } = useCurrentSubscriber();
  const { addToast } = useToast();
  const updateCover = useUpdateInsuranceCover(sub?.id);
  // Self-paid cover is funded on the ANNUAL model (migration 0073 fund_insurance_products):
  // one annual premium (monthly rate × 12) per policy year — never a monthly charge.
  const fundProducts = useFundInsuranceProducts(sub?.id);

  // Upgrade pay sheet (downgrades take no payment).
  const [payOpen, setPayOpen] = useState(false);
  const [payView, setPayView] = useState('confirm'); // confirm | success
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payNonce, setPayNonce] = useState(null);

  const insurance = sub?.insurance;
  // Derive active/expired from the same source as the policies page (status is
  // computed from the renewal date), so a lapsed life policy isn't shown as
  // "current cover" here while the policies page calls it expired.
  const lifePolicy = sub?.policies?.find((p) => p.type === 'life');
  const insNominees = sub?.nominees?.insurance || [];
  const noPolicy = !lifePolicy || lifePolicy.status !== 'active';
  // Employer-funded life cover can't be bought/adjusted by the member (no double-buy).
  const employerFundedLife = lifePolicy?.fundedBy === 'employer';

  const [coverIdx, setCoverIdx] = useState(() => {
    const found = COVER_TIERS.findIndex((t) => t.cover === insurance?.cover);
    return found >= 0 ? found : 0;
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!insurance?.cover) return;
    const found = COVER_TIERS.findIndex((t) => t.cover === insurance.cover);
    setCoverIdx(found >= 0 ? found : 0);
  }, [insurance?.cover]);

  const selectedTier = COVER_TIERS[coverIdx];
  // The tier's `premium` is the monthly RATE; the member is charged the ANNUAL
  // premium (× 12) once per policy year — this is the only self-pay shape.
  const selectedAnnual = selectedTier.premium * 12;
  const currentCover = insurance?.cover || 0;
  const tierDelta = selectedTier.cover - currentCover;
  const isUpgrade = tierDelta > 0;
  const isDowngrade = tierDelta < 0;
  const isCurrent = tierDelta === 0;
  // Two-tap confirm for downgrades — first tap exposes "Confirm downgrade",
  // second tap commits. Reset whenever the tier selection changes.
  const [confirmingDowngrade, setConfirmingDowngrade] = useState(false);
  useEffect(() => { setConfirmingDowngrade(false); }, [coverIdx]);
  const pickerRef = useRef(null);

  function scrollToPicker() {
    pickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Upgrading (or first-time activation) takes a real premium payment via the
  // modern PaySheet. Downgrading lowers cover with no charge (the lower premium
  // applies next cycle) behind the existing two-tap confirm.
  async function handleApplyCover() {
    if (!sub || isCurrent) return;
    if (isUpgrade) {
      setPayNonce(crypto.randomUUID());
      setPayView('confirm');
      setPayOpen(true);
      return;
    }
    if (isDowngrade && !confirmingDowngrade) {
      setConfirmingDowngrade(true);
      return;
    }
    setSubmitting(true);
    try {
      await updateCover.mutateAsync({
        cover: selectedTier.cover,
        premiumMonthly: selectedTier.premium,
      });
      addToast('success', `Cover lowered to ${formatUGX(selectedTier.cover)}. New premium starts next cycle.`);
      setConfirmingDowngrade(false);
    } catch (err) {
      addToast('error', err?.message || 'Could not update cover.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePayUpgrade(methodFull) {
    if (!sub) return;
    setPaySubmitting(true);
    try {
      // Annual-premium model: fund_insurance_products upserts the life policy
      // (activate or upgrade in place) and charges ONE annual premium = rate × 12.
      await fundProducts.mutateAsync({
        fundingMode: 'pay_now',
        products: [{ product: 'life', cover: selectedTier.cover, premiumMonthly: selectedTier.premium }],
        method: methodFull,
        nonce: payNonce,
      });
      setPayView('success');
      addToast('success', `Cover set to ${formatUGX(selectedTier.cover)}.`);
    } catch (err) {
      addToast('error', err?.message || 'Could not update cover.');
    } finally {
      setPaySubmitting(false);
    }
  }

  function closePay() {
    if (paySubmitting) return;
    setPayOpen(false);
  }

  // ── Shared controls ─────────────────────────────────────────────────────────
  // Single-sourced so the mobile stack and the desktop left column render the
  // exact same cover picker / beneficiaries / claim link (the mobile DOM stays
  // byte-identical to before).
  const emptyCover = (
    <section className={styles.emptyCoverCard}>
      <div className={styles.shieldIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
          <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h2 className={styles.emptyTitle}>No active policy</h2>
      <p className={styles.emptyText}>
        Add life cover from <strong>UGX 24,000 / yr</strong>. You&apos;ll be covered up to UGX 1M.
      </p>
      <button type="button" className={styles.emptyCta} onClick={scrollToPicker}>
        Pick your cover
      </button>
    </section>
  );

  const coverPicker = employerFundedLife ? (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Life cover</h2>
      </div>
      <p className={styles.employerNote}>
        Your life cover of <strong>{formatUGX(lifePolicy.cover)}</strong> is provided and paid for by
        your employer. There's nothing to pay — see it on your <strong>Policies</strong> page.
      </p>
    </section>
  ) : (
    <section ref={pickerRef} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{noPolicy ? 'Pick your cover' : 'Upgrade your cover'}</h2>
      </div>

      <div className={styles.tierHead}>
        <div>
          <span className={styles.tierEyebrow}>Cover</span>
          <span className={styles.tierValue}>{formatUGX(selectedTier.cover)}</span>
        </div>
        <div className={styles.tierPremium}>
          <span className={styles.tierEyebrow}>Premium</span>
          <span className={styles.tierValue}>{formatUGX(selectedAnnual, { compact: false })} / yr</span>
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={COVER_TIERS.length - 1}
        step={1}
        value={coverIdx}
        onChange={(e) => setCoverIdx(Number.parseInt(e.target.value, 10))}
        className={styles.slider}
        style={{ '--pct': `${(coverIdx / (COVER_TIERS.length - 1)) * 100}%` }}
        aria-label="Cover tier"
        aria-valuetext={`${formatUGX(selectedTier.cover)} cover, ${formatUGX(selectedAnnual, { compact: false })} per year`}
      />

      <div className={styles.tierMarks}>
        {COVER_TIERS.map((tier, i) => (
          <button
            key={tier.cover}
            type="button"
            className={styles.tierMark}
            data-active={i === coverIdx}
            onClick={() => setCoverIdx(i)}
          >
            {formatUGX(tier.cover)}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={styles.primaryBtn}
        disabled={isCurrent || submitting}
        onClick={handleApplyCover}
        data-confirming={confirmingDowngrade || undefined}
      >
        {submitting ? 'Updating…'
          : isUpgrade ? `${noPolicy ? 'Get' : 'Upgrade to'} ${formatUGX(selectedTier.cover)}${noPolicy ? ' cover' : ''}`
          : isDowngrade && confirmingDowngrade
            ? `Confirm downgrade to ${formatUGX(selectedTier.cover)}`
          : isDowngrade ? `Downgrade to ${formatUGX(selectedTier.cover)}`
          : noPolicy ? 'Pick a cover above'
          : 'Current cover'}
      </button>
      {isDowngrade && (
        <p className={styles.downgradeNote}>
          Lowering cover reduces your premium but also your payout cap. New cover takes effect at the next renewal cycle.
        </p>
      )}
    </section>
  );

  const beneficiaries = (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Insurance beneficiaries</h2>
        <span className={styles.sectionAside}>{insNominees.length} on file</span>
      </div>
      <p className={styles.sectionHelp}>
        These people receive your life insurance benefit. Shares must total 100%.
      </p>
      {insNominees.length > 0 && (
        <ul className={styles.beneList}>
          {insNominees.slice(0, 3).map((n) => (
            <li key={n.id} className={styles.beneRow}>
              <span className={styles.beneAvatar}>
                {getInitials(n.name) || '?'}
              </span>
              <div className={styles.beneText}>
                <span className={styles.beneName}>{n.name}</span>
                <span className={styles.beneMeta}>
                  {n.relationship ? n.relationship[0].toUpperCase() + n.relationship.slice(1) : ''}
                  {n.phone && <> · {n.phone}</>}
                </span>
              </div>
              <span className={styles.beneShare}>{n.share}%</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.linkBtn} onClick={() => navigate('/dashboard/settings/nominees')}>
        Manage beneficiaries
        <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none">
          <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </section>
  );

  const fileClaim = (
    <button type="button" className={styles.fileClaimBtn} onClick={() => navigate('/dashboard/withdraw/claim')}>
      File a claim
      <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none">
        <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );

  // Desktop right column — a sticky "Your cover" summary that flips IN PLACE to
  // the inline pay panel during an upgrade (no bottom sheet on desktop).
  const coverSummaryCard = !noPolicy && insurance ? (
    <div className={flow.card}>
      <p className={flow.sumEyebrow}>Your cover</p>
      <div className={flow.sumBig}>{formatUGX(insurance.cover || 0, { compact: false })}</div>
      <ul className={flow.sumList}>
        <li className={flow.sumRow}>
          <span>Premium</span>
          <span className={flow.sumVal}>{formatUGX((insurance.premiumMonthly || 0) * 12, { compact: false })} / yr</span>
        </li>
        <li className={flow.sumRow}>
          <span>Renews</span>
          <span className={flow.sumVal}>{formatDate(lifePolicy?.renewalDate ?? insurance.renewalDate)}</span>
        </li>
        <li className={flow.sumRow}>
          <span>Started</span>
          <span className={flow.sumVal}>{formatDate(insurance.policyStart)}</span>
        </li>
      </ul>
      {isUpgrade ? (
        <p className={flow.note}>
          Selected <b>{formatUGX(selectedTier.cover)}</b> · {formatUGX(selectedAnnual, { compact: false })} / yr. Press <b>Upgrade</b> on the left to pay the annual premium.
        </p>
      ) : (
        <p className={flow.note}>Use the slider on the left to raise your cover.</p>
      )}
    </div>
  ) : (
    <div className={flow.card}>
      <p className={flow.sumEyebrow}>No active cover</p>
      <p className={flow.note} style={{ marginTop: 'var(--space-2)' }}>
        Pick a cover level on the left to protect your family — from <b>UGX 24,000 / yr</b>.
      </p>
    </div>
  );

  const payPanel = (
    <InlinePayPanel
      view={payView === 'success' ? 'success' : 'confirm'}
      ariaLabel="Pay for insurance cover"
      eyebrow={noPolicy ? 'You’re activating cover' : 'You’re paying to upgrade'}
      total={selectedAnnual}
      subtitle={`${formatUGX(selectedTier.cover)} life cover · ${formatUGX(selectedAnnual, { compact: false })} / yr`}
      lineItems={[
        { label: 'Cover', value: formatUGX(selectedTier.cover, { compact: false }) },
        { label: 'Annual premium', value: `${formatUGX(selectedAnnual, { compact: false })} / yr` },
      ]}
      methods={MOBILE_MONEY_METHODS}
      note="You’ll receive an SMS prompt to authorise the payment on your mobile money account."
      submitting={paySubmitting}
      primaryLabel={`Pay ${formatUGX(selectedAnnual, { compact: false })}`}
      cancelLabel="Cancel"
      onPay={handlePayUpgrade}
      onCancel={closePay}
      success={{
        title: 'Cover updated',
        subtitle: `Your life cover is now ${formatUGX(selectedTier.cover)}.`,
      }}
      successPrimary={{ label: 'Done', onClick: closePay }}
    />
  );

  // Desktop (>=1024px): a 2-column split — the cover controls on the left, the
  // sticky "Your cover" summary on the right that flips in place to the inline
  // pay panel during an upgrade.
  if (isDesktop) {
    return (
      <div className={styles.page}>
        <PageHeader
          title="Insurance cover"
          subtitle="Premium and policy level"
          fallback="/dashboard/settings"
        />
        <div className={flow.splitHost}>
          <div className={flow.split}>
            {/* Left controls lock (inert) while the right column owns the pay
                flow, so the cover slider / Upgrade CTA can't be re-triggered or
                changed underneath the confirm/success panel. */}
            <div className={`${flow.col} ${payOpen ? flow.colLocked : ''}`} inert={payOpen}>
              {noPolicy && emptyCover}
              {coverPicker}
              {beneficiaries}
              {fileClaim}
            </div>
            <aside className={flow.summaryCol}>
              {payOpen ? payPanel : coverSummaryCard}
            </aside>
          </div>
        </div>
      </div>
    );
  }

  // Mobile: unchanged single-column stack + the shared PaySheet bottom sheet.
  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <motion.div
          className={styles.step}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        >
          {!noPolicy && insurance && (
            // Mobile: the removed hero dome's cover figure, re-homed as a flat
            // summary card. Eyebrow + big indigo amount + a premium / renewal
            // sub-line.
            <section className={styles.coverSummary}>
              <span className={styles.coverEyebrow}>Current cover</span>
              <div className={styles.coverAmount}>{formatUGX(insurance.cover || 0, { compact: false })}</div>
              <p className={styles.coverSub}>
                {formatUGX((insurance.premiumMonthly || 0) * 12, { compact: false })} / yr · Renews {formatDate(lifePolicy?.renewalDate ?? insurance.renewalDate)}
              </p>
            </section>
          )}
          {noPolicy && emptyCover}
          {coverPicker}
          {beneficiaries}
          {fileClaim}
        </motion.div>
      </div>

      {/* Upgrade pay sheet — modern shared PaySheet, replaces the no-payment
          "Upgrade" action. Downgrades never reach this (no charge). */}
      <PaySheet
        open={payOpen}
        view={payView}
        ariaLabel="Pay for insurance cover"
        eyebrow={noPolicy ? "You're activating cover" : "You're paying to upgrade"}
        total={selectedAnnual}
        subtitle={`${formatUGX(selectedTier.cover)} life cover · ${formatUGX(selectedAnnual, { compact: false })} / yr`}
        lineItems={[
          { label: 'Cover', value: formatUGX(selectedTier.cover, { compact: false }) },
          { label: 'Annual premium', value: `${formatUGX(selectedAnnual, { compact: false })} / yr` },
        ]}
        note="You'll receive an SMS prompt to authorise the payment on your mobile money account."
        submitting={paySubmitting}
        success={{
          title: 'Cover updated',
          subtitle: `Your life cover is now ${formatUGX(selectedTier.cover)}.`,
        }}
        onPay={handlePayUpgrade}
        onClose={closePay}
      />
    </div>
  );
}
