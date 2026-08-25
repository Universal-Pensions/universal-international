// AnalyticsMobile — the branch-admin PHONE Analytics page (<1024px). The mobile
// sibling of desktop/AnalyticsDesktop.jsx: it wires the SAME hook set
// (useEntityMetrics / useChildren + useChildrenMetrics merged /
// useEntityCommissionSummary / usePendingDuesByAgent / useSettlementsList) into
// the SAME pure derive engine `deriveBranchAnalytics()`, then renders the
// approved mockup's compact phone layout — an intro, a 3-way segmented control
// (Subscribers · Agents · Commissions) switching local panes, and a shared
// "Download reports" card. No Recharts: charts are CSS bars + a conic-gradient
// donut from the shared branchMobile.module.css.
//
// DATA-HONESTY (mirrors the derive engine's notes + this build's prompt):
//  - activeSubs is round(total * activeRate/100) inside the derive — never a
//    fabricated metrics.activeSubscribers.
//  - gender comes from the BRANCH-level genderRatio (percentages, read direct);
//    age is RAW COUNTS; the % label per age band is derived from those counts.
//  - DROPPED with no real source: the "Subscriber growth" 12-mo area chart, the
//    "Avg age" KPI, every "▲ N pts vs last X" delta, and the "Next run / 30 Jun"
//    settlement date. The real Contributions trend (monthlyContributions) stays.
//  - Any errored query surfaces ONE ErrorCard + combined retry (OverviewDesktop
//    pattern), never a silently-zeroed page.

import { useMemo, useState } from 'react';
import { MOCK_NOW } from '../../constants/demoClock';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useEntityMetrics, useChildren, useChildrenMetrics } from '../../hooks/useEntity';
import {
  useEntityCommissionSummary,
  usePendingDuesByAgent,
  useSettlementsList,
} from '../../hooks/useCommission';
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
} from '../analytics/deriveBranchAnalytics';
import styles from './branchMobile.module.css';

const PANES = [
  { key: 'subs', label: 'Subscribers' },
  { key: 'agents', label: 'Agents' },
  { key: 'comm', label: 'Commissions' },
];

const DownloadIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" />
  </svg>
);

/** First name only — keeps per-agent bar labels short on a phone. */
const firstName = (name) => String(name || 'Unknown').split(' ')[0];

