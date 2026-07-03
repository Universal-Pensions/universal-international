import { useMemo } from 'react';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useChildren, useChildrenMetrics } from '../../hooks/useEntity';
import { useEntityCommissionSummary, usePendingDuesByAgent, useSettlementsList } from '../../hooks/useCommission';
import { formatUGXShort, formatNumber } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import { deriveBranchAnalytics } from '../analytics/deriveBranchAnalytics';
import { PageHead, MetricRow, Tile, Card, SectionHead, StatusBadge, Avatar } from '../../employer-dashboard/desktop/ui';
import { checkIcon, pendingIcon, analyticsIcon } from '../../employer-dashboard/desktop/icons';
import ui from '../../employer-dashboard/desktop/ui.module.css';
import styles from './CommissionsDesktop.module.css';

function settlementPct(paid, due) {
  const total = paid + due;
  return total > 0 ? Math.round((paid / total) * 100) : 0;
}

export default function CommissionsDesktop() {
  const { branchId } = useBranchScope();

  // Same source of truth as CommissionsMobile + the branch Analytics page:
  // a single deriveBranchAnalytics pass over the branch-filtered settlement +
  // pending-dues feeds. Previously the desktop read useAgentCommissionList
  // (network-wide, client-filtered), so per-agent paid/due could diverge from
  // the other two surfaces.
  const { data: summary = {}, isError: summaryError, error, refetch: refetchSummary } =
    useEntityCommissionSummary('branch', branchId);
  const { data: agentsRaw = [], isError: agentsError, refetch: refetchAgents } =
    useChildren('branch', branchId);
  const { data: agentMetricsMap = {} } = useChildrenMetrics('branch', branchId);
  const { data: pendingDues = [], isError: duesError, refetch: refetchDues } =
    usePendingDuesByAgent();
  const { data: settlements = [], isLoading, isError: settlementsError, refetch: refetchSettlements } =
    useSettlementsList({ branchId });

  const agents = useMemo(
    () => agentsRaw.map((a) => ({ ...a, metrics: agentMetricsMap[a.id] ?? a.metrics })),
    [agentsRaw, agentMetricsMap],
  );

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

  const rows = useMemo(
    () =>
      (analytics.agentsView.leaderboard || [])
        .map((a) => ({ agentId: a.id, agentName: a.name, totalPaid: a.commissionPaid, totalDue: a.commissionDue }))
        .filter((r) => r.totalPaid > 0 || r.totalDue > 0)
        .sort((a, b) => (b.totalPaid + b.totalDue) - (a.totalPaid + a.totalDue)),
    [analytics],
  );

  if (summaryError || agentsError || duesError || settlementsError) {
    return (
      <ErrorCard
        title="We couldn't load commissions"
        message={error}
        onRetry={() => { refetchSummary(); refetchAgents(); refetchDues(); refetchSettlements(); }}
      />
    );
  }

  const { kpis } = analytics.commissionsView;
  const totalPaid = kpis.paid || 0;
  const totalDue = kpis.due || 0;
  const rate = Math.round(kpis.settlementRate || 0);

  return (
    <div className={ui.stack}>
      <PageHead
        eyebrow="Payouts"
        title="Commissions"
        sub={`${rate}% settlement rate this cycle · paid vs due across your agents`}
      />

      <MetricRow cols={3}>
        <Tile accent="green" icon={checkIcon(18)} label="Settled this cycle" value={formatUGXShort(totalPaid)} sub={`Paid across ${formatNumber(rows.filter((r) => r.totalPaid > 0).length)} agents`} />
        <Tile accent="amber" icon={pendingIcon(18)} label="Due next run" value={formatUGXShort(totalDue)} sub="Pending settlement" />
        <Tile accent="indigo" icon={analyticsIcon(18)} label="Settlement rate" value={`${rate}%`} sub="Paid ÷ (paid + due)" />
      </MetricRow>

      <Card>
        <SectionHead title="By agent" tag="Paid vs due" />
        {isLoading && !rows.length ? (
          <p className={styles.note}>Loading commissions…</p>
        ) : rows.length === 0 ? (
          <p className={styles.note}>No commission activity for this branch yet.</p>
        ) : (
          <div className={ui.tableCard}>
            <table className={ui.table}>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th className={ui.num}>Paid</th>
                  <th className={ui.num}>Due</th>
                  <th>Settlement</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = settlementPct(r.totalPaid, r.totalDue);
                  const onTrack = pct >= 75;
                  return (
                    <tr key={r.agentId} className={ui.rowInteractive}>
                      <td>
                        <span className={styles.who}>
                          <Avatar name={r.agentName} />
                          <span className={styles.whoName}>{r.agentName}</span>
                        </span>
                      </td>
                      <td className={ui.num}>{formatUGXShort(r.totalPaid)}</td>
                      <td className={ui.num}>{formatUGXShort(r.totalDue)}</td>
                      <td>
                        <span className={styles.miniBar}><i style={{ width: `${pct}%` }} /></span>
                        {pct}%
                      </td>
                      <td>
                        <StatusBadge tone={onTrack ? 'active' : 'open'}>{onTrack ? 'On track' : 'Partial'}</StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
