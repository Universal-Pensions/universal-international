import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';
import { formatDate } from '../../utils/date';

import { useAuth } from '../../contexts/AuthContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useCurrentSubscriber } from '../../hooks/useSubscriber';
import { getInitials } from '../../utils/dashboard';
import { SECTIONS } from './settingsSections';
import styles from './SettingsDesktop.module.css';

const stagger = {
  initial: {},
  animate: { transition: { staggerChildren: 0.05, delayChildren: 0.03 } },
};
const item = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT_EXPO } },
};

/**
 * SettingsDesktop — the >=1024px subscriber Settings page (v5 redesign), forked
 * from SettingsPage via useIsDesktop(). The mobile page (curved hero + stacked
 * row list) is never mounted at this width, so this owns its own hooks.
 *
 * Reuses the EXACT SECTIONS array (destinations + panel/soon behaviour) the
 * mobile page renders, so every row navigates identically and the e2e contract
 * (an <h1> "Profile", a "Sign out" action, the Password & security row opening
 * the shared slide-in via setSettingsOpen) is preserved. Only the layout changes:
 * a flat v5 header, an account card with a stat row, and a 2-up grid of titled
 * setting tiles.
 */
export default function SettingsDesktop() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { logout } = useAuth();
  const { setSettingsOpen } = useDashboard();
  const { data: sub } = useCurrentSubscriber();

  const itemVariants = reduceMotion ? undefined : item;
  const initials = getInitials(sub?.name || '');
  const memberSince = sub?.registeredDate
    ? formatDate(sub.registeredDate, { variant: 'month-year' })
    : null;

  function handleLogout() {
    logout();
    navigate('/');
  }

  function handleSection(s) {
    if (s.soon) return;
    if (s.panel === 'settings') {
      setSettingsOpen(true);
      return;
    }
    navigate(s.to);
  }

  return (
    <motion.div
      className={styles.page}
      variants={reduceMotion ? undefined : stagger}
      initial={reduceMotion ? false : 'initial'}
      animate={reduceMotion ? false : 'animate'}
    >
      <motion.header variants={itemVariants} className={styles.head}>
        <p className={styles.eyebrow}>Account</p>
        <h1 className={styles.title}>Profile</h1>
        <p className={styles.subtitle}>Manage your profile, savings settings and security.</p>
      </motion.header>

      {/* Account card — identity + headline stats. */}
      <motion.section variants={itemVariants} className={styles.accountCard}>
        <div className={styles.profile}>
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
        </div>
      </motion.section>

      {/* Settings tiles — the same destinations as the mobile row list. The
          contribution-schedule tile used to be filtered out here because the
          desktop sidebar carried its own "Schedule" nav item; that item is gone,
          so this is now the only way in and the list must not be filtered. */}
      <motion.div variants={itemVariants} className={styles.grid}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.tile}
            data-soon={s.soon || undefined}
            aria-disabled={s.soon || undefined}
            disabled={s.soon}
            onClick={() => handleSection(s)}
          >
            <span className={styles.tileIcon} aria-hidden="true">{s.icon}</span>
            <span className={styles.tileText}>
              <span className={styles.tileLabel}>{s.label}</span>
              <span className={styles.tileHelper}>{s.helper}</span>
            </span>
            {s.soon ? (
              <span className={styles.soonBadge}>Soon</span>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 12 12" width="11" height="11" className={styles.tileArrow}>
                <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            )}
          </button>
        ))}
      </motion.div>

      <motion.footer variants={itemVariants} className={styles.footer}>
        <button type="button" className={styles.logoutBtn} onClick={handleLogout}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          Sign out
        </button>
        <p className={styles.versionLine}>Universal Pensions Uganda · v1.0</p>
      </motion.footer>
    </motion.div>
  );
}
