import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { parseAmount } from '../../utils/finance';
import { activeCoverTotal, activePolicies } from '../../utils/policies';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatNumber, formatUGX } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { useCurrentSubscriber, useSubmitClaim, useSubscriberClaims } from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { PillChip, PillChipGroup } from '../../components/PillChip';
import ErrorCard from '../../components/feedback/ErrorCard';
import { goBackOrFallback } from '../shell/navigation';
import { useSubscriberAppBar } from '../shell/subscriberAppBarContext';
import styles from './ClaimPage.module.css';
import flow from './desktopFlow.module.css';

const CLAIM_TYPES = [
  { id: 'medical',          label: 'Medical' },
  { id: 'accident',         label: 'Accident' },
  { id: 'hospitalization',  label: 'Hospitalisation' },
  { id: 'critical_illness', label: 'Critical illness' },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function statusMeta(status) {
  switch (status) {
    case 'approved':
    case 'paid':         return { label: status === 'paid' ? 'Paid' : 'Approved', tone: 'ok' };
    case 'submitted':    return { label: 'Submitted', tone: 'info' };
    case 'under_review': return { label: 'Under review', tone: 'pending' };
    case 'rejected':     return { label: 'Rejected', tone: 'alert' };
    default:             return { label: status, tone: 'info' };
  }
}

export default function ClaimPage() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();
  const { data: sub, isError, error, refetch } = useCurrentSubscriber();
  const { addToast } = useToast();
  const submitClaim = useSubmitClaim(sub?.id);

  const [view, setView] = useState('list'); // list | form | review | success
  const [claimType, setClaimType] = useState('medical');
  const [claimDate, setClaimDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [claimAmount, setClaimAmount] = useState('');
  const [claimDesc, setClaimDesc] = useState('');
  const [claimFiles, setClaimFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [resultClaim, setResultClaim] = useState(null);

  const { data: claims = [] } = useSubscriberClaims(sub?.id);
  // Cover figures span ALL active products (life + health + funeral), not the
  // legacy life-only row — so a member with only health/funeral cover can still
  // file a claim and sees their real cover, matching Policies / Home.
  const activeIns = activePolicies(sub);
  const coverTotal = activeCoverTotal(sub);
  const premiumTotal = activeIns.reduce((s, p) => s + (Number(p.premiumMonthly) || 0), 0);
  // Self-paid cover is billed as ONE annual premium (rate × 12), never monthly.
  const annualPremiumTotal = premiumTotal * 12;
  const nextRenewal = activeIns.map((p) => p.renewalDate).filter(Boolean).sort()[0] || null;
  const noPolicy = activeIns.length === 0;

  const claimAmtNum = parseAmount(claimAmount) ?? 0;
  const canReview = claimType && claimDate && claimAmtNum > 0 && claimDesc.trim().length >= 6;

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
      const claim = await submitClaim.mutateAsync({
        type: claimType,
        incidentDate: claimDate,
        amount: claimAmtNum,
        description: claimDesc.trim(),
        // Real File objects propagate to the mutation. Today the mock service
        // only logs the file count; once the backend lands, swap the service
        // implementation to send a multipart/form-data POST (or a presigned-
        // URL upload) — the call sites here don't need to change.
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
    setClaimType('medical');
    setClaimDate(new Date().toISOString().slice(0, 10));
    setClaimAmount('');
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
              {noPolicy ? (
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
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    onClick={() => navigate('/dashboard/save/schedule')}
                  >
                    Add cover
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
                        const meta = statusMeta(c.status);
                        return (
                          <li key={c.id} className={styles.claimRow}>
                            <div className={styles.claimHead}>
                              <span className={styles.claimType}>{CLAIM_TYPES.find((t) => t.id === c.type)?.label || c.type}</span>
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
                      <div className={flow.card}>
                        <span className={flow.fieldLabel}>What are you claiming for?</span>
                        <PillChipGroup label="Claim type" layout="grid" columns={2}>
                          {CLAIM_TYPES.map((c) => (
                            <PillChip key={c.id} selected={claimType === c.id} onClick={() => setClaimType(c.id)}>
                              {c.label}
                            </PillChip>
                          ))}
                        </PillChipGroup>
                      </div>

                      <div className={flow.card}>
                        <span className={flow.fieldLabel}>When did it happen?</span>
                        <input
                          type="date"
                          className={styles.input}
                          value={claimDate}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => setClaimDate(e.target.value)}
                          aria-label="Incident date"
                        />
                        <span className={`${flow.fieldLabel} ${flow.fieldLabelGap}`}>Claim amount (UGX)</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          className={styles.input}
                          value={claimAmount ? formatNumber(parseAmount(claimAmount) ?? 0) : ''}
                          onChange={(e) => setClaimAmount(e.target.value.replace(/[^\d]/g, ''))}
                          placeholder="e.g. 350,000"
                          aria-label="Claim amount in UGX"
                        />
                      </div>

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
                  <h2 className={styles.sectionTitle}>What happened?</h2>
                </div>
                <PillChipGroup label="Claim type" layout="grid" columns={2}>
                  {CLAIM_TYPES.map((c) => (
                    <PillChip
                      key={c.id}
                      selected={claimType === c.id}
                      onClick={() => setClaimType(c.id)}
                    >
                      {c.label}
                    </PillChip>
                  ))}
                </PillChipGroup>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionIdx}>02</span>
                  <h2 className={styles.sectionTitle}>When &amp; how much?</h2>
                </div>
                <div className={styles.fieldRow}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Incident date</span>
                    <input
                      type="date"
                      className={styles.input}
                      value={claimDate}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setClaimDate(e.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Amount (UGX)</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      className={styles.input}
                      value={claimAmount ? formatNumber(parseAmount(claimAmount) ?? 0) : ''}
                      onChange={(e) => setClaimAmount(e.target.value.replace(/[^\d]/g, ''))}
                      placeholder="e.g. 350,000"
                    />
                  </label>
                </div>
              </section>

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
                <span className={styles.confirmEyebrow}>Claiming</span>
                <div className={styles.confirmBig}>{formatUGX(claimAmtNum, { compact: false })}</div>
                <ul className={styles.summaryList}>
                  <li className={styles.summaryRow}>
                    <span>Type</span>
                    <strong>{CLAIM_TYPES.find((t) => t.id === claimType)?.label}</strong>
                  </li>
                  <li className={styles.summaryRow}>
                    <span>Incident</span>
                    <strong>{formatDate(claimDate)}</strong>
                  </li>
                  <li className={styles.summaryRow}>
                    <span>Documents</span>
                    <strong>{claimFiles.length} file{claimFiles.length !== 1 ? 's' : ''}</strong>
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
          page footer is suppressed for the form view (it still drives the list /
          review / success actions, constrained to the narrow column). */}
      {!noPolicy && !(isDesktop && view === 'form') && (
        <footer className={`${styles.footer}${isDesktop ? ` ${flow.narrow}` : ''}`}>
          {view === 'list' && claims.length > 0 && (
            <button type="button" className={styles.primaryBtn} onClick={() => { resetForm(); setView('form'); }}>
              File a new claim
            </button>
          )}
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
