import { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';

/**
 * Net-new panel context for the Admin dashboard. The admin shell reuses the
 * distributor's map drill-down (`DashboardNavContext`) and its shared slide-in
 * panels (`DashboardPanelContext` — branches/agents/subscribers/commissions/
 * reports/support/settings). THIS context adds only the admin-exclusive panels:
 * the platform-wide Distributors and Employers managers, each with a list view
 * and a create form. Mirrors `EmployerPanelContext` — one boolean per panel
 * with an open/close setter, plus `closeAllPanels()` so panels never stack.
 *
 * @typedef {Object} AdminPanelContextValue
 * @property {boolean} viewDistributorsOpen
 * @property {(open: boolean) => void} setViewDistributorsOpen
 * @property {boolean} createDistributorOpen
 * @property {(open: boolean) => void} setCreateDistributorOpen
 * @property {boolean} viewEmployersOpen
 * @property {(open: boolean) => void} setViewEmployersOpen
 * @property {boolean} createEmployerOpen
 * @property {(open: boolean) => void} setCreateEmployerOpen
 * @property {boolean} viewEmployerDetailOpen
 * @property {(open: boolean) => void} setViewEmployerDetailOpen
 * @property {string|null} detailEmployerId
 * @property {(id: string|null) => void} setDetailEmployerId
 * @property {boolean} viewAccessRequestsOpen - pending employer/distributor requests
 * @property {(open: boolean) => void} setViewAccessRequestsOpen
 * @property {boolean} viewNomineeClaimsOpen - life/funeral claims filed by a nominee
 * @property {(open: boolean) => void} setViewNomineeClaimsOpen
 * @property {boolean} viewNavOpen - fund unit-price (NAV) register + publish page
 * @property {(open: boolean) => void} setViewNavOpen
 * @property {string|null} attentionType - open Needs-attention drill-down, by signal id
 * @property {(type: string|null) => void} setAttentionType
 * @property {boolean} copilotOpen - Ask-AI "Platform Copilot" drawer
 * @property {(open: boolean) => void} setCopilotOpen
 * @property {() => void} closeAllPanels
 */

// ─── AUDIT A19-001 — session-persisted admin-exclusive rail destination ────
// Companion to the identically-motivated mechanism in
// DashboardPanelContext.jsx — read that file's header comment for why this
// is sessionStorage and not the URL. This file owns the ADMIN-EXCLUSIVE
// panels (Distributors, Employers, Access requests, Nominee claims, Unit
// price) plus the Needs-attention drill (`attentionType`, a signal id string
// rather than a boolean, so it is encoded here as `attention:<id>`). Unlike
// DashboardPanelContext.jsx, no role-gate is needed: AdminPanelProvider is
// only ever instantiated by AdminDashboardShell.jsx, never reused by another
// role. The shared panels (Branches/Agents/Subscribers/Reports/Settings/
// Tickets) persist themselves independently, under a DIFFERENT storage key,
// in DashboardPanelContext.jsx — AdminSidebar.jsx's click handler always
// clears every flag in BOTH contexts before opening its target, so at most
// one of the two keys is ever non-null and the two mechanisms never race
// over which panel reopens.
const ADMIN_PANEL_STORAGE_KEY = 'upensions_admin_panel_extra';
const ATTENTION_PREFIX = 'attention:';

function readPersistedAdminPanel() {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(ADMIN_PANEL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePersistedAdminPanel(value) {
  try {
    if (typeof window === 'undefined') return;
    if (value) window.sessionStorage.setItem(ADMIN_PANEL_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(ADMIN_PANEL_STORAGE_KEY);
  } catch {
    // Quota / private-browsing — non-fatal, mirrors DashboardPanelContext.jsx.
  }
}

const AdminPanelContext = createContext(null);

export function AdminPanelProvider({ children }) {
  const [viewDistributorsOpen, setViewDistributorsOpen] = useState(() => readPersistedAdminPanel() === 'distributors');
  const [createDistributorOpen, setCreateDistributorOpen] = useState(false);
  const [viewEmployersOpen, setViewEmployersOpen] = useState(() => readPersistedAdminPanel() === 'employers');
  const [createEmployerOpen, setCreateEmployerOpen] = useState(false);
  // Employer DETAIL panel — opened by clicking an employer in the map district
  // drill-down (mirrors the branch detail). `detailEmployerId` is the focused
  // employer; the panel reads it + `viewEmployerDetailOpen` to render. Not
  // persisted (AUDIT A19-001 scoped this to the RAIL destinations only — see
  // the module comment — matching that `selectedPage` in AdminDashboardShell.jsx
  // never renders this as the dash-mode canvas either; it is always a
  // slide-in overlay on top).
  const [viewEmployerDetailOpen, setViewEmployerDetailOpen] = useState(false);
  const [detailEmployerId, setDetailEmployerId] = useState(null);
  // Pending employer/distributor access requests (from the public request-access
  // lead form) awaiting admin approval.
  const [viewAccessRequestsOpen, setViewAccessRequestsOpen] = useState(() => readPersistedAdminPanel() === 'access-requests');
  // Death-benefit claims filed by nominees through the public /claim form
  // (migration 0100). Distinct from `claims`, which are the member's own
  // hospital-cash claims and never need admin triage.
  const [viewNomineeClaimsOpen, setViewNomineeClaimsOpen] = useState(() => readPersistedAdminPanel() === 'nominee-claims');
  // Fund unit price (NAV) register + publish page (migrations 0103-0105). A
  // money surface: publishing a price revalues every member's savings.
  const [viewNavOpen, setViewNavOpen] = useState(() => readPersistedAdminPanel() === 'nav');
  // Needs-attention drill-down. Holds the SIGNAL ID rather than a boolean,
  // because one generic page serves all nine drillable signals — the shell reads
  // `attentionType != null` as "the attention page is open" and the page itself
  // reads the value to know which list to fetch. Desktop admin has no routes, so
  // this is the only place that state can live.
  const [attentionType, setAttentionType] = useState(() => {
    const persisted = readPersistedAdminPanel();
    return persisted && persisted.startsWith(ATTENTION_PREFIX) ? persisted.slice(ATTENTION_PREFIX.length) : null;
  });
  // Ask-AI "Platform Copilot" drawer (map-overlay shell FAB). Deliberately
  // never persisted — see DashboardPanelContext.jsx's module comment.
  const [copilotOpen, setCopilotOpen] = useState(false);

  /* Close every admin slide-in panel. The create panels deliberately stay
     independent of their list panels so "Create" can open over the list. */
  const closeAllPanels = useCallback(() => {
    setViewDistributorsOpen(false);
    setCreateDistributorOpen(false);
    setViewEmployersOpen(false);
    setCreateEmployerOpen(false);
    setViewEmployerDetailOpen(false);
    setViewAccessRequestsOpen(false);
    setViewNomineeClaimsOpen(false);
    setViewNavOpen(false);
    setAttentionType(null);
    setCopilotOpen(false);
  }, []);

  // AUDIT A19-001 — see the module comment above. Precedence order is a
  // defensive tie-break only: AdminSidebar.jsx's click handlers enforce
  // single-open (every flag here is cleared before the target is set), so at
  // most one of these is ever true.
  const persistedPanelKey = useMemo(() => {
    if (attentionType) return `${ATTENTION_PREFIX}${attentionType}`;
    if (viewDistributorsOpen) return 'distributors';
    if (viewEmployersOpen) return 'employers';
    if (viewAccessRequestsOpen) return 'access-requests';
    if (viewNomineeClaimsOpen) return 'nominee-claims';
    if (viewNavOpen) return 'nav';
    return null;
  }, [attentionType, viewDistributorsOpen, viewEmployersOpen, viewAccessRequestsOpen, viewNomineeClaimsOpen, viewNavOpen]);

  useEffect(() => {
    writePersistedAdminPanel(persistedPanelKey);
  }, [persistedPanelKey]);

  const value = useMemo(() => ({
    viewDistributorsOpen, setViewDistributorsOpen,
    createDistributorOpen, setCreateDistributorOpen,
    viewEmployersOpen, setViewEmployersOpen,
    createEmployerOpen, setCreateEmployerOpen,
    viewEmployerDetailOpen, setViewEmployerDetailOpen,
    detailEmployerId, setDetailEmployerId,
    viewAccessRequestsOpen, setViewAccessRequestsOpen,
    viewNomineeClaimsOpen, setViewNomineeClaimsOpen,
    viewNavOpen, setViewNavOpen,
    attentionType, setAttentionType,
    copilotOpen, setCopilotOpen,
    closeAllPanels,
  }), [
    viewDistributorsOpen, createDistributorOpen,
    viewEmployersOpen, createEmployerOpen,
    viewEmployerDetailOpen, detailEmployerId,
    viewAccessRequestsOpen,
    viewNomineeClaimsOpen,
    viewNavOpen,
    attentionType,
    copilotOpen,
    closeAllPanels,
  ]);

  return (
    <AdminPanelContext value={value}>
      {children}
    </AdminPanelContext>
  );
}

/**
 * Access the admin panel UI state (open/close the Distributors / Employers
 * slide-in panels).
 * @returns {AdminPanelContextValue}
 */
export function useAdminPanel() {
  const ctx = useContext(AdminPanelContext);
  if (!ctx) throw new Error('useAdminPanel must be used within AdminPanelProvider');
  return ctx;
}
