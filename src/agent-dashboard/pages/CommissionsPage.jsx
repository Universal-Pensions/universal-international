import { useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import { useAgentScope } from '../../contexts/AgentScopeContext';
import { useAgentCommissionDetail, useSettlementsList } from '../../hooks/useCommission';
import { useIsDesktop } from '../../hooks/useIsDesktop';
import { groupByPaidMonth } from '../../utils/commissionMonths';
import ErrorCard from '../../components/feedback/ErrorCard';
import AgentMobileHero from '../shell/AgentMobileHero';
import CommissionsDesktop from './CommissionsDesktop';
import styles from './CommissionsPage.module.css';
import {
  CommissionRow,
  EarnedMonths,
  SettlementMismatchBanner,
} from './commissions/CommissionsParts';
import { VALID_VIEWS, Icons } from './commissions/commissionsConfig';

export default function CommissionsPage() {
  const { view } = useParams();
  const navigate = useNavigate();
  const { agentId } = useAgentScope();
  const { data: detail, isLoading, isError, error, refetch } = useAgentCommissionDetail(agentId);
  const { data: settlements = [] } = useSettlementsList({ agentId });

  // INFORM-NOT-BLOCK mismatch surfacing (BL-1): find the LOGGED-IN agent's most
  // recent settlement batch that paid less than the pending total it was raised
  // against — i.e. a partial payment that left some lines `due`. In LIVE mode
  // RLS scopes `settlement_batches` to the agent's own rows; in MOCK mode there
  // is no RLS, so we pass `agentId` to the query AND defensively re-filter by
  // `b.agentId` here so this page can never surface ANOTHER agent's partial
  // batch. Newest-first from the service.
  const partialBatch = useMemo(
    () => settlements.find(
      (b) => b.agentId === agentId && (b.paidAmount || 0) < (b.pendingTotal || 0),
    ) || null,
    [settlements, agentId],
  );

  // A removed view (confirm / disputes) or any unknown param falls back to the
  // commissions home.
  useEffect(() => {
    if (view && !VALID_VIEWS.has(view)) {
      navigate('/dashboard/commissions', { replace: true });
    }
  }, [view, navigate]);

  const isHome = !view;
  const activeView = VALID_VIEWS.has(view) ? view : null;

  const paidTransactions = useMemo(() => detail?.paidTransactions || [], [detail]);
  const dueTransactions = useMemo(() => detail?.dueTransactions || [], [detail]);

  const totals = useMemo(() => {
    const totalPaid = detail?.totalPaid ?? paidTransactions.reduce((s, c) => s + (c.amount || 0), 0);
    const totalDue = detail?.totalDue ?? dueTransactions.reduce((s, c) => s + (c.amount || 0), 0);
    const totalAll = totalPaid + totalDue;
    const settledPct = totalAll ? Math.round((totalPaid / totalAll) * 100) : 0;
    return {
      paid: paidTransactions,
      due: dueTransactions,
      totalPaid,
      totalDue,
      totalAll,
      settledPct,
    };
  }, [detail, paidTransactions, dueTransactions]);

  const earnedMonths = useMemo(() => groupByPaidMonth(paidTransactions), [paidTransactions]);

  const isDesktop = useIsDesktop();
  if (isDesktop) return <CommissionsDesktop />;

  const recordCount = totals.paid.length + totals.due.length;

  function listFor(viewId) {
    if (viewId === 'earned') {
      return [...totals.paid].sort((a, b) =>
        (b.transactionDate || '').localeCompare(a.transactionDate || ''),
      );
    }
    if (viewId === 'owed') {
      return [...totals.due].sort((a, b) =>
        (a.dueDate || '').localeCompare(b.dueDate || ''),
      );
    }
    return [];
  }

  const list = activeView ? listFor(activeView) : [];

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        {isLoading && (
          <div className={styles.empty}>
            <div className={styles.spinner} />
            <p>Loading your commissions…</p>
          </div>
        )}

        {isError && !isLoading && (
          <div className={styles.empty}>
            <ErrorCard
              title="We couldn't load your commissions"
              message={error}
              onRetry={refetch}
            />
          </div>
        )}

        {!isLoading && !isError && isHome && (
          <div className={styles.homeWrap}>
            <AgentMobileHero
              eyebrow="Total commissions"
              value={`UGX ${formatUGX(totals.totalAll).replace('UGX ', '')}`}
            >
              <span><strong style={{ color: 'var(--color-green-ink, #1f6e44)', fontWeight: 700 }}>{totals.settledPct}%</strong> settled</span>
              <span style={{ color: 'var(--color-gray)' }}>
                {formatNumber(recordCount)} record{recordCount === 1 ? '' : 's'}
              </span>
            </AgentMobileHero>

            <SettlementMismatchBanner batch={partialBatch} />

            <section className={styles.outstandingCard} aria-labelledby="outstanding-title">
              <span className={styles.outstandingEyebrow}>
                <span className={styles.outstandingIcon} aria-hidden="true">{Icons.wallet}</span>
                Outstanding right now
              </span>
              <h2 id="outstanding-title" className={styles.outstandingValue}>
                {formatUGX(totals.totalDue)}
              </h2>
              <p className={styles.outstandingNote}>
                {totals.due.length > 0
                  ? `${formatNumber(totals.due.length)} commission${totals.due.length === 1 ? '' : 's'} owed — settled when your distributor next pays out.`
                  : 'Nothing owed right now. New commissions appear here until they’re paid.'}
              </p>
            </section>

            <div className={styles.summaryStrip}>
              <div className={styles.summaryAmount}>
                <span className={styles.summaryLabel}>Total commissions</span>
                <span className={styles.summaryValue}>{formatUGX(totals.totalAll)}</span>
                <span className={styles.summaryHint}>
                  {formatNumber(recordCount)} record{recordCount === 1 ? '' : 's'} from your subscribers
                </span>
              </div>
              <div className={styles.summaryProgress}>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${totals.settledPct}%` }} />
                </div>
                <div className={styles.progressLabels}>
                  <span className={styles.progressLabelPaid}>{totals.settledPct}% settled</span>
                  <span className={styles.progressLabelDue}>{100 - totals.settledPct}% pending</span>
                </div>
              </div>
            </div>

            <div className={styles.primaryGrid}>
              <button className={styles.primaryCard} data-type="settled" onClick={() => navigate('/dashboard/commissions/earned')}>
                <div className={styles.primaryIcon}>{Icons.check}</div>
                <div className={styles.primaryAmount}>{formatUGXShort(totals.totalPaid)}</div>
                <div className={styles.primaryLabel}>Earned</div>
                <div className={styles.primaryCount}>{formatNumber(totals.paid.length)} commissions paid</div>
              </button>
              <button className={styles.primaryCard} data-type="pending" onClick={() => navigate('/dashboard/commissions/owed')}>
                <div className={styles.primaryIcon}>{Icons.clock}</div>
                <div className={styles.primaryAmount}>{formatUGXShort(totals.totalDue)}</div>
                <div className={styles.primaryLabel}>Owed</div>
                <div className={styles.primaryCount}>{formatNumber(totals.due.length)} awaiting payout</div>
              </button>
            </div>

            <EarnedMonths months={earnedMonths} />
          </div>
        )}

        {!isLoading && !isError && !isHome && activeView && (
          list.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>
                {activeView === 'earned' ? 'No paid commissions yet' : 'Nothing owed right now'}
              </p>
              <p>
                {activeView === 'earned'
                  ? 'Paid commissions appear here once your distributor settles them.'
                  : 'New commissions show up here until your distributor pays them out.'}
              </p>
            </div>
          ) : (
            <div className={styles.list}>
              {list.map((line) => (
                <CommissionRow key={line.id} line={line} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
