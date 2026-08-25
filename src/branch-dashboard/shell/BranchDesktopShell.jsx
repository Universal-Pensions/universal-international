import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useBranchScope } from '../../contexts/BranchScopeContext';
import NotificationBell from '../../components/notifications/NotificationBell';
import BranchSideNavDesktop from './BranchSideNavDesktop';
import BranchCopilotPanel from './BranchCopilotPanel';
import { sparkIcon } from '../../employer-dashboard/desktop/icons';
import styles from './BranchDesktopShell.module.css';

// Pages are lazy-loaded so the Overview doesn't pay for their JS on first paint
// (the shell itself is already lazy one level up, in BranchDashboardShell).
const OverviewDesktop = lazy(() => import('../desktop/OverviewDesktop'));
const AttentionAgentsDesktop = lazy(() => import('../desktop/AttentionAgentsDesktop'));
const AgentsDesktop = lazy(() => import('../desktop/AgentsDesktop'));
const AgentDetailDesktop = lazy(() => import('../desktop/AgentDetailDesktop'));
const BranchAgentSubscribers = lazy(() => import('../desktop/BranchAgentSubscribers'));
const CommissionsDesktop = lazy(() => import('../desktop/CommissionsDesktop'));
const AnalyticsDesktop = lazy(() => import('../desktop/AnalyticsDesktop'));
const SupportDesktop = lazy(() => import('../desktop/SupportDesktop'));
const SettingsDesktop = lazy(() => import('../desktop/SettingsDesktop'));

const COLLAPSE_KEY = 'branchNavCollapsed';

function PageFallback() {
  return (
    <div className={styles.pageFallback}>
      <div className={styles.spinner} />
    </div>
  );
}

/**
 * DesktopLayout — the persistent chrome (left rail | scrollable content | right
 * AI panel) that wraps every routed branch desktop page via <Outlet/>. Mirrors
 * EmployerDesktopShell: collapse state lifted here so the grid reflows; the AI
 * panel is the third grid column (force-collapses the rail while open); "Ask AI"
 * + the notification bell float top-right. Branch has no slide-in overlays — the
 * Add-agent flow is an in-page view on the Agents page.
 */
function DesktopLayout() {
  const location = useLocation();
  const viewportRef = useRef(null);
  const askAiRef = useRef(null);
  const copilotId = useId();
  const { branchId } = useBranchScope();

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
  // radius also reaches body-level portals (the NotificationBell popover, any
  // Modal/Toast). Removed on unmount → never present for branch mobile.
  useEffect(() => {
    document.body.classList.add('branch-desktop-shell');
    return () => document.body.classList.remove('branch-desktop-shell');
  }, []);

  const navCollapsed = collapsed || copilotOpen;

  return (
    <div
      className={`${styles.shell} ${navCollapsed ? styles.shellCollapsed : ''} ${
        copilotOpen ? styles.shellCopilotOpen : ''
      }`}
    >
      <BranchSideNavDesktop collapsed={navCollapsed} onToggleCollapse={toggleCollapsed} />

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

      {branchId && (
        <BranchCopilotPanel open={copilotOpen} onClose={closeCopilot} panelId={copilotId} />
      )}

      {branchId && (
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
          <NotificationBell recipientRole="branch" entityId={branchId} align="right" portal />
        </div>
      )}
    </div>
  );
}

/**
 * BranchDesktopShell — the desktop (>=1024px) branch dashboard. Rendered by
 * BranchDashboardShell's ShellInner when useIsDesktop() is true; the mobile
 * panel/drawer shell stays untouched below the breakpoint. Owns its own nested
 * <Routes> (relative to the /dashboard/* splat) so desktop is fully routed while
 * mobile stays route-free (panels).
 */
export default function BranchDesktopShell() {
  return (
    <Routes>
      <Route element={<DesktopLayout />}>
        <Route index element={<Suspense fallback={<PageFallback />}><OverviewDesktop /></Suspense>} />
        <Route path="attention/:type" element={<Suspense fallback={<PageFallback />}><AttentionAgentsDesktop /></Suspense>} />
        <Route path="agents" element={<Suspense fallback={<PageFallback />}><AgentsDesktop /></Suspense>} />
        <Route path="agents/:agentId" element={<Suspense fallback={<PageFallback />}><AgentDetailDesktop /></Suspense>} />
        {/* Agent-scoped subscriber list — the drill destination from
            AgentDetailDesktop's "View subscribers" CTA. Reuses the distributor
            ViewSubscribers panel in fullPage mode, scoped to the agent so a
            branch admin sees only that agent's members. */}
        <Route path="agents/:agentId/subscribers" element={<Suspense fallback={<PageFallback />}><BranchAgentSubscribers /></Suspense>} />
        <Route path="commissions" element={<Suspense fallback={<PageFallback />}><CommissionsDesktop /></Suspense>} />
        <Route path="analytics" element={<Suspense fallback={<PageFallback />}><AnalyticsDesktop /></Suspense>} />
        <Route path="reports" element={<Navigate to="/dashboard/analytics" replace />} />
        <Route path="support" element={<Suspense fallback={<PageFallback />}><SupportDesktop /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<PageFallback />}><SettingsDesktop /></Suspense>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
