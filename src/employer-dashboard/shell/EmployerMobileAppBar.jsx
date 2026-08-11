import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../assets/logo.png';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useEmployerTicketMetrics } from '../../hooks/useTickets';
import { useEmployerAppBar } from './employerAppBarContext';
import NotificationBell from '../../components/notifications/NotificationBell';
import styles from './EmployerMobileAppBar.module.css';

const BackIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
// Speech-bubble glyph — the employer's "Inbox" is the support conversation list.
const InboxIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const SparkIcon = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M8 1.5l1.3 3.9 3.9 1.3-3.9 1.3L8 11.9 6.7 8 2.8 6.7 6.7 5.4 8 1.5z" fill="currentColor" />
  </svg>
);

// Focused-task pages: back + title, NO action cluster (tasks, not browsing).
const FLOW = {
  '/dashboard/onboard': 'Onboard staff',
  '/dashboard/settings': 'Settings',
};
// Primary bottom-nav tabs: title only (no back), actions shown.
const TAB = {
  '/dashboard/employees': 'Staff',
  '/dashboard/analytics': 'Analytics',
  '/dashboard/runs': 'Contribution runs',
  '/dashboard/profile': 'Company',
};
// Other secondary pages: back + title.
const SECONDARY = {
  '/dashboard/insurance': 'Insurance & benefits',
  '/dashboard/pending-kyc': 'Pending KYC',
  '/dashboard/contributions': 'Contribution history',
};

function resolve(pathname) {
  if (pathname === '/dashboard') return { left: 'logo', actions: true };
  if (FLOW[pathname]) return { left: 'back', title: FLOW[pathname], actions: false };
  if (TAB[pathname]) return { left: 'title', title: TAB[pathname], actions: true };
  if (pathname === '/dashboard/support') return { left: 'back', title: 'Support', actions: false };
  if (pathname.startsWith('/dashboard/employees/')) return { left: 'back', title: 'Staff member', actions: true };
  return { left: 'back', title: SECONDARY[pathname] || '', actions: true };
}

function badgeText(count) {
  return count > 9 ? '9+' : String(count);
}

/**
 * EmployerMobileAppBar — the persistent top bar for the employer PHONE app
 * (<1024px). Left = brand logo on Home, otherwise the section title (with a back
 * arrow on deep pages OR whenever a page registers an in-page back handler — e.g.
 * a Runs/Support sub-view). Right = Inbox (→ Support, open-ticket badge) ·
 * Notifications (shared NotificationBell) · Ask AI. Hidden by the shell on
 * desktop, which uses DesktopLayout's own chrome.
 */
export default function EmployerMobileAppBar({ onOpenAI }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { backRef, backActive, backTitle } = useEmployerAppBar();
  const { employerId } = useEmployerScope();
  const { data: ticketMetrics } = useEmployerTicketMetrics(employerId);
  const openTickets = ticketMetrics?.openCount || 0;

  const meta = resolve(location.pathname);
  // A page can register an in-page step-back handler (Runs/Support/Onboard
  // sub-views); when it does, show the back button even on a primary tab and let
  // it override the title.
  const showBack = meta.left === 'back' || backActive;
  const showLogo = meta.left === 'logo' && !backActive;
  const title = backActive && backTitle ? backTitle : meta.title;

  const handleBack = () => (backRef?.current ? backRef.current() : navigate(-1));

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        {showBack && (
          <button type="button" className={styles.backBtn} onClick={handleBack} aria-label="Back">
            {BackIcon}
          </button>
        )}
        {showLogo ? (
          <img src={logo} alt="Universal Pensions" className={styles.logo} />
        ) : (
          <h1 className={styles.title}>{title}</h1>
        )}
      </div>

      {meta.actions && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => navigate('/dashboard/support')}
            aria-label={openTickets > 0 ? `Support, ${openTickets} open` : 'Support'}
          >
            {InboxIcon}
            {openTickets > 0 && <span className={styles.count} aria-hidden="true">{badgeText(openTickets)}</span>}
          </button>
          {employerId && <NotificationBell role="employer" entityId={employerId} align="right" />}
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
