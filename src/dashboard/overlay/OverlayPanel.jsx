import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDashboard } from '../../contexts/DashboardContext';
import { useDataScope } from '../../contexts/DataScopeContext';
import { SCOPES } from '../../constants/scopes';
import { useCurrentEntity, useChildren, useTopBranch, useSearch, useEntityMetrics, useChildrenMetrics, useEmployerGeoRollup } from '../../hooks/useEntity';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { CHILD_LEVEL } from '../../constants/levels';
import { EASE_OUT_EXPO as EASE } from '../../utils/motion';

import { formatUGX, formatNumber } from '../../utils/currency';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import styles from './OverlayPanel.module.css';
const LEVEL_LABELS = { region: 'Regions', district: 'Districts', branch: 'Branches', agent: 'Agents' };
const LEVEL_TAG = { region: 'Region', district: 'District', branch: 'Branch', agent: 'Agent' };

function ChevronIcon({ expanded }) {
  return (
    <svg
      aria-hidden="true"
      width="14" height="14" viewBox="0 0 14 14" fill="none"
      className={styles.chevron}
      data-expanded={expanded}
    >
      <path d="M4 5.5l3 3 3-3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function ExpandIcon({ expanded }) {
  return (
    <svg
      aria-hidden="true"
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      className={styles.expandIcon}
      data-expanded={expanded}
    >
      <path
        d={expanded ? 'M3 5l3 3 3-3' : 'M3 7l3-3 3 3'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CollapsibleSection({ title, count, defaultOpen, children, fill, expanded, onExpandToggle }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(defaultOpen ?? true);

  if (!isMobile) {
    return (
      <div className={styles.section} data-fill={fill ? 'true' : undefined} data-expanded={expanded ? 'true' : undefined}>
        <div className={styles.sectionHeader} data-static="true">
          <span className={styles.sectionTitle}>{title}</span>
          <div className={styles.sectionRight}>
            {count != null && <span className={styles.sectionCount}>{count}</span>}
            {onExpandToggle && (
              <button
                className={styles.expandBtn}
                onClick={onExpandToggle}
                aria-label={expanded ? 'Collapse list' : 'Expand list'}
                aria-pressed={!!expanded}
              >
                <ExpandIcon expanded={expanded} />
              </button>
            )}
          </div>
        </div>
        <div className={styles.sectionBody}>{children}</div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <button className={styles.sectionHeader} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={styles.sectionTitle}>{title}</span>
        <div className={styles.sectionRight}>
          {count != null && <span className={styles.sectionCount}>{count}</span>}
          <ChevronIcon expanded={open} />
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className={styles.sectionBody}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatusBar({ label, value, segments }) {
  return (
    <div className={styles.statusRow}>
      <span className={styles.statusLabel}>{label}</span>
      <div className={styles.barTrack}>
        {segments.map((seg, i) => (
          <div key={i} className={styles.barSegment} style={{ width: `${seg.pct}%`, background: seg.color }} />
        ))}
      </div>
      <span className={styles.statusPct}>{value}%</span>
    </div>
  );
}

export function GlobalSearch({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  // 200ms debounce — keeps the `useSearch` query from firing on every
  // keystroke. Per the brief perf target: keystroke → render < 50ms after
  // debounce, so the visible cost is the debounce window only.
  const debouncedQuery = useDebouncedValue(query, 200);
  const { data: results = [] } = useSearch(debouncedQuery);

  function handleSelect(item) {
    onNavigate(item.level, item.id);
    setQuery('');
    setOpen(false);
  }

  function handleClose() {
    setQuery('');
    setOpen(false);
  }

  // Blur fires AFTER the dropdown item's `mousedown`/`click` was originally
  // scheduled, which meant the input's blur was racing the click handler.
  // The legacy fix was a 150ms `setTimeout` on blur; that surfaced as a
  // sluggish dropdown that swallowed quick selections. New pattern:
  //   1. Items use `onPointerDown` (fires *before* blur on the input).
  //   2. The input's blur handler closes without a timer — by the time
  //      blur runs, the pointer-down selection has already executed
  //      `handleSelect`, which itself closes the dropdown.
  // This eliminates the race without the timeout debt.

  if (!open) {
    return (
      <button className={styles.searchToggle} onClick={() => setOpen(true)} aria-label="Search">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="14" height="14">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.75"/>
          <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        </svg>
        <span>Search…</span>
      </button>
    );
  }

  return (
    <div className={styles.globalSearch}>
      <div className={styles.searchBarCompact}>
        <svg aria-hidden="true" className={styles.searchBarIcon} viewBox="0 0 24 24" fill="none" width="13" height="13">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.75"/>
          <path d="M16 16l4.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
        </svg>
        <input
          className={styles.searchBarInput}
          type="text"
          placeholder="Region, district, branch…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          onBlur={handleClose}
          aria-label="Search entities"
          name="search"
          autoComplete="off"
        />
        <button
          className={styles.searchBarClose}
          // Pointer-down fires before the input's blur, so the close
          // handler runs in the same gesture without a timer.
          onPointerDown={handleClose}
          aria-label="Close search"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="12" height="12">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      {results.length > 0 && (
        <div className={styles.searchResults}>
          {results.map((item) => (
            <button
              key={item.id}
              className={styles.searchResultBtn}
              // Pointer-down beats the input's blur, so we can navigate
              // before the dropdown unmounts.
              onPointerDown={() => handleSelect(item)}
            >
              <span className={styles.searchResultName}>{item.name}</span>
              <span className={styles.searchResultLevel}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

function pctChange(curr, prev) {
  if (!prev) return 0;
  return Math.round(((curr - prev) / prev) * 100);
}

function ChangeBadge({ value }) {
  return (
    <span className={styles.changeBadge} data-positive={value >= 0}>
      <svg aria-hidden="true" viewBox="0 0 10 10" width="8" height="8" fill="none">
        {value >= 0
          ? <path d="M5 2l3.5 5H1.5z" fill="currentColor"/>
          : <path d="M5 8L1.5 3h7z" fill="currentColor"/>}
      </svg>
      {Math.abs(value)}%
    </span>
  );
}

function MetricRow({ variant, icon, value, label, change, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={styles.monthlyRow} data-variant={variant} data-clickable={!!onClick} onClick={onClick}>
      <div className={styles.monthlyIcon} data-variant={variant}>{icon}</div>
      <div className={styles.monthlyText}>
        <span className={styles.monthlyValue}>{value}</span>
        <span className={styles.monthlyLabel}>{label}</span>
      </div>
      {change != null && <ChangeBadge value={change} />}
      {onClick && (
        <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" width="10" height="10" className={styles.monthlyChevron}>
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Tag>
  );
}

const SubsIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="15" height="15">
    <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4-4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.75"/>
    <path d="M19 8v6M22 11h-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const ContribIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="15" height="15">
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const WithdrawIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="15" height="15">
    <path d="M21 12l-4 4-4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M17 16V4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    <path d="M3 20h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
  </svg>
);
const StarIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="15" height="15">
    <path d="M12 2l2.09 6.26L20 9.27l-4.91 3.82L16.18 20 12 16.77 7.82 20l1.09-6.91L4 9.27l5.91-1.01L12 2z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export function TimePeriodCard({ metrics, level, parentId, onMetricClick, topEntity, topEntityLabel = 'Top Branch' }) {
  const [activeIdx, setActiveIdx] = useState(2); // default: This Month
  const period = PERIODS[activeIdx].key;
  // `topEntity` (employer scope) overrides the distributor top-branch lookup. The
  // employer caller passes null level/parentId so this admin query stays disabled.
  const { data: topBranch } = useTopBranch(level, parentId);
  const topPerformer = topEntity !== undefined ? topEntity : topBranch;
  const isCustomTop = topEntity !== undefined;

  const data = {
    today: {
      subs: metrics.newSubscribersToday || 0,
      subsChange: pctChange(metrics.newSubscribersToday, metrics.prevNewSubscribersToday),
      contrib: metrics.dailyContributions || 0,
      contribChange: pctChange(metrics.dailyContributions, metrics.prevDailyContributions),
      withdraw: metrics.dailyWithdrawals || 0,
      withdrawChange: pctChange(metrics.dailyWithdrawals, metrics.prevDailyWithdrawals),
      changeLabel: 'vs yesterday',
    },
    week: {
      subs: metrics.newSubscribersThisWeek || 0,
      subsChange: pctChange(metrics.newSubscribersThisWeek, metrics.prevNewSubscribersThisWeek),
      contrib: metrics.weeklyContributions || 0,
      contribChange: pctChange(metrics.weeklyContributions, metrics.prevWeeklyContributions),
      withdraw: metrics.weeklyWithdrawals || 0,
      withdrawChange: pctChange(metrics.weeklyWithdrawals, metrics.prevWeeklyWithdrawals),
      changeLabel: 'vs last week',
    },
    month: {
      subs: metrics.newSubscribersThisMonth || 0,
      subsChange: pctChange(metrics.newSubscribersThisMonth, metrics.prevNewSubscribersThisMonth),
      contrib: metrics.monthlyContributions?.[11] || 0,
      contribChange: pctChange(metrics.monthlyContributions?.[11], metrics.monthlyContributions?.[10]),
      withdraw: metrics.monthlyWithdrawals || 0,
      withdrawChange: pctChange(metrics.monthlyWithdrawals, metrics.prevMonthlyWithdrawals),
      changeLabel: 'vs last month',
    },
  };

  const d = data[period];

  return (
    <div className={styles.periodCard}>
      <div className={styles.periodTabs} role="tablist">
        {PERIODS.map((p, i) => (
          <button
            key={p.key}
            className={styles.periodTab}
            data-active={i === activeIdx}
            onClick={() => setActiveIdx(i)}
            role="tab"
            aria-selected={i === activeIdx}
          >
            {p.label}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={period}
          className={styles.monthlyList}
          initial={{ opacity: 0, x: activeIdx > 1 ? 8 : -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: activeIdx > 1 ? -8 : 8 }}
          transition={{ duration: 0.15, ease: EASE }}
        >
          <MetricRow
            variant="subscribers" icon={<SubsIcon />}
            value={formatNumber(d.subs)} label="New Subscribers"
            change={d.subsChange}
            onClick={onMetricClick ? () => onMetricClick('subscriber-growth') : undefined}
          />
          <MetricRow
            variant="contribution" icon={<ContribIcon />}
            value={formatUGX(d.contrib)} label="Contributions"
            change={d.contribChange}
            onClick={onMetricClick ? () => onMetricClick('contributions-collections') : undefined}
          />
          <MetricRow
            variant="withdrawal" icon={<WithdrawIcon />}
            value={formatUGX(d.withdraw)} label="Withdrawals"
            change={d.withdrawChange}
            onClick={onMetricClick ? () => onMetricClick('withdrawals-payouts') : undefined}
          />
          {topPerformer && (
            <MetricRow
              variant="branch" icon={<StarIcon />}
              value={topPerformer.name} label={`${topEntityLabel} · ${formatUGX(topPerformer.contribution)}`}
              onClick={!isCustomTop && onMetricClick ? () => onMetricClick('branch-performance') : undefined}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * District-level Branches | Employers bifurcation (admin data-scope only). Reuses
 * the TimePeriodCard tab chrome (`.periodTab`) inside a fill section so it slots
 * into the panel's scroll area. Branches tab = the drillable agent-tree branches;
 * Employers tab = the per-district employer leaf list (terminal — not drillable).
 */
function DistrictBifurcation({ branches, employers, getBranchSubCount, onDrillBranch, onEmployerSelect, expanded, onExpandToggle }) {
  const [activeIdx, setActiveIdx] = useState(0); // default: Branches
  const TABS = [
    { key: 'branches', label: 'Branches', count: branches.length },
    { key: 'employers', label: 'Employers', count: employers.length },
  ];
  const active = TABS[activeIdx].key;

  return (
    <div className={styles.section} data-fill="true" data-expanded={expanded ? 'true' : undefined}>
      <div className={styles.sectionHeader} data-static="true">
        <div className={styles.bifurcationTabs} role="tablist">
          {TABS.map((t, i) => (
            <button
              key={t.key}
              className={styles.periodTab}
              data-active={i === activeIdx}
              role="tab"
              aria-selected={i === activeIdx}
              onClick={() => setActiveIdx(i)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
        {onExpandToggle && (
          <button
            className={styles.expandBtn}
            onClick={onExpandToggle}
            aria-label={expanded ? 'Collapse list' : 'Expand list'}
            aria-pressed={!!expanded}
          >
            <ExpandIcon expanded={expanded} />
          </button>
        )}
      </div>
      <div className={styles.sectionBody}>
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            className={styles.entityList}
            initial={{ opacity: 0, x: activeIdx ? 8 : -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: activeIdx ? -8 : 8 }}
            transition={{ duration: 0.15, ease: EASE }}
          >
            {active === 'branches' ? (
              branches.map((child) => {
                const isChildActive = child.active !== false;
                return (
                  <button key={child.id} className={styles.entityBtn} data-inactive={!isChildActive} onClick={() => onDrillBranch(child.id)}>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>{child.name}</span>
                      {isChildActive ? (
                        <span className={styles.statusCount}>{formatNumber(getBranchSubCount(child))} subscribers</span>
                      ) : (
                        <span className={styles.inactiveTag}>Inactive</span>
                      )}
                    </div>
                  </button>
                );
              })
            ) : employers.length > 0 ? (
              employers.map((emp) => (
                onEmployerSelect ? (
                  <button key={emp.id} className={styles.entityBtn} onClick={() => onEmployerSelect(emp.id)}>
                    <div className={styles.statusRow}>
                      <span className={styles.employerName}>{emp.name}</span>
                      <span className={styles.statusCount}>{formatNumber(emp.subscribers)} subscribers</span>
                    </div>
                  </button>
                ) : (
                  <div key={emp.id} className={styles.employerRow}>
                    <div className={styles.statusRow}>
                      <span className={styles.employerName}>{emp.name}</span>
                      <span className={styles.statusCount}>{formatNumber(emp.subscribers)} subscribers</span>
                    </div>
                  </div>
                )
              ))
            ) : (
              <div className={styles.emptyHint}>No employers in this district</div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function OverlayPanel({ onEmployerSelect } = {}) {
  const isMobile = useIsMobile();
  const { level, selectedIds, drillDown, drillUp, reset, branchMenuOpen, agentMenuOpen, subscriberMenuOpen, setViewReportsOpen, setReportContext, setCommissionsOpen } = useDashboard();
  const [listExpanded, setListExpanded] = useState(false);

  // When drilled into a specific branch/agent, keep showing the parent district
  // context on the left so the user doesn't lose their place while the slide-in
  // detail panel occupies the right.
  const displayLevel = (level === 'branch' || level === 'agent') ? 'district' : level;
  const parentId = displayLevel === 'country' ? 'ug' : selectedIds[displayLevel];
  const nextLevel = CHILD_LEVEL[displayLevel] || null;
  const { data: currentEntity, isLoading: entityLoading } = useCurrentEntity(displayLevel, selectedIds);
  const { data: children = [] } = useChildren(displayLevel, parentId);
  const { data: commissionSummary } = useEntityCommissionSummary(displayLevel, parentId);

  // Per-level metrics rollup. Powers the hero card, MetricsRow tiles, and the
  // per-child subscriber counts in the child list. Replaces the EMPTY_METRICS
  // zeros that mapRegion/mapDistrict/mapBranch/mapAgent return otherwise.
  const { data: entityMetrics, isError: entityMetricsError } = useEntityMetrics(displayLevel, parentId);
  const { data: childrenMetrics = {} } = useChildrenMetrics(displayLevel, parentId);
  const childrenWithMetrics = useMemo(
    () => children.map((c) => ({ ...c, metrics: childrenMetrics[c.id] ?? c.metrics })),
    [children, childrenMetrics],
  );

  // Admin data-scope filter. `employerAware` is false outside the admin shell (no
  // DataScopeProvider) — so the distributor role keeps today's Branches-only list
  // and never fires the admin-only employer query (enabled === false).
  const { scope, employerAware } = useDataScope();
  const { data: geo } = useEmployerGeoRollup(employerAware);
  const districtGeo = useMemo(() => geo?.byDistrict ?? {}, [geo]);

  // Per-child subscriber count, re-scoped by the filter. Employer geography only
  // exists for region-level children (districts); for every other level / the
  // distributor scope this is just the distributor agent-tree count (unchanged).
  const childSubCount = useCallback((child) => {
    const dist = child.metrics?.totalSubscribers || 0;
    const emp = displayLevel === 'region' ? (districtGeo[child.id]?.subscribers ?? 0) : 0;
    if (scope === SCOPES.DISTRIBUTORS) return dist;
    if (scope === SCOPES.EMPLOYERS) return emp;
    return dist + emp;
  }, [scope, displayLevel, districtGeo]);

  const openReport = useCallback((reportId) => {
    setReportContext(reportId);
    setViewReportsOpen(true);
  }, [setReportContext, setViewReportsOpen]);

  const handleSearchNavigate = useCallback((targetLevel, targetId) => {
    drillDown(targetLevel, targetId);
  }, [drillDown]);

  // Collapse the expanded list view when the user navigates to a different entity.
  // Adjusting state during render (instead of in an effect) avoids a cascading render.
  const [lastNavKey, setLastNavKey] = useState(`${displayLevel}-${parentId}`);
  const navKey = `${displayLevel}-${parentId}`;
  if (navKey !== lastNavKey) {
    setLastNavKey(navKey);
    setListExpanded(false);
  }

  // Skeleton overlay — used on cold-load while React Query resolves the
  // current entity. Replaces the legacy `return null` which left the panel
  // gone (blank space) on first paint. Mirrors the live chrome so layout
  // doesn't jump when data arrives.
  if (!currentEntity) {
    if (entityLoading) {
      return (
        <div
          className={styles.panel}
          role="status"
          aria-busy="true"
          aria-label="Loading network overview"
        >
          <div className={styles.panelHeader}>
            <div className={styles.skeletonRow} style={{ width: 96 }} />
          </div>
          <div className={styles.skeletonHero} aria-hidden="true" />
          <div className={styles.skeletonBlock} aria-hidden="true" style={{ height: 62 }} />
          <div className={styles.skeletonBlock} aria-hidden="true" style={{ height: 84 }} />
          <div className={styles.skeletonBlock} aria-hidden="true" style={{ height: 156, flex: '1 1 auto', minHeight: 0 }} />
        </div>
      );
    }
    return null;
  }

  // Employer geography for the CURRENT entity (admin region/district drill only).
  // Powers the scope-aware hero AUM + adaptive counts row below. Null for the
  // distributor role (employerAware false), so its hero/counts stay unchanged.
  const empGeo = !employerAware ? null
    : displayLevel === 'region'   ? geo?.byRegion?.[parentId]
    : displayLevel === 'district' ? geo?.byDistrict?.[parentId]
    : null;

  const rawInactive = currentEntity.active === false;
  // A distributor-inactive district that nonetheless has employers should still
  // render (employer accounts live outside the agent tree) — but only under the
  // admin Employers/All scope.
  const isInactive = rawInactive
    && !(employerAware && scope !== SCOPES.DISTRIBUTORS && (empGeo?.employers ?? 0) > 0);

  // Metrics priority:
  //   1. entityMetrics — live RPC rollup from get_entity_metrics_rollup
  //   2. currentEntity.metrics — mock seed (full) or EMPTY_METRICS (Supabase)
  // useDistributorMetrics fallback retired in PR-2 — useEntityMetrics covers
  // country level via the same RPC.
  const baseMetrics = isInactive ? null : currentEntity.metrics;
  const metrics = isInactive
    ? null
    : entityMetrics
    ? { ...baseMetrics, ...entityMetrics }
    : baseMetrics;
  const aum = metrics ? (metrics.aum || metrics.totalContributions) : 0;

  // ── Admin scope-derived hero/counts values (gated on employerAware) ─────────
  // Distributor totals come from the agent-tree rollup; employer totals from the
  // geo rollup. The filter picks distributor / employer / sum. Contributions,
  // withdrawals, agents, branches, coverage have NO employer equivalent.
  const distSubs = metrics?.totalSubscribers || 0;
  const distActiveCount = Math.round(distSubs * ((metrics?.activeRate || 0) / 100));
  const empSubs = empGeo?.subscribers ?? 0;
  const empActiveCount = empGeo?.active ?? 0;
  const empCount = empGeo?.employers ?? 0;
  const isEmpScope = scope === SCOPES.EMPLOYERS;
  const isDistScope = scope === SCOPES.DISTRIBUTORS;
  const scopedSubs = isDistScope ? distSubs : isEmpScope ? empSubs : distSubs + empSubs;
  const scopedActiveCount = isDistScope ? distActiveCount : isEmpScope ? empActiveCount : distActiveCount + empActiveCount;
  const scopedAum = isDistScope ? (metrics?.aum || 0) : isEmpScope ? (empGeo?.aum ?? 0) : (metrics?.aum || 0) + (empGeo?.aum ?? 0);
  const scopedActiveRate = scopedSubs > 0 ? Math.round((scopedActiveCount / scopedSubs) * 100) : 0;
  // Hero AUM + activity bar inputs — scope-aware for admin, untouched otherwise.
  const heroAum = employerAware ? scopedAum : aum;
  const barSubs = employerAware ? scopedSubs : (metrics?.totalSubscribers || 0);
  const barActiveRate = employerAware ? scopedActiveRate : (metrics?.activeRate || 0);
  // Active/inactive COUNTS come from the actual active count (single rounding),
  // with inactive as its exact complement — deriving both from the rounded
  // percentage (barSubs × barActiveRate%) double-rounds and can drift ±25.
  const barActiveCount = employerAware
    ? scopedActiveCount
    : Math.round((metrics?.totalSubscribers || 0) * ((metrics?.activeRate || 0) / 100));
  const barInactiveCount = Math.max(0, barSubs - barActiveCount);
  // Hide the contributions/withdrawals footer under the Employers scope (no
  // employer per-region contribution figures exist).
  const showMoneyFooter = !employerAware || scope !== SCOPES.EMPLOYERS;

  // Slide is driven by CSS `transform: translateX(...)` (GPU-accelerated) on
  // the `.panel` class via a `data-offset` attribute; previously this animated
  // the `left` property, which forced layout repaints over the heavy map.
  // Framer handles only the entrance fade — `x: 0` in `animate` ensures the
  // CSS-controlled transform is not overridden by Framer's inline styles.
  const isOffset = !isMobile && (branchMenuOpen || agentMenuOpen || subscriberMenuOpen);
  return (
    <motion.div
      className={styles.panel}
      data-offset={isOffset || undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      {/* Panel header: title/back + search */}
      <div className={styles.panelHeader}>
        {displayLevel === 'country' ? (
          <h2 className={styles.greeting}>Summary</h2>
        ) : (
          <button
            className={styles.backBtn}
            onClick={() => displayLevel === 'region' ? reset() : drillUp(displayLevel)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
        )}
        <GlobalSearch onNavigate={handleSearchNavigate} />
      </div>

          {isInactive && (
            <div className={styles.emptyState}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="32" height="32">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
              </svg>
              <h3 className={styles.emptyTitle}>{currentEntity?.name}</h3>
              <p className={styles.emptyText}>No active branches in this district yet. This is a coverage opportunity for network expansion.</p>
            </div>
          )}

          {!isInactive && <>
          {/* AUM hero — indigo-gradient card with contributions/withdrawals footer */}
          <div className={styles.hero}>
            {displayLevel !== 'country' && (
              <div className={styles.heroLabel} aria-live="polite">
                <span className={styles.heroTag}>{LEVEL_TAG[displayLevel] || displayLevel}</span>
                <span className={styles.heroName}>{currentEntity?.name || ''}</span>
              </div>
            )}
            <div className={styles.heroTop}>
              <span className={styles.aumValue}>{formatUGX(heroAum)}</span>
              <span className={styles.aumLabel}>Assets Under Management</span>
              {entityMetricsError && (
                <span className={styles.metricsErrorBadge} role="status">
                  Metrics unavailable
                </span>
              )}
            </div>
            {showMoneyFooter && (
              <div className={styles.heroStats}>
                <div className={styles.stat}>
                  <span className={styles.statNum}>{formatUGX(metrics.totalContributions)}</span>
                  <span className={styles.statLabel}>Contributions</span>
                </div>
                <div className={styles.statDivider} />
                <div className={styles.stat}>
                  <span className={styles.statNum}>{formatUGX(metrics.totalWithdrawals)}</span>
                  <span className={styles.statLabel}>Withdrawals</span>
                </div>
              </div>
            )}
          </div>

          {/* Entity counts + activity bar. The admin drill (employerAware) re-frames
              the tiles per the data-scope filter; the distributor role + the
              Distributors scope keep today's Subscribers/Agents/Branches/Coverage. */}
          <div className={styles.countsBlock}>
            <div className={styles.countRow}>
              {(!employerAware || isDistScope) ? (
                <>
                  <button className={styles.countItem} data-clickable onClick={() => openReport('all-subscribers')}>
                    <span className={styles.countNum}>{formatNumber(metrics.totalSubscribers || 0)}</span>
                    <span className={styles.countLabel}>Subscribers</span>
                  </button>
                  <button className={styles.countItem} data-clickable onClick={() => openReport('all-agents')}>
                    <span className={styles.countNum}>{metrics.totalAgents ?? 0}</span>
                    <span className={styles.countLabel}>Agents</span>
                  </button>
                  <button className={styles.countItem} data-clickable onClick={() => openReport('all-branches')}>
                    <span className={styles.countNum}>{metrics.totalBranches ?? 0}</span>
                    <span className={styles.countLabel}>Branches</span>
                  </button>
                  <div className={styles.countItem}>
                    <span className={styles.countNum}>{metrics.coverageRate || 0}%</span>
                    <span className={styles.countLabel}>Coverage</span>
                  </div>
                </>
              ) : isEmpScope ? (
                <>
                  <div className={styles.countItem}>
                    <span className={styles.countNum}>{formatNumber(empCount)}</span>
                    <span className={styles.countLabel}>Employers</span>
                  </div>
                  <button className={styles.countItem} data-clickable onClick={() => openReport('all-subscribers')}>
                    <span className={styles.countNum}>{formatNumber(scopedSubs)}</span>
                    <span className={styles.countLabel}>Subscribers</span>
                  </button>
                  <div className={styles.countItem}>
                    <span className={styles.countNum}>{scopedActiveRate}%</span>
                    <span className={styles.countLabel}>Active</span>
                  </div>
                  <div className={styles.countItem}>
                    <span className={styles.countNum}>{formatUGX(scopedAum)}</span>
                    <span className={styles.countLabel}>AUM</span>
                  </div>
                </>
              ) : (
                <>
                  <button className={styles.countItem} data-clickable onClick={() => openReport('all-subscribers')}>
                    <span className={styles.countNum}>{formatNumber(scopedSubs)}</span>
                    <span className={styles.countLabel}>Subscribers</span>
                  </button>
                  <div className={styles.countItem}>
                    <span className={styles.countNum}>{formatNumber(empCount)}</span>
                    <span className={styles.countLabel}>Employers</span>
                  </div>
                  <button className={styles.countItem} data-clickable onClick={() => openReport('all-branches')}>
                    <span className={styles.countNum}>{metrics.totalBranches ?? 0}</span>
                    <span className={styles.countLabel}>Branches</span>
                  </button>
                  <div className={styles.countItem}>
                    <span className={styles.countNum}>{scopedActiveRate}%</span>
                    <span className={styles.countLabel}>Active</span>
                  </div>
                </>
              )}
            </div>
            <div className={styles.activityInline}>
              <div className={styles.activityBarTrack}>
                <div className={styles.activityBarFill} style={{ width: `${barActiveRate}%` }} />
              </div>
              <div className={styles.activityLabels}>
                <span className={styles.activityActive}>
                  {formatNumber(barActiveCount)} active
                </span>
                <span className={styles.activityInactive}>
                  {formatNumber(barInactiveCount)} inactive
                </span>
              </div>
            </div>
          </div>

          {/* Commission summary — distributor role only; removed from the admin drill. */}
          {!employerAware && commissionSummary && commissionSummary.countTotal > 0 && (
            <button className={styles.commissionBlock} onClick={() => setCommissionsOpen(true)}>
              <div className={styles.commissionHeader}>
                <span className={styles.commissionTitle}>Commissions</span>
                <span className={styles.commissionRate}>{commissionSummary.settlementRate}% settled</span>
              </div>
              <div className={styles.commissionBar}>
                <div className={styles.commissionBarFill} data-status="settled" style={{ flex: commissionSummary.countPaid }} />
                <div className={styles.commissionBarFill} data-status="due" style={{ flex: commissionSummary.countDue }} />
              </div>
              <div className={styles.commissionStats}>
                <span className={styles.commissionStat}>
                  <span className={styles.commissionDot} data-status="settled" />
                  {formatUGX(commissionSummary.totalPaid)}
                </span>
                <span className={styles.commissionStat}>
                  <span className={styles.commissionDot} data-status="due" />
                  {formatUGX(commissionSummary.totalDue)}
                </span>
              </div>
            </button>
          )}

          {/* Time-period highlights: Today / This Week / This Month.
              Animates out when the child list is expanded so the list can
              absorb the freed vertical space. Hidden under the admin Employers
              scope — the series is distributor agent-tree data (no employer
              time-series), matching the country card. */}
          <AnimatePresence initial={false}>
            {!listExpanded && !(employerAware && isEmpScope) && (
              <motion.div
                key="period-card"
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 0 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                style={{ overflow: 'hidden', flexShrink: 0 }}
              >
                <TimePeriodCard metrics={metrics} level={displayLevel} parentId={parentId} onMetricClick={openReport} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* District drill-down (admin): always-on Branches | Employers bifurcation
              so employer accounts — which live outside the agent→branch tree — are
              visible at the district level. Clicking an employer opens its detail
              panel (employers are a terminal leaf — no further map drill). */}
          {displayLevel === 'district' && employerAware && nextLevel ? (
            <DistrictBifurcation
              key={`bifurcation-${parentId}`}
              branches={childrenWithMetrics}
              employers={districtGeo[parentId]?.list ?? []}
              getBranchSubCount={childSubCount}
              onDrillBranch={(id) => drillDown(nextLevel, id)}
              onEmployerSelect={onEmployerSelect}
              expanded={listExpanded}
              onExpandToggle={() => setListExpanded((v) => !v)}
            />
          ) : (
            /* Region/child list — per-child count re-scoped (district children merge
               employer geography; distributor scope / other levels are unchanged). */
            childrenWithMetrics.length > 0 && nextLevel && (
              <CollapsibleSection
                title={LEVEL_LABELS[nextLevel] || 'Items'}
                count={childrenWithMetrics.length}
                defaultOpen={false}
                fill
                expanded={listExpanded}
                onExpandToggle={() => setListExpanded((v) => !v)}
                key={`children-${displayLevel}-${parentId}`}
              >
                <div className={styles.entityList}>
                  {childrenWithMetrics.map((child) => {
                    const isChildActive = child.active !== false;
                    const subCount = childSubCount(child);
                    return (
                      <button key={child.id} className={styles.entityBtn} data-inactive={!isChildActive} onClick={() => drillDown(nextLevel, child.id)}>
                        <div className={styles.statusRow}>
                          <span className={styles.statusLabel}>{child.name}</span>
                          {isChildActive ? (
                            <span className={styles.statusCount}>{formatNumber(subCount)} subscribers</span>
                          ) : (
                            <span className={styles.inactiveTag}>No branches</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CollapsibleSection>
            )
          )}
          </>}
    </motion.div>
  );
}
