// Subscriber Analytics panel — an at-a-glance view of the member's savings
// (balance growth + contributions by month) with a KPI strip and downloadable
// reports. Rendered as the Reports hub body (the 5 deep-view report routes stay
// intact as the download/drill targets). Charts use Recharts with the
// subscriber-local chartConfig (brand palette + custom tooltip). Downloads
// reuse the shared `downloadCsv` (src/utils/csvDownload.js) and `downloadSheet`
// (src/utils/xlsx.js — lazy-loads xlsx) helpers. This component never imports
// `mockData`; data arrives via the subscriber hooks (CLAUDE.md §4.1).

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useCurrentSubscriber, useSubscriberTransactions } from '../../hooks/useSubscriber';
import { useToast } from '../../contexts/ToastContext';
import { useIsMobile } from '../../hooks/useIsMobile';
import { formatUGX, formatNumber } from '../../utils/currency';
import { downloadCsv } from '../../utils/csvDownload';
import { downloadSheet } from '../../utils/xlsx';
import ErrorCard from '../../components/feedback/ErrorCard';
import SkeletonRow from '../../components/SkeletonRow';
import EmptyState from '../../components/EmptyState';
import { PALETTE, axisTick, chartTooltip } from './chartConfig';
import {
  deriveSubscriberAnalytics,
  buildTransactionsExport,
  buildContributionsExport,
} from './deriveSubscriberAnalytics';
import styles from './Analytics.module.css';

const CHART_HEIGHT = 260;

