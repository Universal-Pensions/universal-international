import { useState } from 'react';
import { useEmployerScope } from '../../contexts/EmployerScopeContext';
import { useEmployees, useContributionRuns, useEmployer, useEmployerMetrics } from '../../hooks/useEmployer';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { formatUGX, formatNumber } from '../../utils/currency';
import { downloadCsv } from '../../utils/csvDownload';
import { downloadSheet } from '../../utils/xlsx';
import {
  deriveEmployeeAnalytics,
  buildRosterExport,
  buildSummaryExport,
  buildRunsExport,
} from '../reports/deriveEmployeeAnalytics';
import { groupInsuranceProducts } from '../../utils/groupInsurance';
import EmptyState from '../../components/EmptyState';
import s from './employerMobile.module.css';

// Brand-tinted slice colours for the gender donut + legend.
const GENDER_COLORS = ['#292867', '#2F8F9D', '#D9DCF2', '#FBBF24', '#5E63A8'];
// Million-scale compensation bands for active staff (matches AnalyticsDesktop's
// histogram banding — the derive engine's sub-1M buckets are too fine here).
const COMP_BANDS = [
  { key: '< 1.0M', min: 0, max: 999999 },
  { key: '1 – 2M', min: 1000000, max: 1999999 },
  { key: '2 – 3M', min: 2000000, max: 2999999 },
  { key: '3M +', min: 3000000, max: Infinity },
];

const DlIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></svg>
);

