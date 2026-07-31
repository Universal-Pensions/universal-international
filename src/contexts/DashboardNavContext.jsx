import { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SEGMENT_TO_LEVEL, LEVEL_TO_SEGMENT, PARENT_LEVEL } from '../constants/levels';
import { getEntitySync } from '../services/entities';
import { useAuth } from './AuthContext';
import { useIsDesktop } from '../hooks/useIsDesktop';

/**
 * @typedef {Object} DashboardNavContextValue
 * @property {'country'|'region'|'district'|'branch'|'agent'} level - Current drill-down level
 * @property {Record<string, string>} selectedIds - Map of level to selected entity ID
 * @property {string} section - Current section ('map' or 'reports')
 * @property {'subscriber'|undefined} childList - Scoped child list to render, from
 *   a /dashboard/{agents,branches}/:id/subscribers URL
 * @property {string|null} childListParentId - The :id that childList is scoped to
 * @property {string|null} reportId - Auto-navigate report ID from URL
 * @property {(targetLevel: string, id: string) => void} drillDown - Navigate deeper
 * @property {(fromLevel: string) => void} drillUp - Navigate one level up
 * @property {(targetLevel: string) => void} goToLevel - Jump to a specific ancestor level
 * @property {() => void} reset - Navigate back to country level
 * @property {string|null} drillTargetBranchId - Branch ID opened via map drill-down
 * @property {(id: string|null) => void} setDrillTargetBranchId
 * @property {string|null} drillTargetAgentId - Agent ID opened via map drill-down
 * @property {(id: string|null) => void} setDrillTargetAgentId
 * @property {() => void} closeDrillPanel - Close drill-triggered panel and go to district
 * @property {import('react').MutableRefObject} onPanelActionRef - Ref for panel setter registration
 */

const DashboardNavContext = createContext(null);

// Derive level + entityId from the URL pathname
function parsePath(pathname) {
  const path = pathname.replace(/^\/dashboard\/?/, '');
  if (!path) return { level: 'country', entityId: null, section: 'map' };
  // Reports section
  if (path === 'reports' || path.startsWith('reports/')) {
    const reportId = path.split('/')[1] || null;
    return { level: 'country', entityId: null, section: 'reports', reportId };
  }
  const [segment, entityId, subSegment] = path.split('/');
  const level = SEGMENT_TO_LEVEL[segment];
  if (level && entityId) {
    // Drill-down destination: /dashboard/agents/:id/subscribers and
    // /dashboard/branches/:id/subscribers open the subscriber list SCOPED to that
    // parent. `level`/`entityId` still describe the parent (so the map + rail keep
    // their context); `childList` tells the shell which scoped panel to render.
    if (subSegment === 'subscribers' && (level === 'agent' || level === 'branch')) {
      return { level, entityId, section: 'map', childList: 'subscriber' };
    }
    return { level, entityId, section: 'map' };
  }
  return { level: 'country', entityId: null, section: 'map' };
}

// Walk the parent chain to build selectedIds from a single entity
function buildSelectedIds(level, entityId) {
  if (level === 'country' || !entityId) return {};
  const ids = {};
  let currentLevel = level;
  let currentId = entityId;
  while (currentLevel && currentLevel !== 'country' && currentId) {
    ids[currentLevel] = currentId;
    const entity = getEntitySync(currentLevel, currentId);
    if (!entity?.parentId || entity.parentId === 'ug') break;
    const parentLevel = PARENT_LEVEL[currentLevel];
    if (!parentLevel || parentLevel === 'country') break;
    currentLevel = parentLevel;
    currentId = entity.parentId;
  }
  return ids;
}

