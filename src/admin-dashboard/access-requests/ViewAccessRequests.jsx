import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAdminPanel } from '../../contexts/AdminPanelContext';
import {
  useAccessRequests,
  useApproveAccessRequest,
  useDenyAccessRequest,
} from '../../hooks/useAccessRequests';
import { PillChip, PillChipGroup } from '../../components/PillChip';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import Modal from '../../components/Modal';
import styles from '../adminPanels.module.css';

// Employer and distributor requests sit in ONE list and are provisioned by two
// different RPCs into two different managers, so telling them apart is the
// first thing the admin has to do on this screen. Previously the only signal
// was a pill reusing `.statusActive` / `.statusInactive` — the ACTIVE/DEACTIVATED
// green-vs-grey used everywhere else in this panel — parked at the far right
// next to Deny/Approve. Green read as "healthy", not "distributor".
//
// So kind gets its own vocabulary: an icon + a stated word, in indigo vs teal
// (neither of which means "status" anywhere in this dashboard), rendered at the
// START of the row where the eye lands first.
const KIND_META = {
  distributor: {
    label: 'Distributor',
    blurb: 'Network operator — branches & agents',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none"
        stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="19" r="2.4" /><circle cx="19" cy="19" r="2.4" />
        <path d="M12 7.4v4.2M12 11.6L6.4 16.8M12 11.6l5.6 5.2" />
      </svg>
    ),
  },
  employer: {
    label: 'Employer',
    blurb: 'Company enrolling its staff',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none"
        stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="8" width="18" height="12" rx="1.8" />
        <path d="M8 8V5.6A1.6 1.6 0 019.6 4h4.8A1.6 1.6 0 0116 5.6V8M3 13h18" />
      </svg>
    ),
  },
};

const KIND_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'employer', label: 'Employers' },
  { id: 'distributor', label: 'Distributors' },
];

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
  const [kindFilter, setKindFilter] = useState('all');
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
  const visible = kindFilter === 'all' ? requests : requests.filter((r) => r.kind === kindFilter);

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

              {!isLoading && requests.length > 0 && (
                <PillChipGroup label="Request type" layout="row" className={styles.kindFilter}>
                  {KIND_FILTERS.map((f) => (
                    <PillChip
                      key={f.id}
                      selected={kindFilter === f.id}
                      onClick={() => setKindFilter(f.id)}
                    >
                      {f.label}
                      {f.id !== 'all' && ` (${f.id === 'employer' ? pendingEmployers : pendingDistributors})`}
                    </PillChip>
                  ))}
                </PillChipGroup>
              )}

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
              ) : visible.length === 0 ? (
                /* Filtered to nothing — distinct from "nothing pending at all",
                   which would otherwise read as an empty inbox. */
                <div className={styles.empty}>
                  <p className={styles.emptyText}>
                    No pending {kindFilter === 'distributor' ? 'distributor' : 'employer'} requests.
                    {' '}
                    <button type="button" className={styles.linkBtn} onClick={() => setKindFilter('all')}>
                      Show all {requests.length}
                    </button>
                  </p>
                </div>
              ) : (
                <div className={styles.list}>
                  {visible.map((r) => {
                    const kind = KIND_META[r.kind] ?? KIND_META.employer;
                    return (
                    <div className={styles.row} key={r.id}>
                      <div className={styles.rowHead}>
                        <div>
                          {/* Kind leads the row — see KIND_META. */}
                          <span className={`${styles.kindPill} ${r.kind === 'distributor' ? styles.kindDistributor : styles.kindEmployer}`}>
                            {kind.icon}
                            {kind.label}
                          </span>
                          <div className={styles.rowName}>{r.orgName}</div>
                          <div className={styles.rowSub}>
                            {kind.blurb}
                            {' · '}
                            {r.contactName ? r.contactName : 'No contact name'}
                            {r.contactEmail ? ` · ${r.contactEmail}` : ''}
                            {r.contactPhone ? ` · ${r.contactPhone}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
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
                        {/* District now rides on BOTH kinds (0140). A "—" on a
                            distributor means the request predates the form
                            field — approve still works, it just provisions
                            without geography. */}
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{r.district || '—'}</span>
                          <span className={styles.metricLabel}>District</span>
                        </div>
                        {r.kind === 'distributor' && (
                          <div className={styles.metric}>
                            <span className={styles.metricVal}>{r.physicalAddress || '—'}</span>
                            <span className={styles.metricLabel}>Office address</span>
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
                    );
                  })}
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
