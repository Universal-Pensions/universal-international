import { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import { useDashboardNav } from './DashboardNavContext';
import { useAuth } from './AuthContext';

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

// ─── AUDIT A19-001 — session-persisted rail destination ─────────────────────
// Refreshing the distributor/admin DESKTOP shell used to always revert to the
// National Overview, because which rail panel is open lives only in the
// useState booleans below. The URL is deliberately NOT the persistence
// mechanism: CLAUDE.md §4.2 keeps panel/drawer UI state state-based and
// intentionally unrouted for this shell — see DashboardNavContext.jsx's own
// `usesReportsPanel` effect, which actively rewrites `/dashboard/reports`
// back to plain `/dashboard` once it has popped the panel open — and every
// drill navigation in that same file (drillDown/drillUp/goToLevel/reset)
// calls a bare `navigate('/dashboard...')` with no search-param
// preservation, so a `?panel=` query string would be silently stripped on
// the very next unrelated rail/drill click. sessionStorage sidesteps both.
//
// Session-scoped (not localStorage — a stale panel choice should not outlive
// this tab), keyed per ROLE, and gated to exactly the two roles this finding
// names. This context is instantiated fresh by FIVE of six roles — the
// distributor and admin shells via DashboardProvider (DashboardContext.jsx),
// but ALSO the branch shell (BranchDashboardShell.jsx), the agent shell
// (AgentDashboardShell.jsx) and the subscriber shell (indirectly, via
// SubscriberPanelContext.jsx wrapping this same DashboardPanelProvider) —
// none of which are this finding's scope or this agent's write-set. Gating
// on role keeps reload behaviour for those three roles byte-identical to
// before this change; only distributor + admin get the new persistence.
// Best-effort: falls back to in-memory-only on a quota / private-browsing
// error or a non-browser test context, mirroring services/tickets.js's
// A22-006 sessionStorage mirror.
//
// The Ask-AI copilot (`copilotOpen`) is deliberately never persisted here —
// its conversation history is local component state that a refresh already
// discards, so restoring an empty, unprompted-open drawer would be worse
// than leaving it closed.
const PERSISTED_PANEL_ROLES = new Set(['distributor', 'admin']);

function panelStorageKey(role) {
  return `upensions_${role}_panel`;
}

function readPersistedPanelKey(role) {
  if (!PERSISTED_PANEL_ROLES.has(role)) return null;
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(panelStorageKey(role));
  } catch {
    return null;
  }
}

function writePersistedPanelKey(role, key) {
  if (!PERSISTED_PANEL_ROLES.has(role)) return;
  try {
    if (typeof window === 'undefined') return;
    if (key) window.sessionStorage.setItem(panelStorageKey(role), key);
    else window.sessionStorage.removeItem(panelStorageKey(role));
  } catch {
    // Quota / private-browsing — non-fatal. The panel still opens correctly
    // for this render; it just won't survive a refresh this particular time.
  }
}

const DashboardPanelContext = createContext(null);

export function DashboardPanelProvider({ children }) {
  // AUDIT A19-001 — see the module comment above. `role` both scopes the
  // sessionStorage key (so a distributor and an admin session sharing a tab
  // never rehydrate each other's last-open panel) and gates the feature to
  // exactly the two roles this finding names.
  const { role } = useAuth();

  // Sidebar submenu state is *derived* from a manual override OR whether a
  // related slide-in panel is open. Modelling it this way means external
  // openers (overlay click, drill-down) automatically flip the submenu open
  // without anyone needing setState-in-effect plumbing.
  const [manualBranchMenu, setManualBranchMenu] = useState(false);
  const [manualAgentMenu, setManualAgentMenu] = useState(false);
  const [manualSubscriberMenu, setManualSubscriberMenu] = useState(false);

  // Each initializer reads sessionStorage directly (rather than sharing one
  // hoisted variable) — React only ever invokes a useState lazy initializer
  // once, on mount, so this is a handful of cheap synchronous reads at cold
  // load, not a per-render cost. `createAgentOpen` is deliberately excluded:
  // it is legacy context state with no rendered page behind it (grep the
  // dashboard shells — nothing reads it to show a create-agent panel), so it
  // is not a "rail destination" worth restoring.
  const [createBranchOpen, setCreateBranchOpen] = useState(() => readPersistedPanelKey(role) === 'createBranch');
  const [viewBranchesOpen, setViewBranchesOpen] = useState(() => readPersistedPanelKey(role) === 'branches');
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [viewAgentsOpen, setViewAgentsOpen] = useState(() => readPersistedPanelKey(role) === 'agents');
  const [viewSubscribersOpen, setViewSubscribersOpen] = useState(() => readPersistedPanelKey(role) === 'subscribers');
  const [viewReportsOpen, setViewReportsOpen] = useState(() => readPersistedPanelKey(role) === 'reports');
  const [commissionsOpen, setCommissionsOpen] = useState(() => readPersistedPanelKey(role) === 'commissions');
  const [settingsOpen, setSettingsOpen] = useState(() => readPersistedPanelKey(role) === 'settings');
  const [viewTicketsOpen, setViewTicketsOpen] = useState(() => readPersistedPanelKey(role) === 'tickets');
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

  // AUDIT A19-001 — derive which single rail destination is currently active,
  // matching DashboardShell.jsx / AdminDashboardShell.jsx's `selectedPage`
  // precedence (those Shells also layer a `childList === 'subscriber'` URL
  // override on TOP of this, which already correctly restores on reload via
  // routing — see the module comment above — so it is deliberately not
  // reproduced here). Sidebar.jsx / AdminSidebar.jsx's click handlers enforce
  // single-open (closeAllPanels() before setting the target), so at most one
  // of these flags is ever true and the precedence order below only matters
  // as a defensive tie-break.
  const activePanelKey = useMemo(() => {
    if (viewTicketsOpen) return 'tickets';
    if (viewReportsOpen) return 'reports';
    if (commissionsOpen) return 'commissions';
    if (settingsOpen) return 'settings';
    if (createBranchOpen) return 'createBranch';
    if (viewBranchesOpen) return 'branches';
    if (viewAgentsOpen) return 'agents';
    if (viewSubscribersOpen) return 'subscribers';
    return null;
  }, [
    viewTicketsOpen, viewReportsOpen, commissionsOpen, settingsOpen,
    createBranchOpen, viewBranchesOpen, viewAgentsOpen, viewSubscribersOpen,
  ]);

  useEffect(() => {
    writePersistedPanelKey(role, activePanelKey);
  }, [role, activePanelKey]);

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
