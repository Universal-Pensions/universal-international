import { useMemo } from 'react';
import { useParams, NavLink } from 'react-router-dom';
import { useEntity, useEntityMetrics } from '../../hooks/useEntity';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './branchMobile.module.css';

/* ── Inline icons (stroke = currentColor, sized to the mockup) ───────────── */
const PhoneIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
  </svg>
);
const EnrolIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" />
  </svg>
);
const CashIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);
const CalIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
  </svg>
);
const BackIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);
const ChevIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
}

/**
 * AgentDetailMobile — branch admin PHONE per-agent detail (route `agents/:agentId`).
 * Mirrors AgentDetailDesktop's data wiring (useEntity('agent',id) +
 * useEntityMetrics('agent',id) + useEntityCommissionSummary('agent',id)) and the
 * approved mockup's "Agent detail" screen: grad header (avatar + name +
 * specialty·tenure + status/Top/phone pills), an mGrid metric block, a
 * Commission-this-cycle card with a settlement bar, an onboarding-activity list
 * (real metric counts; omitted when empty), and Call / Back buttons.
 *
 * DATA-HONESTY: metric-cell subs/active-rate carry no fabricated multiplier or
 * benchmark; contributions = lifetime collected (the real field). The mockup's
 * "this month / joined Dec 2024 / on track for the 30 Jun run / 87% settlement
 * delta" copy + the synthetic "Recent activity" feed have no real source, so
 * they are dropped — the activity list uses the genuine onboarding counts.
 */
