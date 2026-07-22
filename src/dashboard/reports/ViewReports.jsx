import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useDashboard } from '../../contexts/DashboardContext';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import ReportsHub from './ReportsHub';
import styles from './ViewReports.module.css';

/* ─── Lazy-load individual report views ──────────────────────────────── */

const REPORT_VIEWS = {
  'distribution-summary': lazy(() => import('./views/DistributionSummary')),
  'all-branches': lazy(() => import('./views/AllBranches')),
  'all-agents': lazy(() => import('./views/AllAgents')),
  'all-subscribers': lazy(() => import('./views/AllSubscribers')),
  'contributions-collections': lazy(() => import('./views/ContributionsCollections')),
  'withdrawals-payouts': lazy(() => import('./views/WithdrawalsPayouts')),
  'branch-performance': lazy(() => import('./views/BranchPerformance')),
  'agent-performance': lazy(() => import('./views/AgentPerformance')),
  'subscriber-growth': lazy(() => import('./views/SubscriberGrowth')),
  'subscriber-demographics': lazy(() => import('./views/SubscriberDemographics')),
  'kyc-compliance': lazy(() => import('./views/KycCompliance')),
};

const REPORT_TITLES = {
  'distribution-summary': 'Distribution Summary',
  'all-branches': 'All Branches',
  'all-agents': 'All Agents',
  'all-subscribers': 'All Subscribers',
  'contributions-collections': 'Contributions & Collections',
  'withdrawals-payouts': 'Withdrawals & Payouts',
  'branch-performance': 'Branch Performance',
  'agent-performance': 'Agent Performance',
  'subscriber-growth': 'Subscriber Growth',
  'subscriber-demographics': 'Subscriber Demographics',
  'kyc-compliance': 'KYC & Compliance',
};

function ReportLoading() {
  return (
    <div className={styles.loading}>
      <div className={styles.spinner} />
    </div>
  );
}

export default function ViewReports({ splitMode = false, fullPage = false }) {
  const { viewReportsOpen, setViewReportsOpen, reportContext, setReportContext } = useDashboard();
  const { branchId } = useBranchScope();
  const [activeReportId, setActiveReportId] = useState(null);
  const bodyRef = useRef(null);

  // Auto-navigate to a report when the panel was opened via reportContext.
  // Tracking the last consumed context lets us perform the sync at render
  // time (no cascading effect) and clear the context once consumed.
  const [consumedContext, setConsumedContext] = useState(null);
  if (viewReportsOpen && reportContext && reportContext !== consumedContext) {
    setConsumedContext(reportContext);
    setActiveReportId(reportContext);
  }

  // Clearing the shared context value is an external sync — keep it in an
  // effect, but only fire it once the value has actually been consumed.
  useEffect(() => {
    if (reportContext && reportContext === consumedContext) {
      setReportContext(null);
    }
  }, [reportContext, consumedContext, setReportContext]);

  // Reset state when panel closes (delayed so exit animation finishes first).
  useEffect(() => {
    if (viewReportsOpen) return;
    const t = setTimeout(() => {
      setActiveReportId(null);
      setConsumedContext(null);
    }, 400);
    return () => clearTimeout(t);
  }, [viewReportsOpen]);

  // Scroll to top when switching views
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
  }, [activeReportId]);

  // Escape key to close
  useEffect(() => {
    if (!viewReportsOpen) return;
    function onKey(e) {
      if (e.key === 'Escape' && !fullPage) setViewReportsOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewReportsOpen, setViewReportsOpen, fullPage]);

  function handleBack() {
    setActiveReportId(null);
  }

  const headerTitle = activeReportId ? REPORT_TITLES[activeReportId] || 'Report' : 'Reports';
  const headerSubtitle = activeReportId
    ? null
    : (branchId ? 'Branch overview and analytics' : 'Network overview and analytics');

  const ActiveReportComponent = activeReportId ? REPORT_VIEWS[activeReportId] : null;

  return (
    <>
      <AnimatePresence>
        {viewReportsOpen && !splitMode && !fullPage && (
          <motion.div
            key="vr-backdrop"
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={() => setViewReportsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(viewReportsOpen || fullPage) && (
          <motion.div
            key="vr-panel"
            className={styles.panel}
            data-split-mode={splitMode || undefined}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : {
              x: 0,
              transition: { duration: 0.55, ease: EASE_OUT_EXPO },
            }}
            exit={fullPage ? { opacity: 0 } : {
              x: '100%',
              transition: { duration: 0.55, ease: EASE_OUT_EXPO },
            }}
          >
            {/* ── Header ──────────────────────────────────────────── */}
            <div className={styles.header}>
              <div className={styles.headerTop}>
                {activeReportId && (
                  <button className={styles.backBtn} onClick={handleBack} aria-label="Back to reports">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <div style={{ flex: 1 }}>
                  <AnimatePresence mode="wait">
                    <motion.h2
                      key={headerTitle}
                      className={styles.title}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                    >
                      {headerTitle}
                    </motion.h2>
                  </AnimatePresence>
                  {headerSubtitle && <p className={styles.subtitle}>{headerSubtitle}</p>}
                </div>
                {!fullPage && (
                  <button className={styles.closeBtn} onClick={() => setViewReportsOpen(false)} aria-label="Close">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* ── Body ────────────────────────────────────────────── */}
            <div className={styles.body} ref={bodyRef}>
              {!activeReportId ? (
                <ReportsHub panelMode onSelectReport={setActiveReportId} />
              ) : ActiveReportComponent ? (
                <Suspense fallback={<ReportLoading />}>
                  <ActiveReportComponent onBack={handleBack} />
                </Suspense>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
