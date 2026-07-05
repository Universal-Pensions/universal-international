import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatUGX } from '../../utils/currency';

import { formatDate } from '../../utils/date';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useCurrentSubscriber } from '../../hooks/useSubscriber';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { getInitials } from '../../utils/dashboard';
import SettingsDesktop from './SettingsDesktop';
import { SECTIONS } from './settingsSections';
import styles from './SettingsPage.module.css';

export default function SettingsPage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { logout } = useAuth();
  const { setSettingsOpen } = useDashboard();
  const { data: sub } = useCurrentSubscriber();
  const isDesktop = useIsDesktop();

  // >=1024px gets the v5 desktop redesign (cards + tile grid); the mobile body
  // below stays exactly as shipped. Forked here after the hooks so both layouts
  // share the same data + rules-of-hooks stay satisfied.
  if (isDesktop) return <SettingsDesktop />;

  const initials = getInitials(sub?.name || '');
  const memberSince = sub?.registeredDate
    ? formatDate(sub.registeredDate, { variant: 'month-year' })
    : null;

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <motion.div
          className={styles.step}
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.32, ease: EASE_OUT_EXPO }}
        >
          {/* Profile card */}
          <section className={styles.profile}>
            <span className={styles.avatar} aria-hidden="true">{initials || 'UP'}</span>
            <div className={styles.profileText}>
              <span className={styles.profileName}>{sub?.name || 'Your account'}</span>
              <span className={styles.profileMeta}>
                {sub?.phone && <span>{sub.phone}</span>}
                {memberSince && (
                  <>
                    <span className={styles.profileDot} aria-hidden="true">·</span>
                    <span>Member since {memberSince}</span>
                  </>
                )}
              </span>
            </div>
          </section>

          {/* Sections */}
          <ul className={styles.sectionList}>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={styles.sectionRow}
                  data-soon={s.soon || undefined}
                  aria-disabled={s.soon || undefined}
                  disabled={s.soon}
                  onClick={() => {
                    if (s.soon) return;
                    if (s.panel === 'settings') {
                      setSettingsOpen(true);
                      return;
                    }
                    navigate(s.to);
                  }}
                >
                  <span className={styles.sectionIcon} aria-hidden="true">{s.icon}</span>
                  <span className={styles.sectionText}>
                    <span className={styles.sectionLabel}>{s.label}</span>
                    <span className={styles.sectionHelper}>{s.helper}</span>
                  </span>
                  {s.soon && <span className={styles.soonBadge}>Soon</span>}
                  {!s.soon && (
                    <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" className={styles.sectionArrow}>
                      <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {sub?.insurance?.cover ? (
            <p className={styles.coverHint}>
              Cover {formatUGX(sub.insurance.cover)} · Premium {formatUGX((sub.insurance.premiumMonthly || 0) * 12, { compact: false })} / year
            </p>
          ) : null}

          <button type="button" className={styles.logoutBtn} onClick={handleLogout}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
            Sign out
          </button>

          <p className={styles.versionLine}>Universal Pensions Uganda · v1.0</p>
        </motion.div>
      </div>
    </div>
  );
}
