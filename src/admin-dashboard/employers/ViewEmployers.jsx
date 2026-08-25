import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAdminPanel } from '../../contexts/AdminPanelContext';
import { useAllEmployersMetrics } from '../../hooks/useEmployer';
import { formatNumber, formatUGXShort } from '../../utils/currency';
import styles from '../adminPanels.module.css';

/**
 * Admin: platform-wide Employers panel. Lists every employer with a per-employer
 * roster rollup (members, active, AUM, contributions, insured) from the
 * get_all_employers_metrics RPC. "+ New Employer" opens the create form.
 */
export default function ViewEmployers({ fullPage = false }) {
  const {
    viewEmployersOpen, setViewEmployersOpen, setCreateEmployerOpen,
    setDetailEmployerId, setViewEmployerDetailOpen,
  } = useAdminPanel();
  const { data: employers = [], isLoading } = useAllEmployersMetrics();

  // Drill into a single employer — opens the detail card on top of this list
  // (same panel the map drill-down opens). Its back/close returns here.
  const openEmployer = (id) => {
    setDetailEmployerId(id);
    setViewEmployerDetailOpen(true);
  };

  useEffect(() => {
    if (!viewEmployersOpen) return;
    function onKey(e) {
      if (e.key === 'Escape' && !fullPage) setViewEmployersOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewEmployersOpen, setViewEmployersOpen, fullPage]);

  const totals = employers.reduce(
    (acc, e) => ({
      employers: acc.employers + 1,
      members: acc.members + (e.headcount ?? 0),
      contributed: acc.contributed + (e.totalContributions ?? 0),
    }),
    { employers: 0, members: 0, contributed: 0 },
  );

  return (
    <>
      <AnimatePresence>
        {viewEmployersOpen && !fullPage && (
          <motion.div
            key="ve-backdrop"
            className={styles.backdrop}
            initial={{ opacity: 0, pointerEvents: 'auto' }}
            animate={{ opacity: 1, pointerEvents: 'auto' }}
            // Drop pointer-events the instant it starts closing so a slow/frozen
            // exit can never leave the backdrop blocking the map underneath.
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.25 }}
            onClick={() => setViewEmployersOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(viewEmployersOpen || fullPage) && (
          <motion.div
            key="ve-panel"
            className={styles.panel}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : { x: 0, transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            exit={fullPage ? { opacity: 0 } : { x: '100%', transition: { duration: 0.5, ease: EASE_OUT_EXPO } }}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
          >
            <div className={styles.header}>
              <div className={styles.headerTop}>
                <div className={styles.titleWrap}>
                  <h2 className={styles.title}>Employers</h2>
                  <p className={styles.subtitle}>
                    {formatNumber(totals.employers)} employers · {formatNumber(totals.members)} members · {formatUGXShort(totals.contributed)} paid in by members
                  </p>
                </div>
                <button className={styles.newBtn} onClick={() => setCreateEmployerOpen(true)}>
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="16" height="16">
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  New
                </button>
                {!fullPage && (
                  <button className={styles.closeBtn} onClick={() => setViewEmployersOpen(false)} aria-label="Close">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className={styles.body}>
              {isLoading ? (
                <div className={styles.loading}><div className={styles.spinner} /></div>
              ) : employers.length === 0 ? (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon}>
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="26" height="26">
                      <rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
                      <path d="M3 10h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.75" />
                    </svg>
                  </span>
                  <p className={styles.emptyText}>No employers yet. Create the first one to onboard a company.</p>
                </div>
              ) : (
                <div className={styles.list}>
                  {employers.map((e) => (
                    <button
                      type="button"
                      className={styles.row}
                      key={e.id}
                      onClick={() => openEmployer(e.id)}
                      aria-label={`View ${e.name}`}
                      style={{ width: '100%', textAlign: 'left', font: 'inherit', cursor: 'pointer', opacity: e.status === 'inactive' ? 0.62 : 1 }}
                    >
                      <div className={styles.rowHead}>
                        <div>
                          <div className={styles.rowName}>{e.name}</div>
                          <div className={styles.rowSub}>
                            {[e.sector, e.district].filter(Boolean).join(' · ') || 'No sector set'}
                          </div>
                        </div>
                        {e.status === 'inactive' && (
                          <span className={`${styles.statusPill} ${styles.statusInactive}`} style={{ flexShrink: 0 }}>
                            Deactivated
                          </span>
                        )}
                        <span style={{ color: 'var(--color-gray)', flexShrink: 0, display: 'flex' }}>
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                      </div>
                      <div className={styles.rowMetrics}>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{formatNumber(e.headcount ?? 0)}</span>
                          <span className={styles.metricLabel}>Members</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{formatNumber(e.activeCount ?? 0)}</span>
                          <span className={styles.metricLabel}>Active</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{formatUGXShort(e.totalBalance ?? 0)}</span>
                          <span className={styles.metricLabel}>AUM</span>
                        </div>
                        {/* "Paid in by members", NOT "Contributed".
                            get_all_employers_metrics (0049) sums EVERY
                            type='contribution' transaction for this employer's
                            members — payroll runs AND their own personal
                            top-ups. The employer's own dashboard shows
                            run-linked funding only (the A14-001 fix, scoped to
                            that role), so the same company reads 62.4M here and
                            14.59M one click in. Both figures are correct; the
                            label was the thing that made them look
                            contradictory. See
                            docs/audits/2026-08-23/a14/admin-employers-list-inconsistency.md */}
                        <div
                          className={styles.metric}
                          title="Everything this employer's members have paid in — payroll runs plus their own top-ups. The employer's own dashboard shows payroll runs only."
                        >
                          <span className={styles.metricVal}>{formatUGXShort(e.totalContributions ?? 0)}</span>
                          <span className={styles.metricLabel}>Paid in by members</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricVal}>{formatNumber(e.insuredCount ?? 0)}</span>
                          <span className={styles.metricLabel}>Insured</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
