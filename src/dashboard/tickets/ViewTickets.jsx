// Distributor tickets panel — full thread view with composer.
//
// INTENTIONAL DUPLICATION with `src/branch-dashboard/tickets/ViewTickets.jsx`
// (the branch version). The two share the slide-in chrome but diverge in their
// data wiring (network-wide here vs branch-scoped, read-only there), so they are
// kept as separate files rather than a shared component.

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { useAuth } from '../../contexts/AuthContext';
import { useDashboard } from '../../contexts/DashboardContext';
import { useAllEntities } from '../../hooks/useEntity';
import {
  useDistributorTickets,
  useDistributorTicketMetrics,
  usePlatformTickets,
  usePlatformTicketMetrics,
  useTicketThread,
} from '../../hooks/useTickets';
import { TICKET_STATUS } from '../../data/ticketsSeed';
import { PillChip, PillChipGroup } from '../../components/PillChip';
import KpiCard from '../shared/KpiCard';
import { Icons } from '../shared/Icons';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import ErrorCard from '../../components/feedback/ErrorCard';
import TicketListRow from '../../components/tickets/TicketListRow';
import ThreadView from '../../components/tickets/ThreadView';
import styles from './ViewTickets.module.css';

/* ── Oversight KPI icons ──────────────────────────────────────────────────
   The shared `Icons` set has no ticket-specific glyphs, so the four oversight
   metrics carry small inline line icons in the project's stroke-1.5 / 20×20
   convention (matching `Icons.jsx`). currentColor lets KpiCard's per-slot tint
   own the colour — no red, no mint as primary. */
