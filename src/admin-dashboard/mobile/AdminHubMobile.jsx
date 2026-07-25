import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePlatformOverview } from '../../hooks/useEntity';
import { formatNumber } from '../../utils/currency';
import styles from '../../dashboard/mobile/distributorMobile.module.css';

const ChevIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
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
const InboxIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 13h4l2 3h6l2-3h4" /><path d="M5 13V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" />
  </svg>
);
const SettingsIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7" />
  </svg>
);
const LockIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'A';
}

/**
 * AdminHubMobile — the "Menu" bottom-tab hub (route /dashboard/menu). Identity +
 * secondary destinations (Reports / Support / Settings) + sign out.
 */
export default function AdminHubMobile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { data: p = {} } = usePlatformOverview();

  const name = user?.name || 'Platform Admin';

  const handleSignOut = () => {
    logout();
    navigate('/');
  };

  return (
    <>
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Admin profile">
        <div className={styles.acct}>
          <div className={styles.acctAv} aria-hidden="true">{initials(name)}</div>
          <div>
            <div className={styles.acctNm}>{name}</div>
            <div className={styles.acctMt}>Platform Admin · head office</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={styles.tag} style={{ color: 'var(--color-indigo)' }}>Platform Admin</span>
          <span className={styles.tag}>{formatNumber(p.distributors || 0)} distributors</span>
          <span className={styles.tag}>{formatNumber(p.employers || 0)} employers</span>
        </div>
      </section>

      <div className={styles.tiles}>
        <NavLink to="/dashboard/access-requests" className={styles.tile} aria-label="Access requests">
          <span className={styles.tileIc} aria-hidden="true">{InboxIcon}</span>
          <span><b>Access requests</b><small>Approve sign-ups</small></span>
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
          <span><b>Settings</b><small>Account &amp; security</small></span>
        </NavLink>
      </div>

      <section className={styles.card} aria-label="Preferences">
        <NavLink to="/dashboard/settings" className={styles.setRow} aria-label="Password and security">
          <span className={`${styles.setRowIc} ${styles.tintIndigo}`} aria-hidden="true">{LockIcon}</span>
          <span className={styles.setRowT}>
            <b>Password &amp; security</b>
            <small>Change your sign-in password</small>
          </span>
          <span className={styles.chev}>{ChevIcon}</span>
        </NavLink>
      </section>

      <button type="button" className={styles.signout} onClick={handleSignOut}>Sign out</button>
      <div className={styles.ver}>Universal Pensions · Platform Admin · v2.4.0</div>
    </>
  );
}
