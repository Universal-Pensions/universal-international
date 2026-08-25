import { useNavigate, useLocation } from 'react-router-dom';
import logo from '../../assets/logo.png';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentUnreadTicketCount } from '../../hooks/useTickets';
import { useAgentAppBar } from './agentAppBarContext';
import NotificationBell from '../../components/notifications/NotificationBell';
import styles from './AgentMobileAppBar.module.css';

const BackIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
// Instagram-style "Direct" paper-airplane glyph — the icon agents associate with
// DMs/messages (same glyph the old header chrome + PulseCard used for Inbox).
const InboxIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const SparkIcon = (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
    <path d="M8 1.5l1.3 3.9 3.9 1.3-3.9 1.3L8 11.9 6.7 8 2.8 6.7 6.7 5.4 8 1.5z" fill="currentColor" />
  </svg>
);

// Focused-task pages: back + title, NO action cluster (mirrors the mockup's
// actions:false on Onboard / Settings / Help / Manage schedule / Inbox — those
// screens are tasks, not browsing surfaces).
const FLOW = {
  '/dashboard/onboard': 'Onboard a member',
  '/dashboard/settings': 'Settings',
  '/dashboard/help': 'Help',
};
// Primary bottom-nav tabs: title only (no back), actions shown.
const TAB = {
  '/dashboard/subscribers': 'Subscribers',
  '/dashboard/commissions': 'Commissions',
  '/dashboard/profile': 'Profile',
};
// Other secondary pages: back + title, actions shown.
const SECONDARY = {
  '/dashboard/analytics': 'Analytics',
  '/dashboard/contributions': 'Contributions',
  '/dashboard/onboarded-this-month': 'Onboarded',
  '/dashboard/yet-to-contribute': 'Yet to contribute',
  '/dashboard/insured': 'Insured members',
  '/dashboard/uninsured': 'Uninsured members',
};

function resolve(pathname) {
  if (pathname === '/dashboard') return { left: 'logo', actions: true };
  if (FLOW[pathname]) return { left: 'back', title: FLOW[pathname], actions: false };
  if (TAB[pathname]) return { left: 'title', title: TAB[pathname], actions: true };
  if (pathname === '/dashboard/inbox') return { left: 'back', title: 'Inbox', actions: false };
  if (pathname.endsWith('/schedule')) return { left: 'back', title: 'Manage schedule', actions: false };
  if (pathname.startsWith('/dashboard/subscribers/')) return { left: 'back', title: 'Subscriber', actions: true };
  if (pathname === '/dashboard/commissions/earned') return { left: 'back', title: 'Earned commissions', actions: true };
  if (pathname === '/dashboard/commissions/owed') return { left: 'back', title: 'Owed commissions', actions: true };
  if (pathname.startsWith('/dashboard/commissions/')) return { left: 'back', title: 'Commissions', actions: true };
  return { left: 'back', title: SECONDARY[pathname] || '', actions: true };
}

// Cap the numeric badge so a busy inbox never blows out the icon footprint.
function badgeText(count) {
  return count > 9 ? '9+' : String(count);
}

/**
 * AgentMobileAppBar — the persistent top bar for the agent PHONE app (<1024px).
 * Left = brand logo on Home, otherwise the section title (with a back arrow on
 * deep pages). Right = Inbox (numeric unread badge) · Notifications (the shared
 * NotificationBell) · Ask AI, mirroring the subscriber app bar's cluster. Hidden
 * by the shell on desktop, which uses AgentDesktopShell's own chrome.
 */
export default function AgentMobileAppBar({ onOpenAI }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { backRef } = useAgentAppBar();
  const { agentId } = useAgentScope();
  const unread = useAgentUnreadTicketCount(agentId);
  const meta = resolve(location.pathname);

  // A routed page can register a step-back handler (e.g. a multi-step flow);
  // otherwise fall back to browser back.
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
            onClick={() => navigate('/dashboard/inbox')}
            aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
          >
            {InboxIcon}
            {unread > 0 && <span className={styles.count} aria-hidden="true">{badgeText(unread)}</span>}
          </button>
          {agentId && <NotificationBell recipientRole="agent" entityId={agentId} align="right" />}
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