export default function AgentDetailMobile() {
  const { agentId } = useParams();

  const { data: agent, isLoading, isError, error, refetch } = useEntity('agent', agentId);
  const { data: metrics = {} } = useEntityMetrics('agent', agentId);
  const { data: commission } = useEntityCommissionSummary('agent', agentId);

  const activity = useMemo(() => {
    const m = metrics || {};
    return [
      { key: 'today', label: 'Enrolled today', sub: 'New subscribers', value: m.newSubscribersToday, icon: EnrolIcon, tone: styles.tintGreen },
      { key: 'week', label: 'Enrolled this week', sub: 'New subscribers', value: m.newSubscribersThisWeek, icon: EnrolIcon, tone: styles.tintTeal },
      { key: 'month', label: 'Enrolled this month', sub: 'New subscribers', value: m.newSubscribersThisMonth, icon: CalIcon, tone: styles.tintIndigo },
    ].filter((a) => typeof a.value === 'number');
  }, [metrics]);

  if (isError) {
    return (
      <ErrorCard
        title="We couldn't load this agent"
        message={error}
        onRetry={refetch}
      />
    );
  }

  if (isLoading && !agent) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  /* Graceful not-found — agent isn't on this branch (or no longer exists). */
  if (!agent) {
    return (
      <section className={styles.card} aria-label="Agent not found">
        <header className={styles.cardHd}><h3>Agent not found</h3></header>
        <p className={styles.scoreNote}>
          That agent isn&apos;t part of your branch, or no longer exists.
        </p>
        <NavLink to="/dashboard/agents" className={`${styles.btn} ${styles.btnSec} ${styles.btnBlock}`} style={{ marginTop: 12 }}>
          {BackIcon} Back to team
        </NavLink>
      </section>
    );
  }

  const m = metrics || {};
  const active = agent.status === 'active';
  const totalSubs = m.totalSubscribers || 0;
  const activeRate = Math.round(m.activeRate || 0);
  const tenure = typeof agent.tenureMonths === 'number' ? agent.tenureMonths : null;
  const specialty = agent.specialties?.[0] || 'Field agent';
  const phone = agent.phone || null;

  // Commission this cycle — real per-agent summary (paid / due + settlement %).
  const paid = commission?.totalPaid || 0;
  const due = commission?.totalDue || 0;
  const settlementRate = Math.round(commission?.settlementRate || 0);
  const hasCommission = paid > 0 || due > 0;

  const statusTone = active ? styles.ok : styles.off;

  return (
    <>
      {/* HEADER — identity */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Agent profile">
        <div className={styles.acct}>
          <span className={styles.acctAv} aria-hidden="true">{initials(agent.name)}</span>
          <div>
            <div className={styles.acctNm}>{agent.name}</div>
            <div className={styles.acctMt}>
              {specialty}{tenure != null ? ` · ${tenure} month${tenure === 1 ? '' : 's'}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className={`${styles.pill} ${statusTone}`}><i />{active ? 'Active' : 'Inactive'}</span>
          {phone && <span className={styles.tag}>{phone}</span>}
        </div>
      </section>

      {/* METRIC GRID */}
      <div className={styles.mGrid}>
        <div className={styles.mCell}>
          <div className="lbl">Subscribers</div>
          <div className="v">{formatNumber(totalSubs)}</div>
          <div className="sub">On this agent</div>
        </div>
        <div className={styles.mCell}>
          <div className="lbl">Active rate</div>
          <div className="v">{activeRate}%</div>
          <div className="sub">Contributing recently</div>
        </div>
        <div className={styles.mCell}>
          <div className="lbl">Contributions</div>
          <div className="v">{formatUGXShort(m.totalContributions || 0)}</div>
          <div className="sub">Lifetime collected</div>
        </div>
        <div className={styles.mCell}>
          <div className="lbl">Tenure</div>
          <div className="v">{tenure != null ? <>{tenure}<small> mo</small></> : '—'}</div>
          <div className="sub">{tenure != null ? 'With the branch' : 'Not on file'}</div>
        </div>
      </div>

      {/* COMMISSION — this cycle */}
      <section className={styles.card} aria-label="Commission this cycle">
        <header className={styles.cardHd}><h3>Commission · this cycle</h3></header>
        {hasCommission ? (
          <>
            <div className={styles.kv}>
              <span className={styles.kvK}>Paid so far</span>
              <span className={styles.kvV}>{formatUGX(paid)}</span>
            </div>
            <div className={styles.kv}>
              <span className={styles.kvK}>Currently due</span>
              <span className={styles.kvV}>{formatUGX(due)}</span>
            </div>
            <div className={styles.comBar} style={{ marginTop: 14 }}>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${Math.min(100, settlementRate)}%` }} />
              </div>
              <span className={styles.comBarPc}>{settlementRate}%</span>
            </div>
            <p className={styles.scoreNote} style={{ marginTop: 8 }}>
              Settlement rate — share of this agent&apos;s commission already paid out.
            </p>
          </>
        ) : (
          <p className={styles.scoreNote} style={{ marginTop: 0 }}>
            No commission recorded for this agent yet.
          </p>
        )}
      </section>

      {/* ONBOARDING ACTIVITY — real metric counts (omitted when unavailable) */}
      {activity.length > 0 && (
        <section className={styles.card} aria-label="Onboarding activity">
          <header className={styles.cardHd}><h3>Onboarding activity</h3></header>
          {activity.map((a) => (
            <div key={a.key} className={styles.lrow} style={{ cursor: 'default' }}>
              <span className={`${styles.lIc} ${a.tone}`} aria-hidden="true">{a.icon}</span>
              <span className={styles.lMid}>
                <b>{a.label}</b>
                <small>{a.sub}</small>
              </span>
              <span className={styles.attnNum}>{formatNumber(a.value)}</span>
            </div>
          ))}
        </section>
      )}

      {/* Drill deeper: this agent's own subscribers (AUDIT A12-005 — the branch
          desktop shell already has this via AgentDetailDesktop; the phone shell
          had no way to reach /dashboard/agents/:id/subscribers at all). */}
      <NavLink
        to={`/dashboard/agents/${agentId}/subscribers`}
        className={styles.lrow}
        aria-label={`View subscribers for ${agent.name}`}
      >
        <span className={`${styles.lIc} ${styles.tintIndigo}`} aria-hidden="true">{EnrolIcon}</span>
        <span className={styles.lMid}>
          <b>View subscribers</b>
          <small>{formatNumber(totalSubs)} on this agent</small>
        </span>
        <span className={styles.chev}>{ChevIcon}</span>
      </NavLink>

      {/* ACTIONS */}
      <div className={styles.btnRow}>
        {phone ? (
          <a
            href={`tel:${phone.replace(/\s+/g, '')}`}
            className={`${styles.btn} ${styles.btnSec}`}
            aria-label={`Call ${agent.name}`}
          >
            {PhoneIcon} Call
          </a>
        ) : (
          <span className={`${styles.btn} ${styles.btnSec}`} aria-disabled="true" style={{ opacity: 0.55, cursor: 'default' }}>
            {PhoneIcon} No phone
          </span>
        )}
        <NavLink to="/dashboard/agents" className={`${styles.btn} ${styles.btnSec}`} aria-label="Back to team">
          Back to team
        </NavLink>
      </div>
    </>
  );
}
