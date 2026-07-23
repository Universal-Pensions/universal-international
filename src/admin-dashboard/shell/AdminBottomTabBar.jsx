import { NavLink } from 'react-router-dom';
// Reuse the distributor bottom-bar styling verbatim — same phone nav treatment
// across the two map-theme roles (the admin↔distributor reuse pattern).
import styles from '../../dashboard/shell/DistributorBottomTabBar.module.css';

const HomeIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M3 10.5L12 3l9 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 9.5V21h14V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const DistributorsIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <circle cx="12" cy="5" r="2.4" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="5" cy="19" r="2.4" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="19" cy="19" r="2.4" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 7.4v4M12 11.4H5.6a1 1 0 0 0-1 1v4M12 11.4h6.4a1 1 0 0 1 1 1v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const EmployersIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <rect x="3" y="7.5" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 12.5h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const NetworkIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M12 2l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M3 12l9 5 9-5M3 17l9 5 9-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const MenuIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
    <rect x="14" y="3" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
    <rect x="3" y="14" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
    <rect x="14" y="14" width="7" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const TABS = [
  { to: '/dashboard', end: true, label: 'Home', icon: HomeIcon },
  { to: '/dashboard/distributors', label: 'Distributors', icon: DistributorsIcon },
  { to: '/dashboard/employers', label: 'Employers', icon: EmployersIcon },
  { to: '/dashboard/network', label: 'Network', icon: NetworkIcon },
  { to: '/dashboard/menu', label: 'Menu', icon: MenuIcon },
];

/**
 * AdminBottomTabBar — the super-admin PHONE bottom navigation (<1024px). Five
 * NavLink slots: Home · Distributors · Employers · Network (branches/agents/
 * subscribers hub) · Menu (Reports/Support/Settings/sign out). Hidden by CSS at
 * >=1024px where the desktop rail takes over.
 */
export default function AdminBottomTabBar() {
  return (
    <nav className={styles.bar} aria-label="Admin navigation">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => `${styles.tab} ${isActive ? styles.tabActive : ''}`}
        >
          <span className={styles.tabIcon}>{t.icon}</span>
          <span className={styles.tabLabel}>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
