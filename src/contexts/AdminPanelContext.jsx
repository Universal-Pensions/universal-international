import { createContext, useContext, useState, useMemo, useCallback } from 'react';

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

const AdminPanelContext = createContext(null);

export function AdminPanelProvider({ children }) {
  const [viewDistributorsOpen, setViewDistributorsOpen] = useState(false);
  const [createDistributorOpen, setCreateDistributorOpen] = useState(false);
  const [viewEmployersOpen, setViewEmployersOpen] = useState(false);
  const [createEmployerOpen, setCreateEmployerOpen] = useState(false);
  // Employer DETAIL panel — opened by clicking an employer in the map district
  // drill-down (mirrors the branch detail). `detailEmployerId` is the focused
  // employer; the panel reads it + `viewEmployerDetailOpen` to render.
  const [viewEmployerDetailOpen, setViewEmployerDetailOpen] = useState(false);
  const [detailEmployerId, setDetailEmployerId] = useState(null);
  // Pending employer/distributor access requests (from the public request-access
  // lead form) awaiting admin approval.
  const [viewAccessRequestsOpen, setViewAccessRequestsOpen] = useState(false);
  // Death-benefit claims filed by nominees through the public /claim form
  // (migration 0100). Distinct from `claims`, which are the member's own
  // hospital-cash claims and never need admin triage.
  const [viewNomineeClaimsOpen, setViewNomineeClaimsOpen] = useState(false);
  // Fund unit price (NAV) register + publish page (migrations 0103-0105). A
  // money surface: publishing a price revalues every member's savings.
  const [viewNavOpen, setViewNavOpen] = useState(false);
  // Needs-attention drill-down. Holds the SIGNAL ID rather than a boolean,
  // because one generic page serves all nine drillable signals — the shell reads
  // `attentionType != null` as "the attention page is open" and the page itself
  // reads the value to know which list to fetch. Desktop admin has no routes, so
  // this is the only place that state can live.
  const [attentionType, setAttentionType] = useState(null);
  // Ask-AI "Platform Copilot" drawer (map-overlay shell FAB).
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
