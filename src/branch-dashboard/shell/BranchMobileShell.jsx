import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import Settings from '../../dashboard/settings/Settings';
import BranchMobileAppBar from './BranchMobileAppBar';
import BranchBottomTabBar from './BranchBottomTabBar';
import BranchAskAISheet from './BranchAskAISheet';
import BranchNotifSheet from './BranchNotifSheet';
import { BranchAppBarContext } from './branchAppBarContext';

import BranchHomeMobile from '../mobile/BranchHomeMobile';
import AttentionAgentsMobile from '../mobile/AttentionAgentsMobile';
import AgentsMobile from '../mobile/AgentsMobile';
import AgentDetailMobile from '../mobile/AgentDetailMobile';
import AgentSubscribersMobile from '../mobile/AgentSubscribersMobile';
import CreateAgentMobile from '../mobile/CreateAgentMobile';
import CommissionsMobile from '../mobile/CommissionsMobile';
import AnalyticsMobile from '../mobile/AnalyticsMobile';
import SupportMobile from '../mobile/SupportMobile';
import ThreadMobile from '../mobile/ThreadMobile';
import BranchHubMobile from '../mobile/BranchHubMobile';
import SettingsMobile from '../mobile/SettingsMobile';

import styles from './BranchMobileShell.module.css';

/**
 * Animated layout route — wraps the routed page in the shell's slide-up
 * transition keyed on pathname, so each branch screen lands with the same motion
 * as the agent/subscriber mobile shells. The actual nested <Routes> live inside
 * (relative to /dashboard).
 */
function AnimatedOutlet() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        className={styles.page}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
      >
        <Routes location={location}>
          <Route index element={<BranchHomeMobile />} />
          <Route path="attention/:type" element={<AttentionAgentsMobile />} />
          <Route path="agents/new" element={<CreateAgentMobile />} />
          {/* Agent-scoped subscriber drill (AUDIT A12-005) — mirrors the desktop
              BranchDesktopShell route so "View subscribers" on AgentDetailMobile
              resolves to a real, shareable destination instead of bouncing to
              the catch-all (there was no mobile route here before). Declared
              before `agents/:agentId` for readability; React Router ranks the
              longer static segment first regardless of declaration order. */}
          <Route path="agents/:agentId/subscribers" element={<AgentSubscribersMobile />} />
          <Route path="agents/:agentId" element={<AgentDetailMobile />} />
          <Route path="agents" element={<AgentsMobile />} />
          <Route path="commissions" element={<CommissionsMobile />} />
          <Route path="analytics" element={<AnalyticsMobile />} />
          <Route path="reports" element={<Navigate to="/dashboard/analytics" replace />} />
          <Route path="support/:ticketId" element={<ThreadMobile />} />
          <Route path="support" element={<SupportMobile />} />
          <Route path="menu" element={<BranchHubMobile />} />
          <Route path="settings" element={<SettingsMobile />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * BranchMobileShell — the branch admin PHONE shell (<1024px). A fixed app bar +
 * scrollable <main> with a nested route tree + a five-tab bottom bar, mirroring
 * the shipped agent mobile shell but ROUTED to match the branch DESKTOP routes
 * (agents / commissions / analytics / support / settings). The shared slide-in
 * Settings panel + the Ask AI (Branch Copilot) and Notifications bottom sheets
 * are owned here. The selector (BranchDashboardShell) decides mobile vs desktop;
 * this component is the mobile branch only.
 */
export default function BranchMobileShell() {
  const location = useLocation();
  const viewportRef = useRef(null);

  const [askOpen, setAskOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const openAskAI = useCallback(() => setAskOpen(true), []);
  const openNotif = useCallback(() => setNotifOpen(true), []);

  // Page-scoped back override for the app bar (e.g. a multi-step flow that steps
  // back through internal views before leaving the route).
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

  // The real scroll container is .viewport (overflow-y: auto). Reset its
  // scrollTop on route change before paint so each page lands at top.
  useLayoutEffect(() => {
    // Double optional-chain (not just the ref) — jsdom's Element doesn't
    // implement scrollTo, so a bare `.scrollTo(0, 0)` throws under RTL
    // (this shell had no render test until BranchMobileShell.test.jsx).
    // Matches DistributorMobileShell's already-safe call.
    viewportRef.current?.scrollTo?.(0, 0);
  }, [location.pathname]);

  return (
    <BranchAppBarContext.Provider value={appBarValue}>
      <div className={styles.shell}>
        <BranchMobileAppBar onOpenAI={openAskAI} onOpenNotif={openNotif} />
        <main ref={viewportRef} className={styles.viewport} id="main" tabIndex={-1}>
          <AnimatedOutlet />
        </main>
        <BranchBottomTabBar />

        {/* Shared slide-in Settings panel — same component as the distributor &
            desktop branch shells (opens when settingsOpen flips in
            DashboardPanelContext). */}
        <Settings />

        {/* App-bar surfaces (mobile only) */}
        <BranchAskAISheet open={askOpen} onClose={() => setAskOpen(false)} />
        <BranchNotifSheet open={notifOpen} onClose={() => setNotifOpen(false)} />
      </div>
    </BranchAppBarContext.Provider>
  );
}
