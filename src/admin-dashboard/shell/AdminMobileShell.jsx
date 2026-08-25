import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EASE_OUT_EXPO } from '../../utils/motion';

import DataCopilotPanel from '../../dashboard/overlay/DataCopilotPanel';
import AdminMobileAppBar from './AdminMobileAppBar';
import AdminBottomTabBar from './AdminBottomTabBar';
import { AdminAppBarContext } from './adminAppBarContext';

// Admin-specific pages.
import AdminHomeMobile from '../mobile/AdminHomeMobile';
import DistributorsMobile from '../mobile/DistributorsMobile';
import DistributorDetailMobile from '../mobile/DistributorDetailMobile';
import EmployersMobile from '../mobile/EmployersMobile';
import EmployerDetailMobile from '../mobile/EmployerDetailMobile';
import AdminNetworkMobile from '../mobile/AdminNetworkMobile';
import AdminSettingsMobile from '../mobile/AdminSettingsMobile';
import AdminAccessRequestsMobile from '../mobile/AdminAccessRequestsMobile';
import AdminNavMobile from '../mobile/AdminNavMobile';
import AdminNomineeClaimsMobile from '../mobile/AdminNomineeClaimsMobile';
import AdminAttentionMobile from '../attention/AdminAttentionMobile';
import AdminHubMobile from '../mobile/AdminHubMobile';

// Reused distributor pages — role-agnostic (RLS scopes the data; admin sees all).
// Support/Thread ride the distributor ticket hooks, which fall back to the 'd-001'
// singleton when there's no distributorId claim — exactly what admin needs.
import BranchesMobile from '../../dashboard/mobile/BranchesMobile';
import BranchDetailMobile from '../../dashboard/mobile/BranchDetailMobile';
import AgentsMobile from '../../dashboard/mobile/AgentsMobile';
import AgentDetailMobile from '../../dashboard/mobile/AgentDetailMobile';
import SubscribersMobile from '../../dashboard/mobile/SubscribersMobile';
import SubscriberDetailMobile from '../../dashboard/mobile/SubscriberDetailMobile';
import ReportsMobile from '../../dashboard/mobile/ReportsMobile';
import ReportViewMobile from '../../dashboard/mobile/ReportViewMobile';
import SupportMobile from '../../dashboard/mobile/SupportMobile';
import ThreadMobile from '../../dashboard/mobile/ThreadMobile';

// Reuse the distributor mobile shell layout styles.
import styles from '../../dashboard/shell/DistributorMobileShell.module.css';

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
          <Route index element={<AdminHomeMobile />} />
          <Route path="distributors/:distributorId" element={<DistributorDetailMobile />} />
          <Route path="distributors" element={<DistributorsMobile />} />
          <Route path="employers/:employerId" element={<EmployerDetailMobile />} />
          <Route path="employers" element={<EmployersMobile />} />
          <Route path="access-requests" element={<AdminAccessRequestsMobile />} />
          <Route path="nav" element={<AdminNavMobile />} />
          {/* Death-benefit claims from the public /claim form. The desktop
              equivalent is a context-driven panel the phone shell can't mount,
              so without this route the queue was desktop-only. */}
          <Route path="nominee-claims" element={<AdminNomineeClaimsMobile />} />
          {/* Needs-attention drill-down. Must precede the "*" catch-all below,
              which would otherwise swallow it back to the home route. */}
          <Route path="attention/:type" element={<AdminAttentionMobile />} />
          <Route path="network" element={<AdminNetworkMobile />} />
          <Route path="branches/:branchId" element={<BranchDetailMobile />} />
          <Route path="branches" element={<BranchesMobile />} />
          <Route path="agents/:agentId" element={<AgentDetailMobile />} />
          <Route path="agents" element={<AgentsMobile />} />
          <Route path="subscribers/:subscriberId" element={<SubscriberDetailMobile />} />
          <Route path="subscribers" element={<SubscribersMobile />} />
          <Route path="reports/:reportId" element={<ReportViewMobile />} />
          <Route path="reports" element={<ReportsMobile />} />
          <Route path="support/:ticketId" element={<ThreadMobile />} />
          <Route path="support" element={<SupportMobile />} />
          <Route path="settings" element={<AdminSettingsMobile />} />
          <Route path="menu" element={<AdminHubMobile />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * AdminMobileShell — the super-admin PHONE shell (<1024px). App bar + scrollable
 * routed canvas + five-tab bottom bar + the Ask-AI Platform Copilot, mirroring
 * the distributor mobile shell. Admin-specific destinations (Distributors,
 * Employers, platform Home) plus reused role-agnostic pages (Branches / Agents /
 * Subscribers / Reports) that show everything under admin RLS. No map on phone.
 */
export default function AdminMobileShell() {
  const location = useLocation();
  const viewportRef = useRef(null);

  const [askOpen, setAskOpen] = useState(false);
  const openAskAI = useCallback(() => setAskOpen(true), []);

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

  useLayoutEffect(() => {
    viewportRef.current?.scrollTo?.(0, 0);
  }, [location.pathname]);

  return (
    <AdminAppBarContext.Provider value={appBarValue}>
      <div className={styles.shell}>
        <AdminMobileAppBar onOpenAI={openAskAI} />
        <main ref={viewportRef} className={styles.viewport} id="main" tabIndex={-1} data-mobile-viewport>
          <AnimatedOutlet />
        </main>
        <AdminBottomTabBar />
        <DataCopilotPanel open={askOpen} scope="admin" onClose={() => setAskOpen(false)} />
      </div>
    </AdminAppBarContext.Provider>
  );
}
