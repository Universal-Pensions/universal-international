import { useMemo } from 'react';
import { useCurrentSubscriber, useSubscriberTransactions } from '../../../hooks/useSubscriber';
import { formatUGX } from '../../../utils/currency';

import { formatDate } from '../../../utils/date';
import { downloadCSV } from '../../../utils/csv';
import ErrorCard from '../../../components/feedback/ErrorCard';
import ExportButton from '../../../components/reports/ExportButton';
import SkeletonRow from '../../../components/SkeletonRow';
import EmptyState from '../../../components/EmptyState';
import frameStyles from './ReportFrame.module.css';

function monthLabel(i, len, baseYear, baseMonth) {
  const target = new Date(baseYear, baseMonth - (len - 1 - i), 1);
  return formatDate(target, { variant: 'short-month-year' });
}

export default function ContributionsSummary() {
  const { data: sub, isLoading, isError, error, refetch } = useCurrentSubscriber();
  // Same family as A10-001/A10-002: `sub.transactions` is a field mapSubscriberRow
  // NEVER populates, so the month-axis anchor below silently fell back to the wall
  // clock — the exact drift its own comment says it exists to avoid. Read the real
  // per-id query instead, as AnnualStatement / AllTransactions / InsuranceStatement
  // now do.
  const { data: transactions = [], isLoading: txLoading } = useSubscriberTransactions(sub?.id);
  const history = useMemo(() => sub?.contributionHistory || [], [sub?.contributionHistory]);
  const schedule = sub?.contributionSchedule;
  const retPct = (schedule?.retirementPct ?? 80) / 100;

  // Anchor the month axis to the latest dated contribution/transaction rather
  // than the wall clock: the demo seed is MOCK_NOW-anchored (2026), so labels
  // built from `new Date()` drift away from the data as real time passes.
  // Components must not import mockData (CLAUDE.md §4), so derive the base month
  // from the dated transactions the hook already gave us, falling back to the
  // wall clock when there is no dated data. Mirrors ActivityPage's data anchor.
  const [baseYear, baseMonth] = useMemo(() => {
    let latest = null;
    transactions.forEach((t) => {
      if (!t.date) return;
      const d = new Date(t.date);
      if (!Number.isNaN(d.getTime()) && (latest == null || d > latest)) latest = d;
    });
    const base = latest ?? new Date();
    return [base.getFullYear(), base.getMonth()];
  }, [transactions]);

  const monthly = useMemo(
    () => history.map((v, i) => {
      const ret = Math.round(v * retPct);
      const emg = v - ret;
      return {
        id: `m-${i}`,
        monthLabel: monthLabel(i, history.length, baseYear, baseMonth),
        total: v,
        retirement: ret,
        emergency: emg,
      };
    }).reverse(),
    [history, retPct, baseYear, baseMonth]
  );

  const totals = useMemo(() => {
    return monthly.reduce((acc, m) => {
      acc.total += m.total;
      acc.retirement += m.retirement;
      acc.emergency += m.emergency;
      return acc;
    }, { total: 0, retirement: 0, emergency: 0 });
  }, [monthly]);

  function handleExport() {
    const headers = ['Month', 'Retirement (UGX)', 'Emergency (UGX)', 'Total (UGX)'];
    const rows = monthly.map((m) => [m.monthLabel, m.retirement, m.emergency, m.total]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(`contributions-summary-${stamp}.csv`, headers, rows);
  }

  if (isError) {
    return (
      <ErrorCard
        title="We couldn't load your contributions"
        message={error}
        onRetry={refetch}
      />
    );
  }

  // Cold-load skeleton — keep the report frame feeling responsive
  // before history is hydrated.
  // txLoading included, like the three sibling views. Without it, `transactions`
  // is [] for one round trip after `sub` resolves, and the month anchor below
  // falls back to `new Date()` — reintroducing exactly the wall-clock drift
  // this view was changed to remove. All twelve month labels then shift once
  // the fetch lands.
  if ((isLoading && !sub) || txLoading) {
    return (
      <div className={frameStyles.frame}>
        <div className={frameStyles.headerRow}>
          <div className={frameStyles.headerText}>
            <span className={frameStyles.eyebrow}>Month-by-month view</span>
            <span className={frameStyles.headerDesc}>Loading…</span>
          </div>
        </div>
        <SkeletonRow count={6} label="Loading contributions summary" />
      </div>
    );
  }

  return (
    <div className={frameStyles.frame}>
      <div className={frameStyles.headerRow}>
        <div className={frameStyles.headerText}>
          <span className={frameStyles.eyebrow}>Month-by-month view</span>
          <span className={frameStyles.headerDesc}>Your contributions split by retirement and emergency bucket.</span>
        </div>
        <ExportButton onExport={handleExport} />
      </div>

      <div className={frameStyles.kpiStrip}>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Total contributed</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.total)}</span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Retirement bucket</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.retirement)}</span>
        </div>
        <div className={frameStyles.kpi}>
          <span className={frameStyles.kpiLabel}>Emergency bucket</span>
          <span className={frameStyles.kpiValue}>{formatUGX(totals.emergency)}</span>
        </div>
      </div>

      <section className={frameStyles.statSection}>
        <div className={frameStyles.statSectionTitle}>Monthly breakdown</div>
        {monthly.length === 0 ? (
          <EmptyState
            kind="no-data"
            title="No contributions yet."
            body="Your monthly contributions will appear here once the first one settles."
          />
        ) : (
          <div className={frameStyles.monthGrid}>
            {monthly.map((m) => (
              <div key={m.id} className={frameStyles.monthCard}>
                <span className={frameStyles.monthLabel}>{m.monthLabel}</span>
                <span className={frameStyles.monthValue}>{formatUGX(m.total, { compact: false })}</span>
                <span className={frameStyles.monthMeta}>
                  <span aria-label={`Retirement ${formatUGX(m.retirement, { compact: false })}`}>R {formatUGX(m.retirement)}</span>
                  <span aria-label={`Emergency ${formatUGX(m.emergency, { compact: false })}`}>E {formatUGX(m.emergency)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
