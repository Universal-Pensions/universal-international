import { useMemo, useState } from 'react';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useChildren, useChildrenMetrics } from '../../hooks/useEntity';
import {
  useEntityCommissionSummary,
  usePendingDuesByAgent,
  useSettlementsList,
} from '../../hooks/useCommission';
import { formatUGXShort, formatNumber } from '../../utils/currency';
import { downloadCsv } from '../../utils/csvDownload';
import ErrorCard from '../../components/feedback/ErrorCard';
import { deriveBranchAnalytics } from '../analytics/deriveBranchAnalytics';
import styles from './branchMobile.module.css';

const DownloadIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

/** Settlement % for an agent from its paid/due — 0 when neither exists. */
function settlementPct(paid, due) {
  const total = paid + due;
  return total > 0 ? Math.round((paid / total) * 100) : 0;
}

function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * CommissionsMobile — the branch-admin PHONE commissions page. Mirrors
 * CommissionsDesktop's data truth through the shared `deriveBranchAnalytics`
 * engine: a grad settlement-rate hero (rate % + progress bar), a Settled/Due
 * KPI pair, and a per-agent "By agent" card whose paid/due come from the
 * BRANCH-FILTERED commission feeds (pendingDuesByAgent + settlements), never
 * from agent.metrics. Renders the approved mockup; the fake "next run 30 Jun"
 * date is intentionally OMITTED (no scheduled-run concept exists — settlement
 * is upload-driven due→paid). The Export button does a real CSV download.
 */
