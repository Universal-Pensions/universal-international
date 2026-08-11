import { useState, useEffect, useRef, useMemo } from 'react';
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
import ErrorCard from '../../components/feedback/ErrorCard';
import CoverTierPicker from '../../components/insurance/CoverTierPicker';
import { PAYMENT_METHODS } from '../../constants/payment';
import {
  INSURANCE_PRODUCTS,
  HOSPITAL_CASH_DAYS,
  annualPremium,
  dailyBenefit,
  defaultTier,
  tierForCover,
} from '../../constants/savings';
import {
  productName,
  activePolicies,
  activeCoverTotal,
  activeCoverProductsLabel,
} from '../../utils/policies';
import styles from './InsurancePage.module.css';
import flow from './desktopFlow.module.css';

/** Same order the policies page and `derivePolicies` use. */
const PRODUCT_IDS = ['life', 'health', 'funeral'];
/** Segment / CTA labels. Keys are stored product ids; values are product names. */
const SHORT_NAME = { life: 'Life', health: 'Hospital cash', funeral: 'Funeral' };

/** Cheapest way in across all products — drives the empty-state price hook. */
const CHEAPEST_ANNUAL = Math.min(
  ...INSURANCE_PRODUCTS.map((p) => annualPremium(defaultTier(p.id))),
);

