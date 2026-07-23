import { NavLink } from 'react-router-dom';
import styles from './DistributorBottomTabBar.module.css';

const HomeIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M3 10.5L12 3l9 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5 9.5V21h14V9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const BranchesIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 9h3a2 2 0 0 1 2 2v10M2 21h20M8 7h2M8 11h2M8 15h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const AgentsIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CommissionsIcon = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
    <rect x="2.5" y="6" width="19" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M2.5 10h19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
  { to: '/dashboard/branches', label: 'Branches', icon: BranchesIcon },
  { to: '/dashboard/agents', label: 'Agents', icon: AgentsIcon },
  { to: '/dashboard/commissions', label: 'Commissions', icon: CommissionsIcon },
  { to: '/dashboard/menu', label: 'Menu', icon: MenuIcon },
];

/**
 * DistributorBottomTabBar — the distributor-admin PHONE bottom navigation
 * (<1024px). Five NavLink slots (NO centre FAB — an oversight role browses its
 * network rather than driving one primary "create" action): Home · Branches ·
 * Agents · Commissions · Menu (the hub for Subscribers/Reports/Support/Settings/
 * sign out). Active tab gets the indigo pill indicator. Hidden by CSS at
 * >=1024px, where the desktop rail takes over.
 */
export default function DistributorBottomTabBar() {
  return (
    <nav className={styles.bar} aria-label="Distributor navigation">
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
