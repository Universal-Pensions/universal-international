// AnalyticsDesktop — the branch-admin desktop Analytics page. Supersedes the
// old ReportsDesktop with a four-tab dashboard (Agents · Subscribers ·
// Contributions · Commissions) over a persistent KPI header.
//
// All view shapes + the CSV/Excel export rows come from the PURE derive engine
// `deriveBranchAnalytics()` (27 tests green) — this component only wires hooks
// → derive → charts/tables/exports. No money math or aggregation lives here.
//
// Structure mirrors the employer desktop AnalyticsDesktop: PageHead, a KPI
// MetricRow, per-tab toolbars with an `exporting`-guarded CSV/Excel pair, a
// 2-column Recharts grid, and graceful empty-states on every chart/table.
// Loading + error are guarded up front (BranchOverview's ErrorCard + retryAll
// pattern) so an errored query shows a retry, never a silently-zeroed page.

import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { MOCK_NOW } from '../../constants/demoClock';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useEntityMetrics, useChildren, useChildrenMetrics } from '../../hooks/useEntity';
import { useEntityCommissionSummary, usePendingDuesByAgent, useSettlementsList } from '../../hooks/useCommission';
import { useToast } from '../../contexts/ToastContext';
import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import { downloadSheet } from '../../utils/xlsx';
import { downloadCsv } from '../../utils/csvDownload';
import ErrorCard from '../../components/feedback/ErrorCard';
import {
  deriveBranchAnalytics,
  buildAgentsExport,
  buildSubscribersExport,
  buildContributionsExport,
  buildCommissionsExport,
  buildSettlementsExport,
} from '../analytics/deriveBranchAnalytics';
import { PALETTE, GENDER_COLORS, axisTick, chartTooltip } from '../../employer-dashboard/reports/chartConfig';
import { PageHead, MetricRow, Tile, Card, SectionHead, StatusBadge, Avatar, Btn } from '../../employer-dashboard/desktop/ui';
import {
  employeesIcon, walletIcon, analyticsIcon, checkIcon, pendingIcon,
  downloadIcon, coinsIcon, buildingIcon,
} from '../../employer-dashboard/desktop/icons';
import ui from '../../employer-dashboard/desktop/ui.module.css';
import styles from './AnalyticsDesktop.module.css';

const CHART_HEIGHT = 260;

// Active / dormant donut colours (STATUS_COLORS only covers active/suspended).
const ACTIVE_DORMANT_COLORS = { Active: PALETTE.positive, Dormant: PALETTE.amber };
// Paid (green) vs Due (amber) donut colours.
const PAID_DUE_COLORS = { Paid: PALETTE.positive, Due: PALETTE.amber };

const TABS = [
  { key: 'agents', label: 'Agents' },
  { key: 'subscribers', label: 'Subscribers' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'commissions', label: 'Commissions' },
];

// Map a needs-attention reportId (passed via route state) to a default tab so a
// deep-link from the Overview opens on the relevant view.
function tabFromReportId(reportId) {
  if (reportId === 'all-subscribers') return 'subscribers';
  if (reportId === 'kyc-compliance') return 'subscribers';
  if (reportId === 'contributions-collections') return 'contributions';
  return 'agents';
}

