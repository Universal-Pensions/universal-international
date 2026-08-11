import { useState } from 'react';
import { useNomineeClaims, useReviewNomineeClaim } from '../../hooks/useNomineeClaims';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { productName } from '../../utils/policies';
import { REVIEW_LABEL } from '../nominee-claims/reviewCopy';
import Modal from '../../components/Modal';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

/**
 * AdminNomineeClaimsMobile — the phone view of death-benefit claims filed at the
 * public /claim form (route /dashboard/nominee-claims).
 *
 * The desktop equivalent is the ViewNomineeClaims slide-in panel, which the
 * phone shell cannot mount (it is driven by AdminPanelContext, not the router).
 * Without this page the phone simply had no route: an admin away from a desk
 * could not see that a family had reported a death. Same hooks, same three
 * decisions, same wording (`reviewCopy`) — only the layout differs.
 *
 * Follows AdminAccessRequestsMobile: summary strip, one block per row, decisions
 * behind a confirm Modal. The DECEASED leads each row because that is the person
 * the admin has to find in the member records.
 */
export default function AdminNomineeClaimsMobile() {
  const { data: claims = [], isLoading, isError, error, refetch } = useNomineeClaims('pending');
  const review = useReviewNomineeClaim();
  const { addToast } = useToast();
  // { claim, action: 'in_review' | 'approved' | 'rejected' }
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [matchId, setMatchId] = useState('');
  const [note, setNote] = useState('');
  const busy = review.isPending;

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
      addToast('success', `${claim.reference} — ${REVIEW_LABEL[action].toast}.`);
      setConfirmTarget(null);
    } catch (err) {
      addToast('error', err?.message || 'Could not update the claim.');
    }
  }

  if (isError) {
    return <ErrorCard title="We couldn't load nominee claims" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && claims.length === 0) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  return (
    <>
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Nominee claims summary">
        <div className={styles.statStrip}>
          <div><b>{formatNumber(claims.length)}</b><small>Awaiting review</small></div>
          <div><b>{formatNumber(claims.filter((c) => c.product === 'life').length)}</b><small>Life</small></div>
          <div><b>{formatNumber(claims.filter((c) => c.product === 'funeral').length)}</b><small>Funeral</small></div>
        </div>
      </section>

      <section className={styles.card} aria-label="Claims awaiting review">
        {claims.length === 0 ? (
          <div className={styles.empty}>
            <b>No claims awaiting review</b>
            <p>Claims filed by a family member at /claim appear here.</p>
          </div>
        ) : (
          claims.map((c) => (
            <div key={c.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--color-lavender)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <b style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{c.deceasedName}</b>
                <span className={styles.stBadge} data-status={c.product === 'life' ? 'active' : 'inactive'}>
                  {productName(c.product)}
                </span>
              </div>
              <div style={{ color: 'var(--color-gray)', fontSize: 12.5, marginTop: 2 }}>
                {c.deceasedNin ? `NIN ${c.deceasedNin}` : 'No NIN given'}
                {c.deceasedPhone ? ` · ${c.deceasedPhone}` : ''}
                {' · died '}{formatDate(c.dateOfDeath)}
              </div>
              {/* The claimant's number is the only way to reach this family — it
                  reads as a line of its own rather than buried in a detail row. */}
              <div style={{ color: 'var(--color-gray)', fontSize: 12.5, marginTop: 2 }}>
                {c.claimantName} ({c.relationship}) · <a href={`tel:${c.claimantPhone}`} style={{ color: 'var(--color-indigo)', fontWeight: 700 }}>{c.claimantPhone}</a>
              </div>
              <div style={{ color: 'var(--color-gray)', fontSize: 11.5, marginTop: 2 }}>
                {c.reference} · filed {formatDate(c.createdAt)}
              </div>
              {c.notes && (
                <p style={{ color: 'var(--color-gray)', fontSize: 12.5, margin: '6px 0 0', lineHeight: 1.45 }}>{c.notes}</p>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSec}`}
                  style={{ flex: 1 }}
                  onClick={() => openConfirm(c, 'rejected')}
                  disabled={busy}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSec}`}
                  style={{ flex: 1 }}
                  onClick={() => openConfirm(c, 'in_review')}
                  disabled={busy}
                >
                  Review
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPri}`}
                  style={{ flex: 1 }}
                  onClick={() => openConfirm(c, 'approved')}
                  disabled={busy}
                >
                  Approve
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {confirmTarget && (() => {
        const { claim, action } = confirmTarget;
        const meta = REVIEW_LABEL[action];
        const title = `${meta.title} ${claim.reference}?`;
        return (
          <Modal open onClose={() => { if (!busy) setConfirmTarget(null); }} title={title} size="sm" dismissOnBackdrop={!busy}>
            <div style={{ padding: '4px 2px' }}>
              <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>{title}</h3>
              <p style={{ margin: '0 0 16px', color: 'var(--color-gray)', lineHeight: 1.5, fontSize: 14 }}>
                {meta.body(claim)}
              </p>

              {/* Free-text member id, not a lookup: matching a death to a member
                  record is a judgement call, and getting it wrong pays the wrong
                  family. Same reasoning as the desktop panel. */}
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>
                  Matched member ID {action === 'approved' ? '' : '(optional)'}
                </span>
                <div className={styles.field}>
                  <input
                    type="text"
                    value={matchId}
                    onChange={(e) => setMatchId(e.target.value)}
                    placeholder="e.g. s-0001"
                    disabled={busy}
                  />
                </div>
              </label>

              <label style={{ display: 'block', marginBottom: 16 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>Note (optional)</span>
                <div className={styles.field}>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What you checked, or what is still outstanding"
                    disabled={busy}
                  />
                </div>
              </label>

              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={`${styles.btn} ${styles.btnSec}`} style={{ flex: 1 }} onClick={() => setConfirmTarget(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnPri}`} style={{ flex: 1 }} onClick={handleConfirm} disabled={busy}>
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
