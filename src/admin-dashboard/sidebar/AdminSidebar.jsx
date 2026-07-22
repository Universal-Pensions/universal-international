import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { formatNumber } from '../../utils/currency';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useAdminPanel } from '../../contexts/AdminPanelContext';
import { usePlatformOverview } from '../../hooks/useEntity';
import logo from '../../assets/logo.png';
// Reuse the distributor sidebar's styles verbatim so the admin rail is pixel-
// identical to the map-theme it mirrors.
import styles from '../../dashboard/sidebar/Sidebar.module.css';

function formatCount(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return formatNumber(n);
}

// The node-graph mark doubles as the "Distributor Network" group icon — it reads
// as a connected hierarchy (distributor → branches → agents).
const NETWORK_ICON = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
    <circle cx="12" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="12" cy="21" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="3" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <circle cx="21" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
    <path d="M12 4.5v4.5M12 15v4.5M4.5 12H9M15 12h4.5" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);

// Admin-exclusive rail items (platform-wide managers). The distributor hierarchy
// (distributor → branches → agents) is grouped under a single "Distributor
// Network" item whose flyout lists the three; Employers stays its own channel.
const ADMIN_NAV = [
  { id: 'distributor-network', label: 'Distributor Network', icon: NETWORK_ICON },
  {
    id: 'employers',
    label: 'Employers',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M3 10h18" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" strokeWidth="1.75"/>
      </svg>
    ),
  },
];

const MOBILE_NAV = [
  {
    id: 'overview',
    label: 'Overview',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.75"/>
        <rect x="13" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.75"/>
        <rect x="3" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.75"/>
        <rect x="13" y="13" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.75"/>
      </svg>
    ),
  },
  ...ADMIN_NAV,
  {
    id: 'subscribers',
    label: 'Subscribers',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M5 21v-1a7 7 0 0114 0v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
];

