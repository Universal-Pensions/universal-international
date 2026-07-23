import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import DataCopilotPanel from '../overlay/DataCopilotPanel';
import DistributorMobileAppBar from './DistributorMobileAppBar';
import DistributorBottomTabBar from './DistributorBottomTabBar';
import { DistributorAppBarContext } from './distributorAppBarContext';

import DistributorHomeMobile from '../mobile/DistributorHomeMobile';
import BranchesMobile from '../mobile/BranchesMobile';
import BranchDetailMobile from '../mobile/BranchDetailMobile';
import AgentsMobile from '../mobile/AgentsMobile';
import AgentDetailMobile from '../mobile/AgentDetailMobile';
import CommissionsMobile from '../mobile/CommissionsMobile';
import SubscribersMobile from '../mobile/SubscribersMobile';
import SubscriberDetailMobile from '../mobile/SubscriberDetailMobile';
import ReportsMobile from '../mobile/ReportsMobile';
import ReportViewMobile from '../mobile/ReportViewMobile';
import SupportMobile from '../mobile/SupportMobile';
import ThreadMobile from '../mobile/ThreadMobile';
import SettingsMobile from '../mobile/SettingsMobile';
import DistributorHubMobile from '../mobile/DistributorHubMobile';

import styles from './DistributorMobileShell.module.css';

/**
 * Animated layout route — wraps the routed page in the shell's slide-up
 * transition keyed on pathname, so each distributor screen lands with the same
 * motion as the branch/employer mobile shells. The nested <Routes> live inside,
 * relative to /dashboard.
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
          <Route index element={<DistributorHomeMobile />} />
          <Route path="branches/:branchId" element={<BranchDetailMobile />} />
          <Route path="branches" element={<BranchesMobile />} />
          <Route path="agents/:agentId" element={<AgentDetailMobile />} />
          <Route path="agents" element={<AgentsMobile />} />
          <Route path="commissions" element={<CommissionsMobile />} />
          <Route path="subscribers/:subscriberId" element={<SubscriberDetailMobile />} />
          <Route path="subscribers" element={<SubscribersMobile />} />
          <Route path="reports/:reportId" element={<ReportViewMobile />} />
          <Route path="reports" element={<ReportsMobile />} />
          <Route path="support/:ticketId" element={<ThreadMobile />} />
          <Route path="support" element={<SupportMobile />} />
          <Route path="settings" element={<SettingsMobile />} />
          <Route path="menu" element={<DistributorHubMobile />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * DistributorMobileShell — the distributor-admin PHONE shell (<1024px). A fixed
 * app bar + scrollable <main> with a nested route tree + a five-tab bottom bar,
 * mirroring the shipped branch/employer mobile shells but with the distributor's
 * own destinations (branches / agents / commissions / subscribers / reports /
 * support / settings). The Ask-AI Network Copilot (reused DataCopilotPanel) is
 * owned here. The selector (DashboardShell) decides mobile vs desktop; this is
 * the mobile branch only. No map, no dash/map toggle on the phone.
 */
export default function DistributorMobileShell() {
  const location = useLocation();
  const viewportRef = useRef(null);

  const [askOpen, setAskOpen] = useState(false);
  const openAskAI = useCallback(() => setAskOpen(true), []);

  // Page-scoped back override for the app bar (in-page sub-views step back
  // before leaving the route).
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

  // The real scroll container is .viewport. Reset its scrollTop on route change
  // before paint so each page lands at top.
  useLayoutEffect(() => {
    viewportRef.current?.scrollTo?.(0, 0);
  }, [location.pathname]);

  return (
    <DistributorAppBarContext.Provider value={appBarValue}>
      <div className={styles.shell}>
        <DistributorMobileAppBar onOpenAI={openAskAI} />
        <main ref={viewportRef} className={styles.viewport} id="main" data-mobile-viewport>
          <AnimatedOutlet />
        </main>
        <DistributorBottomTabBar />

        {/* Ask-AI Network Copilot — reused slide-in copilot (self-fetches the
            country rollup; TanStack dedupes into the shared cache). */}
        <DataCopilotPanel open={askOpen} scope="distributor" onClose={() => setAskOpen(false)} />
      </div>
    </DistributorAppBarContext.Provider>
  );
}
