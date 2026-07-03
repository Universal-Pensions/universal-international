// AnalyticsDesktop — the employer desktop Analytics page. Workforce + contribution
// trend dashboard: period-filterable KPI tiles, a 2-column grid of Recharts cards,
// and a CSV/Excel download card.
//
// Reuses the existing analytics engine wholesale: deriveEmployeeAnalytics() for the
// workforce distributions and the buildRosterExport/buildSummaryExport/buildRunsExport
// builders + downloadCsv/downloadSheet for exports (same wiring as the mobile
// EmployerReports panel). The contribution-trend series (over-time, split, cumulative)
// are derived inline from the real contribution-run history. The mockup's hardcoded
// figures are illustrative only — every value here is live-derived.

import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useEmployees, useContributionRuns, useEmployer, useEmployerMetrics } from '../../hooks/useEmployer';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { formatUGX, formatNumber, formatUGXShort } from '../../utils/currency';
import { downloadCsv } from '../../utils/csvDownload';
import { downloadSheet } from '../../utils/xlsx';
import {
  deriveEmployeeAnalytics,
  buildRosterExport,
  buildSummaryExport,
  buildRunsExport,
} from '../reports/deriveEmployeeAnalytics';
import { PALETTE, STATUS_COLORS, axisTick, chartTooltip } from '../reports/chartConfig';
import { deriveEmployerMetrics } from '../overview/employerCopilotContext';
import { PageHead, MetricRow, Tile, Card, SectionHead, Btn } from './ui';
import {
  employeesIcon, checkIcon, walletIcon, shieldIcon, coinsIcon, downloadIcon,
} from './icons';
import ui from './ui.module.css';
import styles from './AnalyticsDesktop.module.css';

// Page-specific icons not in the shared icons.jsx (mirrors the mockup's i-people /
// i-trend / i-bars symbols).
const peopleIcon = (size = 18) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none">
    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
    <path d="M2.5 20v-1.5a4 4 0 014-4h3a4 4 0 014 4V20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M16 5.2a3 3 0 010 5.6M17 14.6a4 4 0 013.5 4V20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const trendIcon = (size = 18) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none">
    <path d="M3 17l5-5 4 3 6-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 8h6v6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CHART_HEIGHT = 240;
const LEGEND_STYLE = { fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: PALETTE.text, paddingTop: 4 };

// Period filter pills — each maps to a month window (null = all time).
const PERIODS = [
  { key: '3m', label: 'Last 3 months', months: 3 },
  { key: '6m', label: 'Last 6 months', months: 6 },
  { key: 'ytd', label: 'This year', months: null, ytd: true },
  { key: 'all', label: 'All time', months: null },
];

// "Mar 26" style label from a run's ISO timestamp.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function runMonthLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

// Compensation histogram bands (millions of UGX/mo) for active staff — mirrors the
// mockup's <1.0M / 1–2M / 2–3M / 3M+ banding (distinct from the derive engine's
// sub-1M buckets so the desktop histogram reads at the employer's salary scale).
const COMP_BANDS = [
  { key: '<1.0M', min: 0, max: 999999 },
  { key: '1.0–2.0M', min: 1000000, max: 1999999 },
  { key: '2.0–3.0M', min: 2000000, max: 2999999 },
  { key: '3.0M+', min: 3000000, max: Infinity },
];
const COMP_BAND_FILL = [PALETTE.indigo, PALETTE.indigo, PALETTE.indigo, PALETTE.indigoSoft];