const NAV_ITEMS = [
  ...MOBILE_NAV,
  {
    id: 'tickets',
    label: 'Support',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M4 5a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4V5z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
        <path d="M8 8h8M8 11.5h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M7 14l4-4 4 4 5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

const MORE_ITEMS = [
  {
    id: 'reports',
    label: 'Reports',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M7 14l4-4 4 4 5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'logout',
    label: 'Log out',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
];

const BOTTOM_ITEMS = [
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'logout',
    label: 'Log out',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        <polyline points="16,17 21,12 16,7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      </svg>
    ),
  },
];

// "Distributor Network" group flyout — the distributor hierarchy as ordered
// children: Distributors → Branches → Agents. Each opens its (view-only) manager
// panel directly. Admin does NOT create branches/agents (RLS-gated to the
// distributor role), so there are no "Create New" actions here.
const NETWORK_SUB = [
  {
    id: 'distributor',
    label: 'Distributors',
    desc: 'Network operators across the platform',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
        <circle cx="12" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="12" cy="21" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="3" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <circle cx="21" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 4.5v4.5M12 15v4.5M4.5 12H9M15 12h4.5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    id: 'branches',
    label: 'Branches',
    desc: 'Manage and monitor all branches',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M3 21h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M5 21V7l7-4 7 4v14" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        <rect x="9" y="13" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.75" />
      </svg>
    ),
  },
  {
    id: 'agents',
    label: 'Agents',
    desc: 'Manage and monitor all agents',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.75" />
        <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="18" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.75" />
        <path d="M21 21v-1.5a3 3 0 00-3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function AdminSidebar({ expanded = false, onToggleExpand, mapMode = false, onToggleMapMode }) {
  const [hovered, setHovered] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // The "Distributor Network" group flyout (Distributors / Branches / Agents).
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const {
    reset,
    createBranchOpen, setCreateBranchOpen,
    viewBranchesOpen, setViewBranchesOpen,
    viewAgentsOpen, setViewAgentsOpen,
    viewSubscribersOpen, setViewSubscribersOpen, setDrillTargetBranchId,
    setDrillTargetAgentId, viewReportsOpen, setViewReportsOpen,
    settingsOpen, setSettingsOpen, viewTicketsOpen, setViewTicketsOpen,
  } = useDashboard();
  const {
    viewDistributorsOpen, setViewDistributorsOpen, createDistributorOpen, setCreateDistributorOpen,
    viewEmployersOpen, setViewEmployersOpen, createEmployerOpen, setCreateEmployerOpen,
    closeAllPanels: adminCloseAllPanels,
  } = useAdminPanel();

  // True platform totals power the flyout count labels (single RPC call, 5-min
  // staleTime). Uses get_platform_overview so the counts are platform totals.
  const { data: platform } = usePlatformOverview();
  const distributorCount = formatCount(platform?.distributors ?? 0);
  const branchCount = formatCount(platform?.branches ?? 0);
  const agentCount = formatCount(platform?.agents ?? 0);

  const active = useMemo(() => {
    if (viewDistributorsOpen || createDistributorOpen || viewBranchesOpen
        || createBranchOpen || viewAgentsOpen || networkMenuOpen) return 'distributor-network';
    if (viewEmployersOpen || createEmployerOpen) return 'employers';
    if (viewTicketsOpen) return 'tickets';
    if (viewReportsOpen) return 'reports';
    if (settingsOpen) return 'settings';
    if (viewSubscribersOpen) return 'subscribers';
    return 'overview';
  }, [
    viewDistributorsOpen, createDistributorOpen, viewBranchesOpen, createBranchOpen,
    viewAgentsOpen, networkMenuOpen, viewEmployersOpen, createEmployerOpen,
    viewTicketsOpen, viewReportsOpen, settingsOpen, viewSubscribersOpen,
  ]);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  const anyMenuOpen = networkMenuOpen || moreOpen;
  useEffect(() => {
    if (!anyMenuOpen) return;
    const handler = () => {
      if (moreOpen) closeMore();
      // The network flyout is a launcher (a child click already closes it), so an
      // outside click closes it.
      if (networkMenuOpen) setNetworkMenuOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [anyMenuOpen, moreOpen, closeMore, networkMenuOpen]);

  function handleClick(id) {
    setMoreOpen(false);

    // Distributor Network group — toggle the flyout launcher. In MAP mode, close
    // the sibling surfaces (they overlay the map, so only one should show). In
    // DASH mode the launcher must NOT close the current full-page canvas: the
    // page is derived from the view-open flags, so clearing them here would blank
    // the canvas back to Overview and lose the user's page if they dismiss the
    // flyout without picking a child. handleNetworkSub already closes the
    // siblings when a child IS chosen. Never close the group's own child panels.
    if (id === 'distributor-network') {
      if (mapMode) {
        setViewSubscribersOpen(false);
        setViewEmployersOpen(false);
        setCreateEmployerOpen(false);
        setViewReportsOpen(false);
        setViewTicketsOpen(false);
        setSettingsOpen(false);
      }
      setNetworkMenuOpen((prev) => !prev);
      return;
    }

    // Employers (its own channel) — open the admin Employers panel, close the
    // network group + every other entity view.
    if (id === 'employers') {
      setNetworkMenuOpen(false);
      setViewSubscribersOpen(false);
      setViewReportsOpen(false);
      setViewTicketsOpen(false);
      setSettingsOpen(false);
      setViewDistributorsOpen(false);
      setCreateDistributorOpen(false);
      setViewBranchesOpen(false);
      setCreateBranchOpen(false);
      setViewAgentsOpen(false);
      setViewEmployersOpen(true);
      return;
    }

    // Any other action closes the group flyout + every entity panel first.
    setNetworkMenuOpen(false);
    adminCloseAllPanels(); // distributor + employer admin panels
    setViewBranchesOpen(false);
    setCreateBranchOpen(false);
    setViewAgentsOpen(false);

    // Subscribers — open the manager directly (no intermediate menu), mirroring
    // how Employers opens its panel.
    if (id === 'subscribers') {
      setViewReportsOpen(false);
      setViewTicketsOpen(false);
      setViewSubscribersOpen(true);
      return;
    }

    // Everything below leaves the subscriber view; close it.
    setViewSubscribersOpen(false);
    if (id === 'settings') {
      setViewReportsOpen(false);
      setViewTicketsOpen(false);
      setSettingsOpen(true);
      return;
    }
    if (id === 'logout') {
      logout();
      navigate('/');
      return;
    }
    if (id === 'overview') {
      setViewReportsOpen(false);
      setViewTicketsOpen(false);
      reset();
    }
    if (id === 'reports') {
      setViewTicketsOpen(false);
      setViewReportsOpen(true);
      return;
    }
    if (id === 'tickets') {
      setViewReportsOpen(false);
      setViewTicketsOpen(true);
      return;
    }
    setViewReportsOpen(false);
    setViewTicketsOpen(false);
  }

  // A Distributor Network child opens its view-only manager panel, exclusive
  // within the group, and closes the launcher flyout.
  function handleNetworkSub(subId) {
    adminCloseAllPanels(); // distributor + employer admin panels
    setCreateBranchOpen(false);
    setViewBranchesOpen(false);
    setViewAgentsOpen(false);
    setViewSubscribersOpen(false);
    setViewReportsOpen(false);
    setViewTicketsOpen(false);
    setSettingsOpen(false);
    if (subId === 'distributor') {
      setViewDistributorsOpen(true);
    } else if (subId === 'branches') {
      setDrillTargetBranchId(null);
      setViewBranchesOpen(true);
    } else if (subId === 'agents') {
      setDrillTargetAgentId(null);
      setViewAgentsOpen(true);
    }
    setNetworkMenuOpen(false);
  }

  return (
    <nav className={styles.sidebar} data-expanded={expanded ? 'true' : undefined}>
      <div className={styles.brand}>
        {expanded ? (
          <>
            <img src={logo} alt="Universal Pensions" className={styles.brandLogo} width={148} height={34} />
            <button
              type="button"
              className={styles.collapseToggle}
              onClick={onToggleExpand}
              aria-label="Collapse menu"
              title="Collapse menu"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </>
        ) : (
          <button
            type="button"
            className={styles.brandMark}
            onClick={onToggleExpand}
            aria-label="Expand menu"
            title="Expand menu"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="24" height="24">
              <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
              <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      <div className={styles.navItems}>
        {/* Whole-platform view toggle: dashboard (default) ⇄ map drill-down.
            Orthogonal to page selection — it never changes the active page. */}
        <button
          type="button"
          role="switch"
          aria-checked={mapMode}
          className={`${styles.navBtn} ${styles.modeToggle}`}
          data-mode-active={mapMode ? 'true' : undefined}
          onClick={onToggleMapMode}
          onMouseEnter={() => setHovered('mapview')}
          onMouseLeave={() => setHovered(null)}
          title="Map view"
          aria-label="Map view"
        >
          <span className={styles.iconWrap}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
              <path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
              <path d="M9 3v16M15 5v16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </span>
          {expanded && <span className={styles.navLabel}>Map view</span>}
          {expanded && (
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchThumb} />
            </span>
          )}
          {!expanded && hovered === 'mapview' && (
            <motion.span
              className={styles.tooltip}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
            >
              Map view
            </motion.span>
          )}
        </button>
        {NAV_ITEMS.map((item) => (
          <div key={item.id} className={styles.navBtnWrap}>
            <button
              className={styles.navBtn}
              data-active={active === item.id}
              onClick={(e) => { if (item.id === 'distributor-network') e.stopPropagation(); handleClick(item.id); }}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered(null)}
              title={item.label}
              aria-label={item.label}
              {...(item.id === 'distributor-network' ? { 'aria-expanded': networkMenuOpen } : {})}
            >
              <span className={styles.iconWrap}>{item.icon}</span>
              {expanded && <span className={styles.navLabel}>{item.label}</span>}
              {!expanded && hovered === item.id && !networkMenuOpen && (
                <motion.span
                  className={styles.tooltip}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {item.label}
                </motion.span>
              )}
            </button>

            {/* Distributor Network group flyout — Distributors / Branches / Agents */}
            {item.id === 'distributor-network' && (
              <AnimatePresence>
                {networkMenuOpen && (
                  <motion.div
                    className={styles.subMenu}
                    initial={{ opacity: 0, x: -8, scale: 0.96 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -8, scale: 0.96 }}
                    transition={{ duration: 0.22, ease: EASE_OUT_EXPO }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className={styles.subMenuArrow} />
                    <div className={styles.subMenuHeader}>
                      <span className={styles.subMenuTitle}>Distributor Network</span>
                    </div>
                    <div className={styles.subMenuDivider} />
                    {NETWORK_SUB.map((sub, i) => {
                      const isActive = (sub.id === 'distributor' && viewDistributorsOpen)
                        || (sub.id === 'branches' && viewBranchesOpen)
                        || (sub.id === 'agents' && viewAgentsOpen);
                      const count = sub.id === 'distributor' ? distributorCount
                        : sub.id === 'branches' ? branchCount : agentCount;
                      return (
                        <motion.button
                          key={sub.id}
                          className={styles.subMenuItem}
                          data-active={isActive}
                          onClick={() => handleNetworkSub(sub.id)}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2, delay: 0.06 * (i + 1), ease: EASE_OUT_EXPO }}
                        >
                          <span className={styles.subMenuIcon}>{sub.icon}</span>
                          <div className={styles.subMenuText}>
                            <span className={styles.subMenuLabel}>{sub.label}</span>
                            <span className={styles.subMenuDesc}>{sub.desc}</span>
                          </div>
                          <span className={styles.subMenuCount} style={{ marginLeft: 'auto' }}>{count}</span>
                        </motion.button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        ))}
      </div>

      {/* Desktop bottom items */}
      <div className={styles.bottomItems}>
        {BOTTOM_ITEMS.map((item) => (
          <button
            key={item.id}
            className={styles.navBtn}
            data-active={active === item.id}
            onClick={() => handleClick(item.id)}
            onMouseEnter={() => setHovered(item.id)}
            onMouseLeave={() => setHovered(null)}
            title={item.label}
            aria-label={item.label}
          >
            <span className={styles.iconWrap}>{item.icon}</span>
            {expanded && <span className={styles.navLabel}>{item.label}</span>}
            {!expanded && hovered === item.id && (
              <motion.span
                className={styles.tooltip}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
              >
                {item.label}
              </motion.span>
            )}
          </button>
        ))}
      </div>

      {/* Mobile tab bar */}
      <div className={styles.mobileBar}>
        {MOBILE_NAV.map((item) => (
          <button
            key={item.id}
            className={styles.mobileBtn}
            data-active={active === item.id}
            onClick={(e) => { if (item.id === 'distributor-network') e.stopPropagation(); handleClick(item.id); }}
            aria-label={item.label}
          >
            <span className={styles.iconWrap}>{item.icon}</span>
            <span className={styles.mobileLabel}>{item.label}</span>
          </button>
        ))}
        {/* More button */}
        <div className={styles.moreWrap}>
          <button
            className={styles.mobileBtn}
            data-active={moreOpen}
            onClick={(e) => { e.stopPropagation(); setMoreOpen(!moreOpen); }}
            aria-label="More options"
          >
            <span className={styles.iconWrap}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="22" height="22">
                <circle cx="12" cy="5" r="1.5" fill="currentColor"/>
                <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
                <circle cx="12" cy="19" r="1.5" fill="currentColor"/>
              </svg>
            </span>
            <span className={styles.mobileLabel}>More</span>
          </button>
          <AnimatePresence>
            {moreOpen && (
              <motion.div
                className={styles.moreMenu}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2, ease: EASE_OUT_EXPO }}
                onClick={(e) => e.stopPropagation()}
              >
                {MORE_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    className={styles.moreItem}
                    onClick={() => handleClick(item.id)}
                  >
                    <span className={styles.moreIcon}>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </nav>
  );
}
