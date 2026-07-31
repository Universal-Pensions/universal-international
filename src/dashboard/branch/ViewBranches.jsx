import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOutsideClick } from '../../hooks/useOutsideClick';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAllEntities, useUpdateBranch, useSetBranchStatus, useAllEntitiesMetrics } from '../../hooks/useEntity';
import { EASE_OUT_EXPO } from '../../utils/motion';

import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import { useDashboard } from '../../contexts/DashboardContext';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { useToast } from '../../contexts/ToastContext';
import { getInitials, getTrend, perfLevel } from '../../utils/dashboard';
import Stars from '../shared/Stars';
import { Icons } from '../shared/Icons';
import TrendArrow from '../shared/TrendArrow';
import MiniChart from '../shared/MiniChart';
import KpiCard from '../shared/KpiCard';
import Demographics from '../shared/Demographics';
import Modal from '../../components/Modal';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import styles from './ViewBranches.module.css';

function getStatus(activeRate) {
  if (activeRate >= 70) return 'good';
  if (activeRate >= 50) return 'warning';
  return 'poor';
}

function districtName(branch, districtsMap) {
  return districtsMap[branch.parentId]?.name || '';
}

function regionName(branch, districtsMap, regionsMap) {
  const d = districtsMap[branch.parentId];
  return d ? (regionsMap[d.parentId]?.name || '') : '';
}

