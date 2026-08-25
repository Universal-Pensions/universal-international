import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useEmployerPanel } from '../../contexts/EmployerPanelContext';
import NotificationBell from '../../components/notifications/NotificationBell';
import EmployerSideNavDesktop from './EmployerSideNavDesktop';
import EmployerCopilotPanel from './EmployerCopilotPanel';
import OnboardStaffPanel from '../employees/OnboardStaffPanel';
import { sparkIcon } from '../desktop/icons';
import styles from './EmployerDesktopShell.module.css';

const COLLAPSE_KEY = 'employerNavCollapsed';

/**
 * DesktopLayout — the persistent desktop (>=1024px) employer chrome (left rail |
 * scrollable content | right AI panel) that wraps every routed employer page via
 * <Outlet/>. Rendered by EmployerShell when useIsDesktop() is true; the route
 * table lives one level up in EmployerDashboardShell and is shared with the
 * mobile shell. Mirrors AgentDesktopShell: collapse state lifted here so the grid
 * reflows; the AI panel is the third grid column (force-collapses the rail while
 * open); "Ask AI" + the notification bell float top-right. Onboard still reuses
 * its slide-in panel as an overlay, triggered from Employees via
 * useEmployerPanel. (Pending-KYC used to do the same; it is now the routed
 * /dashboard/pending-kyc page on desktop as well as phone.)
 */
export function DesktopLayout() {
  const location = useLocation();
  const viewportRef = useRef(null);
  const askAiRef = useRef(null);
  const copilotId = useId();
  const { employerId } = useEmployerScope();
  const { onboardOpen } = useEmployerPanel();

  const [copilotOpen, setCopilotOpen] = useState(false);
  const toggleCopilot = useCallback(() => setCopilotOpen((prev) => !prev), []);
  const closeCopilot = useCallback(() => {
    setCopilotOpen(false);
    requestAnimationFrame(() => askAiRef.current?.focus());
  }, []);

  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        /* ignore persistence failures (private mode, etc.) */
      }
      return next;
    });
  }, []);

  // The scroll container is .viewport, not <body>. Reset its scrollTop on route
  // change before paint so each page lands at the top.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  // Flag the document while the desktop shell is mounted so the tight ~8px
  // radius also reaches body-level portals (the Onboard slide panel,
  // Modal, the NotificationBell popover). Removed on unmount → never present for
  // employer mobile. Matches AgentDesktopShell's body-class trick.
  useEffect(() => {
    document.body.classList.add('employer-desktop-shell');
    return () => document.body.classList.remove('employer-desktop-shell');
  }, []);

  const navCollapsed = collapsed || copilotOpen;

  return (
    <div
      className={`${styles.shell} ${navCollapsed ? styles.shellCollapsed : ''} ${
        copilotOpen ? styles.shellCopilotOpen : ''
      }`}
    >
      <EmployerSideNavDesktop collapsed={navCollapsed} onToggleCollapse={toggleCollapsed} />

      <main ref={viewportRef} className={styles.viewport} id="main" tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            className={styles.page}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {employerId && (
        <EmployerCopilotPanel open={copilotOpen} onClose={closeCopilot} panelId={copilotId} />
      )}

      {employerId && (
        <div className={styles.topBar}>
          <button
            ref={askAiRef}
            type="button"
            className={`${styles.askAi} ${copilotOpen ? styles.askAiActive : ''}`}
            onClick={toggleCopilot}
            aria-expanded={copilotOpen}
            aria-controls={copilotId}
          >
            <span className={styles.askAiIcon} aria-hidden="true">{sparkIcon(18)}</span>
            Ask AI
          </button>
          <NotificationBell recipientRole="employer" entityId={employerId} align="right" portal />
        </div>
      )}

      {/* Reused slide-in flows, mounted once at the shell root and opened from
          pages via useEmployerPanel. Gated on their open flag so their data
          hooks don't fire on cold load (mirrors the mobile shell). */}
      {onboardOpen && <OnboardStaffPanel />}
    </div>
  );
}

export default DesktopLayout;
