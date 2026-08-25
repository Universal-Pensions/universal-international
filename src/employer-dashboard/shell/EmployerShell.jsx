import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useIsDesktop } from '../../hooks/useIsDesktop';
import { DesktopLayout } from './EmployerDesktopShell';
import EmployerMobileAppBar from './EmployerMobileAppBar';
import EmployerBottomTabBar from './EmployerBottomTabBar';
import EmployerAskAISheet from './EmployerAskAISheet';
import { EmployerAppBarContext } from './employerAppBarContext';
import styles from './EmployerShell.module.css';

/**
 * EmployerShell — the single layout-route element for the employer dashboard (the
 * route table lives one level up in EmployerDashboardShell). Gates on the
 * viewport, mirroring AgentShell:
 *   - desktop (>=1024px): the shipped desktop chrome (DesktopLayout).
 *   - mobile (<1024px): the persistent app bar + scrollable viewport + bottom nav
 *     + Ask-AI sheet, with the EmployerAppBarContext (back override + openAskAI)
 *     provided to routed pages.
 */
export default function EmployerShell() {
  const location = useLocation();
  const viewportRef = useRef(null);

  // The only app-bar sheet — Inbox navigates to Support and Notifications use the
  // shared NotificationBell popover.
  const [askOpen, setAskOpen] = useState(false);
  const openAskAI = useCallback(() => setAskOpen(true), []);

  // Page-scoped back override for the app bar. A page (Runs/Support/Onboard with
  // in-page sub-views) registers a handler + optional title; the app bar then
  // renders a back button (even on a primary tab) that steps back through the
  // internal views before the route is exited. Falls back to navigate(-1).
  const backRef = useRef(null);
  const [backActive, setBackActive] = useState(false);
  const [backTitle, setBackTitle] = useState(null);
  const registerBack = useCallback((fn, title = null) => {
    backRef.current = fn;
    setBackActive(true);
    setBackTitle(title);
    return () => {
      if (backRef.current === fn) {
        backRef.current = null;
        setBackActive(false);
        setBackTitle(null);
      }
    };
  }, []);
  const appBarValue = useMemo(
    () => ({ backRef, registerBack, backActive, backTitle, openAskAI }),
    [registerBack, backActive, backTitle, openAskAI],
  );

  // The actual scroll container is .viewport (overflow-y: auto), not <body>.
  // Reset its scrollTop on route change before paint so each page lands at top.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  const isDesktop = useIsDesktop();
  if (isDesktop) return <DesktopLayout />;

  return (
    <EmployerAppBarContext.Provider value={appBarValue}>
      <div className={styles.shell}>
        <EmployerMobileAppBar onOpenAI={openAskAI} />
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
        <EmployerBottomTabBar />
        <EmployerAskAISheet open={askOpen} onClose={() => setAskOpen(false)} />
      </div>
    </EmployerAppBarContext.Provider>
  );
}
