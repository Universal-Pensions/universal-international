import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAdminPanel } from '../../contexts/AdminPanelContext';
import {
  useAccessRequests,
  useApproveAccessRequest,
  useDenyAccessRequest,
} from '../../hooks/useAccessRequests';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import Modal from '../../components/Modal';
import styles from '../adminPanels.module.css';

/**
 * Admin: pending employer/distributor access requests. These come from the
 * public request-access lead form (persisted to `access_requests`). Each row can
 * be Approved — which provisions the real account via create_distributor /
 * create_employer, so it appears in the Distributors/Employers managers — or
 * Denied. Mirrors the ViewDistributors panel/fullPage pattern.
 */
export default function ViewAccessRequests({ fullPage = false }) {
  const { viewAccessRequestsOpen, setViewAccessRequestsOpen } = useAdminPanel();
  const { data: requests = [], isLoading } = useAccessRequests('pending');
  const approve = useApproveAccessRequest();
  const deny = useDenyAccessRequest();
  const { addToast } = useToast();
  // The request awaiting a decision: { request, action: 'approve' | 'deny' }.
  const [confirmTarget, setConfirmTarget] = useState(null);
  const busy = approve.isPending || deny.isPending;

  useEffect(() => {
    if (!viewAccessRequestsOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape' && !fullPage) setViewAccessRequestsOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewAccessRequestsOpen, setViewAccessRequestsOpen, fullPage]);

  async function handleConfirm() {
    if (!confirmTarget) return;
    const { request, action } = confirmTarget;
    try {
      if (action === 'approve') {
        await approve.mutateAsync(request.id);
        addToast(
          'success',
          request.kind === 'distributor'
            ? `${request.orgName} approved — distributor account created.`
            : `${request.orgName} approved — employer account created.`,
        );
      } else {
        await deny.mutateAsync(request.id);
        addToast('success', `Request from ${request.orgName} denied.`);
      }
      setConfirmTarget(null);
    } catch (err) {
      addToast('error', err?.message || 'Could not update the request.');
    }
  }

  const pendingEmployers = requests.filter((r) => r.kind === 'employer').length;
  const pendingDistributors = requests.filter((r) => r.kind === 'distributor').length;
  const kpis = [
    { label: 'Pending', value: formatNumber(requests.length) },
    { label: 'Employers', value: formatNumber(pendingEmployers) },
    { label: 'Distributors', value: formatNumber(pendingDistributors) },
  ];

  return (
    <>
      <AnimatePresence>
        {viewAccessRequestsOpen && !fullPage && (
          <motion.div
            key="var-backdrop"
            className={styles.backdrop}
            initial={{ opacity: 0, pointerEvents: 'auto' }}
            animate={{ opacity: 1, pointerEvents: 'auto' }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.25 }}
            onClick={() => setViewAccessRequestsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(viewAccessRequestsOpen || fullPage) && (
          <motion.div
            key="var-panel"
            className={styles.panel}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : { x: 0, transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            exit={fullPage ? { opacity: 0 } : { x: '100%', transition: { duration: 0.5, ease: EASE_OUT_EXPO } }}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
          >
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <div className={styles.titleWrap}>
                  <h2 className={styles.title}>Access requests</h2>
                  <p className={styles.subtitle}>Employer &amp; distributor sign-up requests awaiting approval</p>
                </div>
                {!fullPage && (
                  <button className={styles.closeBtn} onClick={() => setViewAccessRequestsOpen(false)} aria-label="Close">
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
              ) : requests.length === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="26" height="26">
                      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </span>
                  <p className={styles.emptyText}>No pending access requests. New employer &amp; distributor requests will appear here.</p>
                </div>
              ) : (
                <div className={styles.list}>
                  {requests.map((r) => (
                    <div className={styles.row} key={r.id}>
                      <div className={styles.rowHead}>
                        <div>
                          <div className={styles.rowName}>{r.orgName}</div>
                          <div className={styles.rowSub}>
                            {r.contactName ? r.contactName : 'No contact name'}
                            {r.contactEmail ? ` · ${r.contactEmail}` : ''}
                            {r.contactPhone ? ` · ${r.contactPhone}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                          <span className={`${styles.statusPill} ${r.kind === 'distributor' ? styles.statusActive : styles.statusInactive}`}>
                            {r.kind === 'distributor' ? 'Distributor' : 'Employer'}
                          </span>
                          <button
                            type="button"
                            className={styles.deactivateBtn}
                            onClick={() => setConfirmTarget({ request: r, action: 'deny' })}
                            disabled={busy}
                          >
                            Deny
                          </button>
                          <button
                            type="button"
                            className={styles.activateBtn}
                            onClick={() => setConfirmTarget({ request: r, action: 'approve' })}
                            disabled={busy}
                          >
                            Approve
                          </button>
                        </div>
                      </div>
                      <div className={styles.rowMetrics}>
                        {/* Captured for BOTH kinds since 0095 — it rides through
                            to create_employer / create_distributor on approve,
                            so the admin should see it before deciding. */}
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{r.registrationNo || '—'}</span>
                          <span className={styles.metricLabel}>Reg. no.</span>
                        </div>
                        {r.kind === 'employer' && (
                          <div className={styles.metric}>
                            <span className={styles.metricVal}>{r.sector || '—'}</span>
                            <span className={styles.metricLabel}>Sector</span>
                          </div>
                        )}
                        {r.kind === 'employer' && (
                          <div className={styles.metric}>
                            <span className={styles.metricVal}>{r.district || '—'}</span>
                            <span className={styles.metricLabel}>District</span>
                          </div>
                        )}
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{r.contactEmail ? '✓' : '—'}</span>
                          <span className={styles.metricLabel}>Email on file</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{formatDate(r.createdAt)}</span>
                          <span className={styles.metricLabel}>Requested</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmTarget && (() => {
        const { request, action } = confirmTarget;
        const isApprove = action === 'approve';
        const kindLabel = request.kind === 'distributor' ? 'distributor' : 'employer';
        const title = isApprove ? `Approve ${request.orgName}?` : `Deny ${request.orgName}?`;
        return (
          <Modal
            open
            onClose={() => { if (!busy) setConfirmTarget(null); }}
            title={title}
            size="sm"
            dismissOnBackdrop={!busy}
          >
            <div className={styles.confirmDialog}>
              <h3 className={styles.confirmTitle}>{title}</h3>
              <p className={styles.confirmBody}>
                {isApprove
                  ? `This creates a live ${kindLabel} account for ${request.orgName}, which will appear in the ${request.kind === 'distributor' ? 'Distributors' : 'Employers'} manager. The requester can then be onboarded.`
                  : `This declines the request from ${request.orgName}. No account is created. This can't be undone from here.`}
              </p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setConfirmTarget(null)} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={isApprove ? styles.activateBtn : styles.deactivateBtn}
                  onClick={handleConfirm}
                  disabled={busy}
                >
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
