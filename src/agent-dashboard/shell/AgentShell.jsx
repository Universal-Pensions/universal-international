import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useIsDesktop } from '../../hooks/useIsDesktop';
import Settings from '../../dashboard/settings/Settings';
import BottomTabBar from './BottomTabBar';
import SideNav from './SideNav';
import AgentMobileAppBar from './AgentMobileAppBar';
import AgentAskAISheet from './AgentAskAISheet';
import { AgentAppBarContext } from './agentAppBarContext';
import AgentDesktopShell from './AgentDesktopShell';
import styles from './AgentShell.module.css';

export default function AgentShell() {
  const location = useLocation();
  const viewportRef = useRef(null);

  // Whether the Ask AI bottom sheet is open (the only app-bar sheet — Inbox
  // navigates and Notifications use the shared NotificationBell popover).
  const [askOpen, setAskOpen] = useState(false);
  const openAskAI = useCallback(() => setAskOpen(true), []);

  // Page-scoped back override for the app bar. A routed page (e.g. a multi-step
  // flow) can register a handler that steps back through its internal views
  // before the route is exited; the app bar reads backRef.current at click time
  // and falls back to navigate(-1) when nothing is registered.
  const backRef = useRef(null);
  const registerBack = useCallback((fn) => {
    backRef.current = fn;
    return () => {
      if (backRef.current === fn) backRef.current = null;
    };
  }, []);
  const appBarValue = useMemo(
    () => ({ backRef, registerBack, openAskAI }),
    [registerBack, openAskAI],
  );

  // The actual scroll container is .viewport (overflow-y: auto), not <body>.
  // Reset its scrollTop on route change before paint so each page lands at top.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  const isDesktop = useIsDesktop();
  if (isDesktop) return <AgentDesktopShell />;

  return (
    <AgentAppBarContext.Provider value={appBarValue}>
      <div className={styles.shell}>
        <SideNav />
        <AgentMobileAppBar onOpenAI={openAskAI} />
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
        <BottomTabBar />
        {/* Shared slide-in Settings panel — same component as the distributor &
            branch shells. Opens whenever settingsOpen flips true in
            DashboardPanelContext (e.g. from the password card trigger in the
            agent's SettingsPage). */}
        <Settings />

        {/* App-bar surface (mobile only) */}
        <AgentAskAISheet open={askOpen} onClose={() => setAskOpen(false)} />
      </div>
    </AgentAppBarContext.Provider>
  );
}
