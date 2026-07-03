import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EASE_OUT_EXPO } from '../utils/motion';

import { DashboardProvider, useDashboard } from '../contexts/DashboardContext';
import { useAuth } from '../contexts/AuthContext';
import { useCurrentEntity } from '../hooks/useEntity';
import { useIsMobile } from '../hooks/useIsMobile';
import logo from '../assets/logo.png';
import Sidebar from './sidebar/Sidebar';
// UgandaMap pulls leaflet + react-leaflet (~114 KB gzip + Leaflet CSS).
// React.lazy here means the landing page bundle no longer modulepreloads
// `vendor-leaflet` (PR-7 partial — AUDIT-3-*).
const UgandaMap = lazy(() => import('./map/UgandaMap'));
import OverlayPanel from './overlay/OverlayPanel';
import DataCopilotPanel, { AskAiFab } from './overlay/DataCopilotPanel';
import Breadcrumb from './overlay/Breadcrumb';
import MetricsRow from './cards/MetricsRow';
import TopBar from './overlay/TopBar';
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

function DashboardContent() {
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
  } = useDashboard();
  return (
    <>
      <main className={styles.main} id="main">
        <NavAnnouncer />
        {!isMobile && (
          <Suspense fallback={null}>
            <UgandaMap />
          </Suspense>
        )}
        <Breadcrumb />
        <OverlayPanel />
        <TopBar />
        <MetricsRow />
      </main>
      {createBranchOpen && <CreateBranch />}
      {viewBranchesOpen && <ViewBranches />}
      {viewAgentsOpen && <ViewAgents />}
      {viewSubscribersOpen && <ViewSubscribers />}
      {viewReportsOpen && <ViewReports />}
      {commissionsOpen && <CommissionPanel />}
      {settingsOpen && <Settings />}
      {viewTicketsOpen && <ViewTickets />}
      {/* Ask-AI Network Copilot — additive FAB + slide-in drawer; the map/overlay
          are untouched. */}
      <AskAiFab onClick={() => setCopilotOpen(true)} />
      {copilotOpen && (
        <DataCopilotPanel open scope="distributor" onClose={() => setCopilotOpen(false)} />
      )}
    </>
  );
}

export default function DashboardShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  // Memoised handlers — inline arrows here recreated `onMenuToggle` and
  // `onClose` on every parent render, defeating any memoisation in
  // `MobileHeader`/`MobileDrawer` and re-running the drawer's keydown effect
  // each tick (F23). `setMenuOpen` is a stable setter, so the callbacks are
  // safe to memoise with an empty dep list — the toggle reads the latest
  // value via the functional updater.
  const handleMenuToggle = useCallback(() => setMenuOpen((open) => !open), []);
  const handleMenuClose = useCallback(() => setMenuOpen(false), []);
  return (
    <DashboardProvider>
      <div className={styles.shell}>
        <Sidebar />
        <MobileHeader onMenuToggle={handleMenuToggle} menuOpen={menuOpen} />
        <MobileDrawer open={menuOpen} onClose={handleMenuClose} />
        <DashboardContent />
      </div>
    </DashboardProvider>
  );
}
