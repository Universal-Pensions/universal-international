import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAdminPanel } from '../../contexts/AdminPanelContext';
import { useNomineeClaims, useReviewNomineeClaim } from '../../hooks/useNomineeClaims';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { productName } from '../../utils/policies';
import Modal from '../../components/Modal';
import { REVIEW_LABEL as LABEL } from './reviewCopy';
import styles from '../adminPanels.module.css';

/**
 * Admin: death-benefit claims filed by nominees through the public /claim form.
 *
 * These are NOT `claims` rows. Life and funeral cover pay out because the member
 * has died, so the claimant has no account and the platform cannot verify who
 * they are — the form only ever ACCEPTS information (confirming cover to an
 * anonymous caller would be a member-enumeration oracle, see migration 0100).
 * Everything that makes it real happens here: a human reads the row, finds the
 * member, and records a decision.
 *
 * Three actions rather than two: "Start review" acknowledges the claim without
 * committing to an outcome, which matters when finding the member takes days.
 * Approve and reject are terminal — the RPC refuses to re-decide.
 *
 * Mirrors the ViewAccessRequests panel/fullPage pattern.
 */
export default function ViewNomineeClaims({ fullPage = false }) {
  const { viewNomineeClaimsOpen, setViewNomineeClaimsOpen } = useAdminPanel();
  const { data: claims = [], isLoading } = useNomineeClaims('pending');
  const review = useReviewNomineeClaim();
  const { addToast } = useToast();
  // The claim awaiting a decision: { claim, action: 'in_review'|'approved'|'rejected' }.
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [matchId, setMatchId] = useState('');
  const [note, setNote] = useState('');
  const busy = review.isPending;

  useEffect(() => {
    if (!viewNomineeClaimsOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && !fullPage) setViewNomineeClaimsOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewNomineeClaimsOpen, setViewNomineeClaimsOpen, fullPage]);

  function openConfirm(claim, action) {
    setMatchId(claim.matchedSubscriberId ?? '');
    setNote('');
    setConfirmTarget({ claim, action });
  }

  async function handleConfirm() {
    if (!confirmTarget) return;
    const { claim, action } = confirmTarget;
    try {
      await review.mutateAsync({
        id: claim.id,
        status: action,
        note: note.trim() || undefined,
        subscriberId: matchId.trim() || undefined,
      });
      addToast('success', `${claim.reference} — ${LABEL[action].toast}.`);
      setConfirmTarget(null);
    } catch (err) {
      addToast('error', err?.message || 'Could not update the claim.');
    }
  }

  const kpis = [
    { label: 'Awaiting review', value: formatNumber(claims.length) },
    { label: 'Life', value: formatNumber(claims.filter((c) => c.product === 'life').length) },
    { label: 'Funeral', value: formatNumber(claims.filter((c) => c.product === 'funeral').length) },
  ];

  return (
    <>
      <AnimatePresence>
        {viewNomineeClaimsOpen && !fullPage && (
          <motion.div
            key="vnc-backdrop"
            className={styles.backdrop}
            initial={{ opacity: 0, pointerEvents: 'auto' }}
            animate={{ opacity: 1, pointerEvents: 'auto' }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.25 }}
            onClick={() => setViewNomineeClaimsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(viewNomineeClaimsOpen || fullPage) && (
          <motion.div
            key="vnc-panel"
            className={styles.panel}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : { x: 0, transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            exit={fullPage ? { opacity: 0 } : { x: '100%', transition: { duration: 0.5, ease: EASE_OUT_EXPO } }}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
          >
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <div className={styles.titleWrap}>
                  <h2 className={styles.title}>Nominee claims</h2>
                  <p className={styles.subtitle}>Life &amp; funeral claims filed by a family member</p>
                </div>
                {!fullPage && (
                  <button className={styles.closeBtn} onClick={() => setViewNomineeClaimsOpen(false)} aria-label="Close">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className={styles.body}>
              <div className={styles.rowMetrics} style={{ marginBottom: 'var(--space-5)' }}>
                {kpis.map((k) => (
                  <div className={styles.metric} key={k.label}>
                    <span className={styles.metricVal}>{k.value}</span>
                    <span className={styles.metricLabel}>{k.label}</span>
                  </div>
                ))}
              </div>

              {isLoading ? (
                <div className={styles.loading}><div className={styles.spinner} /></div>
              ) : claims.length === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="26" height="26">
                      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </span>
                  <p className={styles.emptyText}>
                    No claims awaiting review. Claims filed at /claim will appear here.
                  </p>
                </div>
              ) : (
                <div className={styles.list}>
                  {claims.map((c) => (
                    <div className={styles.row} key={c.id}>
                      <div className={styles.rowHead}>
                        <div>
                          {/* The DECEASED leads the row — that is who the admin
                              has to find in the member records. */}
                          <div className={styles.rowName}>{c.deceasedName}</div>
                          <div className={styles.rowSub}>
                            {c.deceasedNin ? `NIN ${c.deceasedNin}` : 'No NIN given'}
                            {c.deceasedPhone ? ` · ${c.deceasedPhone}` : ''}
                            {' · died '}{formatDate(c.dateOfDeath)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                          <span className={`${styles.statusPill} ${c.product === 'life' ? styles.statusActive : styles.statusInactive}`}>
                            {productName(c.product)}
                          </span>
                          <button
                            type="button"
                            className={styles.deactivateBtn}
                            onClick={() => openConfirm(c, 'rejected')}
                            disabled={busy}
                          >
                            Reject
                          </button>
                          <button
                            type="button"
                            className={styles.cancelBtn}
                            onClick={() => openConfirm(c, 'in_review')}
                            disabled={busy}
                          >
                            Start review
                          </button>
                          <button
                            type="button"
                            className={styles.activateBtn}
                            onClick={() => openConfirm(c, 'approved')}
                            disabled={busy}
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                      <div className={styles.rowMetrics}>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{c.reference}</span>
                          <span className={styles.metricLabel}>Reference</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{c.claimantName}</span>
                          <span className={styles.metricLabel}>Claimant</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{c.relationship}</span>
                          <span className={styles.metricLabel}>Relationship</span>
                        </div>
                        <div className={styles.metric}>
                          {/* The only number we can reliably reach them on. */}
                          <span className={styles.metricVal}>{c.claimantPhone}</span>
                          <span className={styles.metricLabel}>Call them on</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{formatDate(c.createdAt)}</span>
                          <span className={styles.metricLabel}>Filed</span>
                        </div>
                      </div>
                      {c.notes && <p className={styles.rowSub} style={{ marginTop: 'var(--space-3)' }}>{c.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmTarget && (() => {
        const { claim, action } = confirmTarget;
        const meta = LABEL[action];
        return (
          <Modal
            open
            onClose={() => { if (!busy) setConfirmTarget(null); }}
            title={`${meta.title} ${claim.reference}?`}
            size="sm"
            dismissOnBackdrop={!busy}
          >
            <div className={styles.confirmDialog}>
              <h3 className={styles.confirmTitle}>{meta.title} {claim.reference}?</h3>
              <p className={styles.confirmBody}>
                {meta.body(claim)}
              </p>

              {/* The manual match. Deliberately a free-text member id rather than
                  an automatic lookup — matching a death to a member record is a
                  judgement call, and getting it wrong pays the wrong family. */}
              <label className={styles.confirmField}>
                <span>Matched member ID {action === 'approved' ? '' : '(optional)'}</span>
                <input
                  type="text"
                  value={matchId}
                  onChange={(e) => setMatchId(e.target.value)}
                  placeholder="e.g. s-0001"
                  disabled={busy}
                />
              </label>

              <label className={styles.confirmField}>
                <span>Note (optional)</span>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What you checked, or what is still outstanding"
                  disabled={busy}
                />
              </label>

              <div className={styles.confirmActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setConfirmTarget(null)} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={action === 'rejected' ? styles.deactivateBtn : styles.activateBtn}
                  onClick={handleConfirm}
                  disabled={busy}
                >
                  {busy ? 'Working…' : meta.cta}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