/** Bar width % relative to the largest value in a set (0 max → 0 width). */
function pct(value, max) {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

/**
 * A list of horizontal bars (label · track · value). `fill` toggles the teal
 * variant. `format` renders the right-hand value; `empty` shows when no rows.
 */
function BarList({ rows, fill = 'indigo', format, empty }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  if (rows.length === 0 || max <= 0) {
    return <p className={styles.scoreNote}>{empty}</p>;
  }
  return (
    <>
      {rows.map((r, i) => (
        <div className={styles.barRow} key={`${r.name}-${i}`}>
          <span className={styles.barLbl}>{firstName(r.name)}</span>
          <span className={styles.barTrack}>
            <span
              className={fill === 'teal' ? `${styles.barFill} ${styles.t}` : styles.barFill}
              style={{ width: `${pct(r.value, max)}%` }}
            />
          </span>
          <span className={styles.barV}>{format(r.value)}</span>
        </div>
      ))}
    </>
  );
}

/**
 * Two-slice donut (conic-gradient) + legend, matching the mockup. `a`/`b` are
 * { label, value, color } where value is whatever unit `format` renders; the
 * ring split uses the share of (a + b).
 */
function SplitDonut({ a, b, centerPct, centerLabel, format }) {
  const total = a.value + b.value;
  const aShare = total > 0 ? (a.value / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div
        className={styles.donut}
        style={{
          width: 104,
          height: 104,
          background: `conic-gradient(${a.color} 0 ${aShare}%, ${b.color} ${aShare}% 100%)`,
        }}
        role="img"
        aria-label={`${a.label} ${format(a.value)}, ${b.label} ${format(b.value)}`}
      >
        <div className={styles.donutC}>
          <b>{centerPct}</b>
          <small>{centerLabel}</small>
        </div>
      </div>
      <div className={styles.legend}>
        <div><i style={{ background: a.color }} />{a.label}<b>{format(a.value)}</b></div>
        <div><i style={{ background: b.color }} />{b.label}<b>{format(b.value)}</b></div>
      </div>
    </div>
  );
}

export default function AnalyticsMobile() {
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
      // A12-001 — same demo-clock anchor as AnalyticsDesktop.jsx, so the trend's
      // last month label matches the data (bucketed server-side off the SQL
      // demo clock, which MOCK_NOW mirrors) instead of the real wall clock.
      now: MOCK_NOW,
    }),
    [metrics, agents, commissionSummary, pendingDuesByAgent, settlements, branchId],
  );

  const [pane, setPane] = useState('subs');
  const [exporting, setExporting] = useState(false);

  // Cold-load + error guards mirror AnalyticsDesktop / BranchHomeMobile.
  const isCold = metrics === undefined && !metricsError;
  const hasError = metricsError || agentsError || commissionError || duesError || settlementsError;

  function retryAll() {
    refetchMetrics();
    refetchAgents();
    refetchCommission();
    refetchDues();
    refetchSettlements();
  }

  // ── Exports ───────────────────────────────────────────────────────────
  // Each Download-reports row builds rows/columns from the matching
  // build*Export() and pipes through downloadCsv / downloadSheet. Guarded by
  // `exporting` + try/catch → toast so a failure never crashes the page.
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

  function exportSubscribers() {
    return runExport(async () => {
      const { rows, columns } = buildSubscribersExport(analytics.subscribersView);
      await downloadCsv({ rows, columns, filename: 'branch-subscribers', isMobile: true });
    });
  }
  function exportAgents() {
    return runExport(async () => {
      const { rows, columns } = buildAgentsExport(analytics.agentsView);
      await downloadSheet({ rows, columns, filename: 'branch-agents', sheetName: 'Agents' });
    });
  }
  function exportCommissions() {
    return runExport(async () => {
      const { rows, columns } = buildCommissionsExport(analytics.commissionsView);
      await downloadCsv({ rows, columns, filename: 'branch-commissions', isMobile: true });
    });
  }
  function exportContributions() {
    return runExport(async () => {
      const { rows, columns } = buildContributionsExport(analytics.contributionsView);
      await downloadCsv({ rows, columns, filename: 'branch-contributions', isMobile: true });
    });
  }

  if (hasError) {
    return (
      <ErrorCard
        title="We couldn't load your analytics"
        message="One or more data sources failed to load."
        onRetry={retryAll}
      />
    );
  }

  if (isCold) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const { subscribersView, agentsView, contributionsView, commissionsView } = analytics;

  return (
    <>
      <p style={{ fontSize: 12.5, color: 'var(--color-gray)', lineHeight: 1.6, margin: '2px 4px 0' }}>
        A live read on your branch — subscribers, agents and commissions, drawn as
        compact charts that fit a phone. Switch views below; export any dataset at
        the bottom.
      </p>

      <div className={styles.seg} role="tablist" aria-label="Analytics view">
        {PANES.map((p) => (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={pane === p.key}
            className={pane === p.key ? `${styles.segBtn} ${styles.segBtnOn}` : styles.segBtn}
            onClick={() => setPane(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {pane === 'subs' && (
        <SubscribersPane view={subscribersView} contributions={contributionsView} />
      )}
      {pane === 'agents' && <AgentsPane view={agentsView} />}
      {pane === 'comm' && <CommissionsPane view={commissionsView} />}

      {/* Shared Download-reports card */}
      <section className={styles.card} aria-label="Download reports">
        <header className={styles.cardHd}><h3>Download reports</h3></header>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <DownloadRow
            title="Subscribers"
            sub="Status · demographics · KYC"
            tag="CSV"
            disabled={exporting}
            onClick={exportSubscribers}
          />
          <DownloadRow
            title="Agent performance"
            sub="Enrolment · contributions · active rate"
            tag="XLSX"
            disabled={exporting}
            onClick={exportAgents}
          />
          <DownloadRow
            title="Commissions"
            sub="Pending dues by agent"
            tag="CSV"
            disabled={exporting}
            onClick={exportCommissions}
          />
          <DownloadRow
            title="Contributions"
            sub="12-month branch history"
            tag="CSV"
            disabled={exporting}
            onClick={exportContributions}
          />
        </div>
      </section>
    </>
  );
}

function DownloadRow({ title, sub, tag, onClick, disabled }) {
  return (
    <button
      type="button"
      className={styles.dl}
      onClick={onClick}
      disabled={disabled}
      aria-label={`Export ${title} (${tag})`}
    >
      <span className={styles.dlIc} aria-hidden="true">{DownloadIcon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
      <span className={styles.tag}>{tag}</span>
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * SUBSCRIBERS PANE
 * ────────────────────────────────────────────────────────────────────────── */
function SubscribersPane({ view, contributions }) {
  const { kpis, gender, age } = view;
  const activePct = kpis.total > 0 ? Math.round((kpis.active / kpis.total) * 100) : 0;

  // Gender: branch-level percentages, read direct. Donut shows Male vs Female
  // (the two primary slices); 'Other' only appears in the engine when > 0 — we
  // surface it as a third legend line so the donut split stays binary + honest.
  const male = gender.find((g) => g.name === 'Male')?.value || 0;
  const female = gender.find((g) => g.name === 'Female')?.value || 0;
  const other = gender.find((g) => g.name === 'Other')?.value || 0;
  const hasGender = male + female + other > 0;
  const malePct = male + female > 0 ? Math.round((male / (male + female)) * 100) : 0;
  const totalAge = age.reduce((s, a) => s + a.value, 0);

  return (
    <>
      <div className={styles.kpi2}>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Subscribers</div>
          <div className={styles.v}>{formatNumber(kpis.total)}</div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Actively contributing</div>
          <div className={`${styles.v} ${styles.grow}`}>
            {formatNumber(kpis.active)} <small>{activePct}%</small>
          </div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Dormant</div>
          <div className={styles.v} style={{ color: 'var(--color-amber-ink, #8A6209)' }}>
            {formatNumber(kpis.dormant)}
          </div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>KYC verified</div>
          <div className={styles.v}>{kpis.kycVerifiedPct}%</div>
        </div>
      </div>

      {/* Gender split — branch-level % */}
      <section className={styles.card} aria-label="Gender split">
        <header className={styles.cardHd}>
          <h3>Gender split</h3>
          <span className={styles.tag}>{formatNumber(kpis.total)}</span>
        </header>
        {hasGender ? (
          <>
            <SplitDonut
              a={{ label: 'Male', value: male, color: 'var(--color-indigo)' }}
              b={{ label: 'Female', value: female, color: 'var(--color-teal)' }}
              centerPct={`${malePct}%`}
              centerLabel="Male"
              format={(v) => `${Math.round(v)}%`}
            />
            {other > 0 && (
              <p className={styles.scoreNote}>Other · {Math.round(other)}%</p>
            )}
          </>
        ) : (
          <p className={styles.scoreNote}>No gender data recorded yet.</p>
        )}
      </section>

      {/* Age distribution — raw counts; % label derived from counts */}
      <section className={styles.card} aria-label="Age distribution">
        <header className={styles.cardHd}>
          <h3>Age distribution</h3>
          <span className={styles.tag}>{formatNumber(totalAge)}</span>
        </header>
        {totalAge > 0 ? (
          age.map((a) => {
            const sharePct = Math.round((a.value / totalAge) * 100);
            return (
              <div className={styles.barRow} key={a.band}>
                <span className={styles.barLbl}>{a.band}</span>
                <span className={styles.barTrack}>
                  <span className={styles.barFill} style={{ width: `${pct(a.value, totalAge)}%` }} />
                </span>
                <span className={styles.barV}>{sharePct}%</span>
              </div>
            );
          })
        ) : (
          <p className={styles.scoreNote}>No age data recorded yet.</p>
        )}
      </section>

      {/* Contributions — REAL 12-mo trend (sparkbars) */}
      <ContributionsSpark trend={contributions.trend} kpis={contributions.kpis} />
    </>
  );
}

/** 12-month contribution sparkbars from the real monthlyContributions series. */
function ContributionsSpark({ trend, kpis }) {
  const max = trend.reduce((m, t) => Math.max(m, t.total), 0);
  return (
    <section className={styles.card} aria-label="Contributions over the last 12 months">
      <header className={styles.cardHd}>
        <h3>Contributions</h3>
        <span className={styles.tag}>12 mo</span>
      </header>
      {trend.length > 0 && max > 0 ? (
        <>
          <div className={styles.chartStat}>
            <b>{formatUGX(kpis.thisMonth)}</b>
            {kpis.yoyPct == null ? (
              <span className={`${styles.delta} ${styles.neutral}`}>Not enough history yet</span>
            ) : kpis.yoyPct !== 0 && (
              <span className={`${styles.delta} ${kpis.yoyPct >= 0 ? styles.up : styles.down}`}>
                {kpis.yoyPct >= 0 ? '▲' : '▼'} {Math.abs(kpis.yoyPct)}% over the year
              </span>
            )}
          </div>
          <div className={styles.spark}>
            {trend.map((t, i) => (
              <div
                className={i === trend.length - 1 ? `${styles.sparkCol} ${styles.sparkColCur}` : styles.sparkCol}
                key={`${t.label}-${i}`}
              >
                <i style={{ height: `${Math.max(4, pct(t.total, max))}%` }} />
              </div>
            ))}
          </div>
          <div className={styles.sparkX}>
            {trend.map((t, i) => <span key={`${t.label}-x-${i}`}>{t.label.slice(0, 1)}</span>)}
          </div>
        </>
      ) : (
        <p className={styles.scoreNote}>No contribution history yet for this branch.</p>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * AGENTS PANE
 * ────────────────────────────────────────────────────────────────────────── */
function AgentsPane({ view }) {
  const { kpis, leaderboard, contributionShare, activeRateByAgent } = view;
  const topPerformer = leaderboard[0]?.name || '—';
  const avgActiveRate = leaderboard.length
    ? Math.round(leaderboard.reduce((s, a) => s + a.activeRate, 0) / leaderboard.length)
    : 0;
  const subsEnrolled = leaderboard.reduce((s, a) => s + a.subscribers, 0);

  // Per-agent enrolled bars (largest first, mirroring the share/rate shapes).
  const enrolledByAgent = [...leaderboard]
    .map((a) => ({ name: a.name, value: a.subscribers }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <div className={styles.kpi2}>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Agents</div>
          <div className={styles.v}>
            {formatNumber(kpis.totalAgents)} <small>{formatNumber(kpis.activeAgents)} active</small>
          </div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Subscribers enrolled</div>
          <div className={styles.v}>{formatNumber(subsEnrolled)}</div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Avg active rate</div>
          <div className={`${styles.v} ${styles.grow}`}>{avgActiveRate}%</div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Top performer</div>
          <div className={styles.v} style={{ fontSize: 14 }}>{topPerformer}</div>
        </div>
      </div>

      <section className={styles.card} aria-label="Subscribers enrolled by agent">
        <header className={styles.cardHd}>
          <h3>Subscribers enrolled</h3>
          <span className={styles.tag}>by agent</span>
        </header>
        <BarList
          rows={enrolledByAgent}
          fill="teal"
          format={(v) => formatNumber(v)}
          empty="No agents in this branch yet."
        />
      </section>

      <section className={styles.card} aria-label="Contributions by agent">
        <header className={styles.cardHd}>
          <h3>Contributions</h3>
          <span className={styles.tag}>collected</span>
        </header>
        <BarList
          rows={contributionShare}
          fill="indigo"
          format={(v) => formatUGXShort(v)}
          empty="No agents in this branch yet."
        />
      </section>

      <section className={styles.card} aria-label="Active rate by agent">
        <header className={styles.cardHd}>
          <h3>Active rate</h3>
          <span className={styles.tag}>per agent</span>
        </header>
        <BarList
          rows={activeRateByAgent}
          fill="indigo"
          format={(v) => `${Math.round(v)}%`}
          empty="No agents in this branch yet."
        />
      </section>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * COMMISSIONS PANE
 * ────────────────────────────────────────────────────────────────────────── */
function CommissionsPane({ view }) {
  const { kpis, duesByAgent, settlements } = view;
  const hasCommission = kpis.paid + kpis.due > 0;
  const settledPct = kpis.paid + kpis.due > 0
    ? Math.round((kpis.paid / (kpis.paid + kpis.due)) * 100)
    : 0;

  // Paid-by-agent bars: aggregate paidAmount per agent from the branch
  // settlement feed (newest-first list, summed by name).
  const paidByAgent = useMemo(() => {
    const byName = new Map();
    for (const s of settlements) {
      const name = s.agentName || 'Unknown';
      byName.set(name, (byName.get(name) || 0) + (Number(s.paidAmount) || 0));
    }
    return [...byName.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [settlements]);

  return (
    <>
      <div className={styles.kpi2}>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Settled</div>
          <div className={`${styles.v} ${styles.grow}`}>{formatUGXShort(kpis.paid)}</div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Due</div>
          <div className={styles.v} style={{ color: 'var(--color-amber-ink, #8A6209)' }}>
            {formatUGXShort(kpis.due)}
          </div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Settlement rate</div>
          <div className={styles.v}>{kpis.settlementRate}%</div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Total commissions</div>
          <div className={styles.v}>{formatUGXShort(kpis.total)}</div>
        </div>
      </div>

      <section className={styles.card} aria-label="Settled versus due commissions">
        <header className={styles.cardHd}>
          <h3>Settled vs due</h3>
          <span className={styles.tag}>{formatUGXShort(kpis.paid + kpis.due)}</span>
        </header>
        {hasCommission ? (
          <SplitDonut
            a={{ label: 'Settled', value: kpis.paid, color: 'var(--color-green)' }}
            b={{ label: 'Due', value: kpis.due, color: 'var(--color-amber)' }}
            centerPct={`${settledPct}%`}
            centerLabel="settled"
            format={(v) => formatUGXShort(v)}
          />
        ) : (
          <p className={styles.scoreNote}>No commissions recorded yet.</p>
        )}
      </section>

      <section className={styles.card} aria-label="Commission paid by agent">
        <header className={styles.cardHd}>
          <h3>Paid by agent</h3>
          <span className={styles.tag}>settled · UGX</span>
        </header>
        <BarList
          rows={paidByAgent}
          fill="teal"
          format={(v) => formatUGXShort(v)}
          empty="No settlements recorded yet."
        />
      </section>

      <section className={styles.card} aria-label="Outstanding commission dues by agent">
        <header className={styles.cardHd}>
          <h3>Pending dues</h3>
          <span className={styles.tag}>by agent · UGX</span>
        </header>
        <BarList
          rows={duesByAgent}
          fill="indigo"
          format={(v) => formatUGXShort(v)}
          empty="No outstanding commission dues."
        />
      </section>
    </>
  );
}