const TICKET_ICONS = {
  open: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
      <path d="M3 5.5A1.5 1.5 0 014.5 4h11A1.5 1.5 0 0117 5.5v7A1.5 1.5 0 0115.5 14H7l-4 3v-11.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  closed: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  response: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  unanswered: (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="16" height="16">
      <path d="M3 5.5A1.5 1.5 0 014.5 4h11A1.5 1.5 0 0117 5.5v7A1.5 1.5 0 0115.5 14H7l-4 3v-11.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 7v3M10 11.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: TICKET_STATUS.OPEN, label: 'Open' },
  { key: TICKET_STATUS.CLOSED, label: 'Closed' },
];

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ViewTickets — distributor network-wide, view-only support oversight       */
/* ═══════════════════════════════════════════════════════════════════════════ */
export default function ViewTickets({ fullPage = false }) {
  const { viewTicketsOpen, setViewTicketsOpen } = useDashboard();
  // This panel is mounted by BOTH the distributor and the admin shells. The
  // admin has no `distributorId` claim, so the previous `?? 'd-001'` fallback
  // read as "the admin is looking at d-001's inbox". It was not actually
  // mis-scoping anything — listTicketsForDistributor ignores its id and returns
  // every ticket — but it made a platform-wide view look like a tenant view, and
  // it would have started mis-scoping the moment tickets gained a real partition.
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const distributorId = user?.distributorId ?? 'd-001';

  // Branch names for the branch rollup filter + ticket subtitles. Same allowed
  // pattern as ViewAgents — an entity read, not a tickets/mockData import.
  const { data: allBranchesRaw = [] } = useAllEntities('branch');
  const BRANCHES_MAP = useMemo(
    () => Object.fromEntries(allBranchesRaw.map((b) => [b.id, b])),
    [allBranchesRaw],
  );
  const branchName = useCallback((id) => BRANCHES_MAP[id]?.name || id, [BRANCHES_MAP]);

  // Two-level drill: 'list' (rollup + filtered inbox) → 'thread' (read-only).
  const [view, setView] = useState('list');
  const [selectedTicketId, setSelectedTicketId] = useState(null);

  // Rollup filters.
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchFilter, setBranchFilter] = useState(null);
  const [agentFilter, setAgentFilter] = useState(null);
  const [branchDropOpen, setBranchDropOpen] = useState(false);

  const branchBtnRef = useRef(null);
  const bodyRef = useRef(null);

  // Metrics drive the KPI row + the agent-filter options (byAgent). Unfiltered
  // so the headline numbers describe the whole network.
  // Both role variants are called unconditionally (hook rules) with only the
  // active one enabled, then the result is picked.
  const distributorMetrics = useDistributorTicketMetrics(isAdmin ? null : distributorId);
  const platformMetrics = usePlatformTicketMetrics(isAdmin);
  const { data: metrics, isLoading: metricsLoading } = isAdmin ? platformMetrics : distributorMetrics;

  // List data, narrowed server-side by the active branch/agent/status filters.
  const listFilters = useMemo(() => {
    const f = {};
    if (statusFilter !== 'all') f.status = statusFilter;
    if (branchFilter) f.branchId = branchFilter;
    if (agentFilter) f.agentId = agentFilter;
    return f;
  }, [statusFilter, branchFilter, agentFilter]);

  const distributorList = useDistributorTickets(isAdmin ? null : distributorId, listFilters);
  const platformList = usePlatformTickets(listFilters, isAdmin);
  const {
    data: ticketList = [],
    isLoading: listLoading,
    isError: listError,
    error: listErr,
    refetch: refetchList,
  } = isAdmin ? platformList : distributorList;

  // Thread for the selected ticket (read-only — no footer / no headerActions).
  const {
    data: thread,
    isLoading: threadLoading,
    isError: threadError,
    error: threadErr,
    refetch: refetchThread,
  } = useTicketThread(view === 'thread' ? selectedTicketId : null);

  const isColdList = listLoading && ticketList.length === 0;

  // Branch options derived from the tickets actually in the network — keeps the
  // filter honest (only branches that have raised tickets appear).
  const branchOptions = useMemo(() => {
    const seen = new Map();
    ticketList.forEach((t) => {
      if (t.branchId && !seen.has(t.branchId)) seen.set(t.branchId, true);
    });
    // Fold in the active branch filter even when it currently narrows to zero,
    // so the chosen branch never vanishes from its own option list.
    if (branchFilter && !seen.has(branchFilter)) seen.set(branchFilter, true);
    return Array.from(seen.keys()).sort((a, b) => branchName(a).localeCompare(branchName(b)));
  }, [ticketList, branchFilter, branchName]);

  // Agent options come from the metrics rollup (name resolved there). When a
  // branch is selected we keep only that branch's agents by intersecting with
  // the ticket list's agentIds.
  const agentOptions = useMemo(() => {
    const rows = metrics?.byAgent ?? [];
    if (!branchFilter) return rows;
    const inBranch = new Set(ticketList.map((t) => t.agentId));
    return rows.filter((r) => inBranch.has(r.agentId) || r.agentId === agentFilter);
  }, [metrics, branchFilter, ticketList, agentFilter]);

  const handleClose = useCallback(() => setViewTicketsOpen(false), [setViewTicketsOpen]);

  function handleSelectTicket(ticket) {
    setSelectedTicketId(ticket.id);
    setView('thread');
  }
  function handleBack() {
    setView('list');
    setSelectedTicketId(null);
  }

  // Reset transient state shortly after the panel closes (matches ViewAgents).
  useEffect(() => {
    if (viewTicketsOpen) return;
    const t = setTimeout(() => {
      setView('list');
      setSelectedTicketId(null);
      setStatusFilter('all');
      setBranchFilter(null);
      setAgentFilter(null);
      setBranchDropOpen(false);
    }, 400);
    return () => clearTimeout(t);
  }, [viewTicketsOpen]);

  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [view]);

  useEffect(() => {
    if (!viewTicketsOpen) return;
    function onKey(e) { if (e.key === 'Escape' && !fullPage) handleClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewTicketsOpen, handleClose, fullPage]);

  // Memoise the refs array + close callback so useOutsideClick doesn't tear
  // down + re-add its document listeners on every render while the dropdown
  // is open.
  const branchOutsideRefs = useMemo(() => [branchBtnRef], []);
  const closeBranchDrop = useCallback(() => setBranchDropOpen(false), []);
  useOutsideClick(branchDropOpen, closeBranchDrop, branchOutsideRefs);

  const headerTitle = view === 'thread' ? (thread?.subject || 'Conversation') : 'Network Support';
  const headerSubtitle =
    view === 'thread'
      ? 'Read-only conversation'
      : `${metrics?.totalCount ?? 0} tickets across the network`;

  return (
    <>
      <AnimatePresence>
        {viewTicketsOpen && !fullPage && (
          <motion.div
            key="vt-backdrop"
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
        {(viewTicketsOpen || fullPage) && (
          <motion.div
            key="vt-panel"
            className={styles.panel}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : { x: 0, transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            exit={fullPage ? { opacity: 0 } : { x: '100%', transition: { duration: 0.55, ease: EASE_OUT_EXPO } }}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
          >
            {/* Header */}
            <div className={styles.header} data-view={view}>
              <div className={styles.headerTop}>
                {view === 'thread' && (
                  <button className={styles.backBtn} onClick={handleBack} aria-label="Go back">
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="18" height="18">
                      <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
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

            {/* KPI row + filters (list view only) */}
            {view === 'list' && (
              <>
                <div className={styles.kpiRow}>
                  <KpiCard
                    icon={TICKET_ICONS.open}
                    label="Open"
                    value={metricsLoading && !metrics ? '—' : (metrics?.openCount ?? 0)}
                  />
                  <KpiCard
                    icon={TICKET_ICONS.closed}
                    label="Closed"
                    value={metricsLoading && !metrics ? '—' : (metrics?.closedCount ?? 0)}
                  />
                  <KpiCard
                    icon={TICKET_ICONS.response}
                    label="Avg first response"
                    value={metricsLoading && !metrics ? '—' : (metrics?.avgFirstResponseHours ?? 0)}
                    suffix="hrs"
                  />
                  <KpiCard
                    icon={TICKET_ICONS.unanswered}
                    label="Unanswered"
                    value={metricsLoading && !metrics ? '—' : (metrics?.unansweredCount ?? 0)}
                  />
                </div>

                <div className={styles.toolbar}>
                  {/* Branch select */}
                  <div style={{ position: 'relative' }} ref={branchBtnRef}>
                    <button
                      className={styles.filterBtn}
                      data-active={!!branchFilter}
                      aria-haspopup="listbox"
                      aria-expanded={branchDropOpen}
                      onClick={() => setBranchDropOpen((p) => !p)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="12" height="12">
                        <path d="M2 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M3 14V5l5-3 5 3v9" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                        <rect x="6.5" y="9" width="3" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                      {branchFilter ? branchName(branchFilter) : 'All branches'}
                    </button>
                    <AnimatePresence>
                      {branchDropOpen && (
                        <motion.div
                          role="listbox"
                          aria-label="Filter by branch"
                          className={styles.filterDropdown}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                        >
                          <button
                            role="option"
                            aria-selected={!branchFilter}
                            className={styles.filterOption}
                            data-selected={!branchFilter}
                            onClick={() => { setBranchFilter(null); setAgentFilter(null); setBranchDropOpen(false); }}
                          >
                            All branches
                          </button>
                          {branchOptions.map((id) => (
                            <button
                              key={id}
                              role="option"
                              aria-selected={branchFilter === id}
                              className={styles.filterOption}
                              data-selected={branchFilter === id}
                              onClick={() => { setBranchFilter(id); setAgentFilter(null); setBranchDropOpen(false); }}
                            >
                              {branchName(id)}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Status pills */}
                  <PillChipGroup label="Filter tickets by status" className={styles.statusGroup}>
                    {STATUS_FILTERS.map((s) => (
                      <PillChip
                        key={s.key}
                        selected={statusFilter === s.key}
                        onClick={() => setStatusFilter(s.key)}
                      >
                        {s.label}
                      </PillChip>
                    ))}
                  </PillChipGroup>
                </div>

                {/* Agent rollup chips */}
                {agentOptions.length > 0 && (
                  <div className={styles.agentChips} role="group" aria-label="Filter tickets by agent">
                    <button
                      className={styles.agentChip}
                      data-active={!agentFilter}
                      aria-pressed={!agentFilter}
                      onClick={() => setAgentFilter(null)}
                    >
                      All agents
                    </button>
                    {agentOptions.map((row) => (
                      <button
                        key={row.agentId}
                        className={styles.agentChip}
                        data-active={agentFilter === row.agentId}
                        aria-pressed={agentFilter === row.agentId}
                        onClick={() => setAgentFilter((prev) => (prev === row.agentId ? null : row.agentId))}
                      >
                        {row.name}
                        <span className={styles.agentChipCount}>{row.openCount + row.closedCount}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Body */}
            <div className={styles.body} ref={bodyRef}>
              <AnimatePresence mode="wait">
                {view === 'list' && (
                  <motion.div
                    key="vt-list"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                  >
                    {isColdList ? (
                      <SkeletonRow count={8} label="Loading tickets" />
                    ) : listError ? (
                      <div className={styles.stateWrap}>
                        <ErrorCard
                          title="We couldn't load the support inbox"
                          message={listErr}
                          onRetry={refetchList}
                        />
                      </div>
                    ) : ticketList.length === 0 ? (
                      statusFilter === 'all' && !branchFilter && !agentFilter ? (
                        <EmptyState
                          kind="no-data"
                          title="No tickets yet."
                          body="Support conversations raised across the network will appear here."
                        />
                      ) : (
                        <EmptyState
                          kind="no-match"
                          title="No tickets match"
                          body="Try widening the branch, agent, or status filter."
                        />
                      )
                    ) : (
                      <>
                        <div className={styles.listCount}>
                          Showing {ticketList.length} {ticketList.length === 1 ? 'ticket' : 'tickets'}
                        </div>
                        <div className={styles.list}>
                          {ticketList.map((ticket) => (
                            <TicketListRow
                              key={ticket.id}
                              ticket={ticket}
                              onClick={handleSelectTicket}
                              subtitle={branchName(ticket.branchId)}
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </motion.div>
                )}

                {view === 'thread' && (
                  <motion.div
                    key="vt-thread"
                    className={styles.threadWrap}
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                  >
                    <ThreadView
                      ticket={thread}
                      messages={thread?.messages ?? []}
                      currentRole="distributor"
                      participantLabel={thread ? branchName(thread.branchId) : undefined}
                      onBack={handleBack}
                      loading={threadLoading}
                      error={threadError ? (threadErr || 'Conversation unavailable') : undefined}
                      onRetry={refetchThread}
                    />
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
