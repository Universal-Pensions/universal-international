import { useMemo } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { useEntity, useEntityMetrics, useChildren, useChildrenMetrics } from '../../hooks/useEntity';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { formatNumber, formatUGX, formatUGXShort } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './distributorMobile.module.css';

const ChevIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const PhoneIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
  </svg>
);

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

/**
 * BranchDetailMobile — one branch (route /dashboard/branches/:branchId). KPI
 * grid + branch admin card + commission settlement summary + the branch's agent
 * roster. Same hooks as the desktop ViewBranches detail so figures never drift.
 */
export default function BranchDetailMobile() {
  const { branchId } = useParams();
  const { data: branch, isLoading, isError, error, refetch } = useEntity('branch', branchId);
  const { data: metrics = {} } = useEntityMetrics('branch', branchId);
  const { data: agentsRaw = [] } = useChildren('branch', branchId);
  const { data: agentMetrics = {} } = useChildrenMetrics('branch', branchId);
  const { data: commission } = useEntityCommissionSummary('branch', branchId);

  const agents = useMemo(
    () => agentsRaw
      .map((a) => ({ ...a, metrics: agentMetrics[a.id] ?? a.metrics ?? {} }))
      .sort((a, b) => (b.metrics?.totalSubscribers || 0) - (a.metrics?.totalSubscribers || 0)),
    [agentsRaw, agentMetrics],
  );

  if (isError || (!branch && !isLoading)) {
    return <ErrorCard title="We couldn't load this branch" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && !branch) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const m = metrics || {};
  const isActive = (branch?.status || 'active') !== 'inactive';

  return (
    <>
      {/* Identity */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Branch">
        <div className={styles.acct}>
          <div className={styles.acctAv} aria-hidden="true">{initials(branch?.name)}</div>
          <div>
            <div className={styles.acctNm}>{branch?.name}</div>
            <div className={styles.acctMt}>Branch{branch?.score != null ? ` · Score ${branch.score}/100` : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span>
          {branch?.districtRank && (
            <span className={styles.tag}>#{branch.districtRank} of {branch.districtBranchCount} in district</span>
          )}
        </div>
      </section>

      {/* KPI grid */}
      <div className={styles.mGrid}>
        <div className={styles.mCell}><div className={styles.lbl}>Subscribers</div><div className={styles.v}>{formatNumber(m.totalSubscribers || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Agents</div><div className={styles.v}>{formatNumber(m.totalAgents || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Funds under mgmt</div><div className={styles.v}>{formatUGX(m.aum || 0)}</div></div>
        <div className={styles.mCell}><div className={styles.lbl}>Active rate</div><div className={styles.v}>{Math.round(m.activeRate || 0)}%</div></div>
      </div>

      {/* Branch admin */}
      {branch?.managerName && (
        <section className={styles.card} aria-label="Branch admin">
          <header className={styles.cardHd}><h3>Branch admin</h3></header>
          <div className={styles.acct}>
            <div className={styles.acctAv} aria-hidden="true">{initials(branch.managerName)}</div>
            <div style={{ minWidth: 0 }}>
              <div className={styles.acctNm} style={{ fontSize: 16 }}>{branch.managerName}</div>
              {branch.managerPhone && (
                <div className={styles.acctMt} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {PhoneIcon} {branch.managerPhone}
                </div>
              )}
              {branch.managerEmail && <div className={styles.acctMt}>{branch.managerEmail}</div>}
            </div>
          </div>
        </section>
      )}

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

      {/* Agents */}
      <section className={styles.card} aria-label="Agents on this branch">
        <header className={styles.cardHd}><h3>Agents</h3><span className={styles.tag}>{formatNumber(agents.length)}</span></header>
        {agents.map((a) => {
          const am = a.metrics || {};
          const agentActive = (a.status || 'active') !== 'inactive';
          return (
            <NavLink to={`/dashboard/agents/${a.id}`} key={a.id} className={styles.lrow}>
              <span className={styles.av} data-tone="teal" aria-hidden="true">{initials(a.name)}</span>
              <span className={styles.lMid}>
                <b>{a.name}</b>
                <small>{formatNumber(am.totalSubscribers || 0)} subs · {a.performance != null ? `${a.performance}% perf` : `${Math.round(am.activeRate || 0)}% active`}</small>
              </span>
              <span className={styles.lEnd}>
                <span className={styles.stBadge} data-status={agentActive ? 'active' : 'inactive'}>{agentActive ? 'Active' : 'Inactive'}</span>
              </span>
              <span className={styles.chev}>{ChevIcon}</span>
            </NavLink>
          );
        })}
        {agents.length === 0 && <p className={styles.scoreNote}>No agents on this branch yet.</p>}
      </section>
    </>
  );
}