function donutGradient(items, total) {
  if (!total) return 'var(--color-lavender)';
  let acc = 0;
  const stops = items.map((it, i) => {
    const start = (acc / total) * 100;
    acc += it.value;
    const end = (acc / total) * 100;
    return `${GENDER_COLORS[i % GENDER_COLORS.length]} ${start}% ${end}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

function areaPaths(values, w = 300, h = 96) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const stepX = w / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, h - (v / max) * (h - 14) - 4]);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return { line, fill: `${line} L${w},${h} L0,${h} Z` };
}

/**
 * AnalyticsMobile — workforce analytics on the phone. Reuses the deriveEmployee-
 * Analytics engine + the export builders (downloadCsv / downloadSheet), rendered
 * as mobile-native charts (stacked status bar, donut, horizontal bars, SVG area)
 * rather than the desktop's Recharts — the user-chosen "apt for mobile" form.
 */
export default function AnalyticsMobile() {
  const { employerId } = useEmployerScope();
  const { addToast } = useToast();
  const isMobile = useIsMobile();

  const { data: employees = [] } = useEmployees(employerId);
  const { data: runs = [] } = useContributionRuns(employerId);
  const { data: employer } = useEmployer(employerId);
  const { data: metrics = {} } = useEmployerMetrics(employerId);
  const [exporting, setExporting] = useState(false);

  const cfg = employer?.defaultContributionConfig;
  const a = deriveEmployeeAnalytics(employees, cfg);

  if (a.isEmpty) {
    return (
      <div className={s.page}>
        <EmptyState kind="no-data" title="No staff yet" body="Workforce analytics appear here once you onboard staff." />
      </div>
    );
  }

  const total = a.kpis.total;
  const active = metrics.active ?? a.kpis.active;
  // Multi-product group insurance (Life / Health / Funeral): the "Group cover"
  // KPI shows the total per-member cover across ALL enabled products, not just
  // the legacy life-only groupCoverAmount.
  const insProducts = groupInsuranceProducts(cfg);
  const insOn = insProducts.length > 0;
  const cover = insProducts.reduce((s, p) => s + p.cover, 0);

  const activeRoster = employees.filter((e) => e.status === 'active');
  const compDist = COMP_BANDS.map((b) => ({
    key: b.key,
    value: activeRoster.filter((e) => {
      const m = Number(e.compensation) || 0;
      return m >= b.min && m <= b.max;
    }).length,
  }));

  const genderTotal = a.gender.reduce((acc, g) => acc + g.value, 0) || 1;
  const ageMax = Math.max(1, ...a.age.map((x) => x.value));
  const compMax = Math.max(1, ...compDist.map((x) => x.value));
  const occRoles = a.occupation.filter((o) => o.label !== '—');
  const occMax = Math.max(1, ...occRoles.map((x) => x.value));
  const activePct = a.kpis.activePct;
  const growthArea = areaPaths(a.growth.map((g) => g.total));
  const lastGrowth = a.growth[a.growth.length - 1];

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
  const exportRoster = () => runExport('the roster', async () => {
    const { rows, columns } = buildRosterExport(employees);
    await downloadCsv({ rows, columns, filename: 'employee-roster', isMobile });
    addToast('success', `Exported ${formatNumber(employees.length)} ${employees.length === 1 ? 'employee' : 'employees'}.`);
  });
  const exportRuns = () => runExport('contributions', async () => {
    if (runs.length === 0) { addToast('info', 'No contribution runs to export yet.'); return; }
    const { rows, columns } = buildRunsExport(runs);
    await downloadSheet({ rows, columns, filename: 'contribution-runs', sheetName: 'Runs' });
    addToast('success', `Exported ${formatNumber(runs.length)} ${runs.length === 1 ? 'run' : 'runs'}.`);
  });
  const exportSummary = () => runExport('the summary', async () => {
    const { rows, columns } = buildSummaryExport(a);
    await downloadCsv({ rows, columns, filename: 'workforce-summary', isMobile });
    addToast('success', 'Workforce summary exported.');
  });

  return (
    <div className={s.page}>
      <p className={s.intro}>A live snapshot of your {formatNumber(total)}-person workforce, drawn as compact charts. Export the underlying data below.</p>

      <div className={s.kpi2}>
        <div className={s.kpiC}><div className={s.kpiLbl}>Employees</div><div className={s.kpiV}>{formatNumber(total)}</div></div>
        <div className={s.kpiC}><div className={s.kpiLbl}>Active</div><div className={`${s.kpiV} ${s.grow}`}>{formatNumber(active)} <small>{activePct}%</small></div></div>
        <div className={s.kpiC}><div className={s.kpiLbl}>Avg age</div><div className={s.kpiV}>{a.kpis.avgAge || '—'}<small> yrs</small></div></div>
        <div className={s.kpiC}><div className={s.kpiLbl}>Avg comp / mo</div><div className={s.kpiV}>{formatUGX(a.kpis.avgMonthly, { compact: true })}</div></div>
        <div className={s.kpiC}><div className={s.kpiLbl}>Total comp / mo</div><div className={s.kpiV}>{formatUGX(a.kpis.totalMonthly, { compact: true })}</div></div>
        <div className={s.kpiC}><div className={s.kpiLbl}>Group cover</div><div className={s.kpiV}>{insOn ? formatUGX(cover, { compact: true }) : 'Off'}</div></div>
      </div>

      <div className={s.card}>
        <div className={s.cardHd}><h3>Employment status</h3><span className={s.tag}>{formatNumber(total)} staff</span></div>
        <div className={s.stackbar}>
          {active > 0 && <span style={{ width: `${activePct}%`, background: 'linear-gradient(90deg,#5bb3bf,var(--color-teal))' }}>{formatNumber(active)}</span>}
          {total - active > 0 && <span style={{ width: `${100 - activePct}%`, background: 'var(--color-lavender)', color: 'var(--color-indigo)' }}>{formatNumber(total - active)}</span>}
        </div>
        <div className={s.stackKey}>
          <div className={s.stackKeyRow}><i style={{ background: 'var(--color-teal)' }} />Active · {activePct}%</div>
          <div className={s.stackKeyRow}><i style={{ background: 'var(--color-lavender)' }} />Inactive · {100 - activePct}%</div>
        </div>
      </div>

      <div className={s.card}>
        <div className={s.cardHd}><h3>Gender mix</h3></div>
        <div className={s.donutWrap}>
          <div className={s.donut} style={{ background: donutGradient(a.gender, genderTotal) }}>
            <div className={s.donutC}><b>{formatNumber(total)}</b><small>staff</small></div>
          </div>
          <div className={s.legend}>
            {a.gender.map((g, i) => (
              <div key={g.key} className={s.legendRow}>
                <i style={{ background: GENDER_COLORS[i % GENDER_COLORS.length] }} />{g.name}
                <b>{formatNumber(g.value)} · {Math.round((g.value / genderTotal) * 100)}%</b>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={s.card}>
        <div className={s.cardHd}><h3>Age distribution</h3></div>
        {a.age.map((b) => (
          <div key={b.key} className={s.barRow}>
            <span className={s.bl}>{b.key}</span>
            <div className={s.barTrack}><div className={s.barFill} style={{ width: `${Math.round((b.value / ageMax) * 100)}%` }} /></div>
            <span className={s.barV}>{formatNumber(b.value)}</span>
          </div>
        ))}
      </div>

      <div className={s.card}>
        <div className={s.cardHd}><h3>Monthly compensation</h3><span className={s.tag}>active staff</span></div>
        {compDist.map((b) => (
          <div key={b.key} className={s.barRow}>
            <span className={s.bl}>{b.key}</span>
            <div className={s.barTrack}><div className={s.barFill} style={{ width: `${Math.round((b.value / compMax) * 100)}%` }} /></div>
            <span className={s.barV}>{formatNumber(b.value)}</span>
          </div>
        ))}
      </div>

      {occRoles.length > 0 && (
        <div className={s.card}>
          <div className={s.cardHd}><h3>Top roles</h3></div>
          {occRoles.map((o) => (
            <div key={o.key} className={s.barRow}>
              <span className={s.bl}>{o.label}</span>
              <div className={s.barTrack}><div className={`${s.barFill} ${s.teal}`} style={{ width: `${Math.round((o.value / occMax) * 100)}%` }} /></div>
              <span className={s.barV}>{formatNumber(o.value)}</span>
            </div>
          ))}
        </div>
      )}

      {growthArea && (
        <div className={s.card}>
          <div className={s.cardHd}><h3>Headcount growth</h3><span className={s.tag}>{a.growth.length} mo</span></div>
          <svg className={s.area} viewBox="0 0 300 96" preserveAspectRatio="none" role="img" aria-label="Cumulative headcount over time">
            <defs>
              <linearGradient id="empGrowthFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5E63A8" stopOpacity="0.34" />
                <stop offset="1" stopColor="#5E63A8" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={growthArea.fill} fill="url(#empGrowthFill)" />
            <path d={growthArea.line} fill="none" stroke="var(--color-indigo)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className={s.aMeta}>
            <span>{a.growth[0].label} · {formatNumber(a.growth[0].total)}</span>
            <span>{lastGrowth.label} · {formatNumber(lastGrowth.total)}</span>
          </div>
        </div>
      )}

      <div className={s.card}>
        <div className={s.cardHd}><h3>Download reports</h3></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" className={s.dlrow} onClick={exportRoster} disabled={exporting}>
            <span className={s.dlrowIc}>{DlIcon}</span>
            <span style={{ flex: 1 }}><b>Employees</b><small>Full staff roster</small></span>
            <span className={s.tag}>CSV</span>
          </button>
          <button type="button" className={s.dlrow} onClick={exportRuns} disabled={exporting || runs.length === 0}>
            <span className={s.dlrowIc}>{DlIcon}</span>
            <span style={{ flex: 1 }}><b>Contribution runs</b><small>All run totals</small></span>
            <span className={s.tag}>XLSX</span>
          </button>
          <button type="button" className={s.dlrow} onClick={exportSummary} disabled={exporting}>
            <span className={s.dlrowIc}>{DlIcon}</span>
            <span style={{ flex: 1 }}><b>Workforce summary</b><small>Every distribution</small></span>
            <span className={s.tag}>CSV</span>
          </button>
        </div>
      </div>
    </div>
  );
}