const DownloadIcon = (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="15" height="15">
    <path d="M10 3v10M10 13l-3-3M10 13l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 15v2h14v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ArrowIcon = (
  <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12">
    <path d="M4.5 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

function Kpi({ label, value, sub, accent }) {
  return (
    <div className={styles.kpi} style={accent ? { '--ac': accent } : undefined}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {sub != null && <span className={styles.kpiSub}>{sub}</span>}
    </div>
  );
}

function ChartCard({ id, title, sub, ariaLabel, hasData, children }) {
  return (
    <section className={styles.chartCard} aria-labelledby={id}>
      <header className={styles.blockHead}>
        <h3 id={id} className={styles.blockTitle}>{title}</h3>
        {sub && <span className={styles.chartSub}>{sub}</span>}
      </header>
      <div className={styles.chartBody} role="img" aria-label={ariaLabel}>
        {hasData ? children : <p className={styles.chartEmpty}>No data yet.</p>}
      </div>
    </section>
  );
}

export default function AnalyticsPanel() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();

  const { data: sub, isLoading, isError, error, refetch } = useCurrentSubscriber();
  const { data: transactions = [] } = useSubscriberTransactions(sub?.id);

  const a = useMemo(
    () => deriveSubscriberAnalytics(sub, transactions),
    [sub, transactions],
  );

  const [exporting, setExporting] = useState(false);

  const runExport = useCallback(async (label, fn) => {
    if (exporting) return;
    setExporting(true);
    try {
      await fn();
    } catch (err) {
      addToast('error', err?.message || `Could not export ${label}.`);
    } finally {
      setExporting(false);
    }
  }, [exporting, addToast]);

  const exportTransactions = useCallback((format) => runExport('your transactions', async () => {
    const { rows, columns } = buildTransactionsExport(transactions);
    if (rows.length === 0) { addToast('info', 'No transactions to export yet.'); return; }
    if (format === 'xlsx') {
      await downloadSheet({ rows, columns, filename: 'transactions', sheetName: 'Transactions' });
    } else {
      await downloadCsv({
        rows, columns, filename: 'transactions', isMobile,
        onCapNotice: ({ capped }) => addToast('warning', `Showing the first ${formatNumber(capped)} rows in the export.`),
      });
    }
    addToast('success', `Exported ${formatNumber(rows.length)} ${rows.length === 1 ? 'transaction' : 'transactions'}.`);
  }), [runExport, transactions, isMobile, addToast]);

  const exportContributions = useCallback((format) => runExport('your contributions summary', async () => {
    const { rows, columns } = buildContributionsExport(a);
    if (rows.length === 0) { addToast('info', 'No contributions to summarise yet.'); return; }
    if (format === 'xlsx') {
      await downloadSheet({ rows, columns, filename: 'contributions-summary', sheetName: 'Contributions' });
    } else {
      await downloadCsv({ rows, columns, filename: 'contributions-summary', isMobile });
    }
    addToast('success', 'Contributions summary exported.');
  }), [runExport, a, isMobile, addToast]);

  if (isError) {
    return (
      <ErrorCard
        title="We couldn't load your analytics"
        message={error}
        onRetry={refetch}
      />
    );
  }

  if (isLoading && !sub) {
    return <SkeletonRow count={6} label="Loading analytics" />;
  }

  const coverActive = a.kpis.insuranceStatus === 'active' && a.kpis.cover > 0;

  return (
    <div className={styles.dash}>
      {/* KPI strip */}
      <div className={styles.kpiRow}>
        <Kpi label="Net balance" value={formatUGX(a.kpis.netBalance)} accent={PALETTE.indigo} />
        <Kpi
          label="Units held"
          value={formatNumber(a.kpis.unitsHeld)}
          sub={a.kpis.currentUnitValue ? `@ ${formatUGX(a.kpis.currentUnitValue, { compact: false })}/unit` : null}
          accent={PALETTE.teal}
        />
        <Kpi label="Total contributed" value={formatUGX(a.kpis.totalContributed)} accent={PALETTE.positive} />
        <Kpi
          label="Insurance cover"
          value={coverActive ? formatUGX(a.kpis.cover) : 'Off'}
          sub={coverActive ? `${formatUGX((a.kpis.premiumMonthly || 0) * 12, { compact: false })}/yr` : 'Not active'}
          accent={PALETTE.amber}
        />
      </div>

      {a.isEmpty ? (
        <EmptyState
          kind="no-data"
          title="No activity yet"
          body="Once your first contribution clears, your balance growth and monthly contributions will chart here."
        />
      ) : (
        <div className={styles.chartGrid}>
          <ChartCard
            id="sa-balance"
            title="Balance growth"
            sub="Closing balance by month"
            hasData={a.balanceSeries.length > 0}
            ariaLabel={`Balance growth over ${a.balanceSeries.length} months, now ${formatUGX(a.kpis.netBalance, { compact: false })}`}
          >
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <AreaChart data={a.balanceSeries} margin={{ top: 8, right: 8, left: -8, bottom: 4 }}>
                <defs>
                  <linearGradient id="subBalanceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PALETTE.indigo} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={PALETTE.indigo} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatUGX(v)} />
                <Tooltip cursor={{ stroke: PALETTE.lavender }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v, { compact: false }) })} />
                <Area type="monotone" dataKey="value" name="Balance" stroke={PALETTE.indigo} strokeWidth={2} fill="url(#subBalanceFill)" isAnimationActive={!reduceMotion} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            id="sa-contributions"
            title="Contributions"
            sub="Contributed each month"
            hasData={a.contributionSeries.some((d) => d.value > 0)}
            ariaLabel={`Monthly contributions over ${a.contributionSeries.length} months, ${formatUGX(a.kpis.totalContributed, { compact: false })} total`}
          >
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={a.contributionSeries} margin={{ top: 8, right: 8, left: -8, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatUGX(v)} />
                <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v, { compact: false }) })} />
                <Bar dataKey="value" name="Contributions" fill={PALETTE.teal} radius={[6, 6, 0, 0]} isAnimationActive={!reduceMotion} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {/* Downloads */}
      <section className={styles.downloads} aria-labelledby="sa-downloads">
        <header className={styles.blockHead}>
          <h3 id="sa-downloads" className={styles.blockTitle}>Download reports</h3>
        </header>
        <p className={styles.downloadsSub}>Export your data for sharing or your own records.</p>
        <div className={styles.downloadGrid}>
          <button type="button" className={styles.downloadBtn} onClick={() => exportTransactions('csv')} disabled={exporting}>
            {DownloadIcon}<span>Transactions<small>CSV</small></span>
          </button>
          <button type="button" className={styles.downloadBtn} onClick={() => exportTransactions('xlsx')} disabled={exporting}>
            {DownloadIcon}<span>Transactions<small>Excel</small></span>
          </button>
          <button type="button" className={styles.downloadBtn} onClick={() => exportContributions('csv')} disabled={exporting}>
            {DownloadIcon}<span>Contributions summary<small>CSV</small></span>
          </button>
          <button type="button" className={styles.downloadBtn} onClick={() => exportContributions('xlsx')} disabled={exporting}>
            {DownloadIcon}<span>Contributions summary<small>Excel</small></span>
          </button>
        </div>
      </section>

      {/* Detailed reports — the 5 deep-view routes (drill / full download targets) */}
      <section className={styles.detail} aria-labelledby="sa-detail">
        <header className={styles.blockHead}>
          <h3 id="sa-detail" className={styles.blockTitle}>Detailed reports</h3>
        </header>
        <p className={styles.downloadsSub}>Open a full report to filter, drill in, and download.</p>
        <div className={styles.detailGrid}>
          {DETAIL_REPORTS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={styles.detailBtn}
              onClick={() => navigate(`/dashboard/reports/${r.id}`)}
            >
              <span className={styles.detailIcon}>{r.icon}</span>
              <span className={styles.detailText}>
                <span className={styles.detailTitle}>{r.title}</span>
                <span className={styles.detailDesc}>{r.description}</span>
              </span>
              <span className={styles.detailArrow}>{ArrowIcon}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// The 5 deep-view report routes stay the canonical full/download targets. This
// list mirrors ReportsPage's REPORTS so the hub still links every one of them.
const DETAIL_REPORTS = [
  {
    id: 'all-transactions',
    title: 'All Transactions',
    description: 'Every contribution, withdrawal, premium, and claim.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <path d="M3 9h18M8 13h8M8 16h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'contributions-summary',
    title: 'Contributions Summary',
    description: 'Month-by-month, retirement vs. emergency.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M7 14l4-4 4 4 5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'withdrawals-history',
    title: 'Withdrawals',
    description: 'Bucket, reason and settlement time.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M12 3v12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M7 8l5-5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    id: 'insurance-statement',
    title: 'Insurance Statement',
    description: 'Premiums paid, claims filed, current cover.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        <path d="M9 12l2.2 2 3.8-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: 'annual-statement',
    title: 'Annual Tax Statement',
    description: 'Year-end summary for tax filing.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="20" height="20">
        <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <path d="M8 7h8M8 11h8M8 15h5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      </svg>
    ),
  },
];
