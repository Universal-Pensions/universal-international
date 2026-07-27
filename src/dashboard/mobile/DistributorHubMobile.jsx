import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEntityMetrics, useEntity } from '../../hooks/useEntity';
import { formatNumber } from '../../utils/currency';
import styles from './distributorMobile.module.css';

const ChevIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
const SubscribersIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
  </svg>
);
const ReportsIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" strokeLinecap="round" />
  </svg>
);
const SupportIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const SettingsIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7" />
  </svg>
);
const BellIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);
const LockIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'D';
}

/**
 * DistributorHubMobile — the "Menu" bottom-tab hub (route /dashboard/menu). No
 * desktop counterpart (desktop uses the rail). Renders an identity card, a 2×2
 * destinations grid for the secondary surfaces not on the bottom bar
 * (Subscribers / Reports / Support / Settings), a couple of setting rows, a
 * sign-out button, and a version line.
 */
export default function DistributorHubMobile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: metrics = {} } = useEntityMetrics('country', 'ug');
  // The operator's own name — "National Network" mislabels every distributor
  // that isn't d-001.
  const { data: distributor } = useEntity('distributor', user?.distributorId ?? 'd-001');

  const name = user?.name || 'Distributor Admin';
  const agents = metrics.totalAgents || 0;
  const branches = metrics.totalBranches || 0;

  const handleSignOut = () => {
    logout();
    navigate('/');
  };

  return (
    <>
      {/* IDENTITY */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Distributor profile">
        <div className={styles.acct}>
          <div className={styles.acctAv} aria-hidden="true">{initials(name)}</div>
          <div>
            <div className={styles.acctNm}>{name}</div>
            <div className={styles.acctMt}>Distributor Admin · {distributor?.name || 'National Network'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={styles.tag} style={{ color: 'var(--color-indigo)' }}>Distributor Admin</span>
          <span className={styles.tag}>{formatNumber(branches)} branches</span>
          <span className={styles.tag}>{formatNumber(agents)} agents</span>
        </div>
      </section>

      {/* DESTINATIONS — 2×2 */}
      <div className={styles.tiles}>
        <NavLink to="/dashboard/subscribers" className={styles.tile} aria-label="Subscribers">
          <span className={styles.tileIc} aria-hidden="true">{SubscribersIcon}</span>
          <span><b>Subscribers</b><small>Members &amp; balances</small></span>
        </NavLink>
        <NavLink to="/dashboard/reports" className={styles.tile} aria-label="Reports">
          <span className={styles.tileIc} aria-hidden="true">{ReportsIcon}</span>
          <span><b>Reports</b><small>Download data</small></span>
        </NavLink>
        <NavLink to="/dashboard/support" className={styles.tile} aria-label="Support">
          <span className={styles.tileIc} aria-hidden="true">{SupportIcon}</span>
          <span><b>Support</b><small>Ticket oversight</small></span>
        </NavLink>
        <NavLink to="/dashboard/settings" className={styles.tile} aria-label="Settings">
          <span className={styles.tileIc} aria-hidden="true">{SettingsIcon}</span>
          <span><b>Settings</b><small>Profile &amp; account</small></span>
        </NavLink>
      </div>

      {/* SETTING ROWS */}
      <section className={styles.card} aria-label="Preferences">
        <div className={styles.setRow}>
          <span className={`${styles.setRowIc} ${styles.tintSoft}`} aria-hidden="true">{BellIcon}</span>
          <span className={styles.setRowT}>
            <b>Notifications</b>
            <small>Enrolments, commissions, contributions</small>
          </span>
          <button
            type="button"
            className={`${styles.swt} ${styles.swtOn}`}
            role="switch"
            aria-checked="true"
            aria-label="Notifications enabled"
          />
        </div>
        <NavLink to="/dashboard/settings" className={styles.setRow} aria-label="Password and security">
          <span className={`${styles.setRowIc} ${styles.tintIndigo}`} aria-hidden="true">{LockIcon}</span>
          <span className={styles.setRowT}>
            <b>Password &amp; security</b>
            <small>Change your sign-in password</small>
          </span>
          <span className={styles.chev}>{ChevIcon}</span>
        </NavLink>
      </section>

      <button type="button" className={styles.signout} onClick={handleSignOut}>
        Sign out
      </button>
      <div className={styles.ver}>Universal Pensions · Distributor Admin · v2.4.0</div>
    </>
  );
}
