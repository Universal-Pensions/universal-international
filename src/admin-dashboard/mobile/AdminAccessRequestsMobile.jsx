import { useState } from 'react';
import {
  useAccessRequests,
  useApproveAccessRequest,
  useDenyAccessRequest,
} from '../../hooks/useAccessRequests';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import Modal from '../../components/Modal';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

/**
 * AdminAccessRequestsMobile — the phone view of pending employer/distributor
 * access requests (route /dashboard/access-requests). Reuses the same hooks as
 * the desktop ViewAccessRequests panel: Approve provisions the real account,
 * Deny declines. A confirm Modal guards both.
 */
export default function AdminAccessRequestsMobile() {
  const { data: requests = [], isLoading, isError, error, refetch } = useAccessRequests('pending');
  const approve = useApproveAccessRequest();
  const deny = useDenyAccessRequest();
  const { addToast } = useToast();
  const [confirmTarget, setConfirmTarget] = useState(null);
  const busy = approve.isPending || deny.isPending;

  async function handleConfirm() {
    if (!confirmTarget) return;
    const { request, action } = confirmTarget;
    try {
      if (action === 'approve') {
        await approve.mutateAsync(request.id);
        addToast('success', `${request.orgName} approved — ${request.kind} account created.`);
      } else {
        await deny.mutateAsync(request.id);
        addToast('success', `Request from ${request.orgName} denied.`);
      }
      setConfirmTarget(null);
    } catch (err) {
      addToast('error', err?.message || 'Could not update the request.');
    }
  }

  if (isError) {
    return <ErrorCard title="We couldn't load access requests" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && requests.length === 0) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  return (
    <>
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Access requests summary">
        <div className={styles.statStrip}>
          <div><b>{formatNumber(requests.length)}</b><small>Pending</small></div>
          <div><b>{formatNumber(requests.filter((r) => r.kind === 'employer').length)}</b><small>Employers</small></div>
          <div><b>{formatNumber(requests.filter((r) => r.kind === 'distributor').length)}</b><small>Distributors</small></div>
        </div>
      </section>

      <section className={styles.card} aria-label="Pending requests">
        {requests.length === 0 ? (
          <div className={styles.empty}><b>No pending requests</b><p>New employer &amp; distributor requests appear here.</p></div>
        ) : (
          requests.map((r) => (
            <div key={r.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--color-lavender)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <b style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{r.orgName}</b>
                <span className={styles.stBadge} data-status={r.kind === 'distributor' ? 'active' : 'inactive'}>
                  {r.kind === 'distributor' ? 'Distributor' : 'Employer'}
                </span>
              </div>
              <div style={{ color: 'var(--color-gray)', fontSize: 12.5, marginTop: 2 }}>
                {[r.contactName, r.contactEmail, r.contactPhone].filter(Boolean).join(' · ') || 'No contact details'}
              </div>
              {r.kind === 'employer' && (r.sector || r.district) && (
                <div style={{ color: 'var(--color-gray)', fontSize: 12.5, marginTop: 2 }}>
                  {[r.sector, r.district].filter(Boolean).join(' · ')}
                </div>
              )}
              {/* Captured for both kinds since 0095 and carried into the
                  create_* RPC on approve — show it before the admin decides. */}
              {r.registrationNo && (
                <div style={{ color: 'var(--color-gray)', fontSize: 12.5, marginTop: 2 }}>
                  Reg. no. {r.registrationNo}
                </div>
              )}
              <div style={{ color: 'var(--color-gray)', fontSize: 11.5, marginTop: 2 }}>Requested {formatDate(r.createdAt)}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSec}`}
                  style={{ flex: 1 }}
                  onClick={() => setConfirmTarget({ request: r, action: 'deny' })}
                  disabled={busy}
                >
                  Deny
                </button>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPri}`}
                  style={{ flex: 1 }}
                  onClick={() => setConfirmTarget({ request: r, action: 'approve' })}
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
        const { request, action } = confirmTarget;
        const isApprove = action === 'approve';
        const title = isApprove ? `Approve ${request.orgName}?` : `Deny ${request.orgName}?`;
        return (
          <Modal open onClose={() => { if (!busy) setConfirmTarget(null); }} title={title} size="sm" dismissOnBackdrop={!busy}>
            <div style={{ padding: '4px 2px' }}>
              <h3 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>{title}</h3>
              <p style={{ margin: '0 0 16px', color: 'var(--color-gray)', lineHeight: 1.5, fontSize: 14 }}>
                {isApprove
                  ? `This creates a live ${request.kind} account for ${request.orgName}.`
                  : `This declines the request from ${request.orgName}. No account is created.`}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className={`${styles.btn} ${styles.btnSec}`} style={{ flex: 1 }} onClick={() => setConfirmTarget(null)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnPri}`} style={{ flex: 1 }} onClick={handleConfirm} disabled={busy}>
                  {busy ? 'Working…' : isApprove ? 'Approve & create' : 'Deny'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
