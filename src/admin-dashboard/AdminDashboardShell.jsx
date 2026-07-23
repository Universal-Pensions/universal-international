import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EASE_OUT_EXPO } from '../utils/motion';

import { DashboardProvider, useDashboard } from '../contexts/DashboardContext';
import { AdminPanelProvider, useAdminPanel } from '../contexts/AdminPanelContext';
import { DataScopeProvider } from '../contexts/DataScopeContext';
import { useAuth } from '../contexts/AuthContext';
import { useCurrentEntity } from '../hooks/useEntity';
import { useIsMobile } from '../hooks/useIsMobile';
import { useIsDesktop } from '../hooks/useIsDesktop';
import logo from '../assets/logo.png';
import AdminSidebar from './sidebar/AdminSidebar';
import AdminMobileShell from './shell/AdminMobileShell';
// The admin dashboard mirrors the distributor map-theme, so it reuses the
// distributor's map, overlay chrome, metrics row, and view panels verbatim —
// they are role-blind (RLS scopes the data) and admin now has the SELECT grants.
const UgandaMap = lazy(() => import('../dashboard/map/UgandaMap'));
import OverlayPanel from '../dashboard/overlay/OverlayPanel';
import DataCopilotPanel, { AskAiFab } from '../dashboard/overlay/DataCopilotPanel';
import Breadcrumb from '../dashboard/overlay/Breadcrumb';
import MetricsRow from '../dashboard/cards/MetricsRow';
import TopBar from '../dashboard/overlay/TopBar';
import ViewBranches from '../dashboard/branch/ViewBranches';
import ViewAgents from '../dashboard/agent/ViewAgents';
import ViewSubscribers from '../dashboard/subscriber/ViewSubscribers';
import ViewReports from '../dashboard/reports/ViewReports';
import Settings from '../dashboard/settings/Settings';
import ViewTickets from '../dashboard/tickets/ViewTickets';
// Admin-exclusive: country-level Summary card (true platform totals + distributor/
// employer framing) shown instead of the distributor OverlayPanel at country level.
import AdminCountryOverview from './AdminCountryOverview';
// Admin-exclusive: rich national KPI landing shown in dash mode at country level
// (the two-mode analogue of the distributor's DistributorOverview).
import AdminOverview from './overview/AdminOverview';
// Admin-exclusive panels.
import ViewDistributors from './distributors/ViewDistributors';
import CreateDistributor from './distributors/CreateDistributor';
import ViewEmployers from './employers/ViewEmployers';
import CreateEmployer from './employers/CreateEmployer';
import ViewEmployerDetail from './employers/ViewEmployerDetail';
// Reuse the distributor shell layout styles for pixel-identical chrome.
import styles from '../dashboard/DashboardShell.module.css';

const DRAWER_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'distributors', label: 'Distributors' },
  { id: 'employers', label: 'Employers' },
  { id: 'branches', label: 'View Branches' },
  { id: 'agents', label: 'View Agents' },
  { id: 'subscribers', label: 'Subscribers' },
  { id: 'tickets', label: 'Support' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
];

