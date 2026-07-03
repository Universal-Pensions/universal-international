import { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { useDashboardNav } from './DashboardNavContext';

/**
 * @typedef {Object} DashboardPanelContextValue
 * @property {boolean} branchMenuOpen
 * @property {(open: boolean) => void} setBranchMenuOpen
 * @property {boolean} createBranchOpen
 * @property {(open: boolean) => void} setCreateBranchOpen
 * @property {boolean} viewBranchesOpen
 * @property {(open: boolean) => void} setViewBranchesOpen
 * @property {boolean} agentMenuOpen
 * @property {(open: boolean) => void} setAgentMenuOpen
 * @property {boolean} createAgentOpen
 * @property {(open: boolean) => void} setCreateAgentOpen
 * @property {boolean} viewAgentsOpen
 * @property {(open: boolean) => void} setViewAgentsOpen
 * @property {boolean} subscriberMenuOpen
 * @property {(open: boolean) => void} setSubscriberMenuOpen
 * @property {boolean} viewSubscribersOpen
 * @property {(open: boolean) => void} setViewSubscribersOpen
 * @property {boolean} viewReportsOpen
 * @property {(open: boolean) => void} setViewReportsOpen
 * @property {boolean} commissionsOpen
 * @property {(open: boolean) => void} setCommissionsOpen
 * @property {boolean} settingsOpen
 * @property {(open: boolean) => void} setSettingsOpen
 * @property {boolean} viewTicketsOpen
 * @property {(open: boolean) => void} setViewTicketsOpen
 * @property {boolean} copilotOpen - Ask-AI "Network Copilot" drawer
 * @property {(open: boolean) => void} setCopilotOpen
 * @property {string|null} reportContext - Report ID for auto-navigation
 * @property {(id: string|null) => void} setReportContext
 * @property {() => void} closeAllPanels - Close every slide-in panel
 */

const DashboardPanelContext = createContext(null);

export function DashboardPanelProvider({ children }) {
  // Sidebar submenu state is *derived* from a manual override OR whether a
  // related slide-in panel is open. Modelling it this way means external
  // openers (overlay click, drill-down) automatically flip the submenu open
  // without anyone needing setState-in-effect plumbing.
  const [manualBranchMenu, setManualBranchMenu] = useState(false);
  const [manualAgentMenu, setManualAgentMenu] = useState(false);
  const [manualSubscriberMenu, setManualSubscriberMenu] = useState(false);

  const [createBranchOpen, setCreateBranchOpen] = useState(false);
  const [viewBranchesOpen, setViewBranchesOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [viewAgentsOpen, setViewAgentsOpen] = useState(false);
  const [viewSubscribersOpen, setViewSubscribersOpen] = useState(false);
  const [viewReportsOpen, setViewReportsOpen] = useState(false);
  const [commissionsOpen, setCommissionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewTicketsOpen, setViewTicketsOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [reportContext, setReportContext] = useState(null);

  const { drillTargetBranchId, drillTargetAgentId } = useDashboardNav();

  // Submenu is open if user toggled it manually OR a related panel is open
  // (and we're not in drill-down mode where the parent district view matters).
  const branchMenuOpen =
    manualBranchMenu || ((createBranchOpen || viewBranchesOpen) && !drillTargetBranchId);
  const agentMenuOpen =
    manualAgentMenu || ((createAgentOpen || viewAgentsOpen) && !drillTargetAgentId);
  const subscriberMenuOpen = manualSubscriberMenu || viewSubscribersOpen;

  // Setter accepts boolean or updater fn — toggles the manual override only.
  // The derived value still respects panel-open state.
  const setBranchMenuOpen = useCallback((next) => {
    setManualBranchMenu((prev) => (typeof next === 'function' ? next(prev) : next));
  }, []);
  const setAgentMenuOpen = useCallback((next) => {
    setManualAgentMenu((prev) => (typeof next === 'function' ? next(prev) : next));
  }, []);
  const setSubscriberMenuOpen = useCallback((next) => {
    setManualSubscriberMenu((prev) => (typeof next === 'function' ? next(prev) : next));
  }, []);

  // Register panel setters into the nav context's onPanelActionRef ref so
  // nav-driven effects (auto-open on drill-down) can call them.
  const { onPanelActionRef } = useDashboardNav();

  useEffect(() => {
    onPanelActionRef.current = {
      setViewBranchesOpen,
      setViewAgentsOpen,
      setViewReportsOpen,
      setBranchMenuOpen,
      setAgentMenuOpen,
    };
    return () => { onPanelActionRef.current = null; };
  }, [onPanelActionRef, setBranchMenuOpen, setAgentMenuOpen]);

  /* Close every slide-in panel — used by single-panel layouts (e.g. branch
     dashboard) to guarantee panels never stack on top of each other. Also
     drops any manual submenu overrides so the sidebar collapses cleanly. */
  const closeAllPanels = useCallback(() => {
    setManualBranchMenu(false);
    setManualAgentMenu(false);
    setManualSubscriberMenu(false);
    setCreateBranchOpen(false);
    setViewBranchesOpen(false);
    setCreateAgentOpen(false);
    setViewAgentsOpen(false);
    setViewSubscribersOpen(false);
    setViewReportsOpen(false);
    setCommissionsOpen(false);
    setSettingsOpen(false);
    setViewTicketsOpen(false);
    setCopilotOpen(false);
  }, []);

  const value = useMemo(() => ({
    branchMenuOpen, setBranchMenuOpen,
    createBranchOpen, setCreateBranchOpen,
    viewBranchesOpen, setViewBranchesOpen,
    agentMenuOpen, setAgentMenuOpen,
    createAgentOpen, setCreateAgentOpen,
    viewAgentsOpen, setViewAgentsOpen,
    subscriberMenuOpen, setSubscriberMenuOpen,
    viewSubscribersOpen, setViewSubscribersOpen,
    viewReportsOpen, setViewReportsOpen,
    commissionsOpen, setCommissionsOpen,
    settingsOpen, setSettingsOpen,
    viewTicketsOpen, setViewTicketsOpen,
    copilotOpen, setCopilotOpen,
    reportContext, setReportContext,
    closeAllPanels,
  }), [
    branchMenuOpen, createBranchOpen, viewBranchesOpen,
    agentMenuOpen, createAgentOpen, viewAgentsOpen,
    subscriberMenuOpen, viewSubscribersOpen, viewReportsOpen,
    commissionsOpen, settingsOpen, viewTicketsOpen, copilotOpen, reportContext,
    closeAllPanels,
    setBranchMenuOpen, setAgentMenuOpen, setSubscriberMenuOpen,
  ]);

  return (
    <DashboardPanelContext value={value}>
      {children}
    </DashboardPanelContext>
  );
}

/**
 * Access the dashboard panel UI state (open/close slide-in panels).
 * @returns {DashboardPanelContextValue}
 */
export function useDashboardPanel() {
  const ctx = useContext(DashboardPanelContext);
  if (!ctx) throw new Error('useDashboardPanel must be used within DashboardPanelProvider');
  return ctx;
}
