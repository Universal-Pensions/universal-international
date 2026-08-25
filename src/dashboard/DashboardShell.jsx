import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EASE_OUT_EXPO } from '../utils/motion';

import { DashboardProvider, useDashboard } from '../contexts/DashboardContext';
import { useAuth } from '../contexts/AuthContext';
import { useCurrentEntity } from '../hooks/useEntity';
import { useIsMobile } from '../hooks/useIsMobile';
import { useIsDesktop } from '../hooks/useIsDesktop';
import logo from '../assets/logo.png';
import Sidebar from './sidebar/Sidebar';
import DistributorMobileShell from './shell/DistributorMobileShell';
// UgandaMap pulls leaflet + react-leaflet (~114 KB gzip + Leaflet CSS).
// React.lazy here means the landing page bundle no longer modulepreloads
// `vendor-leaflet` (PR-7 partial — AUDIT-3-*).
const UgandaMap = lazy(() => import('./map/UgandaMap'));
import OverlayPanel from './overlay/OverlayPanel';
import DistributorOverview from './overview/DistributorOverview';
import DataCopilotPanel, { AskAiFab } from './overlay/DataCopilotPanel';
import Breadcrumb from './overlay/Breadcrumb';
import CreateBranch from './branch/CreateBranch';
import ViewBranches from './branch/ViewBranches';
import ViewAgents from './agent/ViewAgents';
import ViewSubscribers from './subscriber/ViewSubscribers';
import ViewReports from './reports/ViewReports';
import CommissionPanel from './commissions/CommissionPanel';
import Settings from './settings/Settings';
import ViewTickets from './tickets/ViewTickets';
import styles from './DashboardShell.module.css';

