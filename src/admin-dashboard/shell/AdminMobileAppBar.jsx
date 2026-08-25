import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../assets/logo.png';
import { useAdminAppBar } from './adminAppBarContext';
// Reuse the distributor app-bar styling verbatim.
import styles from '../../dashboard/shell/DistributorMobileAppBar.module.css';
import NotificationBell from '../../components/notifications/NotificationBell';

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

const TAB = {
  '/dashboard/distributors': 'Distributors',
  '/dashboard/employers': 'Employers',
  '/dashboard/network': 'Network',
  '/dashboard/branches': 'Branches',
  '/dashboard/agents': 'Agents',
  '/dashboard/subscribers': 'Subscribers',
  '/dashboard/reports': 'Reports',
  '/dashboard/support': 'Support',
  '/dashboard/menu': 'Menu',
};
const FLOW = {
  '/dashboard/settings': 'Settings',
  '/dashboard/access-requests': 'Access requests',
  // A task page reached from the Menu hub: back arrow, no actions cluster.
  '/dashboard/nav': 'Unit price',
  '/dashboard/nominee-claims': 'Nominee claims',
};

function resolve(pathname) {
  if (pathname === '/dashboard') return { left: 'logo', actions: true };
  if (FLOW[pathname]) return { left: 'back', title: FLOW[pathname], actions: false };
  if (TAB[pathname]) return { left: 'title', title: TAB[pathname], actions: true };
  if (pathname.startsWith('/dashboard/distributors/')) return { left: 'back', title: 'Distributor', actions: true };
  if (pathname.startsWith('/dashboard/employers/')) return { left: 'back', title: 'Employer', actions: true };
  if (pathname.startsWith('/dashboard/branches/')) return { left: 'back', title: 'Branch', actions: true };
  if (pathname.startsWith('/dashboard/agents/')) return { left: 'back', title: 'Agent', actions: true };
  if (pathname.startsWith('/dashboard/subscribers/')) return { left: 'back', title: 'Subscriber', actions: true };
  if (pathname.startsWith('/dashboard/reports/')) return { left: 'back', title: 'Report', actions: false };
  if (pathname.startsWith('/dashboard/support/')) return { left: 'back', title: 'Support', actions: false };
  // Needs-attention drill-down. The page renders its own signal-specific title,
  // so the bar carries only the section name and the back affordance.
  if (pathname.startsWith('/dashboard/attention/')) return { left: 'back', title: 'Needs attention', actions: true };
  return { left: 'back', title: '', actions: true };
}

/**
 * AdminMobileAppBar — the persistent top bar for the super-admin PHONE app
 * (<1024px). Left = brand logo on Home, otherwise the section title (with a back
 * arrow on deep/task pages). Right = Support inbox · Ask AI (Platform Copilot).
 * Reuses the distributor app-bar styling.
 */
export default function AdminMobileAppBar({ onOpenAI }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { backRef } = useAdminAppBar();
  const meta = resolve(location.pathname);

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
          {/* entityId="*" — ops-queue notifications raised from a Needs-attention
              drill-down are addressed to a QUEUE (ops-treasury, ops-claims, …),
              not to admin-001, so a self-id filter would show an empty bell.
              RLS still scopes the read (notifications_select_admin, 0049). */}
          <NotificationBell recipientRole="admin" entityId="*" align="right" portal />
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
