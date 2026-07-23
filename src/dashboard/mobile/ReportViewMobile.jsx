import { lazy, Suspense } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import styles from './distributorMobile.module.css';

// Same lazy report views the desktop ViewReports loads — reused verbatim (they
// own their tables + CSV export and are role-agnostic data views).
const REPORT_VIEWS = {
  'distribution-summary': lazy(() => import('../reports/views/DistributionSummary')),
  'all-branches': lazy(() => import('../reports/views/AllBranches')),
  'all-agents': lazy(() => import('../reports/views/AllAgents')),
  'all-subscribers': lazy(() => import('../reports/views/AllSubscribers')),
  'contributions-collections': lazy(() => import('../reports/views/ContributionsCollections')),
  'withdrawals-payouts': lazy(() => import('../reports/views/WithdrawalsPayouts')),
  'branch-performance': lazy(() => import('../reports/views/BranchPerformance')),
  'agent-performance': lazy(() => import('../reports/views/AgentPerformance')),
  'subscriber-growth': lazy(() => import('../reports/views/SubscriberGrowth')),
  'subscriber-demographics': lazy(() => import('../reports/views/SubscriberDemographics')),
  'kyc-compliance': lazy(() => import('../reports/views/KycCompliance')),
};

/**
 * ReportViewMobile — one report (route /dashboard/reports/:reportId). Renders the
 * shared desktop report view inside a horizontally-scrollable container so its
 * wide table works on a phone. The app-bar back returns to the reports list.
 */
export default function ReportViewMobile() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const View = REPORT_VIEWS[reportId];

  if (!View) return <Navigate to="/dashboard/reports" replace />;

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', margin: '0 -4px' }}>
      <Suspense fallback={<div className={styles.loading}><div className={styles.spinner} /></div>}>
        <View onBack={() => navigate('/dashboard/reports')} />
      </Suspense>
    </div>
  );
}