export default function CommissionsMobile() {
  const { branchId } = useBranchScope();

  const { data: summary = {}, isError: summaryError, error: summaryErr, refetch: refetchSummary } =
    useEntityCommissionSummary('branch', branchId);
  const { data: agentsRaw = [], isError: agentsError, refetch: refetchAgents } =
    useChildren('branch', branchId);
  const { data: agentMetricsMap = {} } = useChildrenMetrics('branch', branchId);
  const { data: pendingDues = [], isError: duesError, refetch: refetchDues } =
    usePendingDuesByAgent();
  const { data: settlements = [], isLoading, isError: settlementsError, refetch: refetchSettlements } =
    useSettlementsList({ branchId });

  const [exporting, setExporting] = useState(false);

  const agents = useMemo(
    () => agentsRaw.map((a) => ({ ...a, metrics: agentMetricsMap[a.id] ?? a.metrics })),
    [agentsRaw, agentMetricsMap],
  );

  // Single derive pass — gives us the commission KPIs (settlement rate, paid,
  // due) AND the branch-filtered + commission-joined per-agent leaderboard.
  const analytics = useMemo(
    () =>
      deriveBranchAnalytics({
        agents,
        commissionSummary: summary,
        pendingDuesByAgent: pendingDues,
        settlements,
        branchId,
      }),
    [agents, summary, pendingDues, settlements, branchId],
  );

  // Per-agent rows: keep agents with any paid OR due activity, largest total
  // first. paid/due come straight off the leaderboard (already branch-scoped).
  const rows = useMemo(
    () =>
      (analytics.agentsView.leaderboard || [])
        .map((a) => ({ id: a.id, name: a.name, paid: a.commissionPaid, due: a.commissionDue }))
        .filter((r) => r.paid > 0 || r.due > 0)
        .sort((a, b) => (b.paid + b.due) - (a.paid + a.due)),
    [analytics],
  );

  if (summaryError || agentsError || duesError || settlementsError) {
    return (
      <ErrorCard
        title="We couldn't load commissions"
        message={summaryErr}
        onRetry={() => {
          refetchSummary();
          refetchAgents();
          refetchDues();
          refetchSettlements();
        }}
      />
    );
  }

  // Cold load: without this the settlement-rate hero + KPI pair briefly flash
  // 0% / UGX 0 before the commission feeds resolve. Hold a spinner until the
  // first settlements read lands.
  if (isLoading && settlements.length === 0 && rows.length === 0) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const { kpis } = analytics.commissionsView;
  const rate = Math.round(kpis.settlementRate || 0);
  const totalPaid = kpis.paid || 0;
  const totalDue = kpis.due || 0;
  const paidAgentCount = rows.filter((r) => r.paid > 0).length;

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      await downloadCsv({
        filename: 'branch-commissions',
        isMobile: true,
        columns: [
          { key: 'name', label: 'Agent' },
          { key: 'paid', label: 'Paid (UGX)' },
          { key: 'due', label: 'Due (UGX)' },
          { key: 'settlementPct', label: 'Settlement (%)' },
        ],
        rows: rows.map((r) => ({
          name: r.name,
          paid: r.paid,
          due: r.due,
          settlementPct: settlementPct(r.paid, r.due),
        })),
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      {/* HERO — settlement rate + progress */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Settlement rate">
        <div className={styles.eyebrow}>Payouts · this cycle</div>
        <div className={styles.heroVal} style={{ fontSize: 30, marginTop: 5 }}>{rate}%</div>
        <div className={styles.frameLbl} style={{ marginTop: 4, marginBottom: 0 }}>
          settled · paid ÷ (paid + due)
        </div>
        <div className={styles.comBar} style={{ marginTop: 14 }}>
          <div className={styles.barTrack} style={{ height: 10 }}>
            <div className={styles.barFill} style={{ width: `${Math.min(100, rate)}%` }} />
          </div>
          <span className={styles.comBarPc}>{rate}%</span>
        </div>
      </section>

      {/* KPI pair — Settled / Due */}
      <div className={styles.kpi2}>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Settled this cycle</div>
          <div className={`${styles.v} ${styles.grow}`}>{formatUGXShort(totalPaid)}</div>
          <div className={styles.frameLbl} style={{ marginTop: 2, marginBottom: 0, fontSize: '10.5px' }}>
            paid across {formatNumber(paidAgentCount)} agent{paidAgentCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className={styles.kpiC}>
          <div className={styles.lbl}>Due</div>
          <div className={styles.v} style={{ color: 'var(--color-amber-ink, #8A6209)' }}>
            {formatUGXShort(totalDue)}
          </div>
          <div className={styles.frameLbl} style={{ marginTop: 2, marginBottom: 0, fontSize: '10.5px' }}>
            pending settlement
          </div>
        </div>
      </div>

      {/* BY AGENT */}
      <section className={styles.card} aria-label="Commissions by agent">
        <header className={styles.cardHd}>
          <h3>By agent</h3>
          <span className={styles.tag}>Paid vs due</span>
        </header>
        {isLoading && rows.length === 0 ? (
          <p className={styles.scoreNote}>Loading commissions…</p>
        ) : rows.length === 0 ? (
          <p className={styles.scoreNote}>No commission activity for this branch yet.</p>
        ) : (
          rows.map((r) => {
            const pct = settlementPct(r.paid, r.due);
            const onTrack = pct >= 75;
            return (
              <div className={styles.comRow} key={r.id || r.name}>
                <div className={styles.comTop}>
                  <span className={styles.av} aria-hidden="true">{initialsOf(r.name)}</span>
                  <span className={styles.comTopCt}>
                    <b>{r.name}</b>
                    <small>Paid {formatUGXShort(r.paid)} · due {formatUGXShort(r.due)}</small>
                  </span>
                  <span className={`${styles.pill} ${onTrack ? styles.ok : styles.warn}`}>
                    <i />
                    {onTrack ? 'On track' : 'Partial'}
                  </span>
                </div>
                <div className={styles.comBar}>
                  <div className={styles.barTrack}>
                    <div className={styles.barFill} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={styles.comBarPc}>{pct}%</span>
                </div>
              </div>
            );
          })
        )}
      </section>

      {rows.length > 0 && (
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSec} ${styles.btnBlock}`}
          onClick={handleExport}
          disabled={exporting}
          aria-label="Export commission report as CSV"
        >
          {DownloadIcon}
          {exporting ? 'Exporting…' : 'Export commission report'}
        </button>
      )}
    </>
  );
}
