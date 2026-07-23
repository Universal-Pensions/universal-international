import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../assets/logo.png';
import { useDistributorAppBar } from './distributorAppBarContext';
import styles from './DistributorMobileAppBar.module.css';

const BackIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const InboxIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const SparkIcon = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M8 1.5l1.3 3.9 3.9 1.3-3.9 1.3L8 11.9 6.7 8 2.8 6.7 6.7 5.4 8 1.5z" fill="currentColor" />
  </svg>
);

// Primary bottom-nav tabs: title only (no back), actions shown.
const TAB = {
  '/dashboard/branches': 'Branches',
  '/dashboard/agents': 'Agents',
  '/dashboard/commissions': 'Commissions',
  '/dashboard/subscribers': 'Subscribers',
  '/dashboard/reports': 'Reports',
  '/dashboard/support': 'Support',
  '/dashboard/menu': 'Menu',
};
// Focused-task pages: back + title, NO action cluster.
const FLOW = {
  '/dashboard/settings': 'Settings',
};

function resolve(pathname) {
  if (pathname === '/dashboard') return { left: 'logo', actions: true };
  if (FLOW[pathname]) return { left: 'back', title: FLOW[pathname], actions: false };
  if (TAB[pathname]) return { left: 'title', title: TAB[pathname], actions: true };
  if (pathname.startsWith('/dashboard/branches/')) return { left: 'back', title: 'Branch', actions: true };
  if (pathname.startsWith('/dashboard/agents/')) return { left: 'back', title: 'Agent', actions: true };
  if (pathname.startsWith('/dashboard/subscribers/')) return { left: 'back', title: 'Subscriber', actions: true };
  if (pathname.startsWith('/dashboard/reports/')) return { left: 'back', title: 'Report', actions: false };
  if (pathname.startsWith('/dashboard/support/')) return { left: 'back', title: 'Support', actions: false };
  return { left: 'back', title: '', actions: true };
}

/**
 * DistributorMobileAppBar — the persistent top bar for the distributor-admin
 * PHONE app (<1024px). Left = brand logo on Home, otherwise the section title
 * (with a back arrow on deep/task pages). Right = Support inbox (→ the ticket
 * queue) · Ask AI (opens the Network Copilot). Hidden by the shell on desktop,
 * which uses the map-theme rail shell.
 */
export default function DistributorMobileAppBar({ onOpenAI }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { backRef } = useDistributorAppBar();
  const meta = resolve(location.pathname);

  // A routed page can register a step-back handler; otherwise fall back to back.
  const handleBack = () => (backRef?.current ? backRef.current() : navigate(-1));

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        {meta.left === 'back' && (
          <button type="button" className={styles.backBtn} onClick={handleBack} aria-label="Back">
            {BackIcon}
          </button>
        )}
        {meta.left === 'logo' ? (
          <img src={logo} alt="Universal Pensions" className={styles.logo} />
        ) : (
          <h1 className={styles.title}>{meta.title}</h1>
        )}
      </div>

      {meta.actions && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate('/dashboard/support')}
            aria-label="Support inbox"
          >
            {InboxIcon}
          </button>
          <button
            type="button"
            className={styles.aiBtn}
            onClick={onOpenAI}
            aria-label="Ask AI"
          >
            {SparkIcon}
            <span>Ask AI</span>
          </button>
        </div>
      )}
    </header>
  );
}
