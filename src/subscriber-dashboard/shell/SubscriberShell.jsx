import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useIsDesktop } from '../../hooks/useIsDesktop';
import { useCurrentSubscriber } from '../../hooks/useSubscriber';
import Settings from '../../dashboard/settings/Settings';
import BottomTabBar from './BottomTabBar';
import SideNav from './SideNav';
import SubscriberMobileAppBar from './SubscriberMobileAppBar';
import { SubscriberAppBarContext } from './subscriberAppBarContext';
import { useSubscriberNotifications } from './useSubscriberNotifications';
import HelpSheet from './HelpSheet';
import NotificationsSheet from './NotificationsSheet';
import AskAISheet from './AskAISheet';
import SubscriberDesktopShell from './SubscriberDesktopShell';
import styles from './SubscriberShell.module.css';

export default function SubscriberShell() {
  const location = useLocation();
  const viewportRef = useRef(null);

  // Which app-bar bottom sheet is open: 'help' | 'notif' | 'ai' | null.
  const [sheet, setSheet] = useState(null);
  const closeSheet = () => setSheet(null);

  // Lifted here so the app-bar unread dot and the Notifications sheet share one
  // read-state (the hook keeps readAt in its own useState — one instance only).
  const { data: sub } = useCurrentSubscriber();
  const notifs = useSubscriberNotifications(sub);

  // Page-scoped back override for the app bar. A routed page (e.g. ClaimPage's
  // multi-step flow) can register a handler that steps back through its internal
  // views before the route is exited; the app bar reads backRef.current at click
  // time and falls back to navigate(-1) when nothing is registered.
  const backRef = useRef(null);
  const registerBack = useCallback((fn) => {
    backRef.current = fn;
    return () => {
      if (backRef.current === fn) backRef.current = null;
    };
  }, []);
  const appBarValue = useMemo(() => ({ backRef, registerBack }), [registerBack]);

  // The actual scroll container is .viewport (overflow-y: auto), not <body>.
  // Reset its scrollTop on route change before paint so each page lands at top.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  // >=1024px gets the dedicated desktop chrome (sidebar rail + top bar + framed
  // content column) — the same split the agent shell uses. Below that the mobile
  // shell (persistent app bar + bottom tab bar + full-bleed pages).
  const isDesktop = useIsDesktop();
  if (isDesktop) return <SubscriberDesktopShell />;

  return (
    <SubscriberAppBarContext.Provider value={appBarValue}>
    <div className={styles.shell}>
      <SideNav />
      <SubscriberMobileAppBar
        unread={notifs.unread}
        onOpenHelp={() => setSheet('help')}
        onOpenNotif={() => setSheet('notif')}
        onOpenAI={() => setSheet('ai')}
      />
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
          DashboardPanelContext (e.g. from the Security row in SettingsPage). */}
      <Settings />

      {/* App-bar surfaces (mobile only) */}
      <HelpSheet open={sheet === 'help'} onClose={closeSheet} onAskAI={() => setSheet('ai')} />
      <NotificationsSheet
        open={sheet === 'notif'}
        onClose={closeSheet}
        items={notifs.items}
        isUnread={notifs.isUnread}
        markAllRead={notifs.markAllRead}
        unread={notifs.unread}
      />
      <AskAISheet open={sheet === 'ai'} onClose={closeSheet} />
    </div>
    </SubscriberAppBarContext.Provider>
  );
}
