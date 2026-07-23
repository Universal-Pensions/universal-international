import { useParams } from 'react-router-dom';
import { useEntity, useEntityMetrics } from '../../hooks/useEntity';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { formatNumber, formatUGX, formatUGXShort } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './distributorMobile.module.css';

const PhoneIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
const StarIcon = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

/**
 * AgentDetailMobile — one agent (route /dashboard/agents/:agentId). Profile +
 * KPI grid + branch assignment + commission summary. Same hooks as the desktop
 * ViewAgents detail so figures never drift.
 */
export default function AgentDetailMobile() {
  const { agentId } = useParams();
  const { data: agent, isLoading, isError, error, refetch } = useEntity('agent', agentId);
  const { data: metrics = {} } = useEntityMetrics('agent', agentId);
  const { data: branch } = useEntity('branch', agent?.parentId);
  const { data: commission } = useEntityCommissionSummary('agent', agentId);

  if (isError || (!agent && !isLoading)) {
    return <ErrorCard title="We couldn't load this agent" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && !agent) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const m = metrics || {};
  const isActive = (agent?.status || 'active') !== 'inactive';

  return (
    <>
      {/* Profile */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Agent">
        <div className={styles.acct}>
          <div className={styles.acctAv} aria-hidden="true">{initials(agent?.name)}</div>
          <div style={{ minWidth: 0 }}>
            <div className={styles.acctNm}>{agent?.name}</div>
            <div className={styles.acctMt} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {agent?.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{PhoneIcon}{agent.phone}</span>}
              {agent?.rating != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--color-amber-ink, #8A6209)' }}>
                  {StarIcon}{Number(agent.rating).toFixed(1)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
          {agent?.performance != null && <span className={styles.tag}>{agent.performance}% performance</span>}
          {agent?.employeeId && <span className={styles.tag}>{agent.employeeId}</span>}
        </div>
      </section>

      {/* KPI grid */}
      <div className={styles.mGrid}>
        <div className={styles.mCell}><div className={styles.lbl}>Subscribers</div><div className={styles.v}>{formatNumber(m.totalSubscribers || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Active rate</div><div className={styles.v}>{Math.round(m.activeRate || 0)}%</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Contributions</div><div className={styles.v}>{formatUGX(m.totalContributions || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Funds under mgmt</div><div className={styles.v}>{formatUGX(m.aum || 0)}</div></div>
      </div>

      {/* Branch assignment */}
      <section className={styles.card} aria-label="Branch assignment">
        <header className={styles.cardHd}><h3>Branch assignment</h3></header>
        <div className={styles.kv}><span className={styles.kvK}>Branch</span><span className={styles.kvV}>{branch?.name || '—'}</span></div>
        {agent?.center && <div className={styles.kv}><span className={styles.kvK}>Center</span><span className={styles.kvV}>{agent.center}</span></div>}
        {agent?.employeeId && <div className={styles.kv}><span className={styles.kvK}>Employee ID</span><span className={styles.kvV}>{agent.employeeId}</span></div>}
      </section>

      {/* Commissions */}
      {commission && (commission.total > 0 || commission.totalDue > 0) && (
        <section className={styles.card} aria-label="Commissions">
          <header className={styles.cardHd}><h3>Commissions</h3><span className={styles.tag}>{commission.settlementRate}% settled</span></header>
          <div className={styles.totchips}>
            <div className={styles.totchip}><small>Settled</small><b>{formatUGXShort(commission.totalPaid || 0)}</b></div>
            <div className={styles.totchip}><small>Due</small><b>{formatUGXShort(commission.totalDue || 0)}</b></div>
            <div className={`${styles.totchip} ${styles.totchipGrand}`}><small>Total</small><b>{formatUGXShort(commission.total || 0)}</b></div>
          </div>
        </section>
      )}
    </>
  );
}