function branchAgents(branchId, agentsByBranch) {
  return agentsByBranch[branchId] || [];
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Agent Detail View                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
function AgentDetail({ agent }) {
  const m = agent.metrics;
  const level = perfLevel(agent.performance);

  return (
    <div className={styles.detailContent}>
      {/* Profile card */}
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

      {/* KPIs */}
      <div className={styles.kpiRow}>
        <KpiCard icon={Icons.subscribers} label="Subscribers" value={formatNumber(m.totalSubscribers)} />
        <KpiCard icon={Icons.activeRate} label="Active Rate" value={m.activeRate} suffix="%" />
        <KpiCard icon={Icons.contributions} label="Contributions" value={formatUGX(m.totalContributions)} />
        <KpiCard icon={Icons.aum} label="AUM" value={formatUGX(m.aum)} />
      </div>

      {/* Chart */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Monthly Contributions</div>
        <MiniChart data={m.monthlyContributions} />
      </div>

      {/* Activity */}
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

      {/* Demographics */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Demographics</div>
        <Demographics metrics={m} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Branch Detail View                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */
function BranchDetail({ branch, onSelectAgent, onEdit, agentsByBranch, readOnly = false, onViewSubscribers }) {
  const m = branch.metrics;
  const agents = useMemo(() => branchAgents(branch.id, agentsByBranch), [branch.id, agentsByBranch]);
  const { data: commission } = useEntityCommissionSummary('branch', branch.id);

  return (
    <div className={styles.detailContent}>
      <span className={styles.statusBadge} data-status={branch.status}>
        <span className={styles.statusDot} data-status={branch.status === 'active' ? 'good' : 'poor'} />
        {branch.status === 'active' ? 'Active' : 'Inactive'}
      </span>

      {/* KPIs */}
      <div className={styles.kpiRow}>
        <KpiCard icon={Icons.subscribers} label="Subscribers" value={formatNumber(m.totalSubscribers)} />
        <KpiCard icon={Icons.agents} label="Agents" value={m.totalAgents} />
        <KpiCard icon={Icons.aum} label="AUM" value={formatUGX(m.aum)} />
        <KpiCard icon={Icons.activeRate} label="Active Rate" value={m.activeRate} suffix="%" />
      </div>

      {/* Drill deeper: every subscriber under this branch. `subscribers` has no
          branch_id — the list resolves branch → agents → subscribers server-side
          (entities.getSubscribersForBranch). */}
      {onViewSubscribers && (
        <button
          type="button"
          className={styles.drillCta}
          data-testid="branch-view-subscribers"
          aria-label={`View subscribers for ${branch.name}`}
          onClick={onViewSubscribers}
        >
          View subscribers
          <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" width="10" height="10">
            <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Branch Score + Rank */}
      {branch.score != null && (
        <div className={styles.scoreRow}>
          <div className={styles.scorePill}>
            <span className={styles.scorePillLabel}>Score</span>
            <span className={styles.scorePillValue}>{branch.score}</span>
            <span className={styles.scorePillMax}>/100</span>
          </div>
          {branch.districtRank && (
            <div className={styles.scorePill} data-variant="rank">
              <span className={styles.scorePillLabel}>District Rank</span>
              <span className={styles.scorePillValue}>#{branch.districtRank}</span>
              <span className={styles.scorePillMax}>of {branch.districtBranchCount}</span>
            </div>
          )}
          {branch.rank && (
            <div className={styles.scorePill} data-variant="global">
              <span className={styles.scorePillLabel}>Overall</span>
              <span className={styles.scorePillValue}>#{branch.rank}</span>
            </div>
          )}
        </div>
      )}

      {/* Branch admin */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Branch Admin</span>
          {!readOnly && (
            <button className={styles.editBtn} onClick={() => onEdit('admin')}>
              <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="12" height="12">
                <path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              Edit
            </button>
          )}
        </div>
        <div className={styles.adminCard}>
          <div className={styles.adminAvatar}>{getInitials(branch.managerName)}</div>
          <div className={styles.adminDetails}>
            <div className={styles.adminName}>{branch.managerName}</div>
            <div className={styles.adminRow}>
              <span className={styles.adminRowIcon}>{Icons.phone}</span>
              <span className={styles.adminRowText}>{branch.managerPhone}</span>
            </div>
            <div className={styles.adminRow}>
              <span className={styles.adminRowIcon}>{Icons.email}</span>
              <span className={styles.adminRowText}>{branch.managerEmail}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Monthly Contributions</div>
        <MiniChart data={m.monthlyContributions} />
      </div>

      {/* Activity */}
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

      {/* Commissions */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Commissions</div>
        <div className={styles.infoCard}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>
              <span className={styles.commDot} data-status="settled" />
              Settled
            </span>
            <span className={styles.infoValue}>
              <span className={styles.commAmount}>{commission ? formatUGX(commission.totalPaid) : '--'}</span>
              <span className={styles.commCount}>{commission ? `${commission.countPaid} txn${commission.countPaid !== 1 ? 's' : ''}` : ''}</span>
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>
              <span className={styles.commDot} data-status="due" />
              Due
            </span>
            <span className={styles.infoValue}>
              <span className={styles.commAmount}>{commission ? formatUGX(commission.totalDue) : '--'}</span>
              <span className={styles.commCount}>{commission ? `${commission.countDue} txn${commission.countDue !== 1 ? 's' : ''}` : ''}</span>
            </span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Settlement Rate</span>
            <span className={styles.infoValue}>
              <span className={styles.commRate}>{commission ? `${commission.settlementRate}%` : '--'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Demographics */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Demographics</div>
        <Demographics metrics={m} />
      </div>

      {/* Agents list */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Agents ({agents.length})</span>
        </div>
        <div className={styles.agentList}>
          {agents.map((agent) => {
            const level = perfLevel(agent.performance);
            return (
              <button key={agent.id} className={styles.agentItem} onClick={() => onSelectAgent(agent)}>
                <div className={styles.agentAvatar}>{getInitials(agent.name)}</div>
                <div className={styles.agentInfo}>
                  <div className={styles.agentName}>{agent.name}</div>
                  <div className={styles.agentMeta}>
                    <span className={styles.agentStatus} data-status={agent.status} />
                    <span>{agent.metrics.totalSubscribers} subs</span>
                    <span>&middot;</span>
                    <Stars rating={agent.rating} />
                  </div>
                </div>
                <span className={styles.agentPerf} data-level={level}>{agent.performance}%</span>
                <span className={styles.chevronAgent}>
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="14" height="14">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Edit Branch Panel                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */
function EditBranch({ branch, section, onSave, onCancel }) {
  const [name, setName] = useState(branch.managerName);
  const [phone, setPhone] = useState(branch.managerPhone);
  const [email, setEmail] = useState(branch.managerEmail);
  const [branchName, setBranchName] = useState(branch.name);

  function handleSave() {
    if (section === 'admin') {
      onSave({ managerName: name, managerPhone: phone, managerEmail: email });
    } else {
      onSave({ name: branchName });
    }
  }

  return (
    <>
      <div className={styles.detailContent}>
        <div className={styles.editForm}>
          {section === 'admin' ? (
            <>
              <div className={styles.field}>
                <label className={styles.label}>Full Name</label>
                <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Manager name" name="managerName" autoComplete="name" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Phone Number</label>
                <input className={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+256…" name="phone" type="tel" autoComplete="tel" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Email Address</label>
                <input className={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" name="email" type="email" autoComplete="email" />
              </div>
            </>
          ) : (
            <div className={styles.field}>
              <label className={styles.label}>Branch Name</label>
              <input className={styles.input} value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="Branch name" name="branchName" autoComplete="off" />
            </div>
          )}
        </div>
      </div>
      <div className={styles.footer}>
        <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
        <div className={styles.footerSpacer} />
        <button className={styles.saveBtn} onClick={handleSave}>Save Changes</button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  ViewBranches — main panel orchestrator                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */
const SORT_OPTIONS = [
  { key: 'score', label: 'Score', fn: (a, b) => (b.score || 0) - (a.score || 0) },
  { key: 'subscribers', label: 'Subscribers', fn: (a, b) => b.metrics.totalSubscribers - a.metrics.totalSubscribers },
  { key: 'activeRate', label: 'Active Rate', fn: (a, b) => b.metrics.activeRate - a.metrics.activeRate },
  { key: 'aum', label: 'AUM', fn: (a, b) => b.metrics.aum - a.metrics.aum },
  { key: 'agents', label: 'Agents', fn: (a, b) => b.metrics.totalAgents - a.metrics.totalAgents },
];

export default function ViewBranches({ readOnly = false, fullPage = false }) {
  const navigate = useNavigate();
  const { viewBranchesOpen, setViewBranchesOpen, drillTargetBranchId, closeDrillPanel } = useDashboard();
  const { addToast } = useToast();
  const updateBranchMutation = useUpdateBranch();
  const setBranchStatusMutation = useSetBranchStatus();

  const [view, setView] = useState('list');
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [editSection, setEditSection] = useState(null);
  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState(null);
  const [regionDropOpen, setRegionDropOpen] = useState(false);
  const [sortKey, setSortKey] = useState('subscribers');
  const [sortDropOpen, setSortDropOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const bodyRef = useRef(null);
  const virtualListRef = useRef(null);
  const regionBtnRef = useRef(null);
  const sortBtnRef = useRef(null);

  const { data: allBranchesRaw = [], isLoading: branchesLoading } = useAllEntities('branch');
  const { data: allAgentsRaw = [] } = useAllEntities('agent');
  const { data: allDistrictsRaw = [] } = useAllEntities('district');
  const { data: allRegionsRaw = [] } = useAllEntities('region');

  // Per-branch and per-agent metrics — the entity mappers return EMPTY_METRICS
  // under Supabase, so we overlay real rollups via the get_entity_metrics_rollup
  // RPC. Without this merge every `branch.metrics.totalSubscribers` (and the
  // same for agents) reads zero.
  const { data: branchMetricsMap = {} } = useAllEntitiesMetrics('branch');
  const { data: agentMetricsMap = {} } = useAllEntitiesMetrics('agent');

  // Treat the very first cold-load (no rows yet AND query is pending) as
  // the skeleton case. Once cached branches exist we always render the
  // live list — even during a background refetch — so we never bounce
  // back into a skeleton after the user has already seen the data.
  const isCold = branchesLoading && allBranchesRaw.length === 0;

  const DISTRICTS_MAP = useMemo(() => Object.fromEntries(allDistrictsRaw.map(d => [d.id, d])), [allDistrictsRaw]);
  const REGIONS_MAP = useMemo(() => Object.fromEntries(allRegionsRaw.map(r => [r.id, r])), [allRegionsRaw]);

  // Overlay live rollup metrics into each agent so per-row "X subs" labels
  // and the per-branch agent list pick up real counts.
  const allAgents = useMemo(
    () => allAgentsRaw.map(a => ({ ...a, metrics: agentMetricsMap[a.id] ?? a.metrics })),
    [allAgentsRaw, agentMetricsMap],
  );

  const AGENTS_BY_BRANCH = useMemo(() => {
    const map = {};
    allAgents.forEach(a => {
      if (!map[a.parentId]) map[a.parentId] = [];
      map[a.parentId].push(a);
    });
    return map;
  }, [allAgents]);

  // Overlay live rollup metrics into each branch so the totals/sort columns
  // and per-row pills pick up real numbers.
  const allBranches = useMemo(
    () => allBranchesRaw.map(b => ({ ...b, metrics: branchMetricsMap[b.id] ?? b.metrics })),
    [allBranchesRaw, branchMetricsMap],
  );

  // Auto-select branch when opened via map drill-down. Reads from the
  // metrics-overlaid `allBranches`, not `allBranchesRaw` (which has
  // EMPTY_METRICS), so the BranchDetail KPI cards bind to real numbers.
  useEffect(() => {
    if (!viewBranchesOpen || !drillTargetBranchId || allBranches.length === 0) return;
    const branch = allBranches.find(b => b.id === drillTargetBranchId);
    if (!branch) return;
    setSelectedBranch(branch);
    // Only snap to 'detail' on the first auto-select for this drill target;
    // later metrics-overlay updates refresh selectedBranch in place without
    // overwriting a user-initiated nav to an agent / edit pane.
    if (!selectedBranch || selectedBranch.id !== drillTargetBranchId) {
      setView('detail');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedBranch intentionally excluded to avoid self-triggered loop
  }, [viewBranchesOpen, drillTargetBranchId, allBranches]);

  const handleClose = useCallback(() => {
    if (drillTargetBranchId) closeDrillPanel();
    else setViewBranchesOpen(false);
  }, [drillTargetBranchId, closeDrillPanel, setViewBranchesOpen]);

  // Aggregate stats for summary strip
  const totals = useMemo(() => {
    const t = { subs: 0, agents: 0, aum: 0 };
    allBranches.forEach((b) => {
      t.subs += b.metrics.totalSubscribers;
      t.agents += b.metrics.totalAgents;
      t.aum += b.metrics.aum;
    });
    return t;
  }, [allBranches]);

  const filtered = useMemo(() => {
    let list = allBranches;
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter((b) =>
        b.name.toLowerCase().includes(q) ||
        districtName(b, DISTRICTS_MAP).toLowerCase().includes(q) ||
        b.managerName.toLowerCase().includes(q)
      );
    }
    if (regionFilter) {
      list = list.filter((b) => {
        const d = DISTRICTS_MAP[b.parentId];
        return d && d.parentId === regionFilter;
      });
    }
    if (statusFilter !== 'all') {
      list = list.filter((b) => b.status === statusFilter);
    }
    const sortOpt = SORT_OPTIONS.find((o) => o.key === sortKey);
    return list.sort(sortOpt ? sortOpt.fn : SORT_OPTIONS[0].fn);
  }, [allBranches, search, regionFilter, statusFilter, sortKey, DISTRICTS_MAP]);

  const regionCounts = useMemo(() => {
    const counts = {};
    allBranches.forEach((b) => {
      const d = DISTRICTS_MAP[b.parentId];
      if (d) counts[d.parentId] = (counts[d.parentId] || 0) + 1;
    });
    return counts;
  }, [allBranches, DISTRICTS_MAP]);

  const regionOptions = allRegionsRaw;

  /* ── Virtualizer for branch list ──────────────────────────────────────── */
  const ESTIMATED_ITEM_HEIGHT = 72; // matches contain-intrinsic-size in CSS
  const ITEM_GAP = 8; // var(--space-2)
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: useCallback(() => bodyRef.current, []),
    estimateSize: useCallback(() => ESTIMATED_ITEM_HEIGHT, []),
    gap: ITEM_GAP,
    overscan: 8,
    scrollMargin: virtualListRef.current?.offsetTop ?? 0,
  });

  useEffect(() => {
    if (viewBranchesOpen) return;
    const t = setTimeout(() => {
      setView('list');
      setSelectedBranch(null);
      setSelectedAgent(null);
      setEditSection(null);
      setSearch('');
      setRegionFilter(null);
      setSortKey('subscribers');
      setStatusFilter('all');
    }, 400);
    return () => clearTimeout(t);
  }, [viewBranchesOpen]);

  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [view]);

  /* Escape key to close panel */
  useEffect(() => {
    if (!viewBranchesOpen) return;
    function onKey(e) {
      if (e.key === 'Escape' && !fullPage) handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewBranchesOpen, drillTargetBranchId, handleClose, fullPage]);

  // Memoise the refs arrays + close callbacks so useOutsideClick doesn't tear
  // down + re-add its document listeners on every render while a dropdown is open.
  const regionOutsideRefs = useMemo(() => [regionBtnRef], []);
  const sortOutsideRefs = useMemo(() => [sortBtnRef], []);
  const closeRegionDrop = useCallback(() => setRegionDropOpen(false), []);
  const closeSortDrop = useCallback(() => setSortDropOpen(false), []);
  useOutsideClick(regionDropOpen, closeRegionDrop, regionOutsideRefs);
  useOutsideClick(sortDropOpen, closeSortDrop, sortOutsideRefs);

  function handleSelectBranch(branch) { setSelectedBranch(branch); setView('detail'); }
  function handleSelectAgent(agent) { setSelectedAgent(agent); setView('agent'); }
  function handleEdit(section) { setEditSection(section); setView('edit'); }

  async function handleSaveEdit(updates) {
    if (!selectedBranch) return;
    try {
      const updated = await updateBranchMutation.mutateAsync({ id: selectedBranch.id, updates });
      setSelectedBranch(updated);
      setView('detail');
      addToast('success', 'Branch updated.');
    } catch (err) {
      addToast('error', err?.message || 'Could not update branch.');
    }
  }

  function handleToggleStatusRequest() {
    setConfirmStatusOpen(true);
  }

  async function handleToggleStatusConfirm() {
    if (!selectedBranch) return;
    const nextStatus = selectedBranch.status === 'active' ? 'inactive' : 'active';
    try {
      const updated = await setBranchStatusMutation.mutateAsync({ id: selectedBranch.id, status: nextStatus });
      setSelectedBranch(updated);
      setConfirmStatusOpen(false);
      addToast('success', nextStatus === 'active' ? 'Branch activated.' : 'Branch deactivated.');
    } catch (err) {
      addToast('error', err?.message || 'Could not update status.');
    }
  }

  function handleBack() {
    if (view === 'edit') { setView('detail'); setEditSection(null); }
    else if (view === 'agent') { setView('detail'); setSelectedAgent(null); }
    else if (view === 'detail') {
      if (drillTargetBranchId) closeDrillPanel();
      else { setView('list'); setSelectedBranch(null); }
    }
  }

  let headerTitle = 'Existing Branches';
  // Derived from the (RLS-scoped) branch list rather than asserting "Uganda":
  // a regional distributor's 27 branches sit in one region, not the country.
  const branchRegionCount = new Set(
    allBranches.map((b) => DISTRICTS_MAP[b.parentId]?.parentId).filter(Boolean),
  ).size;
  let headerSubtitle = branchRegionCount
    ? `${allBranches.length} branches across ${branchRegionCount} ${branchRegionCount === 1 ? 'region' : 'regions'}`
    : `${allBranches.length} branches`;
  if (view === 'detail' && selectedBranch) {
    headerTitle = selectedBranch.name;
    headerSubtitle = `${districtName(selectedBranch, DISTRICTS_MAP)}, ${regionName(selectedBranch, DISTRICTS_MAP, REGIONS_MAP)} Region`;
  } else if (view === 'agent' && selectedAgent) {
    headerTitle = selectedAgent.name;
    headerSubtitle = `Agent at ${selectedBranch?.name || ''}`;
  } else if (view === 'edit') {
    headerTitle = editSection === 'admin' ? 'Edit Branch Admin' : 'Edit Branch Details';
    headerSubtitle = selectedBranch?.name || '';
  }

  return (
    <>
      <AnimatePresence>
        {viewBranchesOpen && !fullPage && (
          <motion.div
            key="vb-backdrop"
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
        {(viewBranchesOpen || fullPage) && (
          <motion.div
            key="vb-panel"
            className={styles.panel}
            initial={fullPage ? false : { x: '100%' }}
            animate={fullPage ? { opacity: 1 } : { x: 0 }}
            exit={fullPage ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
            style={fullPage ? { position: 'static', inset: 'auto', margin: '0 auto', width: '100%', maxWidth: '1040px', height: 'auto', maxHeight: 'none', overflow: 'visible', boxShadow: 'none', border: 'none' } : undefined}
          >
            {/* ── Header ──────────────────────────────────────────── */}
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

            {/* ── Search + filters (list view) ────────────────────── */}
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
                      placeholder="Search branches, districts, managers…"
                      aria-label="Search branches"
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
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="12" height="12">
                        <path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                      {regionFilter ? REGIONS_MAP[regionFilter]?.name : 'Region'}
                    </button>
                    <AnimatePresence>
                      {regionDropOpen && (
                        <motion.div
                          role="listbox"
                          aria-label="Filter by region"
                          className={styles.filterDropdown}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                        >
                          <button
                            role="option"
                            aria-selected={!regionFilter}
                            className={styles.filterOption}
                            data-selected={!regionFilter}
                            onClick={() => { setRegionFilter(null); setRegionDropOpen(false); }}
                          >
                            All Regions
                            <span className={styles.filterCount}>{allBranches.length}</span>
                          </button>
                          {regionOptions.map((r) => (
                            <button
                              key={r.id}
                              role="option"
                              aria-selected={regionFilter === r.id}
                              className={styles.filterOption}
                              data-selected={regionFilter === r.id}
                              onClick={() => { setRegionFilter(r.id); setRegionDropOpen(false); }}
                            >
                              {r.name}
                              <span className={styles.filterCount}>{regionCounts[r.id] || 0}</span>
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
                      <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="12" height="12">
                        <path d="M4 2v12M4 14l-3-3M4 14l3-3M12 14V2M12 2l-3 3M12 2l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {SORT_OPTIONS.find((o) => o.key === sortKey)?.label || 'Sort'}
                    </button>
                    <AnimatePresence>
                      {sortDropOpen && (
                        <motion.div
                          role="listbox"
                          aria-label="Sort branches"
                          className={styles.filterDropdown}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.12 }}
                        >
                          {SORT_OPTIONS.map((opt) => (
                            <button
                              key={opt.key}
                              role="option"
                              aria-selected={sortKey === opt.key}
                              className={styles.filterOption}
                              data-selected={sortKey === opt.key}
                              onClick={() => { setSortKey(opt.key); setSortDropOpen(false); }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* ── Status filter chips ────────────────────────── */}
                <div className={styles.statusChips} role="group" aria-label="Filter branches by status">
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

                {/* ── Summary strip ───────────────────────────────── */}
                <div className={styles.summaryStrip}>
                  <div className={styles.summaryChip}>
                    <span className={styles.summaryChipIcon}>{Icons.subscribers}</span>
                    <span className={styles.summaryChipValue}>{formatNumber(totals.subs)}</span>
                    <span className={styles.summaryChipLabel}>Subscribers</span>
                  </div>
                  <div className={styles.summaryChip}>
                    <span className={styles.summaryChipIcon}>{Icons.agents}</span>
                    <span className={styles.summaryChipValue}>{formatNumber(totals.agents)}</span>
                    <span className={styles.summaryChipLabel}>Agents</span>
                  </div>
                  <div className={styles.summaryChip}>
                    <span className={styles.summaryChipIcon}>{Icons.aum}</span>
                    <span className={styles.summaryChipValue}>{formatUGXShort(totals.aum)}</span>
                    <span className={styles.summaryChipLabel}>AUM</span>
                  </div>
                </div>
              </>
            )}

            {/* ── Body ────────────────────────────────────────────── */}
            <div className={styles.body} ref={bodyRef}>
              <AnimatePresence mode="wait">
                {/* ─── List View ─────────────────────────────────── */}
                {view === 'list' && (
                  <motion.div
                    key="v-list"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                  >
                    <div className={styles.listCount}>
                      {isCold
                        ? 'Loading branches…'
                        : `Showing ${filtered.length} of ${allBranches.length} branches`}
                    </div>

                    {isCold ? (
                      <SkeletonRow
                        count={6}
                        variant="card"
                        label="Loading branches"
                      />
                    ) : filtered.length === 0 ? (
                      // Differentiate genuinely-empty from filter-mismatch so the
                      // user knows whether to invite the first branch or to widen
                      // their search.
                      search.trim() === '' && !regionFilter && statusFilter === 'all' ? (
                        <EmptyState
                          kind="no-data"
                          title="No branches yet."
                          body="When branches are added, they'll show up here for review."
                        />
                      ) : (
                        <EmptyState
                          kind="no-match"
                          title="No branches match"
                          body="Try adjusting your search or filters."
                        />
                      )
                    ) : (
                      <div
                        ref={virtualListRef}
                        className={styles.virtualList}
                        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
                      >
                          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                            const branch = filtered[virtualRow.index];
                            return (
                              <button
                                key={branch.id}
                                className={styles.branchItem}
                                onClick={() => handleSelectBranch(branch)}
                                data-index={virtualRow.index}
                                ref={rowVirtualizer.measureElement}
                                style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  width: '100%',
                                  transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                                }}
                              >
                                <span className={styles.branchAccent} data-status={getStatus(branch.metrics.activeRate)} />
                                <div className={styles.branchInfo}>
                                  <div className={styles.branchName}>{branch.name}</div>
                                  <div className={styles.branchLocation}>{districtName(branch, DISTRICTS_MAP)}, {regionName(branch, DISTRICTS_MAP, REGIONS_MAP)}</div>
                                  <div className={styles.branchActiveBar}>
                                    <div className={styles.branchActiveBarFill} data-status={getStatus(branch.metrics.activeRate)} style={{ width: `${branch.metrics.activeRate}%` }} />
                                  </div>
                                </div>
                                <div className={styles.branchStats}>
                                  <div className={styles.stat}>
                                    <span className={styles.statValue}>{branch.metrics.totalAgents}</span>
                                    <span className={styles.statLabel}>Agents</span>
                                  </div>
                                  <div className={styles.stat}>
                                    <span className={styles.statValue}>{branch.metrics.totalSubscribers}</span>
                                    <span className={styles.statLabel}>Subs</span>
                                  </div>
                                  <div className={styles.stat}>
                                    <span className={styles.statValue}>{branch.metrics.activeRate}%</span>
                                    <span className={styles.statLabel}>Active</span>
                                  </div>
                                  <div className={styles.stat} data-variant="score">
                                    <span className={styles.statValueScore}>{branch.score ?? '—'}</span>
                                    <span className={styles.statLabel}>Score</span>
                                  </div>
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
                    {/* Bottom padding for scrolling past bottom cards */}
                    <div style={{ height: 'var(--space-4)' }} />
                  </motion.div>
                )}

                {/* ─── Branch Detail View ────────────────────────── */}
                {view === 'detail' && selectedBranch && (
                  <motion.div
                    key="v-detail"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                  >
                    <BranchDetail
                      branch={selectedBranch}
                      onSelectAgent={handleSelectAgent}
                      onEdit={handleEdit}
                      agentsByBranch={AGENTS_BY_BRANCH}
                      readOnly={readOnly}
                      onViewSubscribers={() => navigate(`/dashboard/branches/${selectedBranch.id}/subscribers`)}
                    />
                  </motion.div>
                )}

                {/* ─── Agent Detail View ─────────────────────────── */}
                {view === 'agent' && selectedAgent && (
                  <motion.div
                    key="v-agent"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                  >
                    <AgentDetail agent={selectedAgent} />
                  </motion.div>
                )}

                {/* ─── Edit View ─────────────────────────────────── */}
                {view === 'edit' && selectedBranch && (
                  <motion.div
                    key="v-edit"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.25, ease: EASE_OUT_EXPO }}
                    style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
                  >
                    <EditBranch branch={selectedBranch} section={editSection} onSave={handleSaveEdit} onCancel={handleBack} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ── Footer (detail view — toggle status) ────────────── */}
            {!readOnly && view === 'detail' && selectedBranch && (
              <div className={styles.footer}>
                {selectedBranch.status === 'active' ? (
                  <button className={styles.deactivateBtn} onClick={handleToggleStatusRequest}>Deactivate Branch</button>
                ) : (
                  <button className={styles.activateBtn} onClick={handleToggleStatusRequest}>Activate Branch</button>
                )}
                <div className={styles.footerSpacer} />
                <button className={styles.editBtn} onClick={() => handleEdit('details')}>
                  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="12" height="12">
                    <path d="M11.5 1.5l3 3L5 14H2v-3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  Edit Details
                </button>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Confirm status-change modal ─────────────────────── */}
      {selectedBranch && (() => {
        const isActive = selectedBranch.status === 'active';
        const title = isActive ? 'Deactivate this branch?' : 'Activate this branch?';
        return (
          <Modal
            open={confirmStatusOpen}
            onClose={() => {
              if (!setBranchStatusMutation.isPending) setConfirmStatusOpen(false);
            }}
            title={title}
            size="sm"
            dismissOnBackdrop={!setBranchStatusMutation.isPending}
          >
            <div className={styles.confirmDialog}>
              <h3 className={styles.confirmTitle}>{title}</h3>
              <p className={styles.confirmBody}>
                {isActive
                  ? `${selectedBranch.name} will stop accepting new subscribers and its agents won't be able to log in until it's reactivated.`
                  : `${selectedBranch.name} will resume normal operation.`}
              </p>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setConfirmStatusOpen(false)}
                  disabled={setBranchStatusMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={isActive ? styles.deactivateBtn : styles.activateBtn}
                  onClick={handleToggleStatusConfirm}
                  disabled={setBranchStatusMutation.isPending}
                >
                  {setBranchStatusMutation.isPending
                    ? 'Working…'
                    : isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
