import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAdminPanel } from '../../contexts/AdminPanelContext';
import { useAllEntities, usePlatformOverview, useSetDistributorStatus } from '../../hooks/useEntity';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber, formatUGXShort } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import Modal from '../../components/Modal';
import styles from '../adminPanels.module.css';

/**
 * Admin: platform-wide Distributors panel. Shows platform totals from
 * get_platform_overview (true counts incl. employer-onboarded subscribers, not
 * the agent-tree-only country rollup) plus a list of distributor entities, each
 * with profile + status. "+ New Distributor" opens the create form.
 *
 * NOTE: per-distributor rollups (subscribers/agents/branches per distributor)
 * are intentionally absent — the schema does not partition the network by
 * distributor (branches have no distributor_id; distributors hang off 'ug' as a
 * flat catalog), so only platform-wide totals + a distributor count are honest.
 */
export default function ViewDistributors() {
  const { viewDistributorsOpen, setViewDistributorsOpen, setCreateDistributorOpen } = useAdminPanel();
  const { data: distributors = [], isLoading } = useAllEntities('distributor');
  const { data: platform } = usePlatformOverview();
  const setStatus = useSetDistributorStatus();
  const { addToast } = useToast();
  // The distributor whose deactivate/reactivate is awaiting confirmation.
  const [confirmTarget, setConfirmTarget] = useState(null);

  useEffect(() => {
    if (!viewDistributorsOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') setViewDistributorsOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewDistributorsOpen, setViewDistributorsOpen]);

  async function handleConfirm() {
    if (!confirmTarget) return;
    const next = confirmTarget.status === 'inactive' ? 'active' : 'inactive';
    try {
      await setStatus.mutateAsync({ id: confirmTarget.id, status: next });
      addToast('success', next === 'active' ? 'Distributor reactivated.' : 'Distributor deactivated.');
      setConfirmTarget(null);
    } catch (err) {
      addToast('error', err?.message || 'Could not update status.');
    }
  }

  const platformKpis = [
    { label: 'Distributors', value: formatNumber(platform?.distributors ?? 0) },
    { label: 'Branches', value: formatNumber(platform?.branches ?? 0) },
    { label: 'Agents', value: formatNumber(platform?.agents ?? 0) },
    { label: 'Subscribers', value: formatNumber(platform?.totalSubscribers ?? 0) },
    { label: 'AUM', value: formatUGXShort(platform?.aum ?? 0) },
  ];

  return (
    <>
      <AnimatePresence>
        {viewDistributorsOpen && (
          <motion.div
            key="vd-backdrop"
            className={styles.backdrop}
            initial={{ opacity: 0, pointerEvents: 'auto' }}
            animate={{ opacity: 1, pointerEvents: 'auto' }}
            // Drop pointer-events the instant it starts closing so a slow/frozen
            // exit (e.g. backgrounded tab) can never leave the backdrop blocking
            // the map underneath.
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.25 }}
            onClick={() => setViewDistributorsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewDistributorsOpen && (
          <motion.div
            key="vd-panel"
            className={styles.panel}
            initial={{ x: '100%' }}
            animate={{ x: 0, transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            exit={{ x: '100%', transition: { duration: 0.5, ease: EASE_OUT_EXPO } }}
          >
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <div className={styles.titleWrap}>
                  <h2 className={styles.title}>Distributors</h2>
                  <p className={styles.subtitle}>Network operators across the platform</p>
                </div>
                <button className={styles.newBtn} onClick={() => setCreateDistributorOpen(true)}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="16" height="16">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  New
                </button>
                <button className={styles.closeBtn} onClick={() => setViewDistributorsOpen(false)} aria-label="Close">
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={styles.body}>
              {/* Network totals — the national distributor's reach = the platform. */}
              <div className={styles.rowMetrics} style={{ marginBottom: 'var(--space-5)' }}>
                {platformKpis.map((k) => (
                  <div className={styles.metric} key={k.label}>
                    <span className={styles.metricVal}>{k.value}</span>
                    <span className={styles.metricLabel}>{k.label}</span>
                  </div>
                ))}
              </div>

              {isLoading ? (
                <div className={styles.loading}><div className={styles.spinner} /></div>
              ) : distributors.length === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="26" height="26">
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
                      <circle cx="12" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                      <circle cx="12" cy="20" r="1.5" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                  </span>
                  <p className={styles.emptyText}>No distributors yet. Create the first one to get started.</p>
                </div>
              ) : (
                <div className={styles.list}>
                  {distributors.map((d) => (
                    <div className={styles.row} key={d.id}>
                      <div className={styles.rowHead}>
                        <div>
                          <div className={styles.rowName}>{d.name}</div>
                          <div className={styles.rowSub}>
                            {d.managerName ? d.managerName : 'No manager set'}
                            {d.managerPhone ? ` · ${d.managerPhone}` : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                          <span
                            className={`${styles.statusPill} ${d.status === 'inactive' ? styles.statusInactive : styles.statusActive}`}
                          >
                            {d.status === 'inactive' ? 'Deactivated' : 'Active'}
                          </span>
                          <button
                            type="button"
                            className={d.status === 'inactive' ? styles.activateBtn : styles.deactivateBtn}
                            onClick={() => setConfirmTarget(d)}
                          >
                            {d.status === 'inactive' ? 'Reactivate' : 'Deactivate'}
                          </button>
                        </div>
                      </div>
                      <div className={styles.rowMetrics}>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{d.parentId || 'ug'}</span>
                          <span className={styles.metricLabel}>Parent</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{d.managerEmail ? '✓' : '—'}</span>
                          <span className={styles.metricLabel}>Email on file</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{formatDate(d.createdAt)}</span>
                          <span className={styles.metricLabel}>Created</span>
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
        const isActive = confirmTarget.status !== 'inactive';
        const title = isActive ? `Deactivate ${confirmTarget.name}?` : `Reactivate ${confirmTarget.name}?`;
        return (
          <Modal
            open
            onClose={() => { if (!setStatus.isPending) setConfirmTarget(null); }}
            title={title}
            size="sm"
            dismissOnBackdrop={!setStatus.isPending}
          >
            <div className={styles.confirmDialog}>
              <h3 className={styles.confirmTitle}>{title}</h3>
              <p className={styles.confirmBody}>
                {isActive
                  ? 'Its branches and agents will be deactivated, and every subscriber under this distributor will be reset to self-onboarded — they stay active and keep their pension.'
                  : 'This reactivates the distributor, its branches, and its agents. Subscribers that were reset to self-onboarded are not re-linked.'}
              </p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setConfirmTarget(null)} disabled={setStatus.isPending}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={isActive ? styles.deactivateBtn : styles.activateBtn}
                  onClick={handleConfirm}
                  disabled={setStatus.isPending}
                >
                  {setStatus.isPending ? 'Working…' : isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