const DRAWER_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'branches', label: 'View Branches' },
  { id: 'agents', label: 'View Agents' },
  { id: 'subscribers', label: 'Subscribers' },
  { id: 'commissions', label: 'Commissions' },
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
        aria-controls="distributor-mobile-drawer"
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
    setCommissionsOpen,
    setSettingsOpen,
    setViewTicketsOpen,
    setCopilotOpen,
  } = useDashboard();

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
    // Close all panels first
    setBranchMenuOpen(false);
    setAgentMenuOpen(false);
    setViewBranchesOpen(false);
    setViewAgentsOpen(false);
    setViewSubscribersOpen(false);
    setCreateBranchOpen(false);
    setViewReportsOpen(false);
    setCommissionsOpen(false);
    setSettingsOpen(false);
    setViewTicketsOpen(false);
    setCopilotOpen(false);

    switch (id) {
      case 'overview':
        reset();
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
      case 'commissions':
        setCommissionsOpen(true);
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
            id="distributor-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Distributor dashboard menu"
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

function DashboardContent({ mode, mapMounted }) {
  const isMobile = useIsMobile();
  // Lazy-mount panels so their data hooks don't fire on dashboard cold load.
  // Before PR-3, all seven panel components were mounted unconditionally,
  // collectively firing 24 simultaneous Supabase requests at first paint
  // (AUDIT-1-10). Each panel still has its own AnimatePresence/motion.div
  // entrance — these guards only delay the React mount + data-hook fire
  // until the user opens the panel for the first time.
  const {
    createBranchOpen,
    viewBranchesOpen,
    viewAgentsOpen,
    viewSubscribersOpen,
    viewReportsOpen,
    commissionsOpen,
    settingsOpen,
    viewTicketsOpen,
    copilotOpen,
    setCopilotOpen,
    drillTargetBranchId,
    drillTargetAgentId,
    level,
    childList,
    childListParentId,
  } = useDashboard();

  // Ask-AI trigger ref + a close handler that restores focus to it (AUDIT
  // A19-006) — the bare `setCopilotOpen(false)` this used to pass left focus
  // stranded wherever Tab last moved it in the background sidebar. Mirrors
  // `closeCopilot` in the four routed shells (e.g. SubscriberDesktopShell).
  const askAiRef = useRef(null);
  const closeCopilot = useCallback(() => {
    setCopilotOpen(false);
    requestAnimationFrame(() => askAiRef.current?.focus());
  }, [setCopilotOpen]);

  // Dashboard mode is a DESKTOP concept — mobile never mounts the map and keeps
  // its existing overlay-summary + slide-in-drawer tree unchanged.
  const dashMode = mode === 'dash' && !isMobile;

  // Which page fills the dash-mode canvas. Same open-flag precedence as the
  // sidebar's `active` highlight, so the two never disagree. In dash mode the
  // sidebar enforces single-open, so at most one flag is true; the precedence
  // just makes the fallback deterministic.
  //
  // A /dashboard/{agents,branches}/:id/subscribers URL wins outright: it is an
  // explicit routed destination, so it must not be overridden by whichever panel
  // flag happens to be set from the click that navigated here.
  const selectedPage =
    childList === 'subscriber' ? 'subscribers' :
    viewTicketsOpen ? 'tickets' :
    viewReportsOpen ? 'reports' :
    commissionsOpen ? 'commissions' :
    settingsOpen ? 'settings' :
    createBranchOpen ? 'createBranch' :
    viewBranchesOpen ? 'branches' :
    viewAgentsOpen ? 'agents' :
    viewSubscribersOpen ? 'subscribers' :
    'overview';

  return (
    <>
      <main className={dashMode ? `${styles.main} ${styles.mainDash}` : styles.main} id="main" tabIndex={-1}>
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
        {/* Map-mode chrome (also the mobile overlay tree — mobile is never dashMode). */}
        {!dashMode && <Breadcrumb />}
        {!dashMode && <OverlayPanel />}
        {/* Dash-mode canvas — the selected rail destination rendered full-page.
            The same component is NOT also rendered as a sibling drawer below
            (that block is gated to !dashMode), so there is never a double mount. */}
        {dashMode && (
          <div className={styles.dashHost}>
            {/* Key by the drill target so clearing it (a rail click in dash mode)
                remounts fresh at the LIST — ViewBranches/ViewAgents keep an
                internal detail view that clearing the drill flag alone won't reset. */}
            {selectedPage === 'branches' && <ViewBranches key={`vb-${drillTargetBranchId || 'list'}`} fullPage />}
            {selectedPage === 'agents' && <ViewAgents key={`va-${drillTargetAgentId || 'list'}`} fullPage />}
            {selectedPage === 'subscribers' && (
              <ViewSubscribers
                // Remount when the scope changes so the panel's internal
                // list/detail view resets to the list for a new parent.
                key={`vs-${childListParentId || 'all'}`}
                fullPage
                scope={childListParentId
                  ? (level === 'agent'
                      ? { agentId: childListParentId }
                      : { branchId: childListParentId })
                  : null}
              />
            )}
            {selectedPage === 'commissions' && <CommissionPanel fullPage />}
            {selectedPage === 'reports' && <ViewReports fullPage />}
            {selectedPage === 'settings' && <Settings fullPage />}
            {selectedPage === 'tickets' && <ViewTickets fullPage />}
            {selectedPage === 'createBranch' && <CreateBranch fullPage />}
            {/* Country level → the rich national dashboard; a deeper drill in dash
                mode (region/district) falls back to the OverlayPanel summary. */}
            {selectedPage === 'overview' && (level === 'country'
              ? <DistributorOverview />
              : <OverlayPanel fullPage />)}
          </div>
        )}
      </main>
      {/* Slide-in drawers — map mode + mobile only. In dash mode these same pages
          render full-page inside <main> above instead. */}
      {!dashMode && (
        <>
          {createBranchOpen && <CreateBranch />}
          {viewBranchesOpen && <ViewBranches />}
          {viewAgentsOpen && <ViewAgents />}
          {viewSubscribersOpen && <ViewSubscribers />}
          {viewReportsOpen && <ViewReports />}
          {commissionsOpen && <CommissionPanel />}
          {settingsOpen && <Settings />}
          {viewTicketsOpen && <ViewTickets />}
        </>
      )}
      {/* Ask-AI Network Copilot — additive FAB + slide-in drawer; the map/overlay
          are untouched. */}
      <AskAiFab ref={askAiRef} onClick={() => setCopilotOpen(true)} />
      {copilotOpen && (
        <DataCopilotPanel open scope="distributor" onClose={closeCopilot} />
      )}
    </>
  );
}

function DistributorDesktopShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Desktop rail expand/collapse. Defaults expanded so the wordmark logo + nav
  // labels show; the rail collapses to the 64px icon-only form via its toggle.
  const [railExpanded, setRailExpanded] = useState(true);
  const handleRailToggle = useCallback(() => setRailExpanded((v) => !v), []);
  // Whole-shell view mode. 'dash' = branch-admin dashboard (default, a full-page
  // view per rail destination); 'map' = the Leaflet drill-down with slide-in
  // panels. Local shell state (parallels railExpanded) — kept out of the shared
  // DashboardContext so admin + the other roles are untouched. Page selection is
  // the panel-open booleans / URL drill state, which are orthogonal to mode, so
  // toggling mode preserves the current page for free.
  const [mode, setMode] = useState('dash');
  // Leaflet is expensive and cannot lay out while hidden, so we defer mounting
  // UgandaMap until the first time the user enters map mode (when <main> is
  // visible and correctly sized). Once mounted it stays mounted — dash mode just
  // hides it via CSS so the instance + drill state survive across toggles.
  const [mapMounted, setMapMounted] = useState(false);
  const handleToggleMode = useCallback(() => {
    setMode((m) => {
      const next = m === 'map' ? 'dash' : 'map';
      if (next === 'map') setMapMounted(true);
      return next;
    });
  }, []);
  // Memoised handlers — inline arrows here recreated `onMenuToggle` and
  // `onClose` on every parent render, defeating any memoisation in
  // `MobileHeader`/`MobileDrawer` and re-running the drawer's keydown effect
  // each tick (F23). `setMenuOpen` is a stable setter, so the callbacks are
  // safe to memoise with an empty dep list — the toggle reads the latest
  // value via the functional updater.
  const handleMenuToggle = useCallback(() => setMenuOpen((open) => !open), []);
  const handleMenuClose = useCallback(() => setMenuOpen(false), []);
  return (
    <div className={styles.shell} data-rail={railExpanded ? 'expanded' : 'collapsed'}>
      <Sidebar
        expanded={railExpanded}
        onToggleExpand={handleRailToggle}
        mapMode={mode === 'map'}
        onToggleMapMode={handleToggleMode}
      />
      <MobileHeader onMenuToggle={handleMenuToggle} menuOpen={menuOpen} />
      <MobileDrawer open={menuOpen} onClose={handleMenuClose} />
      <DashboardContent mode={mode} mapMounted={mapMounted} />
    </div>
  );
}

/**
 * DashboardShell — the distributor role entry. Selects the phone shell
 * (DistributorMobileShell, a routed app-bar + bottom-tab PWA) below 1024px and
 * the desktop two-mode (dash⇄map) rail shell at/above it. Both share one
 * DashboardProvider so panel/drill state is continuous across a resize. The
 * pre-redesign hamburger-drawer + overlay-summary mobile experience is retired
 * in favour of DistributorMobileShell.
 */
export default function DashboardShell() {
  const isDesktop = useIsDesktop();
  return (
    <DashboardProvider>
      {isDesktop ? <DistributorDesktopShell /> : <DistributorMobileShell />}
    </DashboardProvider>
  );
}