function MobileHeader({ onMenuToggle, menuOpen }) {
  const { level, drillUp, reset } = useDashboard();
  const isDeep = level !== 'country';

  function handleBack() {
    if (level === 'region') reset();
    else drillUp(level);
  }

  return (
    <div className={styles.mobileHeader}>
      <div className={styles.mobileHeaderLeft}>
        {isDeep && (
          <button className={styles.backBtn} onClick={handleBack} aria-label="Go back">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
              <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <img src={logo} alt="Universal Pensions" className={styles.mobileHeaderLogo} width={120} height={36} />
      </div>
      <button
        className={styles.hamburger}
        onClick={onMenuToggle}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        aria-controls="admin-mobile-drawer"
      >
        <span className={styles.hamburgerLine} data-open={menuOpen} />
        <span className={styles.hamburgerLine} data-open={menuOpen} />
        <span className={styles.hamburgerLine} data-open={menuOpen} />
      </button>
    </div>
  );
}

function MobileDrawer({ open, onClose }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const {
    reset,
    setBranchMenuOpen, setCreateBranchOpen, setViewBranchesOpen,
    setAgentMenuOpen, setViewAgentsOpen,
    setViewSubscribersOpen,
    setViewReportsOpen,
    setSettingsOpen,
    setViewTicketsOpen,
  } = useDashboard();
  const {
    setViewDistributorsOpen,
    setViewEmployersOpen,
    closeAllPanels: adminCloseAllPanels,
  } = useAdminPanel();

  useEffect(() => {
    if (!open) return;
    function handleEsc(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  function handleItem(id) {
    onClose();
    // Close every panel (reused + admin) so only one slide-in shows.
    setBranchMenuOpen(false);
    setAgentMenuOpen(false);
    setViewBranchesOpen(false);
    setViewAgentsOpen(false);
    setViewSubscribersOpen(false);
    setCreateBranchOpen(false);
    setViewReportsOpen(false);
    setSettingsOpen(false);
    setViewTicketsOpen(false);
    adminCloseAllPanels();

    switch (id) {
      case 'overview':
        reset();
        break;
      case 'distributors':
        setViewDistributorsOpen(true);
        break;
      case 'employers':
        setViewEmployersOpen(true);
        break;
      case 'branches':
        setViewBranchesOpen(true);
        break;
      case 'agents':
        setViewAgentsOpen(true);
        break;
      case 'subscribers':
        setViewSubscribersOpen(true);
        break;
      case 'tickets':
        setViewTicketsOpen(true);
        break;
      case 'reports':
        setViewReportsOpen(true);
        break;
      case 'settings':
        setSettingsOpen(true);
        break;
      default:
        break;
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={styles.drawerOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            id="admin-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Admin dashboard menu"
            className={styles.drawer}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
          >
            <nav className={styles.drawerNav}>
              {DRAWER_ITEMS.map((item) => (
                <button key={item.id} className={styles.drawerItem} onClick={() => handleItem(item.id)}>
                  {item.label}
                </button>
              ))}
            </nav>
            <button
              className={styles.drawerLogout}
              onClick={() => { onClose(); logout(); navigate('/'); }}
            >
              Log out
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const LEVEL_NAMES = { country: 'National Overview', region: 'Region', district: 'District', branch: 'Branch', agent: 'Agent' };

function NavAnnouncer() {
  const { level, selectedIds } = useDashboard();
  const { data: entity } = useCurrentEntity(level, selectedIds);
  const announcement = useMemo(() => {
    if (level === 'country') return 'Now viewing National Overview';
    if (entity?.name) return `Now viewing ${entity.name} ${LEVEL_NAMES[level] || ''}`;
    return '';
  }, [level, entity?.name]);

  return (
    <div
      aria-live="polite"
      style={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {announcement}
    </div>
  );
}

function AdminDashboardContent({ mode, mapMounted }) {
  const isMobile = useIsMobile();
  // Lazy-mount panels so their data hooks don't fire on dashboard cold load
  // (mirrors the distributor shell's AUDIT-1-10 fix).
  const {
    level,
    viewBranchesOpen,
    viewAgentsOpen,
    viewSubscribersOpen,
    viewReportsOpen,
    settingsOpen,
    viewTicketsOpen,
    drillTargetBranchId,
    drillTargetAgentId,
  } = useDashboard();
  const {
    viewDistributorsOpen,
    createDistributorOpen,
    viewEmployersOpen,
    createEmployerOpen,
    viewEmployerDetailOpen,
    setViewEmployerDetailOpen,
    setDetailEmployerId,
    copilotOpen,
    setCopilotOpen,
  } = useAdminPanel();
  // Open the employer detail panel focused on the clicked employer (from the map
  // district drill-down's Employers tab) — mirrors clicking a branch.
  const handleEmployerSelect = useCallback((id) => {
    setDetailEmployerId(id);
    setViewEmployerDetailOpen(true);
  }, [setDetailEmployerId, setViewEmployerDetailOpen]);

  // Dashboard mode is a DESKTOP concept — mobile never mounts the map and keeps
  // its existing overlay-summary + slide-in-drawer tree unchanged.
  const dashMode = mode === 'dash' && !isMobile;

  // Which page fills the dash canvas. LIST/leaf pages only — the create forms +
  // employer-detail render as slide-in overlays ON TOP of the full-page list
  // (below), never as the canvas itself. Same open-flag precedence as the
  // sidebar's `active` highlight so the two never disagree.
  const selectedPage =
    viewTicketsOpen ? 'tickets' :
    viewReportsOpen ? 'reports' :
    settingsOpen ? 'settings' :
    viewDistributorsOpen ? 'distributors' :
    viewEmployersOpen ? 'employers' :
    viewBranchesOpen ? 'branches' :
    viewAgentsOpen ? 'agents' :
    viewSubscribersOpen ? 'subscribers' :
    'overview';

  return (
    <>
      <main className={dashMode ? `${styles.main} ${styles.mainDash}` : styles.main} id="main">
        <NavAnnouncer />
        {/* Map: built lazily on the first map-mode entry, then kept mounted and
            hidden via CSS in dash mode so its Leaflet instance + drill state
            survive across toggles. */}
        {!isMobile && mapMounted && (
          <div className={dashMode ? styles.mapHidden : styles.mapWrap}>
            <Suspense fallback={null}>
              <UgandaMap visible={mode === 'map'} />
            </Suspense>
          </div>
        )}
        {/* Map-mode chrome (also the mobile overlay tree — mobile is never dashMode).
            Admin-framed Summary at country level; the distributor overlay handles
            deeper geographic drill-down (region/district/branch/agent). */}
        {!dashMode && <Breadcrumb />}
        {!dashMode && (level === 'country'
          ? <AdminCountryOverview />
          : <OverlayPanel onEmployerSelect={handleEmployerSelect} />)}
        {!dashMode && <TopBar />}
        {!dashMode && <MetricsRow />}
        {/* Dash-mode canvas — the selected rail destination rendered full-page. */}
        {dashMode && (
          <div className={styles.dashHost}>
            {selectedPage === 'distributors' && <ViewDistributors fullPage />}
            {selectedPage === 'employers' && <ViewEmployers fullPage />}
            {/* Key by the drill target so clearing it (a rail click in dash mode)
                remounts fresh at the LIST — the panels keep an internal detail view
                that clearing the drill flag alone won't reset. */}
            {selectedPage === 'branches' && <ViewBranches key={`vb-${drillTargetBranchId || 'list'}`} readOnly fullPage />}
            {selectedPage === 'agents' && <ViewAgents key={`va-${drillTargetAgentId || 'list'}`} fullPage showCommissions={false} />}
            {selectedPage === 'subscribers' && <ViewSubscribers fullPage />}
            {selectedPage === 'reports' && <ViewReports fullPage />}
            {selectedPage === 'settings' && <Settings fullPage />}
            {selectedPage === 'tickets' && <ViewTickets fullPage />}
            {/* Country level → the rich national platform dashboard; a deeper drill
                in dash mode (region/district/branch/agent) falls back to the shared
                OverlayPanel summary. */}
            {selectedPage === 'overview' && (level === 'country'
              ? <AdminOverview />
              : <OverlayPanel fullPage onEmployerSelect={handleEmployerSelect} />)}
          </div>
        )}
      </main>
      {/* Admin sub-panels that layer ON TOP — rendered in BOTH modes so they
          overlay either the map-mode drawers or the dash-mode full-page list.
          NB: no <CreateBranch> — admins have no branch-INSERT RLS grant. */}
      {createDistributorOpen && <CreateDistributor />}
      {createEmployerOpen && <CreateEmployer />}
      {viewEmployerDetailOpen && <ViewEmployerDetail />}
      {/* Map-mode-only list drawers — in dash mode these same pages render
          full-page inside <main> above instead (never a double mount). */}
      {!dashMode && viewDistributorsOpen && <ViewDistributors />}
      {!dashMode && viewEmployersOpen && <ViewEmployers />}
      {!dashMode && viewBranchesOpen && <ViewBranches readOnly />}
      {!dashMode && viewAgentsOpen && <ViewAgents showCommissions={false} />}
      {!dashMode && viewSubscribersOpen && <ViewSubscribers />}
      {!dashMode && viewReportsOpen && <ViewReports />}
      {!dashMode && settingsOpen && <Settings />}
      {!dashMode && viewTicketsOpen && <ViewTickets />}
      {/* Ask-AI Platform Copilot — additive FAB + slide-in drawer; the map/overlay
          are untouched. */}
      <AskAiFab onClick={() => setCopilotOpen(true)} />
      {copilotOpen && (
        <DataCopilotPanel open scope="admin" onClose={() => setCopilotOpen(false)} />
      )}
    </>
  );
}

function AdminDesktopShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop rail expand/collapse. Defaults expanded so the wordmark logo + nav
  // labels show; the rail collapses to the 64px icon-only form via its toggle.
  const [railExpanded, setRailExpanded] = useState(true);
  const handleRailToggle = useCallback(() => setRailExpanded((v) => !v), []);
  // Whole-shell view mode. 'dash' = branch-admin dashboard (default, a full-page
  // view per rail destination); 'map' = the Leaflet drill-down with slide-in
  // panels. Local shell state (parallels railExpanded) — kept out of the shared
  // contexts so the distributor + other roles are untouched. Page selection is
  // the panel-open booleans / URL drill state, orthogonal to mode, so toggling
  // mode preserves the current page for free.
  const [mode, setMode] = useState('dash');
  // Leaflet is expensive and cannot lay out while hidden, so defer mounting
  // UgandaMap until the first map-mode entry. Once mounted it stays mounted —
  // dash mode just hides it via CSS so the instance + drill state survive.
  const [mapMounted, setMapMounted] = useState(false);
  const handleToggleMode = useCallback(() => {
    setMode((m) => {
      const next = m === 'map' ? 'dash' : 'map';
      if (next === 'map') setMapMounted(true);
      return next;
    });
  }, []);
  const handleMenuToggle = useCallback(() => setMenuOpen((o) => !o), []);
  const handleMenuClose = useCallback(() => setMenuOpen(false), []);
  return (
    <div className={styles.shell} data-rail={railExpanded ? 'expanded' : 'collapsed'}>
      <AdminSidebar
        expanded={railExpanded}
        onToggleExpand={handleRailToggle}
        mapMode={mode === 'map'}
        onToggleMapMode={handleToggleMode}
      />
      <MobileHeader onMenuToggle={handleMenuToggle} menuOpen={menuOpen} />
      <MobileDrawer open={menuOpen} onClose={handleMenuClose} />
      <AdminDashboardContent mode={mode} mapMounted={mapMounted} />
    </div>
  );
}

/**
 * AdminDashboardShell — the super-admin role entry. Selects the phone shell
 * (AdminMobileShell) below 1024px and the desktop two-mode (dash⇄map) rail shell
 * at/above it, both inside the same DashboardProvider → AdminPanelProvider →
 * DataScopeProvider(defaultScope="all") stack so platform scope + panel state are
 * continuous across a resize. The pre-redesign hamburger-drawer mobile experience
 * is retired in favour of AdminMobileShell.
 */
export default function AdminDashboardShell() {
  const isDesktop = useIsDesktop();
  return (
    <DashboardProvider>
      <AdminPanelProvider>
        <DataScopeProvider defaultScope="all">
          {isDesktop ? <AdminDesktopShell /> : <AdminMobileShell />}
        </DataScopeProvider>
      </AdminPanelProvider>
    </DashboardProvider>
  );
}