export default function AnalyticsDesktop() {
  const { employerId } = useEmployerScope();
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();

  const { data: employees = [] } = useEmployees(employerId);
  const { data: runs = [] } = useContributionRuns(employerId);
  const { data: employer } = useEmployer(employerId);
  const { data: metrics = {} } = useEmployerMetrics(employerId);

  const [period, setPeriod] = useState('6m');
  const [exporting, setExporting] = useState(false);

  const cfg = employer?.defaultContributionConfig;

  // Every derived series + KPI figure below depends only on the fetched data and
  // the selected period — memoize so they don't recompute on each export-spinner
  // / toast re-render. (The rebuild into AnalyticsDesktop dropped the useMemo the
  // old EmployerReports panel had — audit R1.)
  const derived = useMemo(() => {
    const a = deriveEmployeeAnalytics(employees, cfg);

  // ── Period window over the run history ─────────────────────────────────────
  // Runs arrive newest-first; chronological order (oldest→newest) is what the
  // trend charts need, then we trim to the selected window.
  const chronoRuns = [...runs].sort((x, y) => String(x.runAt ?? '').localeCompare(String(y.runAt ?? '')));
  const activePeriod = PERIODS.find((p) => p.key === period) || PERIODS[1];
  const windowed = chronoRuns.filter((r) => {
    const d = new Date(r.runAt);
    if (Number.isNaN(d.getTime())) return false;
    if (activePeriod.ytd) return d.getFullYear() === new Date().getFullYear();
    if (activePeriod.months == null) return true;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - activePeriod.months);
    return d >= cutoff;
  });

  // ── KPI figures (live) ─────────────────────────────────────────────────────
  const headcount = metrics.headcount ?? a.kpis.total;
  const active = metrics.active ?? a.kpis.active;
  // Contributions = PENSION (employee + employer). Insurance premiums are a
  // separate run leg and are excluded from the contributions trends/KPIs.
  const totalContributions = metrics.totalContributions
    ?? runs.reduce((s, r) => s + ((r.employeeTotal || 0) + (r.employerTotal || 0)), 0);
  const latest = chronoRuns[chronoRuns.length - 1];
  const thisMonth = latest ? (latest.employeeTotal || 0) + (latest.employerTotal || 0) : 0;
  // Real participation = active staff with compensation > 0 (the v2 run driver),
  // measured against the active base — same formula the mobile Overview and the
  // copilot use, not a hardcoded 100%.
  const participation = Math.round(deriveEmployerMetrics(metrics, employees).participationRate);
  const avgComp = a.kpis.avgMonthly;
  const cover = Number(cfg?.groupCoverAmount) || 0;
  const insuranceOn = (cfg?.insuranceEnabled ?? cover > 0) && cover > 0;
  const insuredStaff = insuranceOn ? headcount : (metrics.insuredCount ?? 0);

  // ── Chart series (live, from the windowed run history) ─────────────────────
  // a. Contributions over time — pension total (employee + employer) per run month.
  const overTime = windowed.map((r) => ({
    label: runMonthLabel(r.runAt),
    total: (r.employeeTotal || 0) + (r.employerTotal || 0),
  }));

  // b. Employee vs employer leg — stacked per run month.
  const splitSeries = windowed.map((r) => ({
    label: runMonthLabel(r.runAt),
    employee: r.employeeTotal || 0,
    employer: r.employerTotal || 0,
  }));

  // c. Workforce status — active vs inactive donut (from the derive engine).
  const statusData = a.status;

  // d. Compensation distribution — active staff by monthly-pay band.
  const activeRoster = employees.filter((e) => e.status === 'active');
  const compDist = COMP_BANDS.map((b, i) => ({
    key: b.key,
    value: activeRoster.filter((e) => {
      const m = Number(e.compensation) || 0;
      return m >= b.min && m <= b.max;
    }).length,
    fill: COMP_BAND_FILL[i],
  }));

  // e. Cumulative funding — running PENSION total across the windowed runs.
  let cumAcc = 0;
  const cumulative = windowed.map((r) => {
    cumAcc += (r.employeeTotal || 0) + (r.employerTotal || 0);
    return { label: runMonthLabel(r.runAt), total: cumAcc };
  });

  // f. Funding by role — monthly contribution per role (top roles). The employee
  // leg + employer match on the average compensation in each role band; falls back
  // to the headline employee% when a role has no occupancy. Reuses the derive
  // engine's occupation ranking, enriched with avg-compensation per role.
  const empPct = Number(cfg?.employeePct ?? 0);
  const matchPct = Number(cfg?.employerMatchPct ?? 0);
  // Fixed-amount employer-only plans fund a FLAT amount per member (no % of
  // compensation), so a comp×rate calc yields 0 for every role (empty bars).
  // Handle it explicitly; otherwise use the effective % of compensation.
  const isFixedBasis = cfg?.mode === 'employer-only' && cfg?.employerBasis === 'fixed';
  const fixedAmount = Number(cfg?.employerAmount) || 0;
  const totalRate = cfg?.mode === 'employer-only'
    ? (Number(cfg?.employerPct) || 0)
    : empPct + (empPct * matchPct) / 100;
  const roleComp = new Map(); // role -> { sum, count }
  for (const e of activeRoster) {
    const role = e.occupation ? String(e.occupation) : '—';
    const cur = roleComp.get(role) || { sum: 0, count: 0 };
    cur.sum += Number(e.compensation) || 0;
    cur.count += 1;
    roleComp.set(role, cur);
  }
  const fundingByRole = [...roleComp.entries()]
    .filter(([role]) => role !== '—')
    .map(([role, { sum, count }]) => ({
      label: role.length > 16 ? `${role.slice(0, 15)}…` : role,
      value: isFixedBasis ? fixedAmount : Math.round((sum / count) * (totalRate / 100)),
    }))
    .sort((x, y) => y.value - x.value)
    .slice(0, 6);

    return {
      a, headcount, active, totalContributions, thisMonth, participation,
      avgComp, insuranceOn, insuredStaff, overTime, splitSeries,
      statusData, compDist, cumulative, fundingByRole, latest, cumAcc,
    };
  }, [employees, runs, cfg, metrics, period]);

  const {
    a, headcount, active, totalContributions, thisMonth, participation,
    avgComp, insuranceOn, insuredStaff, overTime, splitSeries,
    statusData, compDist, cumulative, fundingByRole, latest, cumAcc,
  } = derived;

  // ── Exports (reuse the derive engine's builders + shared download helpers) ──
  const runExport = async (label, fn) => {
    if (exporting) return;
    setExporting(true);
    try {
      await fn();
    } catch (err) {
      addToast('error', err?.message || `Could not export ${label}.`);
    } finally {
      setExporting(false);
    }
  };

  const exportRoster = (format) => runExport('the roster', async () => {
    const { rows, columns } = buildRosterExport(employees);
    if (format === 'xlsx') {
      await downloadSheet({ rows, columns, filename: 'employee-roster', sheetName: 'Employees' });
    } else {
      await downloadCsv({
        rows, columns, filename: 'employee-roster', isMobile,
        onCapNotice: ({ capped }) => addToast('warning', `Showing the first ${formatNumber(capped)} rows in the export.`),
      });
    }
    addToast('success', `Exported ${formatNumber(employees.length)} ${employees.length === 1 ? 'employee' : 'employees'}.`);
  });

  const exportRuns = (format) => runExport('contributions', async () => {
    if (runs.length === 0) { addToast('info', 'No contribution runs to export yet.'); return; }
    const { rows, columns } = buildRunsExport(runs);
    if (format === 'xlsx') {
      await downloadSheet({ rows, columns, filename: 'contribution-runs', sheetName: 'Runs' });
    } else {
      await downloadCsv({ rows, columns, filename: 'contribution-runs', isMobile });
    }
    addToast('success', `Exported ${formatNumber(runs.length)} ${runs.length === 1 ? 'run' : 'runs'}.`);
  });

  const exportSummary = () => runExport('the summary', async () => {
    const { rows, columns } = buildSummaryExport(a);
    await downloadCsv({ rows, columns, filename: 'workforce-summary', isMobile });
    addToast('success', 'Workforce summary exported.');
  });

  const hasComp = compDist.some((d) => d.value > 0);

  return (
    <div className={ui.stack}>
      <PageHead
        eyebrow="Insights"
        title="Analytics"
        sub="Workforce and contribution trends across your company."
      />

      {/* Period filter + Export */}
      <div className={ui.toolrow}>
        <div className={ui.filters}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`${ui.filter} ${period === p.key ? ui.filterActive : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.grow} />
        <Btn variant="secondary" onClick={() => exportRoster('csv')} disabled={exporting || a.isEmpty}>
          {downloadIcon(16)}{exporting ? 'Exporting…' : 'Export'}
        </Btn>
      </div>

      {/* KPI tiles: 4-up */}
      <MetricRow cols={4}>
        <Tile
          accent="indigo"
          icon={peopleIcon(18)}
          label="Headcount"
          value={formatNumber(headcount)}
          sub="All staff on the company roster"
        />
        <Tile
          accent="green"
          icon={employeesIcon(18)}
          label="Active staff"
          value={formatNumber(active)}
          sub="Funded each contribution run"
        />
        <Tile
          accent="teal"
          icon={coinsIcon(18)}
          label="Total contributions"
          value={formatUGX(totalContributions)}
          sub="Real money toward retirement"
        />
        <Tile
          accent="indigoSoft"
          icon={trendIcon(18)}
          label="This month"
          value={formatUGX(thisMonth)}
          sub={latest ? `Latest run · ${runMonthLabel(latest.runAt)}` : 'No runs yet'}
        />
      </MetricRow>

      {/* KPI tiles: 3-up */}
      <MetricRow cols={3}>
        <Tile
          accent="green"
          icon={checkIcon(18)}
          label="Participation"
          value={`${participation}%`}
          sub="Active staff funded every run"
        />
        <Tile
          accent="amber"
          icon={walletIcon(18)}
          label="Avg compensation"
          value={formatUGX(avgComp)}
          sub="Per staff member, monthly"
        />
        <Tile
          accent="teal"
          icon={shieldIcon(18)}
          label="Insured staff"
          value={formatNumber(insuredStaff)}
          sub={insuranceOn ? 'Everyone — group life cover' : 'No group cover set up'}
        />
      </MetricRow>

      {/* Charts grid */}
      <div className={styles.charts}>
        {/* a. Contributions over time */}
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Contributions over time</h3>
            <p className={styles.chartSub}>Total funded per month — what your staff save plus your match.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label={`Contributions over ${overTime.length} months`}>
            {overTime.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <AreaChart data={overTime} margin={{ top: 12, right: 12, left: -8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="anOverTime" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PALETTE.indigo} stopOpacity={0.18} />
                      <stop offset="100%" stopColor={PALETTE.indigo} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} width={48} />
                  <Tooltip cursor={{ stroke: PALETTE.lavender }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                  <Area type="monotone" dataKey="total" name="Total funded" stroke={PALETTE.indigo} strokeWidth={2.5} fill="url(#anOverTime)" isAnimationActive={!reduceMotion} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No contribution runs yet.</p>}
          </div>
        </Card>

        {/* b. Employee vs employer split */}
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Employee vs employer split</h3>
            <p className={styles.chartSub}>Every month, what staff save versus the match you add on top.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Employee and employer contribution legs per month">
            {splitSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={splitSeries} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                  <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} width={48} />
                  <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                  <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={LEGEND_STYLE} />
                  <Bar dataKey="employee" stackId="leg" name="Employee leg (staff save)" fill={PALETTE.indigo} radius={[0, 0, 0, 0]} isAnimationActive={!reduceMotion} />
                  <Bar dataKey="employer" stackId="leg" name="Employer leg (your match)" fill={PALETTE.positive} radius={[4, 4, 0, 0]} isAnimationActive={!reduceMotion} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No contribution runs yet.</p>}
          </div>
        </Card>

        {/* c. Workforce status donut */}
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Workforce status</h3>
            <p className={styles.chartSub}>Active staff are funded each run; inactive staff are skipped.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label={`Workforce status: ${active} active, ${headcount - active} inactive of ${headcount}`}>
            {headcount > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" stroke="#FFFFFF" strokeWidth={2} isAnimationActive={!reduceMotion}>
                    {statusData.map((e) => <Cell key={e.key} fill={STATUS_COLORS[e.key] || PALETTE.lavender} />)}
                  </Pie>
                  <Tooltip cursor={false} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${formatNumber(v)} staff` })} />
                  <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={LEGEND_STYLE} />
                </PieChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No staff yet.</p>}
          </div>
        </Card>

        {/* d. Compensation distribution histogram */}
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Compensation distribution</h3>
            <p className={styles.chartSub}>How monthly pay spreads across your active staff.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Active staff by monthly pay band">
            {hasComp ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={compDist} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
                  <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                  <XAxis dataKey="key" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${formatNumber(v)} staff` })} />
                  <Bar dataKey="value" name="Active staff" radius={[6, 6, 0, 0]} isAnimationActive={!reduceMotion}>
                    {compDist.map((e) => <Cell key={e.key} fill={e.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No active staff yet.</p>}
          </div>
        </Card>

        {/* e. Cumulative funding */}
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Cumulative funding</h3>
            <p className={styles.chartSub}>Total saved toward retirement, building month over month.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label={`Cumulative funding rising to ${formatUGX(cumAcc)}`}>
            {cumulative.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <AreaChart data={cumulative} margin={{ top: 12, right: 12, left: -8, bottom: 4 }}>
                  <defs>
                    <linearGradient id="anCumulative" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={PALETTE.teal} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={PALETTE.teal} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} width={48} />
                  <Tooltip cursor={{ stroke: PALETTE.lavender }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                  <Area type="monotone" dataKey="total" name="Cumulative" stroke={PALETTE.teal} strokeWidth={2.5} fill="url(#anCumulative)" isAnimationActive={!reduceMotion} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No contribution runs yet.</p>}
          </div>
        </Card>

        {/* f. Funding by role */}
        <Card>
          <div className={styles.chartHead}>
            <h3 className={styles.chartTitle}>Funding by role</h3>
            <p className={styles.chartSub}>Monthly contribution per staff member — employee leg plus your match.</p>
          </div>
          <div className={styles.chartBody} role="img" aria-label="Monthly contribution by role">
            {fundingByRole.length > 0 ? (
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <BarChart data={fundingByRole} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke={PALETTE.gridLine} horizontal={false} />
                  <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} />
                  <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={104} />
                  <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${formatUGX(v)} / mo` })} />
                  <Bar dataKey="value" name="Monthly contribution" fill={PALETTE.indigoSoft} radius={[0, 6, 6, 0]} isAnimationActive={!reduceMotion} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className={styles.chartEmpty}>No role data yet.</p>}
          </div>
        </Card>
      </div>

      {/* Download reports */}
      <Card>
        <SectionHead icon={downloadIcon(18)} title="Download reports" tag="CSV · Excel" />
        <div className={ui.toolrow}>
          <Btn variant="secondary" onClick={() => exportRoster('csv')} disabled={exporting || a.isEmpty}>
            {downloadIcon(16)}Roster (CSV)
          </Btn>
          <Btn variant="secondary" onClick={() => exportRuns('xlsx')} disabled={exporting || runs.length === 0}>
            {downloadIcon(16)}Contributions (Excel)
          </Btn>
          <Btn variant="secondary" onClick={exportSummary} disabled={exporting || a.isEmpty}>
            {downloadIcon(16)}Workforce summary (CSV)
          </Btn>
        </div>
        <p className={styles.downloadNote}>Export the underlying data for sharing or your own records.</p>
      </Card>
    </div>
  );
}
