import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import Settings from '../../dashboard/settings/Settings';
import SubscriberSideNavDesktop from './SubscriberSideNavDesktop';
import SubscriberCopilotPanel from './SubscriberCopilotPanel';
import SubscriberNotificationBell from './SubscriberNotificationBell';
import styles from './SubscriberDesktopShell.module.css';

const COLLAPSE_KEY = 'subscriberNavCollapsed';

const SparkIcon = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
    <path d="M8 1.5l1.3 3.9 3.9 1.3-3.9 1.3L8 11.9 6.7 8 2.8 6.7 6.7 5.4 8 1.5z" fill="currentColor" />
  </svg>
);

// The Home overview gets the full content canvas, and so do the money-flow
// pages — Save, the Withdrawals hub, Withdraw savings, File a claim, the
// contribution-schedule editor, and the Insurance + Policies pages all use the
// WIDE 2-column desktop "split" layout (action column + sticky summary that
// flips to the inline pay panel), which needs more room than the centred reading
// column allows. Every other route is a focused list / detail view whose mobile
// layout reads best centred.
function isWideRoute(pathname) {
  return (
    pathname === '/dashboard' ||
    pathname === '/dashboard/' ||
    pathname === '/dashboard/save' ||
    pathname === '/dashboard/save/schedule' ||
    pathname === '/dashboard/withdraw' ||
    pathname === '/dashboard/withdraw/savings' ||
    pathname === '/dashboard/withdraw/claim' ||
    pathname === '/dashboard/policies' ||
    pathname === '/dashboard/settings/insurance' ||
    pathname === '/dashboard/agent'
  );
}

/**
 * SubscriberDesktopShell — the >=1024px subscriber dashboard chrome. Mirrors
 * AgentDesktopShell: a CSS-grid [sidebar][1fr][AI panel] layout. The left rail
 * collapses to an icon strip; an on-demand right-side "Ask AI" panel grows the
 * third column so the overview reflows beside it (pure grid push — no backdrop).
 *
 * The content column width is route-aware: wide for Home (the dashboard
 * overview), a centred reading column everywhere else.
 */
export default function SubscriberDesktopShell() {
  const location = useLocation();
  const viewportRef = useRef(null);
  const copilotId = useId();
  const askAiRef = useRef(null);

  // Right-side AI chat panel ("Ask AI"). Ephemeral (default closed each session);
  // opening it grows the shell's third grid column so the overview reflows beside
  // it, and force-collapses the left nav (see navCollapsed below).
  const [copilotOpen, setCopilotOpen] = useState(false);
  const toggleCopilot = useCallback(() => setCopilotOpen((prev) => !prev), []);
  // Closing returns focus to the trigger — the panel goes `inert`, so focus would
  // otherwise be dropped to <body> (it's a non-modal panel, so no focus trap).
  const closeCopilot = useCallback(() => {
    setCopilotOpen(false);
    requestAnimationFrame(() => askAiRef.current?.focus());
  }, []);

  // Sidebar collapse lives here (not in the rail) so the shell grid column can
  // reflow with it. Persisted so the choice survives navigation + reloads.
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

  // The actual scroll container is .viewport (overflow-y: auto), not <body>.
  // Reset its scrollTop on route change before paint so each page lands at top.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  // Flag the document while the subscriber desktop shell is mounted so the ~8px
  // "functional" corner radius also reaches body-level portals (the Settings
  // panel, Modal, popovers render OUTSIDE the .page subtree). The matching var
  // override lives in SubscriberDesktopShell.module.css. Removed on unmount, so
  // it's never present for the subscriber mobile shell or any other role.
  useEffect(() => {
    document.body.classList.add('subscriber-desktop-shell');
    return () => document.body.classList.remove('subscriber-desktop-shell');
  }, []);

  // The left nav force-collapses while the AI panel is open (to make room for
  // the third column) WITHOUT clobbering the user's saved preference: it reverts
  // to `collapsed` once the panel closes.
  const navCollapsed = collapsed || copilotOpen;

  const wide = isWideRoute(location.pathname);

  return (
    <div
      className={`${styles.shell} ${navCollapsed ? styles.shellCollapsed : ''} ${
        copilotOpen ? styles.shellCopilotOpen : ''
      }`}
    >
      <SubscriberSideNavDesktop collapsed={navCollapsed} onToggleCollapse={toggleCollapsed} />

      <main ref={viewportRef} className={styles.viewport} id="main" tabIndex={-1}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            className={`${styles.page} ${wide ? styles.pageWide : ''}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Right-side AI chat panel — the shell's third grid column. Stays mounted
          (the column width hides it) so the conversation survives toggling. */}
      <SubscriberCopilotPanel open={copilotOpen} onClose={closeCopilot} panelId={copilotId} />

      {/* Top-right corner controls — the "Ask AI" CTA + the notification centre.
          Pinned to the screen's top-right and slid left (right offset grows with
          the panel width) so they stay just left of the AI panel when it opens. */}
      <div className={styles.topBar}>
        <button
          ref={askAiRef}
          type="button"
          className={`${styles.askAi} ${copilotOpen ? styles.askAiActive : ''}`}
          onClick={toggleCopilot}
          aria-expanded={copilotOpen}
          aria-controls={copilotId}
        >
          <span className={styles.askAiIcon} aria-hidden="true">{SparkIcon}</span>
          Ask AI
        </button>
        <SubscriberNotificationBell />
      </div>

      {/* Shared slide-in Settings panel — same component as the mobile subscriber
          shell. Opens whenever settingsOpen flips true in DashboardPanelContext.
          Mounted exactly once at the shell root. */}
      <Settings />
    </div>
  );
}