export function DashboardNavProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Keep latest pathname accessible without re-creating callbacks on every
  // route change — goToLevel reads `pathnameRef.current` instead of closing
  // over `location.pathname`.
  const pathnameRef = useRef(location.pathname);
  useEffect(() => {
    pathnameRef.current = location.pathname;
  });
  // Role gates the panel-style "/dashboard/reports → slide-in" effect below.
  // Distributor + the branch MOBILE dashboard render Reports as a slide-in
  // panel, so visiting `/dashboard/reports` should pop the panel and rewrite the
  // URL back to `/dashboard`. Subscriber + agent dashboards (and now the branch
  // DESKTOP shell, >=1024px) have *routed* report pages and must be allowed to
  // render them — bouncing them back to `/dashboard` was the Phase 6.5
  // regression that made every report page unreachable for those roles.
  const { role } = useAuth();
  const isDesktop = useIsDesktop();
  const usesReportsPanel = role === 'distributor' || (role === 'branch' && !isDesktop);

  // Derive drill-down state from URL
  const { level, entityId, section, reportId, childList } = useMemo(() => parsePath(location.pathname), [location.pathname]);
  const selectedIds = useMemo(() => buildSelectedIds(level, entityId), [level, entityId]);

  // Map drill-down → slide-in panel handoff
  const [drillTargetBranchId, setDrillTargetBranchId] = useState(null);
  const [drillTargetAgentId, setDrillTargetAgentId] = useState(null);
  const drillBranchRef = useRef(null);
  const drillAgentRef = useRef(null);

  // Callback ref that the panel context registers its setters into.
  // This lets nav effects call panel setters without a direct dependency.
  const onPanelActionRef = useRef(null);

  // Auto-open reports panel when URL is /dashboard/reports, then redirect to
  // /dashboard. Distributor + branch only — see `usesReportsPanel` note above.
  useEffect(() => {
    if (!usesReportsPanel) return;
    if (section === 'reports') {
      onPanelActionRef.current?.setViewReportsOpen(true);
      navigate('/dashboard', { replace: true });
    }
  }, [section, navigate, usesReportsPanel]);

  // Auto-open slide-in panels when URL reaches branch/agent level. The URL
  // is an external system (browser history), so syncing React state from it
  // is exactly what useEffect is for — the cascading-renders lint rule is
  // overzealous here.
  useEffect(() => {
    if (level === 'branch' && entityId) {
      drillBranchRef.current = entityId;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- URL → state sync
      setDrillTargetBranchId(entityId);
      onPanelActionRef.current?.setViewBranchesOpen(true);
      // Close the sidebar's Branches submenu — it's redundant once a specific
      // branch is in focus, and leaving it open pollutes the district view
      // after the user clicks Back.
      onPanelActionRef.current?.setBranchMenuOpen?.(false);
    } else if (level === 'agent' && entityId) {
      drillAgentRef.current = entityId;
      setDrillTargetAgentId(entityId);
      onPanelActionRef.current?.setViewAgentsOpen(true);
      onPanelActionRef.current?.setAgentMenuOpen?.(false);
    } else {
      if (drillBranchRef.current) {
        drillBranchRef.current = null;
        setDrillTargetBranchId(null);
        onPanelActionRef.current?.setViewBranchesOpen(false);
      }
      if (drillAgentRef.current) {
        drillAgentRef.current = null;
        setDrillTargetAgentId(null);
        onPanelActionRef.current?.setViewAgentsOpen(false);
      }
    }
  }, [level, entityId]);

  // Close drill-triggered panel and navigate back to district level
  const closeDrillPanel = useCallback(() => {
    const districtId = selectedIds.district;
    drillBranchRef.current = null;
    drillAgentRef.current = null;
    setDrillTargetBranchId(null);
    setDrillTargetAgentId(null);
    onPanelActionRef.current?.setViewBranchesOpen(false);
    onPanelActionRef.current?.setViewAgentsOpen(false);
    onPanelActionRef.current?.setBranchMenuOpen?.(false);
    onPanelActionRef.current?.setAgentMenuOpen?.(false);
    if (districtId) {
      navigate(`/dashboard/${LEVEL_TO_SEGMENT.district}/${districtId}`);
    } else {
      navigate('/dashboard');
    }
  }, [selectedIds, navigate]);

  // Navigation actions — translate to URL changes
  const drillDown = useCallback((targetLevel, id) => {
    const segment = LEVEL_TO_SEGMENT[targetLevel];
    if (segment) navigate(`/dashboard/${segment}/${id}`);
  }, [navigate]);

  const drillUp = useCallback((fromLevel) => {
    const lvl = fromLevel || 'country';
    if (lvl === 'country') return;
    const parentLevel = PARENT_LEVEL[lvl];
    if (!parentLevel || parentLevel === 'country') {
      navigate('/dashboard');
    } else {
      const parentId = buildSelectedIds(lvl, parsePath(location.pathname).entityId)[parentLevel];
      if (parentId) {
        navigate(`/dashboard/${LEVEL_TO_SEGMENT[parentLevel]}/${parentId}`);
      } else {
        navigate('/dashboard');
      }
    }
  }, [navigate, location.pathname]);

  const goToLevel = useCallback((targetLevel) => {
    if (targetLevel === 'country') {
      navigate('/dashboard');
    } else {
      const parsed = parsePath(pathnameRef.current);
      const currentIds = buildSelectedIds(parsed.level, parsed.entityId);
      const id = currentIds[targetLevel];
      if (id) navigate(`/dashboard/${LEVEL_TO_SEGMENT[targetLevel]}/${id}`);
      else navigate('/dashboard');
    }
  }, [navigate]);

  const reset = useCallback(() => {
    navigate('/dashboard');
  }, [navigate]);

  const value = useMemo(() => ({
    level, selectedIds, section, reportId,
    childList, childListParentId: childList ? entityId : null,
    drillDown, drillUp, goToLevel, reset,
    drillTargetBranchId, setDrillTargetBranchId,
    drillTargetAgentId, setDrillTargetAgentId,
    drillBranchRef, drillAgentRef,
    closeDrillPanel,
    onPanelActionRef,
  }), [
    level, selectedIds, section, reportId, childList, entityId,
    drillDown, drillUp, goToLevel, reset,
    drillTargetBranchId, drillTargetAgentId,
    closeDrillPanel,
  ]);

  return (
    <DashboardNavContext value={value}>
      {children}
    </DashboardNavContext>
  );
}

/**
 * Access the dashboard navigation context (drill-down state and navigation actions).
 * @returns {DashboardNavContextValue}
 */
export function useDashboardNav() {
  const ctx = useContext(DashboardNavContext);
  if (!ctx) throw new Error('useDashboardNav must be used within DashboardNavProvider');
  return ctx;
}
