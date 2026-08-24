import { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import { formatDate } from '../../utils/date';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentCommissionDetail, useSettlementsList } from '../../hooks/useCommission';
import ReportTable from '../../components/reports/ReportTable';
import EmptyState from '../../components/EmptyState';
import SkeletonRow from '../../components/SkeletonRow';
import ErrorCard from '../../components/feedback/ErrorCard';
import PageHeader from '../../components/PageHeader';
import KpiCard from '../../dashboard/shared/KpiCard';
import {
  CommissionRow,
  SettlementMismatchBanner,
} from './commissions/CommissionsParts';
import { VALID_VIEWS, VIEW_LABELS, Icons } from './commissions/commissionsConfig';
import desktopStyles from './CommissionsDesktop.module.css';

const ChevronRight = (
  <svg viewBox="0 0 20 20" fill="none" width="18" height="18" aria-hidden="true">
    <path d="M8 5l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * CommissionsDesktop — the ≥1024px agent "Commissions" surface.
 *
 * BASE (/commissions, no view) is a tab-root, so the page body owns a PLAIN
 * <h1> (no back chevron, no hero dome — those belong to PageHeader on
 * sub-pages). The desktop top bar renders no <h1>. The base view is an
 * earned/owed-at-a-glance dashboard: a KPI row (earned / owed / settled),
 * the settlement-mismatch banner (BL-1, inform-not-block), a sortable
 * settlement-history table, and entry-point cards into the earned / owed
 * sub-lists.
 *
 * A `view` param (earned | owed, per VALID_VIEWS) renders the filtered line
 * list via the shared CommissionRow, fronted by PageHeader default (back +
 * h1) — a sub-view.
 *
 * Same data hooks as the mobile CommissionsPage (React Query dedupes), so
 * nothing extra is fetched. ReportTable owns its own loading spinner +
 * "No data available" empty state, neither customisable; to keep the shared
 * SkeletonRow / EmptyState look we branch OUTSIDE the table on the query —
 * SkeletonRow while loading, EmptyState when the settlement list is empty,
 * else the table.
 */
export default function CommissionsDesktop() {
  const { view } = useParams();
  const navigate = useNavigate();
  const { agentId } = useAgentScope();
  const { data: detail, isLoading, isError, error, refetch } = useAgentCommissionDetail(agentId);
  const { data: settlements = [], isLoading: settlementsLoading } = useSettlementsList({ agentId });

  // Same INFORM-NOT-BLOCK partial-batch surfacing as the mobile page: the
  // logged-in agent's most recent settlement that paid less than the pending
  // total it was raised against. Defensively re-filter by agentId (no RLS in
  // MOCK mode). Newest-first from the service.
  const partialBatch = useMemo(
    () => settlements.find(
      (b) => b.agentId === agentId && (b.paidAmount || 0) < (b.pendingTotal || 0),
    ) || null,
    [settlements, agentId],
  );

  const activeView = VALID_VIEWS.has(view) ? view : null;

  const paidTransactions = useMemo(() => detail?.paidTransactions || [], [detail]);
  const dueTransactions = useMemo(() => detail?.dueTransactions || [], [detail]);

  const totals = useMemo(() => {
    const totalPaid = detail?.totalPaid ?? paidTransactions.reduce((s, c) => s + (c.amount || 0), 0);
    const totalDue = detail?.totalDue ?? dueTransactions.reduce((s, c) => s + (c.amount || 0), 0);
    const totalAll = totalPaid + totalDue;
    const settledPct = totalAll ? Math.round((totalPaid / totalAll) * 100) : 0;
    return { totalPaid, totalDue, totalAll, settledPct };
  }, [detail, paidTransactions, dueTransactions]);

  // Settlement table columns. `id` (ref) renders as plain text so getByText
  // resolves. Numeric columns carry a sortValue so ReportTable sorts on the
  // raw number, not the formatted string.
  const columns = useMemo(
    () => [
      {
        key: 'paidDate',
        label: 'Paid',
        sortable: true,
        render: (row) => formatDate(row.paidDate),
      },
      { key: 'txnRef', label: 'Reference', sortable: true },
      {
        key: 'lineCount',
        label: 'Lines',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.lineCount || 0,
        render: (row) => formatNumber(row.lineCount || 0),
      },
      {
        key: 'pendingTotal',
        label: 'Due at the time',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.pendingTotal || 0,
        render: (row) => formatUGX(row.pendingTotal || 0),
      },
      {
        key: 'paidAmount',
        label: 'Paid',
        align: 'right',
        sortable: true,
        sortValue: (row) => row.paidAmount || 0,
        render: (row) => formatUGX(row.paidAmount || 0),
      },
      {
        key: 'status',
        label: 'Status',
        sortable: true,
        sortValue: (row) => ((row.paidAmount || 0) < (row.pendingTotal || 0) ? 0 : 1),
        render: (row) => {
          const partial = (row.paidAmount || 0) < (row.pendingTotal || 0);
          return (
            <span className={desktopStyles.statusPill} data-tone={partial ? 'partial' : 'full'}>
              <span className={desktopStyles.statusDot} aria-hidden="true" />
              {partial ? 'Partial' : 'Full'}
            </span>
          );
        },
      },
    ],
    [],
  );

  // ── Sub-view (earned / owed list) ──────────────────────────────────────
  if (activeView) {
    const list = activeView === 'earned'
      ? [...paidTransactions].sort((a, b) =>
          (b.transactionDate || '').localeCompare(a.transactionDate || ''))
      : [...dueTransactions].sort((a, b) =>
          (a.dueDate || '').localeCompare(b.dueDate || ''));

    return (
      <div className={desktopStyles.subPage}>
        <PageHeader
          title={VIEW_LABELS[activeView]}
          subtitle={`${list.length} record${list.length === 1 ? '' : 's'}`}
          fallback="/dashboard/commissions"
        />

        {isLoading && <SkeletonRow count={6} variant="compact" label="Loading your commissions" />}

        {isError && !isLoading && (
          <ErrorCard
            title="We couldn't load your commissions"
            message={error}
            onRetry={refetch}
          />
        )}

        {!isLoading && !isError && (
          list.length === 0 ? (
            <EmptyState
              kind="no-data"
              title={activeView === 'earned' ? 'No paid commissions yet' : 'Nothing owed right now'}
              body={activeView === 'earned'
                ? 'Paid commissions appear here once your distributor settles them.'
                : 'New commissions show up here until your distributor pays them out.'}
            />
          ) : (
            <div className={desktopStyles.list}>
              {list.map((line) => (
                <CommissionRow key={line.id} line={line} />
              ))}
            </div>
          )
        )}
      </div>
    );
  }

  // ── BASE view (tab-root) ────────────────────────────────────────────────
  const tableLoading = settlementsLoading && settlements.length === 0;

  return (
    <div className={desktopStyles.page}>
      <header className={desktopStyles.head}>
        <p className={desktopStyles.eyebrow}>Total commissions</p>
        <h1 className={desktopStyles.title}>Commissions</h1>
        <p className={desktopStyles.subtitle}>
          {isLoading
            ? 'Loading your commissions…'
            : `${formatUGX(totals.totalAll)} earned and owed · ${totals.settledPct}% settled`}
        </p>
      </header>

      {isError && !isLoading && (
        <ErrorCard
          title="We couldn't load your commissions"
          message={error}
          onRetry={refetch}
        />
      )}

      {!isError && (
        <>
          <SettlementMismatchBanner batch={partialBatch} />

          <div className={desktopStyles.kpiRow}>
            <KpiCard
              icon={Icons.check}
              label="Earned"
              value={isLoading ? '—' : formatUGX(totals.totalPaid)}
            />
            <KpiCard
              icon={Icons.clock}
              label="Owed right now"
              value={isLoading ? '—' : formatUGX(totals.totalDue)}
            />
            <KpiCard
              icon={Icons.wallet}
              label="Settled"
              value={isLoading ? '—' : `${totals.settledPct}`}
              suffix="%"
            />
          </div>

          <div className={desktopStyles.entryGrid}>
            <button
              type="button"
              className={desktopStyles.entryCard}
              data-type="earned"
              onClick={() => navigate('/dashboard/commissions/earned')}
            >
              <span className={desktopStyles.entryIcon}>{Icons.check}</span>
              <span className={desktopStyles.entryText}>
                <span className={desktopStyles.entryLabel}>Earned</span>
                <span className={desktopStyles.entryCount}>
                  {formatNumber(paidTransactions.length)} commission{paidTransactions.length === 1 ? '' : 's'} paid
                </span>
              </span>
              <span className={desktopStyles.entryAmount}>{formatUGXShort(totals.totalPaid)}</span>
              <span className={desktopStyles.entryChev}>{ChevronRight}</span>
            </button>
            <button
              type="button"
              className={desktopStyles.entryCard}
              data-type="owed"
              onClick={() => navigate('/dashboard/commissions/owed')}
            >
              <span className={desktopStyles.entryIcon}>{Icons.clock}</span>
              <span className={desktopStyles.entryText}>
                <span className={desktopStyles.entryLabel}>Owed</span>
                <span className={desktopStyles.entryCount}>
                  {formatNumber(dueTransactions.length)} awaiting payout
                </span>
              </span>
              <span className={desktopStyles.entryAmount}>{formatUGXShort(totals.totalDue)}</span>
              <span className={desktopStyles.entryChev}>{ChevronRight}</span>
            </button>
          </div>

          <div className={desktopStyles.sectionHead}>
            <span className={desktopStyles.sectionEyebrow}>History</span>
            <h2 className={desktopStyles.sectionTitle}>Settlement history</h2>
          </div>

          <div className={desktopStyles.tableArea}>
            {tableLoading && (
              <SkeletonRow count={4} variant="compact" label="Loading settlement history" />
            )}
            {!tableLoading && settlements.length === 0 && (
              <EmptyState
                kind="no-data"
                title="No settlements yet"
                body="Each time your distributor pays out a batch, it appears here with the reference and amount."
              />
            )}
            {!tableLoading && settlements.length > 0 && (
              <ReportTable
                columns={columns}
                data={settlements}
                defaultSort="paidDate"
                defaultDir="desc"
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
