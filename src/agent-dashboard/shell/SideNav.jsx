import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import NotificationBell from '../../components/notifications/NotificationBell';
import logoWhite from '../../assets/logo-white.png';
import styles from './SideNav.module.css';

const PRIMARY = [
  {
    to: '/dashboard',
    end: true,
    label: 'Home',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-4v-6h-6v6H5a2 2 0 01-2-2v-9z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/subscribers',
    label: 'Subscribers',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="9" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M3 19a6 6 0 0112 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        <circle cx="17" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M16 14h1.5a4 4 0 014 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/onboard',
    label: 'Onboard',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="9" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M3 19a6 6 0 0112 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        <path d="M18 7v6M21 10h-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/analytics',
    label: 'Analytics',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M4 19V5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        <path d="M4 19h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        <rect x="7.5" y="11" width="3" height="6" rx="0.6" stroke="currentColor" strokeWidth="1.75"/>
        <rect x="12.5" y="7" width="3" height="10" rx="0.6" stroke="currentColor" strokeWidth="1.75"/>
        <rect x="17.5" y="13" width="3" height="4" rx="0.6" stroke="currentColor" strokeWidth="1.75"/>
      </svg>
    ),
  },
  {
    to: '/dashboard/commissions',
    label: 'Commissions',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <rect x="2.5" y="6" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M2.5 10h19" stroke="currentColor" strokeWidth="1.75"/>
        <circle cx="12" cy="14.5" r="1.6" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
];

const SECONDARY = [
  {
    to: '/dashboard/settings',
    label: 'Settings',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
];

export default function SideNav() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { agentId } = useAgentScope();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <aside className={styles.nav} aria-label="Primary">
      <div className={styles.brand}>
        <img
          src={logoWhite}
          alt="Universal Pensions"
          width="160"
          height="56"
          className={styles.brandLogo}
        />
        {agentId && (
          <div className={styles.brandBell}>
            <NotificationBell recipientRole="agent" entityId={agentId} align="left" />
          </div>
        )}
      </div>

      <div className={styles.group}>
        {PRIMARY.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `${styles.item} ${isActive ? styles.itemActive : ''}`}
          >
            <span className={styles.itemIcon}>{item.icon}</span>
            <span className={styles.itemLabel}>{item.label}</span>
          </NavLink>
        ))}
      </div>

      <div className={styles.divider} aria-hidden="true" />

      <div className={styles.group}>
        {SECONDARY.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `${styles.item} ${styles.itemSecondary} ${isActive ? styles.itemActive : ''}`}
          >
            <span className={styles.itemIcon}>{item.icon}</span>
            <span className={styles.itemLabel}>{item.label}</span>
          </NavLink>
        ))}
      </div>

      <div className={styles.spacer} />

      <button type="button" className={styles.logout} onClick={handleLogout}>
        <span className={styles.itemIcon}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
            <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
        </span>
        <span className={styles.itemLabel}>Log out</span>
      </button>
    </aside>
  );
}