export default function InsurancePage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub, isError, error, refetch } = useCurrentSubscriber();
  const { addToast } = useToast();
  const updateCover = useUpdateInsuranceCover(sub?.id);
  // Self-paid cover is funded on the ANNUAL model (migration 0073 fund_insurance_products):
  // one annual premium (monthly rate × 12) per policy year — never a monthly charge.
  const fundProducts = useFundInsuranceProducts(sub?.id);

  // Upgrade pay sheet (downgrades take no payment). `payProduct` pins which
  // policy the open sheet is buying, so switching products mid-flow can't
  // redirect a payment.
  const [payOpen, setPayOpen] = useState(false);
  const [payView, setPayView] = useState('confirm'); // confirm | success
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payNonce, setPayNonce] = useState(null);
  const [payProduct, setPayProduct] = useState(null);

  const insNominees = sub?.nominees?.insurance || [];

  // One row per product, derived from the same `policies` array the policies
  // page reads (status is computed from the renewal date there, so a lapsed
  // policy can't read as "current cover" on this page while reading expired on
  // that one). NOTE `sub.insurance` is the legacy life-only object and carries
  // no `fundedBy`, so employer detection must come from `policies`.
  const rows = useMemo(() => PRODUCT_IDS.map((id) => {
    const policy = sub?.policies?.find((p) => p.type === id) ?? null;
    const status = policy?.status ?? 'none';
    const isActive = status === 'active';
    return {
      id,
      name: productName(id),
      short: SHORT_NAME[id],
      policy,
      status,
      isActive,
      // Employer-funded cover can't be bought or adjusted by the member — the
      // RPC raises on a re-buy, so the picker must not be offered at all.
      employerFunded: isActive && policy?.fundedBy === 'employer',
      // Only ACTIVE cover counts as "what you have now": an expired or building
      // policy is not in force, so any tier is a purchase rather than a change.
      currentCover: isActive ? (policy.cover || 0) : 0,
    };
  }), [sub?.policies]);

  const anyActive = rows.some((r) => r.isActive);

  // Which product the picker is pointed at. Defaults to something the member can
  // actually act on: their first live self-funded policy, else the first
  // adjustable product, else life.
  const [productId, setProductId] = useState(
    () => rows.find((r) => r.isActive && !r.employerFunded)?.id
      ?? rows.find((r) => !r.employerFunded)?.id
      ?? 'life',
  );
  const row = rows.find((r) => r.id === productId) ?? rows[0];

  // Selected cover per product, seeded from what's held. An off-ladder cover
  // (employer-set, or left behind by a repricing) resolves to the nearest tier
  // at or below rather than collapsing to the cheapest one.
  const [coverByProduct, setCoverByProduct] = useState(() => seedCovers(rows));
  const coverSignature = rows.map((r) => `${r.id}:${r.currentCover}`).join('|');
  useEffect(() => { setCoverByProduct(seedCovers(rows)); }, [coverSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const [submitting, setSubmitting] = useState(false);
  // Two-tap confirm for downgrades — first tap exposes "Confirm downgrade",
  // second commits. Holds the product being confirmed so switching products (or
  // changing the tier) can't carry a confirmation across.
  const [confirmingProduct, setConfirmingProduct] = useState(null);
  const pickerRef = useRef(null);

  // Build speed for a save-to-cover ("building") policy: the share of the
  // member's liquid savings that is swept toward the premium each period. One
  // schedule-level figure, not per-product — the 0072 sweep reads a single
  // `insurance_savings_pct` — so it is seeded and compared against the schedule.
  const storedSavingsPct = clampPct(sub?.contributionSchedule?.insuranceSavingsPct, 50);
  const [savingsPct, setSavingsPct] = useState(storedSavingsPct);
  const [paceSubmitting, setPaceSubmitting] = useState(false);
  // Re-seed when the stored value arrives (or changes elsewhere), so the control
  // never sits on a stale figure after the subscriber query settles.
  useEffect(() => { setSavingsPct(storedSavingsPct); }, [storedSavingsPct]);

  const selectedTier = tierForCover(productId, coverByProduct[productId]) ?? defaultTier(productId);
  // The tier's premium is the monthly RATE; the member is charged the ANNUAL
  // premium (× 12) once per policy year — this is the only self-pay shape.
  const selectedAnnual = annualPremium(selectedTier);
  const tierDelta = selectedTier.cover - row.currentCover;
  const isUpgrade = tierDelta > 0;
  const isDowngrade = tierDelta < 0;
  const isCurrent = tierDelta === 0;
  const confirmingThis = confirmingProduct === productId;

  useEffect(() => { setConfirmingProduct(null); }, [productId, selectedTier.cover]);

  function scrollToPicker() {
    pickerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Hospital cash pays a flat amount per night rather than a lump sum, so the
   * cover figure alone doesn't tell the member what they'd actually receive.
   * Renders `null` for lump-sum products (life, funeral) — driven by the
   * product's `benefitDays`, not by an id check, so a future daily-benefit
   * product picks this up for free.
   */
  function dailyBenefitNote(id, cover) {
    const daily = dailyBenefit(id, cover);
    if (!daily) return null;
    return (
      <p className={styles.benefitNote}>
        You will be paid <strong>{formatUGX(daily, { compact: false })}</strong> daily
        {' '}for {HOSPITAL_CASH_DAYS} days of hospitalisation.
      </p>
    );
  }

  // E3 — a transient subscriber-query failure would otherwise fall through to
  // the "no cover" state and render a misleading empty card. Surface the
  // standard retry card instead (mirrors HomePage / SavePage).
  if (isError) {
    return (
      <div className={styles.page}>
        <ErrorCard title="We couldn't load your insurance" message={error} onRetry={refetch} />
      </div>
    );
  }

  // Upgrading (or first-time activation) takes a real premium payment via the
  // modern PaySheet. Downgrading lowers cover with no charge (the lower premium
  // applies next cycle) behind the existing two-tap confirm.
  async function handleApplyCover() {
    if (!sub || isCurrent) return;
    if (isUpgrade) {
      setPayProduct(productId);
      setPayNonce(crypto.randomUUID());
      setPayView('confirm');
      setPayOpen(true);
      return;
    }
    if (isDowngrade && !confirmingThis) {
      setConfirmingProduct(productId);
      return;
    }
    setSubmitting(true);
    try {
      await updateCover.mutateAsync({
        product: productId,
        cover: selectedTier.cover,
        premiumMonthly: selectedTier.premiumMonthly,
      });
      addToast('success', `${row.short} cover lowered to ${formatUGX(selectedTier.cover)}. New premium starts next cycle.`);
      setConfirmingProduct(null);
    } catch (err) {
      addToast('error', err?.message || 'Could not update cover.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePayUpgrade(methodFull) {
    if (!sub || !payProduct) return;
    setPaySubmitting(true);
    try {
      // Annual-premium model: fund_insurance_products upserts the policy for the
      // chosen product (activate or upgrade in place) and charges ONE annual
      // premium = rate × 12.
      await fundProducts.mutateAsync({
        fundingMode: 'pay_now',
        products: [{
          product: payProduct,
          cover: selectedTier.cover,
          premiumMonthly: selectedTier.premiumMonthly,
        }],
        method: methodFull,
        nonce: payNonce,
      });
      setPayView('success');
      addToast('success', `${row.short} cover set to ${formatUGX(selectedTier.cover)}.`);
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

  /**
   * Persist the build speed only. `fund_insurance_products` with an EMPTY product
   * list and `save_to_cover` writes the funding columns without touching any
   * policy or charging anything — the same call the schedule page used to make
   * for a split-only tweak. It goes through the RPC because those columns are
   * RPC-locked and a plain schedule PATCH cannot carry them.
   */
  async function handleSavePace() {
    if (!sub || savingsPct === storedSavingsPct) return;
    setPaceSubmitting(true);
    try {
      await fundProducts.mutateAsync({
        fundingMode: 'save_to_cover',
        products: [],
        savingsPct,
        nonce: crypto.randomUUID(),
      });
      addToast('success', `Build speed set to ${savingsPct}% of your liquid savings.`);
    } catch (err) {
      addToast('error', err?.message || 'Could not update the build speed.');
    } finally {
      setPaceSubmitting(false);
    }
  }

  // ── Shared controls ─────────────────────────────────────────────────────────
  // Single-sourced so the mobile stack and the desktop left column render the
  // exact same product selector / cover picker / beneficiaries / claim link.
  const emptyCover = (
    <section className={styles.emptyCoverCard}>
      <div className={styles.shieldIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
          <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
          <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <h2 className={styles.emptyTitle}>No active cover</h2>
      <p className={styles.emptyText}>
        Protect your family from <strong>{formatUGX(CHEAPEST_ANNUAL, { compact: false })} / yr</strong>.
        Pick a cover below — life, health or funeral.
      </p>
      <button type="button" className={styles.emptyCta} onClick={scrollToPicker}>
        Pick your cover
      </button>
    </section>
  );

  // Which policy am I changing? The whole point of the selector — the slider and
  // the CTA below it retarget to whatever is chosen here.
  const productSelector = (
    <div className={`${flow.seg} ${styles.segTight}`} role="radiogroup" aria-label="Choose which cover to change">
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={r.id === productId}
          className={`${flow.segBtn} ${r.id === productId ? flow.segBtnActive : ''}`}
          onClick={() => setProductId(r.id)}
        >
          <span className={styles.segName}>{r.short}</span>
          <span className={styles.segCover}>
            {r.isActive ? formatUGX(r.currentCover) : '—'}
          </span>
        </button>
      ))}
    </div>
  );

  let coverBody;
  if (row.employerFunded) {
    coverBody = (
      <>
        <p className={styles.employerNote}>
          Your {row.short.toLowerCase()} cover of <strong>{formatUGX(row.policy.cover)}</strong> is provided and
          paid for by your employer. There&apos;s nothing to pay — see it on your <strong>Policies</strong> page.
        </p>
        {dailyBenefitNote(row.id, row.policy.cover)}
      </>
    );
  } else if (row.status === 'building') {
    // pay_now on a building policy WOULD activate it and charge the full year,
    // but "pay off my build early" is a different decision — so the cover amount
    // stays read-only here. What IS adjustable is the pace: how much of the
    // member's liquid savings gets swept toward the premium each period.
    //
    // This control used to live on the schedule page, behind a link here that
    // pointed at `/dashboard/schedule` — a route that does not exist (the real
    // one is `/dashboard/save/schedule`), so it had been dead. It moved here with
    // the rest of the cover decisions: everything about a policy is on this page.
    coverBody = (
      <>
        <p className={styles.employerNote}>
          Your {row.short.toLowerCase()} cover of <strong>{formatUGX(row.policy.cover)}</strong> is still
          building — your savings are filling the premium. It starts the moment it&apos;s funded.
        </p>
        {dailyBenefitNote(row.id, row.policy.cover)}

        <div className={styles.paceBox}>
          <div className={styles.paceHead}>
            <span className={styles.paceLabel}>How much of your liquid savings builds cover?</span>
            <strong className={styles.paceVal}>{savingsPct}%</strong>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={savingsPct}
            onChange={(e) => setSavingsPct(Number.parseInt(e.target.value, 10))}
            className={styles.paceSlider}
            style={{ '--pct': `${savingsPct}%` }}
            aria-label="Percent of liquid savings that builds cover"
            aria-valuetext={`${savingsPct} percent of your liquid savings builds cover`}
          />
          <p className={styles.paceNote}>
            {savingsPct === 0
              ? 'Nothing is going in, so this cover will not finish building. Raise it to start.'
              : 'Higher means your cover starts sooner, but less of your saving stays available to withdraw.'}
          </p>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={savingsPct === storedSavingsPct || paceSubmitting}
            onClick={handleSavePace}
          >
            {paceSubmitting
              ? 'Saving…'
              : (savingsPct === storedSavingsPct ? 'No changes to save' : 'Save build speed')}
          </button>
        </div>
      </>
    );
  } else {
    coverBody = (
      <>
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

        <CoverTierPicker
          variant="panel"
          productId={productId}
          value={coverByProduct[productId]}
          label={`${row.short} cover amount`}
          showReadout={false}
          onChange={(cover) => setCoverByProduct((prev) => ({ ...prev, [productId]: cover }))}
        />

        {dailyBenefitNote(productId, selectedTier.cover)}

        <button
          type="button"
          className={styles.primaryBtn}
          disabled={isCurrent || submitting}
          onClick={handleApplyCover}
          data-confirming={confirmingThis || undefined}
        >
          {submitting ? 'Updating…'
            : isUpgrade ? `${row.isActive ? 'Upgrade to' : 'Get'} ${formatUGX(selectedTier.cover)}${row.isActive ? '' : ' cover'}`
            : isDowngrade && confirmingThis
              ? `Confirm downgrade to ${formatUGX(selectedTier.cover)}`
            : isDowngrade ? `Downgrade to ${formatUGX(selectedTier.cover)}`
            : `Current ${row.short.toLowerCase()} cover`}
        </button>
        {isDowngrade && (
          <p className={styles.downgradeNote}>
            Lowering cover reduces your premium but also your payout cap. New cover takes effect at the next renewal cycle.
          </p>
        )}
      </>
    );
  }

  const coverPicker = (
    <section ref={pickerRef} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>
          {row.isActive ? 'Upgrade your cover' : 'Pick your cover'}
        </h2>
      </div>
      <p className={styles.sectionHelp}>
        Choose which cover to change, then how much it pays.
      </p>
      {productSelector}
      {coverBody}
    </section>
  );

  // ONE block, TWO compositions. Mobile stacks [beneficiaries][file a claim] and
  // shows three names; desktop caps the list at two and folds the claim link
  // into the action row, because the desktop page has a hard no-scroll budget
  // (see the height table in InsurancePage.module.css). Parameterised rather
  // than duplicated so the two versions cannot drift apart.
  function renderBeneficiaries({ maxRows, trailing }) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Insurance beneficiaries</h2>
          <span className={styles.sectionAside}>{insNominees.length} on file</span>
        </div>
        <p className={`${styles.sectionHelp} ${styles.beneHelp}`}>
          These people receive your life insurance benefit. Shares must total 100%.
        </p>
        {insNominees.length > 0 && (
          <ul className={styles.beneList}>
            {insNominees.slice(0, maxRows).map((n) => (
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
        <div className={styles.actionRow}>
          <button type="button" className={styles.linkBtn} onClick={() => navigate('/dashboard/settings/nominees')}>
            Manage beneficiaries
            <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none">
              <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {trailing}
        </div>
      </section>
    );
  }

  const beneficiaries = renderBeneficiaries({ maxRows: 3, trailing: null });

  const fileClaim = (
    <button type="button" className={styles.fileClaimBtn} onClick={() => navigate('/dashboard/withdraw/claim')}>
      File a claim
      <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none">
        <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );

  // Desktop folds "File a claim" into the beneficiaries card's action row rather
  // than giving it a full-width button of its own — both are destinations, and
  // the two together are most of the vertical budget this page needed to stop
  // scrolling. Built from the same source as the mobile version so the two
  // can't drift.
  const beneficiariesDesktop = renderBeneficiaries({ maxRows: 2, trailing: fileClaim });

  // Desktop right column — a sticky "Your cover" summary that flips IN PLACE to
  // the inline pay panel during an upgrade (no bottom sheet on desktop). The
  // headline is the TOTAL across every active policy: reading the life row alone
  // understates a multi-product member (see activeCoverTotal in utils/policies).
  const live = activePolicies(sub);
  const coverSummaryCard = anyActive ? (
    <div className={flow.card}>
      <p className={flow.sumEyebrow}>Your cover</p>
      <div className={flow.sumBig}>{formatUGX(activeCoverTotal(sub), { compact: false })}</div>
      <ul className={flow.sumList}>
        {live.map((p) => (
          <li key={p.type} className={flow.sumRow}>
            <span>{productName(p.type)}</span>
            <span className={flow.sumVal}>{formatUGX(p.cover, { compact: false })}</span>
          </li>
        ))}
        <li className={flow.sumRow}>
          <span>Premium</span>
          <span className={flow.sumVal}>
            {formatUGX(live.reduce((s, p) => s + (p.renewalAmount || 0), 0), { compact: false })} / yr
          </span>
        </li>
        <li className={flow.sumRow}>
          <span>Next renewal</span>
          <span className={flow.sumVal}>{formatDate(nextRenewal(live))}</span>
        </li>
      </ul>
      {isUpgrade ? (
        <p className={flow.note}>
          Selected <b>{formatUGX(selectedTier.cover)}</b> {row.short.toLowerCase()} cover · {formatUGX(selectedAnnual, { compact: false })} / yr.
          Press <b>{row.isActive ? 'Upgrade' : 'Get'}</b> on the left to pay the annual premium.
        </p>
      ) : (
        <p className={flow.note}>
          Covering {activeCoverProductsLabel(sub)}. Pick a cover on the left to change or add one.
        </p>
      )}
    </div>
  ) : (
    <div className={flow.card}>
      <p className={flow.sumEyebrow}>No active cover</p>
      <p className={flow.note} style={{ marginTop: 'var(--space-2)' }}>
        Pick a cover level on the left to protect your family — from <b>{formatUGX(CHEAPEST_ANNUAL, { compact: false })} / yr</b>.
      </p>
    </div>
  );

  const payLabel = payProduct ? (SHORT_NAME[payProduct] ?? '').toLowerCase() : '';
  const payProps = {
    ariaLabel: 'Pay for insurance cover',
    eyebrow: row.isActive ? 'You’re paying to upgrade' : 'You’re activating cover',
    total: selectedAnnual,
    subtitle: `${formatUGX(selectedTier.cover)} ${payLabel} cover · ${formatUGX(selectedAnnual, { compact: false })} / yr`,
    lineItems: [
      { label: `${SHORT_NAME[payProduct] ?? 'Cover'} cover`, value: formatUGX(selectedTier.cover, { compact: false }) },
      { label: 'Annual premium', value: `${formatUGX(selectedAnnual, { compact: false })} / yr` },
    ],
    submitting: paySubmitting,
    success: {
      title: 'Cover updated',
      subtitle: `Your ${payLabel} cover is now ${formatUGX(selectedTier.cover)}.`,
    },
  };

  const payPanel = (
    <InlinePayPanel
      {...payProps}
      view={payView === 'success' ? 'success' : 'confirm'}
      methods={PAYMENT_METHODS}
      primaryLabel={`Pay ${formatUGX(selectedAnnual, { compact: false })}`}
      cancelLabel="Cancel"
      onPay={handlePayUpgrade}
      onCancel={closePay}
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
          {/* splitTight keeps the two columns down to a ~680px container. The
              shared 900px floor is tuned for the flows carrying an amount field
              and a method list; here the left column is a 4-stop slider and the
              right is a short figure list, and the default floor would collapse
              the split on every 1024-1204px laptop — reintroducing the very
              "summary at the bottom, page scrolls" bug this layout fixes. */}
          <div className={`${flow.split} ${flow.splitTight}`}>
            {/* Left controls lock (inert) while the right column owns the pay
                flow, so the product selector / cover slider / CTA can't be
                re-triggered or changed underneath the confirm/success panel. */}
            <div className={`${flow.col} ${payOpen ? flow.colLocked : ''}`} inert={payOpen}>
              {/* No empty-cover card here: the right rail already renders "No
                  active cover" with the same price hook, and its CTA only
                  scrolls to a picker that is already on screen. Mobile keeps it
                  — there the rail is not visible. */}
              {coverPicker}
              {beneficiariesDesktop}
            </div>
            <aside className={flow.summaryCol}>
              {payOpen ? payPanel : coverSummaryCard}
            </aside>
          </div>
        </div>
      </div>
    );
  }

  // Mobile: single-column stack + the shared PaySheet bottom sheet.
  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <motion.div
          className={styles.step}
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
        >
          {anyActive && (
            // Flat summary card: eyebrow + big indigo TOTAL across every active
            // policy + a premium / renewal sub-line.
            <section className={styles.coverSummary}>
              <span className={styles.coverEyebrow}>Current cover</span>
              <div className={styles.coverAmount}>{formatUGX(activeCoverTotal(sub), { compact: false })}</div>
              <p className={styles.coverSub}>
                {activeCoverProductsLabel(sub)} ·{' '}
                {formatUGX(live.reduce((s, p) => s + (p.renewalAmount || 0), 0), { compact: false })} / yr ·
                {' '}Renews {formatDate(nextRenewal(live))}
              </p>
            </section>
          )}
          {!anyActive && emptyCover}
          {coverPicker}
          {beneficiaries}
          {fileClaim}
        </motion.div>
      </div>

      {/* Upgrade pay sheet — modern shared PaySheet. Downgrades never reach this
          (no charge). */}
      <PaySheet
        {...payProps}
        open={payOpen}
        view={payView}
        onPay={handlePayUpgrade}
        onClose={closePay}
      />
    </div>
  );
}

/**
 * Seed the per-product cover selection from what the member currently holds,
 * defaulting to each product's entry tier when they hold nothing.
 */
function seedCovers(rows) {
  return Object.fromEntries(rows.map((r) => [
    r.id,
    (r.currentCover > 0
      ? tierForCover(r.id, r.currentCover)
      : defaultTier(r.id))?.cover ?? 0,
  ]));
}

/**
 * Coerce a stored percentage into the 0-100 the slider can represent. A missing
 * or malformed `insurance_savings_pct` falls back rather than rendering an
 * out-of-range thumb (which reads as 0% and would invite a needless "fix").
 */
function clampPct(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Earliest renewal across the given policies — the next date that matters. */
function nextRenewal(policies) {
  return policies
    .map((p) => p.renewalDate)
    .filter(Boolean)
    .sort()[0] ?? null;
}
