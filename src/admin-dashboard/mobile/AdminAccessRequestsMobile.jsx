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
              {/* Kind BEFORE the org name, in its own palette. `stBadge`
                  data-status="active"/"inactive" is the green/grey status
                  vocabulary used elsewhere on this screen — borrowing it for
                  kind made a distributor read as "healthy" rather than as a
                  different kind of account. */}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--font-display)', fontSize: 10.5, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                padding: '2px 8px', borderRadius: 999, marginBottom: 4,
                background: r.kind === 'distributor'
                  ? 'color-mix(in srgb, var(--color-teal) 13%, transparent)'
                  : 'color-mix(in srgb, var(--color-indigo) 12%, transparent)',
                color: r.kind === 'distributor' ? 'var(--color-teal-ink)' : 'var(--color-indigo-deep)',
              }}
              >
                {r.kind === 'distributor' ? 'Distributor' : 'Employer'}
              </span>
              <div>
                <b style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>{r.orgName}</b>
              </div>
              <div style={{ color: 'var(--color-gray)', fontSize: 12.5, marginTop: 2 }}>
                {[r.contactName, r.contactEmail, r.contactPhone].filter(Boolean).join(' · ') || 'No contact details'}
              </div>
              {/* District rides on BOTH kinds since 0140; sector stays
                  employer-only and the office address distributor-only. */}
              {[r.sector, r.district, r.physicalAddress].some(Boolean) && (
                <div style={{ color: 'var(--color-gray)', fontSize: 12.5, marginTop: 2 }}>
                  {[
                    r.kind === 'employer' ? r.sector : null,
                    r.district,
                    r.kind === 'distributor' ? r.physicalAddress : null,
                  ].filter(Boolean).join(' · ')}
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
