import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import logo from '../../assets/logo.png';
import styles from './SubscriberSideNavDesktop.module.css';

/**
 * SubscriberSideNavDesktop — the labelled sidebar rail for the desktop
 * (>=1024px) subscriber dashboard. Fills the left grid column of
 * SubscriberDesktopShell.
 *
 * Redesign (mirrors AgentSideNavDesktop): a WHITE rail (the shipped mobile
 * SideNav is indigo and is left untouched for the mobile shell), the real
 * colour logo, and a collapse control after the logo that folds the rail to an
 * icon-only strip (driven by `collapsed` / `onToggleCollapse` lifted to
 * SubscriberDesktopShell so the shell grid track can reflow with it). The
 * subscriber dashboard has no in-app notification surface, so there is no bell.
 *
 * The nav arrays are intentionally inlined here (a copy of the mobile
 * SideNav.jsx PRIMARY/SECONDARY) rather than shared, so the desktop rail can
 * evolve independently without touching the shared mobile component.
 */

// Collapse (hamburger) glyph — sits AFTER the logo and folds the rail to an
// icon-only strip. Local to this rail (not a shared nav glyph).
const menuIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

const PRIMARY = [
  {
    to: '/dashboard',
    end: true,
    label: 'Home',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M3 11l9-7 9 7v9a2 2 0 01-2 2h-4v-6h-6v6H5a2 2 0 01-2-2v-9z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/dashboard/save',
    // No `end`: the child route /dashboard/save/schedule (reached from Account
    // settings → Contribution settings) has no nav item of its own, so it must
    // light up its parent rather than leaving the rail with nothing active.
    label: 'Save',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <rect x="2" y="6" width="20" height="13" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <path d="M2 10h20" stroke="currentColor" strokeWidth="1.75" />
        <path d="M12 16v-4M10 14h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/dashboard/withdraw',
    label: 'Withdrawals',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M12 3v12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M7 8l5-5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
];

const SECONDARY = [
  {
    to: '/dashboard/reports',
    label: 'Analytics',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M7 14l4-4 4 4 5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/dashboard/agent',
    label: 'Your agent',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="12" cy="9" r="3.5" stroke="currentColor" strokeWidth="1.75" />
        <path d="M5 20a7 7 0 0114 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/dashboard/help',
    label: 'Help',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
        <path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5M12 16v.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    to: '/dashboard/settings',
    label: 'Account settings',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
];

const logoutIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
);

export default function SubscriberSideNavDesktop({ collapsed = false, onToggleCollapse }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <aside
      className={`${styles.nav} ${collapsed ? styles.collapsed : ''}`}
      aria-label="Primary"
    >
      <div className={styles.brand}>
        <img src={logo} alt="Universal Pensions" className={styles.brandLogo} />
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {menuIcon}
        </button>
      </div>

      <div className={styles.group}>
        {PRIMARY.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `${styles.item} ${isActive ? styles.itemActive : ''}`}
            title={collapsed ? item.label : undefined}
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
            title={collapsed ? item.label : undefined}
          >
            <span className={styles.itemIcon}>{item.icon}</span>
            <span className={styles.itemLabel}>{item.label}</span>
          </NavLink>
        ))}
      </div>

      <div className={styles.spacer} />

      <button
        type="button"
        className={styles.logout}
        onClick={handleLogout}
        title={collapsed ? 'Log out' : undefined}
      >
        <span className={styles.itemIcon}>{logoutIcon}</span>
        <span className={styles.itemLabel}>Log out</span>
      </button>
    </aside>
  );
}