export default function AnalyticsDesktop() {
  const reduceMotion = useReducedMotion();
  const location = useLocation();
  const { addToast } = useToast();
  const { branchId } = useBranchScope();

  const {
    data: metrics,
    isError: metricsError,
    refetch: refetchMetrics,
  } = useEntityMetrics('branch', branchId);
  const {
    data: agentsRaw = [],
    isError: agentsError,
    refetch: refetchAgents,
  } = useChildren('branch', branchId);
  const { data: agentMetricsMap = {} } = useChildrenMetrics('branch', branchId);
  const {
    data: commissionSummary,
    isError: commissionError,
    refetch: refetchCommission,
  } = useEntityCommissionSummary('branch', branchId);
  const {
    data: pendingDuesByAgent = [],
    isError: duesError,
    refetch: refetchDues,
  } = usePendingDuesByAgent();
  const {
    data: settlements = [],
    isError: settlementsError,
    refetch: refetchSettlements,
  } = useSettlementsList({ branchId });

  const agents = useMemo(
    () => agentsRaw.map((a) => ({ ...a, metrics: agentMetricsMap[a.id] ?? a.metrics })),
    [agentsRaw, agentMetricsMap],
  );

  const analytics = useMemo(
    () => deriveBranchAnalytics({
      metrics: metrics ?? {},
      agents,
      commissionSummary: commissionSummary ?? {},
      pendingDuesByAgent,
      settlements,
      branchId,
      // A12-001 — label the 12-month trend from the demo clock, not the real
      // wall clock: metrics.monthlyContributions is bucketed server-side
      // relative to the SQL demo clock (public._demo_now()), and MOCK_NOW is
      // its JS mirror (src/constants/demoClock.js), so this keeps the last
      // point's month label matching the month the data is actually from.
      now: MOCK_NOW,
    }),
    [metrics, agents, commissionSummary, pendingDuesByAgent, settlements, branchId],
  );

  const [tab, setTab] = useState(() => tabFromReportId(location.state?.reportId));
  const [exporting, setExporting] = useState(false);

  // Cold-load guard — the page needs the branch metrics before it can render a
  // trustworthy KPI header. Metrics arriving undefined (not yet fetched) and no
  // error means we're still loading.
  const isCold = metrics === undefined && !metricsError;

  // Any errored query means we can't draw a trustworthy dashboard. Surface ONE
  // ErrorCard with a combined retry rather than a silently-zeroed page.
  const hasError = metricsError || agentsError || commissionError || duesError || settlementsError;

  function retryAll() {
    refetchMetrics();
    refetchAgents();
    refetchCommission();
    refetchDues();
    refetchSettlements();
  }

  // ── Exports ────────────────────────────────────────────────────────────
  // Each export builds rows/columns from the matching build*Export() and pipes
  // through downloadSheet (Excel) / downloadCsv (CSV). Guarded by `exporting`
  // and wrapped in try/catch → toast so a failure never crashes the page.
  async function runExport(fn) {
    if (exporting) return;
    setExporting(true);
    try {
      await fn();
      addToast('success', 'Report exported.');
    } catch (e) {
      addToast('error', e?.message || 'Could not export the report.');
    } finally {
      setExporting(false);
    }
  }

  // Resolve the active tab's dataset → { rows, columns, filename }.
  function activeDataset() {
    if (tab === 'subscribers') {
      return { ...buildSubscribersExport(analytics.subscribersView), filename: 'branch-subscribers' };
    }
    if (tab === 'contributions') {
      return { ...buildContributionsExport(analytics.contributionsView), filename: 'branch-contributions' };
    }
    if (tab === 'commissions') {
      return { ...buildCommissionsExport(analytics.commissionsView), filename: 'branch-commissions' };
    }
    return { ...buildAgentsExport(analytics.agentsView), filename: 'branch-agents' };
  }

  function exportActive(format) {
    return runExport(async () => {
      const { rows, columns, filename } = activeDataset();
      if (format === 'xlsx') {
        await downloadSheet({ rows, columns, filename, sheetName: 'Analytics' });
      } else {
        await downloadCsv({ rows, columns, filename });
      }
    });
  }

  // Settlement history export (Commissions tab only) — a separate dataset.
  function exportSettlements() {
    return runExport(async () => {
      const { rows, columns } = buildSettlementsExport(analytics.commissionsView);
      await downloadSheet({ rows, columns, filename: 'branch-settlements', sheetName: 'Settlements' });
    });
  }

  if (hasError) {
    return (
      <div className={ui.stack}>
        <PageHead
          eyebrow="Analytics"
          title="Analytics"
          sub="Agents, subscribers, contributions and commissions for your branch"
        />
        <ErrorCard
          title="We couldn't load your analytics"
          message="One or more data sources failed to load."
          onRetry={retryAll}
        />
      </div>
    );
  }

  if (isCold) {
    return (
      <div className={ui.stack}>
        <PageHead
          eyebrow="Analytics"
          title="Analytics"
          sub="Agents, subscribers, contributions and commissions for your branch"
        />
        <Card>
          <p className={styles.empty}>Loading branch analytics…</p>
        </Card>
      </div>
    );
  }

  const { header } = analytics;

  return (
    <div className={ui.stack}>
      <PageHead
        eyebrow="Analytics"
        title="Analytics"
        sub="Agents, subscribers, contributions and commissions for your branch"
      />

      {/* ── Persistent KPI header (always above the tabs) ── */}
      <MetricRow cols={4}>
        <Tile
          accent="indigo"
          icon={coinsIcon(18)}
          label="Funds under management"
          value={formatUGX(header.aum)}
          sub="Across this branch"
        />
        <Tile
          accent="teal"
          icon={walletIcon(18)}
          label="Total contributions"
          value={formatUGX(header.totalContributions)}
          sub="Collected to date"
        />
        <Tile
          accent="green"
          icon={employeesIcon(18)}
          label="Active subscribers"
          value={formatNumber(header.activeSubs)}
          sub={`${Math.round(header.activeRate || 0)}% active`}
        />
        <Tile
          accent="indigoSoft"
          icon={analyticsIcon(18)}
          label="Agents"
          value={`${formatNumber(header.activeAgents)}/${formatNumber(header.totalAgents)}`}
          sub="active"
        />
      </MetricRow>

      {/* ── Tab strip + active-tab export ── */}
      <div className={styles.toolbar}>
        <div className={styles.pills} role="tablist" aria-label="Analytics view">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.pill} ${tab === t.key ? styles.pillOn : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.exportRow}>
          <Btn variant="secondary" onClick={() => exportActive('csv')} disabled={exporting}>
            {downloadIcon(16)}{exporting ? 'Exporting…' : 'Export CSV'}
          </Btn>
          <Btn variant="secondary" onClick={() => exportActive('xlsx')} disabled={exporting}>
            {downloadIcon(16)}Export Excel
          </Btn>
        </div>
      </div>

      {tab === 'agents' && (
        <AgentsTab view={analytics.agentsView} reduceMotion={reduceMotion} />
      )}
      {tab === 'subscribers' && (
        <SubscribersTab view={analytics.subscribersView} reduceMotion={reduceMotion} />
      )}
      {tab === 'contributions' && (
        <ContributionsTab view={analytics.contributionsView} reduceMotion={reduceMotion} />
      )}
      {tab === 'commissions' && (
        <CommissionsTab
          view={analytics.commissionsView}
          reduceMotion={reduceMotion}
          exporting={exporting}
          onExportSettlements={exportSettlements}
        />
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * AGENTS TAB
 * ────────────────────────────────────────────────────────────────────────── */
function AgentsTab({ view, reduceMotion }) {
  const { kpis, contributionShare, activeRateByAgent, leaderboard } = view;

  return (
    <>
      <MetricRow cols={4}>
        <Tile
          accent="indigo"
          icon={analyticsIcon(18)}
          label="Active agents"
          value={`${formatNumber(kpis.activeAgents)}/${formatNumber(kpis.totalAgents)}`}
          sub="Active of all agents"
        />
        <Tile
          accent="green"
          icon={employeesIcon(18)}
          label="Avg subscribers / agent"
          value={formatNumber(kpis.avgSubsPerAgent)}
          sub="Across the branch"
        />
        <Tile
          accent="teal"
          icon={coinsIcon(18)}
          label="Avg contributions / agent"
          value={formatUGX(kpis.avgContribPerAgent)}
          sub="Collected to date"
        />
        <Tile
          accent="amber"
          icon={pendingIcon(18)}
          label="Inactive agents"
          value={formatNumber(kpis.inactiveAgents)}
          sub="Not currently active"
        />
      </MetricRow>

      <div className={styles.charts}>
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Contribution by agent</h3>
            <p className={styles.chartSub}>Total contributions collected per agent.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Contributions by agent">
            {contributionShare.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={contributionShare} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={PALETTE.gridLine} horizontal={false} />
                  <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} />
                  <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={110} />
                  <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                  <Bar dataKey="value" name="Contributions" fill={PALETTE.indigo} radius={[0, 6, 6, 0]} isAnimationActive={!reduceMotion} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No agents in this branch yet.</p>}
          </div>
        </Card>

        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Active rate by agent</h3>
            <p className={styles.chartSub}>Share of each agent&apos;s subscribers who are active.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Active rate by agent">
            {activeRateByAgent.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={activeRateByAgent} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={PALETTE.gridLine} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={110} />
                  <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${Math.round(v)}%` })} />
                  <Bar dataKey="value" name="Active rate" fill={PALETTE.teal} radius={[0, 6, 6, 0]} isAnimationActive={!reduceMotion} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No agents in this branch yet.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <SectionHead icon={employeesIcon(18)} title="Agent leaderboard" tag={`${formatNumber(leaderboard.length)} agents`} />
        {leaderboard.length === 0 ? (
          <p className={styles.empty}>No agents in this branch yet.</p>
        ) : (
          <div className={ui.tableCard}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th className={ui.num}>Subscribers</th>
                  <th>Active rate</th>
                  <th className={ui.num}>Contributions</th>
                  <th className={ui.num}>AUM</th>
                  <th className={ui.num}>Commission due</th>
                  <th className={ui.num}>Commission paid</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <span className={ui.member}>
                        <Avatar name={a.name} />
                        <span className={ui.tName}>{a.name}</span>
                      </span>
                    </td>
                    <td>
                      <StatusBadge tone={a.status === 'active' ? 'active' : 'inactive'}>
                        {a.status === 'active' ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                    <td className={ui.num}>{formatNumber(a.subscribers)}</td>
                    <td>
                      <span className={styles.miniBar} role="img" aria-label={`Active rate ${Math.round(a.activeRate)}%`}>
                        <span className={styles.miniTrack} aria-hidden="true">
                          <span className={styles.miniFill} style={{ width: `${Math.max(0, Math.min(100, a.activeRate))}%` }} />
                        </span>
                        <span className={styles.miniLabel} aria-hidden="true">{Math.round(a.activeRate)}%</span>
                      </span>
                    </td>
                    <td className={ui.num}>{formatUGX(a.contributions)}</td>
                    <td className={ui.num}>{formatUGX(a.aum)}</td>
                    <td className={ui.num}>{formatUGX(a.commissionDue)}</td>
                    <td className={ui.num}>{formatUGX(a.commissionPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * SUBSCRIBERS TAB
 * ────────────────────────────────────────────────────────────────────────── */
function SubscribersTab({ view, reduceMotion }) {
  const { kpis, activeDormant, gender, age, kyc } = view;
  const hasSubs = kpis.total > 0;
  const hasGender = gender.some((g) => g.value > 0);
  const hasAge = age.some((a) => a.value > 0);
  const kycClear = (kyc.pending + kyc.incomplete) === 0;

  return (
    <>
      <MetricRow cols={4}>
        <Tile
          accent="indigo"
          icon={employeesIcon(18)}
          label="Total subscribers"
          value={formatNumber(kpis.total)}
          sub="On this branch"
        />
        <Tile
          accent="green"
          icon={checkIcon(18)}
          label="Active"
          value={formatNumber(kpis.active)}
          sub="Contributing recently"
        />
        <Tile
          accent="amber"
          icon={pendingIcon(18)}
          label="Dormant"
          value={formatNumber(kpis.dormant)}
          sub="No recent activity"
        />
        <Tile
          accent="teal"
          icon={checkIcon(18)}
          label="KYC verified"
          value={`${kpis.kycVerifiedPct}%`}
          sub="Fully verified subscribers"
        />
      </MetricRow>

      <div className={styles.charts}>
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Active vs dormant</h3>
            <p className={styles.chartSub}>How many subscribers are actively contributing.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Active versus dormant subscribers">
            {hasSubs ? (
              <div className={styles.donutWrap}>
                <div className={styles.donutChart}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={activeDormant} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" stroke="#FFFFFF" strokeWidth={2} isAnimationActive={!reduceMotion}>
                        {activeDormant.map((e) => <Cell key={e.name} fill={ACTIVE_DORMANT_COLORS[e.name] || PALETTE.lavender} />)}
                      </Pie>
                      <Tooltip cursor={false} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${formatNumber(v)} subscribers` })} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className={styles.legend}>
                  {activeDormant.map((e) => (
                    <div key={e.name} className={styles.lg}>
                      <span className={styles.sw} style={{ background: ACTIVE_DORMANT_COLORS[e.name] || PALETTE.lavender }} />
                      {e.name}
                      <span className={styles.lgVal}>{formatNumber(e.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className={styles.chartEmpty}>No subscribers on this branch yet.</p>}
          </div>
        </Card>

        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Gender split</h3>
            <p className={styles.chartSub}>Share of subscribers by recorded gender.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Gender split">
            {hasGender ? (
              <div className={styles.donutWrap}>
                <div className={styles.donutChart}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={gender} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" stroke="#FFFFFF" strokeWidth={2} isAnimationActive={!reduceMotion}>
                        {gender.map((e, i) => <Cell key={e.name} fill={GENDER_COLORS[i % GENDER_COLORS.length]} />)}
                      </Pie>
                      <Tooltip cursor={false} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${Math.round(v)}%` })} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className={styles.legend}>
                  {gender.map((e, i) => (
                    <div key={e.name} className={styles.lg}>
                      <span className={styles.sw} style={{ background: GENDER_COLORS[i % GENDER_COLORS.length] }} />
                      {e.name}
                      <span className={styles.lgVal}>{Math.round(e.value)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className={styles.chartEmpty}>No gender data recorded yet.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <div className={styles.chartHead}>
          <h3 className={styles.chartTitle}>Age distribution</h3>
          <p className={styles.chartSub}>Subscribers grouped by age band.</p>
        </div>
        <div className={styles.chartBody} role="img" aria-label="Age distribution">
          {hasAge ? (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={age} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                <XAxis dataKey="band" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${formatNumber(v)} subscribers` })} />
                <Bar dataKey="value" name="Subscribers" fill={PALETTE.indigo} radius={[6, 6, 0, 0]} isAnimationActive={!reduceMotion} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className={styles.chartEmpty}>No age data recorded yet.</p>}
        </div>
      </Card>

      <Card>
        <SectionHead icon={checkIcon(18)} title="KYC status" tag={`${formatNumber(kpis.total)} subscribers`} />
        <MetricRow cols={3}>
          <Tile accent="green" icon={checkIcon(18)} label="Verified" value={formatNumber(kyc.verified)} sub="Fully verified" />
          <Tile accent="amber" icon={pendingIcon(18)} label="Pending" value={formatNumber(kyc.pending)} sub="Awaiting verification" />
          <Tile accent="indigoSoft" icon={employeesIcon(18)} label="Incomplete" value={formatNumber(kyc.incomplete)} sub="Missing documents" />
        </MetricRow>
        {kycClear && (
          <p className={styles.kycNote}>Every subscriber at this branch is fully verified.</p>
        )}
      </Card>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * CONTRIBUTIONS TAB
 * ────────────────────────────────────────────────────────────────────────── */
function ContributionsTab({ view, reduceMotion }) {
  const { kpis, trend, cumulative } = view;

  return (
    <>
      <MetricRow cols={4}>
        <Tile
          accent="indigo"
          icon={coinsIcon(18)}
          label="This month"
          value={formatUGX(kpis.thisMonth)}
          sub="Latest month collected"
        />
        <Tile
          accent="teal"
          icon={analyticsIcon(18)}
          label="Month on month"
          value={`${kpis.momPct}%`}
          sub="vs previous month"
        />
        <Tile
          accent="green"
          icon={analyticsIcon(18)}
          label="Year on year"
          value={kpis.yoyPct != null ? `${kpis.yoyPct}%` : '—'}
          sub={kpis.yoyPct != null ? 'vs start of window' : 'Not enough history yet'}
        />
        <Tile
          accent="indigoSoft"
          icon={walletIcon(18)}
          label="Monthly average"
          value={formatUGX(kpis.monthlyAvg)}
          sub="Across active months"
        />
      </MetricRow>

      <Card>
        <div className={styles.chartHead}>
          <h3 className={styles.chartTitle}>Contributions — last 12 months</h3>
          <p className={styles.chartSub}>UGX collected per month across the branch.</p>
        </div>
        <div className={styles.chartBody} role="img" aria-label="Contributions over the last 12 months">
          {trend.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trend} margin={{ top: 12, right: 12, left: -8, bottom: 4 }}>
                <defs>
                  <linearGradient id="branchContribFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PALETTE.indigo} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={PALETTE.indigo} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} width={52} />
                <Tooltip cursor={{ stroke: PALETTE.lavender }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                <Area type="monotone" dataKey="total" name="Collected" stroke={PALETTE.indigo} strokeWidth={2.5} fill="url(#branchContribFill)" isAnimationActive={!reduceMotion} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className={styles.chartEmpty}>No contribution history yet for this branch.</p>}
        </div>
      </Card>

      <Card>
        <div className={styles.chartHead}>
          <h3 className={styles.chartTitle}>Cumulative contributions</h3>
          <p className={styles.chartSub}>Running total collected month over month.</p>
        </div>
        <div className={styles.chartBody} role="img" aria-label="Cumulative contributions">
          {cumulative.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={cumulative} margin={{ top: 12, right: 12, left: -8, bottom: 4 }}>
                <defs>
                  <linearGradient id="branchCumulativeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PALETTE.teal} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={PALETTE.teal} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} width={52} />
                <Tooltip cursor={{ stroke: PALETTE.lavender }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                <Area type="monotone" dataKey="total" name="Cumulative" stroke={PALETTE.teal} strokeWidth={2.5} fill="url(#branchCumulativeFill)" isAnimationActive={!reduceMotion} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className={styles.chartEmpty}>No contribution history yet for this branch.</p>}
        </div>
      </Card>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * COMMISSIONS TAB
 * ────────────────────────────────────────────────────────────────────────── */
function CommissionsTab({ view, reduceMotion, exporting, onExportSettlements }) {
  const { kpis, paidVsDue, duesByAgent, settlements } = view;
  const hasCommission = (kpis.paid + kpis.due) > 0;

  return (
    <>
      <MetricRow cols={4}>
        <Tile
          accent="indigo"
          icon={coinsIcon(18)}
          label="Total commissions"
          value={formatUGX(kpis.total)}
          sub="Earned across the branch"
        />
        <Tile
          accent="green"
          icon={checkIcon(18)}
          label="Paid"
          value={formatUGX(kpis.paid)}
          sub="Settled to agents"
        />
        <Tile
          accent="amber"
          icon={pendingIcon(18)}
          label="Due"
          value={formatUGX(kpis.due)}
          sub="Awaiting settlement"
        />
        <Tile
          accent="teal"
          icon={analyticsIcon(18)}
          label="Settlement rate"
          value={`${kpis.settlementRate}%`}
          sub="Of commissions settled"
        />
      </MetricRow>

      <div className={styles.charts}>
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Paid vs due</h3>
            <p className={styles.chartSub}>Settled commissions against what is still owed.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Paid versus due commissions">
            {hasCommission ? (
              <div className={styles.donutWrap}>
                <div className={styles.donutChart}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={paidVsDue} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" stroke="#FFFFFF" strokeWidth={2} isAnimationActive={!reduceMotion}>
                        {paidVsDue.map((e) => <Cell key={e.name} fill={PAID_DUE_COLORS[e.name] || PALETTE.lavender} />)}
                      </Pie>
                      <Tooltip cursor={false} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className={styles.legend}>
                  {paidVsDue.map((e) => (
                    <div key={e.name} className={styles.lg}>
                      <span className={styles.sw} style={{ background: PAID_DUE_COLORS[e.name] || PALETTE.lavender }} />
                      {e.name}
                      <span className={styles.lgVal}>{formatUGX(e.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className={styles.chartEmpty}>No commissions recorded yet.</p>}
          </div>
        </Card>

        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Pending dues by agent</h3>
            <p className={styles.chartSub}>Outstanding commission owed to each agent.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Pending commission dues by agent">
            {duesByAgent.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={duesByAgent} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={PALETTE.gridLine} horizontal={false} />
                  <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} />
                  <YAxis type="category" dataKey="name" tick={axisTick} tickLine={false} axisLine={false} width={110} />
                  <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                  <Bar dataKey="value" name="Pending dues" fill={PALETTE.amber} radius={[0, 6, 6, 0]} isAnimationActive={!reduceMotion} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No outstanding commission dues.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <SectionHead
          icon={buildingIcon(18)}
          title="Settlement history"
          tag={`${formatNumber(settlements.length)} settlements`}
          action={
            <Btn variant="secondary" size="sm" onClick={onExportSettlements} disabled={exporting || settlements.length === 0}>
              {downloadIcon(16)}Export
            </Btn>
          }
        />
        {settlements.length === 0 ? (
          <p className={styles.empty}>No settlements recorded yet.</p>
        ) : (
          <div className={ui.tableCard}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className={ui.num}>Amount paid</th>
                  <th>Txn ref</th>
                  <th>Paid date</th>
                  <th className={ui.num}>Lines</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className={ui.member}>
                        <Avatar name={s.agentName || 'Unknown'} />
                        <span className={ui.tName}>{s.agentName || 'Unknown'}</span>
                      </span>
                    </td>
                    <td className={ui.num}>{formatUGX(s.paidAmount)}</td>
                    <td>{s.txnRef || '—'}</td>
                    <td>{s.paidDate ? String(s.paidDate).slice(0, 10) : '—'}</td>
                    <td className={ui.num}>{formatNumber(s.lineCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
