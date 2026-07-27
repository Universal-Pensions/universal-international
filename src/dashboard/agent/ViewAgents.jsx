import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAllEntities, useAllEntitiesMetrics } from '../../hooks/useEntity';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import { useDashboard } from '../../contexts/DashboardContext';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { getInitials, getTrend, perfLevel } from '../../utils/dashboard';
import Stars from '../shared/Stars';
import { Icons } from '../shared/Icons';
import TrendArrow from '../shared/TrendArrow';
import MiniChart from '../shared/MiniChart';
import KpiCard from '../shared/KpiCard';
import Demographics from '../shared/Demographics';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import styles from './ViewAgents.module.css';

function branchName(agent, branchesMap) {
  return branchesMap[agent.parentId]?.name || '';
}

function districtOfAgent(agent, branchesMap, districtsMap) {
  const b = branchesMap[agent.parentId];
  return b ? (districtsMap[b.parentId]?.name || '') : '';
}

function regionOfAgent(agent, branchesMap, districtsMap, regionsMap) {
  const b = branchesMap[agent.parentId];
  if (!b) return '';
  const d = districtsMap[b.parentId];
  return d ? (regionsMap[d.parentId]?.name || '') : '';
}

const SORT_OPTIONS = [
  { key: 'subscribers', label: 'Subscribers', fn: (a, b) => b.metrics.totalSubscribers - a.metrics.totalSubscribers },
  { key: 'performance', label: 'Performance', fn: (a, b) => b.performance - a.performance },
  { key: 'activeRate', label: 'Active Rate', fn: (a, b) => b.metrics.activeRate - a.metrics.activeRate },
  { key: 'rating', label: 'Rating', fn: (a, b) => b.rating - a.rating },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Agent Detail                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */
function AgentDetail({ agent, branchesMap, districtsMap, regionsMap, onViewCommissions }) {
  const m = agent.metrics;
  const level = perfLevel(agent.performance);
  const { data: commissionData } = useEntityCommissionSummary('agent', agent.id);

  return (
    <div className={styles.detailContent}>
      <div className={styles.profileCard}>
        <div className={styles.profileAvatar}>{getInitials(agent.name)}</div>
        <div className={styles.profileInfo}>
          <div className={styles.profileName}>{agent.name}</div>
          <div className={styles.profileMeta}>
            <span className={styles.agentStatus} data-status={agent.status} />
            <span className="capitalize">{agent.status}</span>
            <span>&middot;</span>
            <span>{agent.phone}</span>
            {agent.employeeId && (
              <>
                <span>&middot;</span>
                <span>{agent.employeeId}</span>
              </>
            )}
          </div>
          <div className={styles.profileRating}>
            <Stars rating={agent.rating} />
            <span className={styles.profileRatingValue}>{agent.rating.toFixed(1)}</span>
            <span className={styles.profilePerfBadge} data-level={level}>{agent.performance}%</span>
          </div>
        </div>
      </div>

      <div className={styles.kpiRow}>
        <KpiCard icon={Icons.subscribers} label="Subscribers" value={formatNumber(m.totalSubscribers)} />
        <KpiCard icon={Icons.activeRate} label="Active Rate" value={m.activeRate} suffix="%" />
        <KpiCard icon={Icons.contributions} label="Contributions" value={formatUGX(m.totalContributions)} />
        <KpiCard icon={Icons.aum} label="AUM" value={formatUGX(m.aum)} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Branch Assignment</div>
        <div className={styles.infoCard}>
          {agent.employeeId && (
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Employee ID</span>
              <span className={styles.infoValue}>{agent.employeeId}</span>
            </div>
          )}
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Branch</span>
            <span className={styles.infoValue}>{branchName(agent, branchesMap)}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>District</span>
            <span className={styles.infoValue}>{districtOfAgent(agent, branchesMap, districtsMap)}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Region</span>
            <span className={styles.infoValue}>{regionOfAgent(agent, branchesMap, districtsMap, regionsMap)}</span>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Commissions</div>
        <div className={styles.infoCard}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Settled</span>
            <span className={styles.infoValue}>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-status-good)' }}>
                {commissionData ? formatUGX(commissionData.totalPaid) : '--'}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--text-xs)', color: 'var(--color-gray)' }}>
                {commissionData ? `(${commissionData.countPaid})` : ''}
              </span>
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Due</span>
            <span className={styles.infoValue}>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-status-warning)' }}>
                {commissionData ? formatUGX(commissionData.totalDue) : '--'}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 'var(--text-xs)', color: 'var(--color-gray)' }}>
                {commissionData ? `(${commissionData.countDue})` : ''}
              </span>
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Settlement Rate</span>
            <span className={styles.infoValue}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {commissionData ? `${commissionData.settlementRate}%` : '--'}
              </span>
            </span>
          </div>
        </div>
        {onViewCommissions && (
          <button className={styles.commissionLink} onClick={onViewCommissions}>
            View Details
            <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" width="10" height="10">
              <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Monthly Contributions</div>
        <MiniChart data={m.monthlyContributions} />
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Activity</div>
        <div className={styles.infoCard}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>New today</span>
            <span className={styles.infoValue}>
              {m.newSubscribersToday} subscribers
              <TrendArrow trend={getTrend(m.newSubscribersToday, m.newSubscribersThisWeek)} />
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>This week</span>
            <span className={styles.infoValue}>{m.newSubscribersThisWeek} subscribers</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>This month</span>
            <span className={styles.infoValue}>{m.newSubscribersThisMonth} subscribers</span>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Demographics</div>
        <Demographics metrics={m} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ViewAgents — main panel                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function ViewAgents({ splitMode = false, fullPage = false, showCommissions = true }) {
  const { viewAgentsOpen, setViewAgentsOpen, setCommissionsOpen, drillTargetAgentId, closeDrillPanel } = useDashboard();
  const { branchId } = useBranchScope();

  const { data: allAgentsRaw = [], isLoading: agentsLoading } = useAllEntities('agent');
  const { data: allBranchesRaw = [] } = useAllEntities('branch');
  const { data: allDistrictsRaw = [] } = useAllEntities('district');
  const { data: allRegionsRaw = [] } = useAllEntities('region');

  // Per-agent live rollup — without this overlay every `a.metrics.totalSubscribers`
  // / `a.metrics.activeRate` / `a.metrics.aum` reads zero under Supabase.
  const { data: agentMetricsMap = {} } = useAllEntitiesMetrics('agent');

  // Cold-load guard — skeleton only on a true first-fetch (pending AND
  // no cached rows), never on background refetches once data has shown.
  const isCold = agentsLoading && allAgentsRaw.length === 0;

  const BRANCHES_MAP = useMemo(() => Object.fromEntries(allBranchesRaw.map(b => [b.id, b])), [allBranchesRaw]);
  const DISTRICTS_MAP = useMemo(() => Object.fromEntries(allDistrictsRaw.map(d => [d.id, d])), [allDistrictsRaw]);
  const REGIONS_MAP = useMemo(() => Object.fromEntries(allRegionsRaw.map(r => [r.id, r])), [allRegionsRaw]);

  const [view, setView] = useState('list');
  const [selectedAgent, setSelectedAgent] = useState(null);

  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState(null);
  const [regionDropOpen, setRegionDropOpen] = useState(false);
  const [sortKey, setSortKey] = useState('subscribers');
  const [sortDropOpen, setSortDropOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const bodyRef = useRef(null);
  const regionBtnRef = useRef(null);
  const sortBtnRef = useRef(null);

  const allAgentsWithMetrics = useMemo(
    () => allAgentsRaw.map(a => ({ ...a, metrics: agentMetricsMap[a.id] ?? a.metrics })),
    [allAgentsRaw, agentMetricsMap],
  );
  const allAgents = branchId
    ? allAgentsWithMetrics.filter(a => a.parentId === branchId)
    : allAgentsWithMetrics;

  // Auto-select agent when opened via map drill-down. Reads from the
  // metrics-overlaid `allAgents`, not `allAgentsRaw` (which has
  // EMPTY_METRICS), so the AgentDetail KPI cards bind to real numbers.
  useEffect(() => {
    if (!viewAgentsOpen || !drillTargetAgentId || allAgents.length === 0) return;
    const agent = allAgents.find(a => a.id === drillTargetAgentId);
    if (!agent) return;
    setSelectedAgent(agent);
    // Only snap to 'detail' on the first auto-select for this drill target;
    // later metrics-overlay updates refresh selectedAgent in place without
    // overwriting a user-initiated nav.
    if (!selectedAgent || selectedAgent.id !== drillTargetAgentId) {
      setView('detail');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedAgent intentionally excluded to avoid self-triggered loop
  }, [viewAgentsOpen, drillTargetAgentId, allAgents]);

  const handleClose = useCallback(() => {
    if (drillTargetAgentId) closeDrillPanel();
    else setViewAgentsOpen(false);
  }, [drillTargetAgentId, closeDrillPanel, setViewAgentsOpen]);

  const totals = useMemo(() => {
    const t = { subs: 0, aum: 0 };
    allAgents.forEach((a) => {
      t.subs += a.metrics.totalSubscribers;
      t.aum += a.metrics.aum;
    });
    return t;
  }, [allAgents]);

  const filtered = useMemo(() => {
    let list = allAgents;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        branchName(a, BRANCHES_MAP).toLowerCase().includes(q) ||
        districtOfAgent(a, BRANCHES_MAP, DISTRICTS_MAP).toLowerCase().includes(q)
      );
    }
    if (regionFilter) {
      list = list.filter((a) => {
        const b = BRANCHES_MAP[a.parentId];
        if (!b) return false;
        const d = DISTRICTS_MAP[b.parentId];
        return d && d.parentId === regionFilter;
      });
    }
    if (statusFilter !== 'all') {
      list = list.filter((a) => a.status === statusFilter);
    }
    const sortOpt = SORT_OPTIONS.find((o) => o.key === sortKey);
    return list.sort(sortOpt ? sortOpt.fn : SORT_OPTIONS[0].fn);
  }, [allAgents, search, regionFilter, statusFilter, sortKey, BRANCHES_MAP, DISTRICTS_MAP]);

  const regionOptions = allRegionsRaw;

  const regionCounts = useMemo(() => {
    const counts = {};
    allAgents.forEach((a) => {
      const b = BRANCHES_MAP[a.parentId];
      if (!b) return;
      const d = DISTRICTS_MAP[b.parentId];
      if (d) counts[d.parentId] = (counts[d.parentId] || 0) + 1;
    });
    return counts;
  }, [allAgents, BRANCHES_MAP, DISTRICTS_MAP]);

  const estimateSize = useCallback(() => 72, []);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => bodyRef.current,
    estimateSize,
    overscan: 10,
  });

  useEffect(() => {
    if (viewAgentsOpen) return;
    const t = setTimeout(() => {
      setView('list');
      setSelectedAgent(null);
      setSearch('');
      setRegionFilter(null);
      setSortKey('subscribers');
      setStatusFilter('all');
    }, 400);
    return () => clearTimeout(t);
  }, [viewAgentsOpen]);

  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [view]);

  useEffect(() => {
    if (!viewAgentsOpen) return;
    function onKey(e) { if (e.key === 'Escape' && !fullPage) handleClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewAgentsOpen, handleClose, fullPage]);

  // Memoise the refs arrays + close callbacks so useOutsideClick doesn't tear
  // down + re-add its document listeners on every render while a dropdown is open.
  const regionOutsideRefs = useMemo(() => [regionBtnRef], []);
  const sortOutsideRefs = useMemo(() => [sortBtnRef], []);
  const closeRegionDrop = useCallback(() => setRegionDropOpen(false), []);
  const closeSortDrop = useCallback(() => setSortDropOpen(false), []);
  useOutsideClick(regionDropOpen, closeRegionDrop, regionOutsideRefs);
  useOutsideClick(sortDropOpen, closeSortDrop, sortOutsideRefs);

  function handleSelectAgent(agent) { setSelectedAgent(agent); setView('detail'); }
  function handleBack() {
    if (drillTargetAgentId) closeDrillPanel();
    else { setView('list'); setSelectedAgent(null); }
  }

  let headerTitle = 'Existing Agents';
  // Derived from the (RLS-scoped) agent list rather than asserting "Uganda".
  const agentBranchCount = new Set(allAgents.map((a) => a.parentId).filter(Boolean)).size;
  let headerSubtitle = agentBranchCount
    ? `${allAgents.length} agents across ${agentBranchCount} ${agentBranchCount === 1 ? 'branch' : 'branches'}`
    : `${allAgents.length} agents`;
  if (view === 'detail' && selectedAgent) {
    headerTitle = selectedAgent.name;
    headerSubtitle = `Agent at ${branchName(selectedAgent, BRANCHES_MAP)}`;
  }

  return (
    <>
      <AnimatePresence>
        {viewAgentsOpen && !splitMode && !fullPage && (
          <motion.div
            key="va-backdrop"
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={handleClose}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(viewAgentsOpen || fullPage) && (
          <motion.div
            key="va-panel"
            className={styles.panel}
            data-split-mode={splitMode || undefined}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : {
              x: 0,
              transition: { duration: 0.55, ease: EASE_OUT_EXPO },
            }}
            exit={fullPage ? { opacity: 0 } : {
              x: '100%',
              transition: { duration: 0.55, ease: EASE_OUT_EXPO },
            }}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
          >
            {/* Header */}
            <div className={styles.header} data-view={view}>
              <div className={styles.headerTop}>
                {view !== 'list' && (
                  <button className={styles.backBtn} onClick={handleBack} aria-label="Go back">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <div style={{ flex: 1 }}>
                  <AnimatePresence mode="wait">
                    <motion.h2
                      key={headerTitle}
                      className={styles.title}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.2 }}
                    >
                      {headerTitle}
                    </motion.h2>
                  </AnimatePresence>
                  <p className={styles.subtitle}>{headerSubtitle}</p>
                </div>
                {!fullPage && (
                  <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Toolbar (list view) */}
            {view === 'list' && (
              <>
                <div className={styles.toolbar}>
                  <div className={styles.searchWrap}>
                    <span className={styles.searchIcon}>
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="14" height="14">
                        <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M14 14l-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </span>
                    <input
                      className={styles.searchInput}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search agents, branches, districts…"
                      aria-label="Search agents"
                      name="search"
                      autoComplete="off"
                    />
                    {search && (
                      <button className={styles.searchClear} onClick={() => setSearch('')} aria-label="Clear search">
                        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="12" height="12">
                          <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <div style={{ position: 'relative' }} ref={regionBtnRef}>
                    <button
                      className={styles.filterBtn}
                      data-active={!!regionFilter}
                      aria-haspopup="listbox"
                      aria-expanded={regionDropOpen}
                      onClick={() => setRegionDropOpen((p) => !p)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                      {regionFilter ? REGIONS_MAP[regionFilter]?.name : 'Region'}
                    </button>
                    <AnimatePresence>
                      {regionDropOpen && (
                        <motion.div role="listbox" aria-label="Filter by region" className={styles.filterDropdown} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
                          <button role="option" aria-selected={!regionFilter} className={styles.filterOption} data-selected={!regionFilter} onClick={() => { setRegionFilter(null); setRegionDropOpen(false); }}>
                            All Regions <span className={styles.filterCount}>{allAgents.length}</span>
                          </button>
                          {regionOptions.map((r) => (
                            <button key={r.id} role="option" aria-selected={regionFilter === r.id} className={styles.filterOption} data-selected={regionFilter === r.id} onClick={() => { setRegionFilter(r.id); setRegionDropOpen(false); }}>
                              {r.name} <span className={styles.filterCount}>{regionCounts[r.id] || 0}</span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div style={{ position: 'relative' }} ref={sortBtnRef}>
                    <button
                      className={styles.filterBtn}
                      data-active={sortKey !== 'subscribers'}
                      aria-haspopup="listbox"
                      aria-expanded={sortDropOpen}
                      onClick={() => setSortDropOpen((p) => !p)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M4 2v12M4 14l-3-3M4 14l3-3M12 14V2M12 2l-3 3M12 2l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      {SORT_OPTIONS.find((o) => o.key === sortKey)?.label || 'Sort'}
                    </button>
                    <AnimatePresence>
                      {sortDropOpen && (
                        <motion.div role="listbox" aria-label="Sort agents" className={styles.filterDropdown} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
                          {SORT_OPTIONS.map((opt) => (
                            <button key={opt.key} role="option" aria-selected={sortKey === opt.key} className={styles.filterOption} data-selected={sortKey === opt.key} onClick={() => { setSortKey(opt.key); setSortDropOpen(false); }}>
                              {opt.label}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className={styles.statusChips} role="group" aria-label="Filter agents by status">
                  {['all', 'active', 'inactive'].map((s) => (
                    <button
                      key={s}
                      className={styles.statusChip}
                      data-active={statusFilter === s}
                      aria-pressed={statusFilter === s}
                      onClick={() => setStatusFilter(s)}
                    >
                      {s === 'all' ? 'All' : s === 'active' ? 'Active' : 'Inactive'}
                    </button>
                  ))}
                </div>

                <div className={styles.summaryStrip}>
                  <div className={styles.summaryChip}>
                    <span className={styles.summaryChipIcon}>{Icons.subscribers}</span>
                    <span className={styles.summaryChipValue}>{formatNumber(allAgents.length)}</span>
                    <span className={styles.summaryChipLabel}>Agents</span>
                  </div>
                  <div className={styles.summaryChip}>
                    <span className={styles.summaryChipIcon}>{Icons.subscribers}</span>
                    <span className={styles.summaryChipValue}>{formatNumber(totals.subs)}</span>
                    <span className={styles.summaryChipLabel}>Subscribers</span>
                  </div>
                  <div className={styles.summaryChip}>
                    <span className={styles.summaryChipIcon}>{Icons.aum}</span>
                    <span className={styles.summaryChipValue}>{formatUGXShort(totals.aum)}</span>
                    <span className={styles.summaryChipLabel}>AUM</span>
                  </div>
                </div>
              </>
            )}

            {/* Body */}
            <div className={styles.body} ref={bodyRef}>
              <AnimatePresence mode="wait">
                {view === 'list' && (
                  <motion.div key="va-list" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
                    <div className={styles.listCount}>
                      {isCold
                        ? 'Loading agents…'
                        : `Showing ${filtered.length} of ${allAgents.length} agents`}
                    </div>

                    {isCold ? (
                      <SkeletonRow count={8} label="Loading agents" />
                    ) : filtered.length === 0 ? (
                      // No filters active → "No agents yet" (CTA-free in a list-only
                      // panel — agents are created from elsewhere in the flow).
                      // Otherwise nudge the user to widen their filter.
                      search.trim() === '' && !regionFilter && statusFilter === 'all' ? (
                        <EmptyState
                          kind="no-data"
                          title="No agents yet."
                          body="Agents added through the network will appear here."
                        />
                      ) : (
                        <EmptyState
                          kind="no-match"
                          title="No agents match"
                          body="Try adjusting your search or filters."
                        />
                      )
                    ) : (
                      <div
                        className={styles.virtualList}
                        style={{ height: `${virtualizer.getTotalSize()}px` }}
                      >
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                          const agent = filtered[virtualRow.index];
                          const level = perfLevel(agent.performance);
                          return (
                            <button
                              key={agent.id}
                              className={styles.agentItem}
                              onClick={() => handleSelectAgent(agent)}
                              data-index={virtualRow.index}
                              ref={virtualizer.measureElement}
                              style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualRow.start}px)`,
                              }}
                            >
                                <div className={styles.agentAvatar}>{getInitials(agent.name)}</div>
                                <div className={styles.agentInfo}>
                                  <div className={styles.agentName}>{agent.name}</div>
                                  <div className={styles.agentMeta}>
                                    <span className={styles.agentStatus} data-status={agent.status} />
                                    <span>{branchName(agent, BRANCHES_MAP)}</span>
                                    {agent.employeeId && (
                                      <>
                                        <span>&middot;</span>
                                        <span>{agent.employeeId}</span>
                                      </>
                                    )}
                                    <span>&middot;</span>
                                    <Stars rating={agent.rating} />
                                  </div>
                                </div>
                                <div className={styles.agentStats}>
                                  <div className={styles.stat}>
                                    <span className={styles.statValue}>{agent.metrics.totalSubscribers}</span>
                                    <span className={styles.statLabel}>Subs</span>
                                  </div>
                                  <span className={styles.agentPerf} data-level={level}>{agent.performance}%</span>
                                </div>
                                <span className={styles.chevron}>
                                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="14" height="14">
                                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                    )}
                  </motion.div>
                )}

                {view === 'detail' && selectedAgent && (
                  <motion.div key="va-detail" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}>
                    <AgentDetail agent={selectedAgent} branchesMap={BRANCHES_MAP} districtsMap={DISTRICTS_MAP} regionsMap={REGIONS_MAP} onViewCommissions={showCommissions ? () => { setViewAgentsOpen(false); setCommissionsOpen(true); } : undefined} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
