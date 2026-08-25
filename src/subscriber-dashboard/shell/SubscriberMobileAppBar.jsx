import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../assets/logo.png';
import { useSubscriberAppBar } from './subscriberAppBarContext';
import styles from './SubscriberMobileAppBar.module.css';

const BackIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const HelpIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path d="M9.4 9a2.6 2.6 0 1 1 3.7 2.4c-.8.4-1.1 1-1.1 1.8M12 17h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const BellIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const SparkIcon = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M8 1.5l1.3 3.9 3.9 1.3-3.9 1.3L8 11.9 6.7 8 2.8 6.7 6.7 5.4 8 1.5z" fill="currentColor" />
  </svg>
);

// Money-flow deep pages: back + title, NO action cluster (mirrors the mockup's
// actions:false on save/withdraw-form/claim — those screens are focused tasks).
const FLOW = {
  '/dashboard/save': 'Save',
  '/dashboard/save/schedule': 'Contribution settings',
  '/dashboard/withdraw/savings': 'Withdraw savings',
  '/dashboard/withdraw/claim': 'File a claim',
};
// Primary bottom-nav tabs: title only (no back), actions shown.
const TAB = {
  '/dashboard/activity': 'Activity',
  '/dashboard/withdraw': 'Withdraw',
  '/dashboard/settings': 'Profile',
};
// Other secondary pages: back + title, actions shown.
const SECONDARY = {
  '/dashboard/reports': 'Analytics',
  // The 5 report sub-views (A10-004 / A18-006). Without these, every one of
  // them fell through to the generic '/dashboard/reports/' fallback below and
  // rendered the same "Analytics" <h1> — the report's own header is
  // deliberately suppressed on mobile (ReportsPage.jsx's ReportsHeader
  // returns null below 1024px), so that shared fallback was the ONLY heading
  // on screen for all five routes. Titles match ReportsPage.jsx's REPORT_TITLES
  // (the desktop-canonical name for each report) so mobile never says
  // something different from desktop for the same route.
  '/dashboard/reports/all-transactions':      'All Transactions',
  '/dashboard/reports/contributions-summary': 'Contributions Summary',
  '/dashboard/reports/withdrawals-history':   'Withdrawals',
  '/dashboard/reports/insurance-statement':   'Insurance Statement',
  '/dashboard/reports/annual-statement':      'Annual Tax Statement',
  '/dashboard/policies': 'Policies',
  '/dashboard/help': 'Help',
  '/dashboard/agent': 'Your agent',
  '/dashboard/settings/profile': 'Edit profile',
  '/dashboard/settings/nominees': 'Nominees',
  '/dashboard/settings/insurance': 'Insurance',
};

function resolve(pathname) {
  if (pathname === '/dashboard') return { left: 'logo', actions: true };
  if (FLOW[pathname]) return { left: 'back', title: FLOW[pathname], actions: false };
  if (TAB[pathname]) return { left: 'title', title: TAB[pathname], actions: true };
  let title = SECONDARY[pathname];
  if (!title && pathname.startsWith('/dashboard/reports/')) title = 'Analytics';
  return { left: 'back', title: title || '', actions: true };
}

/**
 * SubscriberMobileAppBar — the persistent top bar for the subscriber PHONE app
 * (<1024px). Left = brand logo on Home, otherwise the section title (with a back
 * arrow on deep pages). Right = Help · Notifications (amber unread dot) · Ask AI,
 * each opening a bottom sheet. Hidden by the shell on desktop, which uses its own
 * SubscriberDesktopShell chrome.
 */
export default function SubscriberMobileAppBar({ unread = 0, onOpenHelp, onOpenNotif, onOpenAI }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { backRef } = useSubscriberAppBar();
  const meta = resolve(location.pathname);

  // A routed page can register a step-back handler (e.g. ClaimPage's multi-step
  // flow); otherwise fall back to browser back.
  const handleBack = () => (backRef?.current ? backRef.current() : navigate(-1));

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        {meta.left === 'back' && (
          <button
            type="button"
            className={styles.backBtn}
            onClick={handleBack}
            aria-label="Back"
          >
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
          <button type="button" className={styles.iconBtn} onClick={onOpenHelp} aria-label="Help">
            {HelpIcon}
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenNotif}
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          >
            {BellIcon}
            {unread > 0 && <span className={styles.badge} aria-hidden="true" />}
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
