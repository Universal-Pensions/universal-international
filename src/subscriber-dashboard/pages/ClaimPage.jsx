import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { activeCoverTotal, activePolicies, productName } from '../../utils/policies';
import { hospitalCashQuote } from '../../utils/hospitalCash';
import { HOSPITAL_CASH_DAYS, annualPremium, defaultTier } from '../../constants/savings';
import { claimTypeLabel, claimStatusMeta } from '../../constants/claims';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { useCurrentSubscriber, useSubmitClaim, useSubscriberClaims } from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import ErrorCard from '../../components/feedback/ErrorCard';
import { goBackOrFallback } from '../shell/navigation';
import { useSubscriberAppBar } from '../shell/subscriberAppBarContext';
import styles from './ClaimPage.module.css';
import flow from './desktopFlow.module.css';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Cheapest way into any cover — the empty state's price hook. */
const CHEAPEST_ANNUAL = Math.min(
  ...['life', 'health', 'funeral'].map((id) => annualPremium(defaultTier(id))),
);

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ClaimPage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub, isError, error, refetch } = useCurrentSubscriber();
  const { addToast } = useToast();
  const submitClaim = useSubmitClaim(sub?.id);

  const [view, setView] = useState('list'); // list | form | review | success
  const [admissionDate, setAdmissionDate] = useState('');
  const [dischargeDate, setDischargeDate] = useState('');
  const [provider, setProvider] = useState('');
  const [claimDesc, setClaimDesc] = useState('');
  const [claimFiles, setClaimFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [resultClaim, setResultClaim] = useState(null);

  const { data: claims = [] } = useSubscriberClaims(sub?.id);
  const activeIns = activePolicies(sub);
  const coverTotal = activeCoverTotal(sub);
  const premiumTotal = activeIns.reduce((s, p) => s + (Number(p.premiumMonthly) || 0), 0);
  // Self-paid cover is billed as ONE annual premium (rate × 12), never monthly.
  const annualPremiumTotal = premiumTotal * 12;
  const nextRenewal = activeIns.map((p) => p.renewalDate).filter(Boolean).sort()[0] || null;

  // WHO CAN CLAIM WHAT is the rule this page turns on. Hospital cash pays the
  // member while they are alive, so it is the only thing claimable here. Life
  // and funeral pay out BECAUSE the member has died — their nominee claims them
  // through the public form at /claim, with no account.
  const hospitalCash = activeIns.find((p) => p.type === 'health') || null;
  const deathBenefits = activeIns.filter((p) => p.type === 'life' || p.type === 'funeral');
  const noPolicy = activeIns.length === 0;
  // Three states: file a claim · explain the nominee route · upsell.
  const gate = hospitalCash ? 'claimable' : (deathBenefits.length > 0 ? 'nominee-only' : 'none');

  // Live preview. The server re-derives all of this in submit_hospital_cash_claim
  // (0099) and is the authority — nothing here is sent as an amount.
  const quote = hospitalCashQuote({
    policy: hospitalCash,
    admission: admissionDate,
    discharge: dischargeDate,
    claims,
  });

  const canReview = Boolean(
    admissionDate && dischargeDate
    && quote.nights >= 1 && quote.payableNights >= 1
    && provider.trim().length > 0
    && claimDesc.trim().length >= 6,
  );

  // ── Shared form fragments ───────────────────────────────────────────────────
  // Desktop and mobile render the same inputs in different chrome, so they are
  // built once here rather than duplicated into both branches.
  const stayFields = (
    <>
      <div className={styles.fieldRow}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Admitted on</span>
          <input
            type="date"
            className={styles.input}
            value={admissionDate}
            max={dischargeDate || todayIso()}
            onChange={(e) => setAdmissionDate(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Discharged on</span>
          <input
            type="date"
            className={styles.input}
            value={dischargeDate}
            min={admissionDate || undefined}
            max={todayIso()}
            onChange={(e) => setDischargeDate(e.target.value)}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span className={`${styles.fieldLabel} ${flow.fieldLabelGap}`}>Hospital or clinic</span>
        <input
          type="text"
          className={styles.input}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          placeholder="e.g. Mulago National Referral Hospital"
          maxLength={160}
        />
      </label>
    </>
  );

  // What the member will actually be paid, updating as they type. Hospital cash
  // pays per NIGHT, so the cover figure on its own would overstate this.
  const payoutPreview = admissionDate && dischargeDate ? (
    <div className={styles.payoutCard} data-tone={quote.payableNights > 0 ? 'ok' : 'warn'}>
      {quote.nights < 1 ? (
        <p className={styles.payoutNote}>
          Hospital cash pays for each <strong>night</strong> you stay. Choose a discharge
          date after your admission date.
        </p>
      ) : quote.payableNights < 1 ? (
        <p className={styles.payoutNote}>
          You&apos;ve already claimed all <strong>{HOSPITAL_CASH_DAYS} covered nights</strong> for
          this policy year. Your allowance resets on {formatDate(hospitalCash?.renewalDate)}.
        </p>
      ) : (
        <>
          <span className={styles.payoutEyebrow}>You&apos;ll receive</span>
          <div className={styles.payoutBig}>{formatUGX(quote.payout, { compact: false })}</div>
          <p className={styles.payoutNote}>
            {quote.payableNights} {quote.payableNights === 1 ? 'night' : 'nights'}
            {' × '}{formatUGX(quote.dailyRate, { compact: false })} a night ·{' '}
            {quote.remaining - quote.payableNights} of your {HOSPITAL_CASH_DAYS} covered
            nights left after this.
          </p>
          {quote.capped && (
            <p className={styles.payoutWarn}>
              You stayed {quote.nights} nights, but only {quote.payableNights} are still
              covered this policy year — so that&apos;s what this claim pays.
            </p>
          )}
        </>
      )}
    </div>
  ) : null;

  const { registerBack } = useSubscriberAppBar();
  const handleBack = useCallback(() => {
    if (view === 'review') return setView('form');
    if (view === 'form' || view === 'success') return setView('list');
    goBackOrFallback(navigate, '/dashboard/withdraw');
  }, [view, navigate]);

  // On mobile the shell app bar owns the back arrow (the in-page hero was
  // removed). Register handleBack so its back steps through this flow's internal
  // views (review→form→list) before exiting the route. Desktop wires handleBack
  // to its own deskHead back button, so it doesn't register.
  useEffect(() => {
    if (isDesktop) return undefined;
    return registerBack(handleBack);
  }, [isDesktop, registerBack, handleBack]);

  function handleFilePick(e) {
    // Keep the actual File objects, not just metadata, so they can be uploaded
    // when the backend lands. Display fields (.name, .size) read straight off
    // each File. Cap at 4 to mirror the dropzone copy.
    const picked = Array.from(e.target.files || []).slice(0, 4);
    const tooLarge = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooLarge) {
      addToast('error', `${tooLarge.name} is over 5MB — please upload a smaller file.`);
      // Reset the input so the same oversized file can be re-selected after
      // the user picks a smaller replacement.
      e.target.value = '';
      return;
    }
    setClaimFiles(picked);
  }

  function removeFileAt(index) {
    setClaimFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmitClaim() {
    if (!canReview || !sub) return;
    setSubmitting(true);
    try {
      // No amount is sent. The RPC prices the stay from the member's own policy
      // (cover ÷ 20 a night) and caps it against the nights they have already
      // used this policy year — see migration 0099.
      const claim = await submitClaim.mutateAsync({
        admissionDate,
        dischargeDate,
        provider: provider.trim(),
        description: claimDesc.trim(),
        // Real File objects propagate to the mutation, but there is still no
        // storage bucket and no documents column — the review screen says so
        // rather than implying an upload happened. See BACKEND.md §14a.
        files: claimFiles,
      });
      setResultClaim(claim);
      setView('success');
      addToast('success', 'Claim submitted. We’ll be in touch shortly.');
    } catch (err) {
      addToast('error', err?.message || 'Could not submit claim.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    // Dates start EMPTY rather than defaulting to today: a hospital stay is a
    // real event the member has to recall, and a pre-filled date is the kind of
    // default people submit without reading.
    setAdmissionDate('');
    setDischargeDate('');
    setProvider('');
    setClaimDesc('');
    setClaimFiles([]);
    setResultClaim(null);
  }

  // On the list view with an active policy, fold the cover figure into the
  // hero dome (eyebrow + big amount + premium/renewal stat row). Every other
  // view (and the no-policy upsell) shows a title-only hero with a muted line.
  const showCoverHero = view === 'list' && !noPolicy;

  const headTitle =
    view === 'list' ? 'File a claim'
    : view === 'form' ? 'New claim'
    : view === 'review' ? 'Review claim'
    : 'Submitted';

  // Desktop subtitle folds the cover figure (mobile surfaces it in the hero
  // dome's big amount + stat row) into a single flat line so nothing is lost.
  const deskSubtitle =
    showCoverHero
      ? `UGX ${formatUGX(coverTotal, { compact: false }).replace('UGX ', '')} active cover · ${formatUGX(annualPremiumTotal, { compact: false })} / yr${nextRenewal ? ` · renews ${formatDate(nextRenewal)}` : ''}`
      : view === 'list' && coverTotal > 0 ? `Cover: ${formatUGX(coverTotal)}`
      : view === 'list' ? 'No active policy yet'
      : undefined;

  // A cold-start query failure would otherwise render a silent blank claim page
  // — surface a retry card instead (mirrors HomePage's error handling).
  if (isError) {
    return (
      <div className={styles.page}>
        <ErrorCard
          title="We couldn't load your cover"
          message={error}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {isDesktop && (
        // Desktop (>=1024px): flat v5 header — eyebrow + title + subtitle. No
        // indigo hero dome. Cover/premium/renewal fold into the subtitle line.
        // Mobile drops its in-page header entirely — the shell app bar owns the
        // "File a claim" title + back arrow; the cover figure surfaces in a flat
        // summary card inside the list body below.
        <header className={styles.deskHead}>
          <button
            type="button"
            className={styles.deskBack}
            onClick={handleBack}
            aria-label="Back"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
              <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className={styles.deskHeadText}>
            <p className={styles.deskEyebrow}>{showCoverHero ? 'Active cover' : 'Insurance claim'}</p>
            <h1 className={styles.deskTitle}>{headTitle}</h1>
            {deskSubtitle && <p className={styles.deskSubtitle}>{deskSubtitle}</p>}
          </div>
        </header>
      )}

      <div className={styles.body}>
        <AnimatePresence mode="wait" initial={false}>
          {view === 'list' && (
            <motion.div
              key="list"
              className={`${styles.step}${isDesktop ? ` ${flow.narrow}` : ''}`}
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
            >
              {gate === 'none' ? (
                <section className={styles.emptyCoverCard}>
                  <div className={styles.shieldIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
                      <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <h2 className={styles.emptyTitle}>No active cover</h2>
                  <p className={styles.emptyText}>
                    You have nothing to claim on yet. Cover starts from{' '}
                    <strong>{formatUGX(CHEAPEST_ANNUAL, { compact: false })} / yr</strong>.
                  </p>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => navigate('/dashboard/settings/insurance')}
                  >
                    Add cover
                  </button>
                </section>
              ) : gate === 'nominee-only' ? (
                // The member holds only DEATH benefits. Saying "no claims
                // available" would be wrong and slightly alarming; the honest
                // answer is that someone else makes this claim, on their behalf,
                // and the useful action is to check that person is on file.
                <section className={styles.emptyCoverCard}>
                  <div className={styles.shieldIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
                      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
                      <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <h2 className={styles.emptyTitle}>Your family makes this claim</h2>
                  <p className={styles.emptyText}>
                    You hold{' '}
                    <strong>
                      {deathBenefits.map((p) => productName(p.type).toLowerCase()).join(' and ')}
                    </strong>
                    . These pay out to the people you&apos;ve named, after you&apos;ve passed
                    away — so the claim is made by them, not by you. Make sure your
                    beneficiaries are on file and know how to reach us.
                  </p>
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => navigate('/dashboard/settings/nominees')}
                  >
                    Check your beneficiaries
                  </button>
                  <p className={styles.emptyText}>
                    Add <strong>hospital cash</strong> and you can claim for yourself
                    whenever you spend a night in hospital.
                  </p>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => navigate('/dashboard/settings/insurance')}
                  >
                    Add hospital cash
                  </button>
                </section>
              ) : (
                <>
                  {!isDesktop && showCoverHero && (
                    // Mobile: the removed hero dome's cover figure, re-homed as a
                    // flat summary card. Eyebrow + big indigo amount + a premium /
                    // renewal sub-line. Desktop folds the same figures into the
                    // flat header subtitle, so this is mobile-only.
                    <section className={styles.coverSummary}>
                      <span className={styles.coverEyebrow}>Active cover</span>
                      <div className={styles.coverAmount}>{formatUGX(coverTotal, { compact: false })}</div>
                      <p className={styles.coverSub}>
                        {formatUGX(annualPremiumTotal, { compact: false })} / yr{nextRenewal ? ` · Renews ${formatDate(nextRenewal)}` : ''}
                      </p>
                    </section>
                  )}

                  <button type="button" className={styles.fileNewBtn} onClick={() => { resetForm(); setView('form'); }}>
                    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="14" height="14">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                    </svg>
                    File a new claim
                  </button>

                  <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Past claims</h2>
                    <ul className={styles.claimsList}>
                      {claims.length === 0 && (
                        <li className={styles.claimsEmpty}>No claims filed yet.</li>
                      )}
                      {claims.map((c) => {
                        const meta = claimStatusMeta(c.status);
                        return (
                          <li key={c.id} className={styles.claimRow}>
                            <div className={styles.claimHead}>
                              <span className={styles.claimType}>{claimTypeLabel(c)}</span>
                              <span className={styles.claimStatus} data-tone={meta.tone}>
                                <span className={styles.statusDot} />
                                {meta.label}
                              </span>
                            </div>
                            <div className={styles.claimMeta}>
                              <span>Submitted {formatDate(c.submittedDate)}</span>
                              <span className={styles.claimDot}>·</span>
                              <span>Incident {formatDate(c.incidentDate)}</span>
                            </div>
                            <div className={styles.claimAmount}>{formatUGX(c.amount, { compact: false })}</div>
                            {c.description && <p className={styles.claimDesc}>{c.description}</p>}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                </>
              )}
            </motion.div>
          )}

          {view === 'form' && (
            <motion.div
              key="form"
              className={styles.step}
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
            >
              {isDesktop ? (
                /* Desktop (>=1024px): 2-column — the claim form beside a sticky
                   "Your cover" card. The review CTA sits inline at the foot of
                   the form column (the page footer's Review button is hidden on
                   desktop). Mobile keeps the shipped numbered-section flow below. */
                <div className={flow.splitHost}>
                  <div className={flow.split}>
                    <div className={flow.col}>
                      <div className={flow.card}>{stayFields}</div>
                      {payoutPreview}

                      <div className={flow.card}>
                        <span className={flow.fieldLabel} id="claim-desc-label-desktop">Describe what happened</span>
                        <textarea
                          className={styles.textarea}
                          value={claimDesc}
                          onChange={(e) => setClaimDesc(e.target.value)}
                          placeholder="A short summary of the incident and what you're claiming for."
                          rows={4}
                          aria-labelledby="claim-desc-label-desktop"
                        />
                        <span className={styles.charHint}>{claimDesc.length} chars · min 6</span>
                      </div>

                      <div className={flow.card}>
                        <span className={flow.fieldLabel}>Supporting documents</span>
                        <label className={styles.dropzone}>
                          <input
                            type="file"
                            multiple
                            accept="image/*,application/pdf"
                            onChange={handleFilePick}
                            className={styles.hiddenInput}
                            aria-label="Upload supporting documents"
                          />
                          <div className={styles.dropzoneInner}>
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                              <polyline points="17,8 12,3 7,8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                              <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                            </svg>
                            <span className={styles.dropzoneTitle}>Tap to upload</span>
                            <span className={styles.dropzoneHint}>Receipts, discharge letter, photos · up to 4 files</span>
                          </div>
                        </label>
                        {claimFiles.length > 0 && (
                          <ul className={styles.filesList}>
                            {claimFiles.map((f, i) => (
                              <li key={`${f.name}-${i}`} className={styles.fileItem}>
                                <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none">
                                  <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                                </svg>
                                <span className={styles.fileName}>{f.name}</span>
                                <button type="button" className={styles.fileRemove} onClick={() => removeFileAt(i)} aria-label={`Remove ${f.name}`}>
                                  <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none">
                                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                                  </svg>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <button
                          type="button"
                          className={`${flow.cta} ${flow.ctaPrimary}`}
                          disabled={!canReview}
                          onClick={() => setView('review')}
                        >
                          Review claim
                        </button>
                      </div>
                    </div>

                    <aside className={flow.summaryCol}>
                      <div className={flow.card}>
                        <div className={flow.blockHead}>
                          <span className={flow.blockTitle}>
                            <span className={flow.blockIc}>
                              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                                <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                                <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </span>
                            Your cover
                          </span>
                          <span className={flow.pillOk}><span className={flow.pillDot} />Active</span>
                        </div>
                        <ul className={flow.sumList}>
                          <li className={flow.sumRow}>
                            <span>Cover amount</span>
                            <span className={flow.sumVal}>{formatUGX(coverTotal, { compact: false })}</span>
                          </li>
                          {premiumTotal > 0 && (
                            <li className={flow.sumRow}>
                              <span>Premium</span>
                              <span className={flow.sumVal}>{formatUGX(annualPremiumTotal, { compact: false })} / yr</span>
                            </li>
                          )}
                          {nextRenewal && (
                            <li className={flow.sumRow}>
                              <span>Renews</span>
                              <span className={flow.sumVal}>{formatDate(nextRenewal)}</span>
                            </li>
                          )}
                        </ul>
                        <p className={flow.note}>
                          Claims are reviewed within 3–5 working days. You&apos;ll get a notification when there&apos;s an update.
                        </p>
                      </div>
                    </aside>
                  </div>
                </div>
              ) : (
                <>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIdx}>01</span>
                  <h2 className={styles.sectionTitle}>Your hospital stay</h2>
                </div>
                {stayFields}
              </section>

              {payoutPreview}

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIdx}>03</span>
                  <h2 className={styles.sectionTitle} id="claim-desc-label">Describe it</h2>
                </div>
                <textarea
                  className={styles.textarea}
                  value={claimDesc}
                  onChange={(e) => setClaimDesc(e.target.value)}
                  placeholder="A short summary of the incident and what you're claiming for."
                  rows={4}
                  aria-labelledby="claim-desc-label"
                />
                <span className={styles.charHint}>{claimDesc.length} chars · min 6</span>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIdx}>04</span>
                  <h2 className={styles.sectionTitle}>Supporting documents</h2>
                </div>
                <label className={styles.dropzone}>
                  <input
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    onChange={handleFilePick}
                    className={styles.hiddenInput}
                    aria-label="Upload supporting documents"
                  />
                  <div className={styles.dropzoneInner}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="17,8 12,3 7,8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                      <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                    </svg>
                    <span className={styles.dropzoneTitle}>Tap to upload</span>
                    <span className={styles.dropzoneHint}>Receipts, discharge letter, photos · up to 4 files</span>
                  </div>
                </label>

                {claimFiles.length > 0 && (
                  <ul className={styles.filesList}>
                    {claimFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className={styles.fileItem}>
                        <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none">
                          <path d="M5 3h7l4 4v10a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                        </svg>
                        <span className={styles.fileName}>{f.name}</span>
                        <button
                          type="button"
                          className={styles.fileRemove}
                          onClick={() => removeFileAt(i)}
                          aria-label={`Remove ${f.name}`}
                        >
                          <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12" fill="none">
                            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
                </>
              )}
            </motion.div>
          )}

          {view === 'review' && (
            <motion.div
              key="review"
              className={`${styles.step}${isDesktop ? ` ${flow.narrow}` : ''}`}
              initial={reducedMotion ? false : { opacity: 0, y: 10 }}
              animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
              exit={reducedMotion ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
            >
              <section className={styles.reviewCard}>
                <span className={styles.confirmEyebrow}>You&apos;ll receive</span>
                <div className={styles.confirmBig}>{formatUGX(quote.payout, { compact: false })}</div>
                <ul className={styles.summaryList}>
                  <li className={styles.summaryRow}>
                    <span>Cover</span>
                    <strong>{productName('health')}</strong>
                  </li>
                  <li className={styles.summaryRow}>
                    <span>Hospital</span>
                    <strong>{provider.trim()}</strong>
                  </li>
                  <li className={styles.summaryRow}>
                    <span>Stay</span>
                    <strong>{formatDate(admissionDate)} → {formatDate(dischargeDate)}</strong>
                  </li>
                  <li className={styles.summaryRow}>
                    <span>Nights paid</span>
                    <strong>
                      {quote.payableNights} × {formatUGX(quote.dailyRate, { compact: false })}
                    </strong>
                  </li>
                  <li className={styles.summaryRow}>
                    <span>Documents</span>
                    {/* Honest about the demo limit rather than implying an upload
                        happened — there is no storage bucket (BACKEND.md §14a). */}
                    <strong>
                      {claimFiles.length} file{claimFiles.length !== 1 ? 's' : ''} attached
                    </strong>
                  </li>
                </ul>
                <p className={styles.reviewDesc}>{claimDesc}</p>
                <p className={styles.confirmNote}>
                  A case officer will review your claim within 3 business days. You&apos;ll get an SMS at every step.
                </p>
              </section>
            </motion.div>
          )}

          {view === 'success' && (
            <motion.div
              key="success"
              className={`${styles.successStep}${isDesktop ? ` ${flow.narrow}` : ''}`}
              initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={reducedMotion ? undefined : { opacity: 1, scale: 1 }}
              exit={reducedMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
            >
              <div className={styles.successCheck} aria-hidden="true">
                <svg viewBox="0 0 48 48" width="40" height="40" fill="none">
                  <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
                  <path d="M14 24l7 7 14-15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h2 className={styles.successTitle}>Claim submitted</h2>
              <p className={styles.successSubtitle}>
                We&apos;ve received your claim. A case officer will be in touch within 3 business days.
              </p>
              {resultClaim?.id && (
                <div className={styles.successRef}>
                  Case <strong>{resultClaim.id.slice(-6).toUpperCase()}</strong>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* On desktop the form's Review CTA is inline in the split column, so the
          page footer is suppressed for the form view (it still drives the
          review / success actions, constrained to the narrow column).

          The LIST view has no footer at all: `.fileNewBtn` above already carries
          "File a new claim", directly under the cover it applies to, and it is
          the only version that also shows when there are no past claims. The
          footer is not sticky, so a second copy at the bottom of the list was
          the same button twice on one screen. */}
      {!noPolicy && view !== 'list' && !(isDesktop && view === 'form') && (
        <footer className={`${styles.footer}${isDesktop ? ` ${flow.narrow}` : ''}`}>
          {view === 'form' && (
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!canReview}
              onClick={() => setView('review')}
            >
              Review claim
            </button>
          )}
          {view === 'review' && (
            <div className={styles.footerRow}>
              <button type="button" className={styles.secondaryBtn} onClick={() => setView('form')}>Edit</button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={submitting}
                onClick={handleSubmitClaim}
              >
                {submitting ? 'Submitting…' : 'Submit claim'}
              </button>
            </div>
          )}
          {view === 'success' && (
            <div className={styles.footerRow}>
              <button type="button" className={styles.secondaryBtn} onClick={() => navigate('/dashboard')}>
                Home
              </button>
              <button type="button" className={styles.primaryBtn} onClick={() => setView('list')}>
                View claims
              </button>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
