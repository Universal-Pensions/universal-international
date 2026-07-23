import { NavLink } from 'react-router-dom';
import styles from './distributorMobile.module.css';

const DocIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" strokeLinecap="round" />
  </svg>
);
const ChevIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Mirrors ViewReports' REPORT_VIEWS keys; each opens /dashboard/reports/:id which
// renders the same lazy report view the desktop uses.
const REPORTS = [
  { id: 'distribution-summary', title: 'Distribution Summary', sub: 'Network overview' },
  { id: 'all-branches', title: 'All Branches', sub: 'Full branch roster' },
  { id: 'all-agents', title: 'All Agents', sub: 'Full agent roster' },
  { id: 'all-subscribers', title: 'All Subscribers', sub: 'Member directory' },
  { id: 'contributions-collections', title: 'Contributions & Collections', sub: 'Inflows over time' },
  { id: 'withdrawals-payouts', title: 'Withdrawals & Payouts', sub: 'Outflows over time' },
  { id: 'branch-performance', title: 'Branch Performance', sub: 'Ranked by health' },
  { id: 'agent-performance', title: 'Agent Performance', sub: 'Ranked by output' },
  { id: 'subscriber-growth', title: 'Subscriber Growth', sub: 'Enrolment trend' },
  { id: 'subscriber-demographics', title: 'Subscriber Demographics', sub: 'Who is saving' },
  { id: 'kyc-compliance', title: 'KYC & Compliance', sub: 'Verification status' },
];

/**
 * ReportsMobile — the distributor's Reports surface (route /dashboard/reports).
 * A dedicated mobile list of the same 11 reports as desktop; each opens the
 * shared lazy report view (with its own table + CSV export) at
 * /dashboard/reports/:reportId.
 */
export default function ReportsMobile() {
  return (
    <>
      <section className={styles.card} aria-label="Reports">
        <header className={styles.cardHd}><h3>Reports</h3><span className={styles.tag}>Network</span></header>
        {REPORTS.map((r) => (
          <NavLink to={`/dashboard/reports/${r.id}`} key={r.id} className={styles.lrow}>
            <span className={`${styles.lIc} ${styles.tintIndigo}`} aria-hidden="true">{DocIcon}</span>
            <span className={styles.lMid}>
              <b>{r.title}</b>
              <small>{r.sub}</small>
            </span>
            <span className={styles.chev}>{ChevIcon}</span>
          </NavLink>
        ))}
      </section>
      <p className={styles.ver}>Tap a report to view its table and download the data.</p>
    </>
  );
}
