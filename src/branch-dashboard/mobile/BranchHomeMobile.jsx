import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useEntity, useChildren, useEntityMetrics, useChildrenMetrics, useBranchPendingContributions } from '../../hooks/useEntity';
import { formatUGXShort, formatNumber } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import {
  deriveMetrics,
  calcScore,
  scoreLabel,
  monthlyContribStat,
  computeAttention,
  attentionRouteMobile,
  topAgent,
} from '../overview/branchOverviewDerive';
import styles from './branchMobile.module.css';

const ChevIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const AlertIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
  </svg>
);
const CheckIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
const RankIcon = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9V2h12v7a6 6 0 0 1-12 0z" />
    <path d="M6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M9 22h6M12 16v6" />
  </svg>
);

/* Local light-theme gauge — mirrors OverviewDesktop's BranchGauge, sized to the
   mockup's compact 84px Home card ring. */
function BranchGauge({ value }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value || 0));
  const offset = c * (1 - clamped / 100);
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r={r} fill="none" stroke="#EEF0FA" strokeWidth="9" />
      <circle
        cx="42" cy="42" r={r} fill="none" stroke="url(#branchHomeGaugeGrad)" strokeWidth="9"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
      />
      <defs>
        <linearGradient id="branchHomeGaugeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-indigo-soft)" />
          <stop offset="1" stopColor="var(--color-indigo)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * BranchHomeMobile — the branch admin PHONE home (<1024px) and the REFERENCE
 * pattern for the other mobile pages. Mirrors OverviewDesktop's data wiring
 * (useEntity / useEntityMetrics / useChildren / useChildrenMetrics merged +
 * branchOverviewDerive) but renders the trimmed approved-mockup Home: a grad hero
 * (greeting + framed Funds under management + this-month contribution delta +
 * a Subscribers/Active/Agents strip), a Needs-attention card, a compact Branch
 * health score, and a top-3 Your-team card. No contributions chart, no today's
 * snapshot (intentionally trimmed per the mockup).
 */
export default function BranchHomeMobile() {
  const { user } = useAuth();
  const { branchId } = useBranchScope();

  const { data: branch, isLoading, isError, error, refetch } = useEntity('branch', branchId);
  const { data: metrics = {} } = useEntityMetrics('branch', branchId);
  const { data: agentsRaw = [], isError: agentsError, refetch: refetchAgents } = useChildren('branch', branchId);
  const { data: agentMetricsMap = {} } = useChildrenMetrics('branch', branchId);
  const { data: pending } = useBranchPendingContributions(branchId);

  const agents = useMemo(
    () => agentsRaw.map((a) => ({ ...a, metrics: agentMetricsMap[a.id] ?? a.metrics })),
    [agentsRaw, agentMetricsMap],
  );

  const derived = useMemo(() => deriveMetrics(metrics, agents), [metrics, agents]);
  const score = useMemo(() => calcScore(derived), [derived]);
  const month = useMemo(() => monthlyContribStat(metrics), [metrics]);
  const attention = useMemo(
    () => computeAttention(metrics, agents, { overdue: pending?.total || 0 }),
    [metrics, agents, pending],
  );
  const top = useMemo(() => topAgent(agents), [agents]);

  const team = useMemo(
    () =>
      [...agents]
        .sort((a, b) => (b.metrics?.totalContributions || 0) - (a.metrics?.totalContributions || 0))
        .slice(0, 3),
    [agents],
  );

  if (isError || agentsError || (!branch && !isLoading)) {
    return (
      <ErrorCard
        title="We couldn't load your branch"
        message={error}
        onRetry={() => { refetch(); refetchAgents(); }}
      />
    );
  }

  if (isLoading && !branch) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const managerName = (user?.name || branch?.managerName || 'Branch Admin').split(' ')[0];
  const activePct = derived.totalSubs > 0 ? Math.round((derived.activeSubs / derived.totalSubs) * 100) : 0;
  // computeAttention only ever emits 'ok' or 'warning' severities, so the row
  // tint is a two-way split (green when clear, amber when it needs attention).
  const tone = (sev) => (sev === 'ok' ? styles.tintGreen : styles.tintAmber);

  return (
    <>
      {/* HERO — funds under management */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Branch overview">
        <div className={styles.greetLine}>
          <b>Welcome back, {managerName}</b>
          {branch?.name ? ` · ${branch.name}` : ''}
        </div>
        <div className={styles.frame}>
          <div className={styles.frameLbl}>Funds under management · total subscriber savings</div>
          <div className={styles.heroVal}>UGX {formatUGXShort(metrics.aum || 0)}</div>
          {month.current > 0 && (
            <div className={styles.frameSub}>
              {month.prev > 0 && (
                <span className={`${styles.delta} ${month.changePct >= 0 ? styles.up : styles.down}`}>
                  {month.changePct >= 0 ? '▲' : '▼'} {Math.abs(month.changePct)}%
                </span>
              )}
              UGX {formatUGXShort(month.current)} contributed this month
            </div>
          )}
        </div>
        <div className={styles.statStrip}>
          <NavLink to="/dashboard/analytics" aria-label="View subscribers analytics">
            <b>{formatNumber(derived.totalSubs)}</b>
            <small>Subscriber{derived.totalSubs === 1 ? '' : 's'}</small>
          </NavLink>
          <div>
            <b className="g">{activePct}%</b>
            <small>Active rate</small>
          </div>
          <NavLink to="/dashboard/agents" aria-label="View agents">
            <b>{formatNumber(agents.length)}</b>
            <small>Agent{agents.length === 1 ? '' : 's'}</small>
          </NavLink>
        </div>
      </section>

      {/* NEEDS ATTENTION */}
      <section className={styles.card} aria-label="Needs attention">
        <header className={styles.cardHd}><h3>Needs attention</h3></header>
        {attention.map((a) => (
          <NavLink
            to={attentionRouteMobile(a.type)}
            key={a.label}
            className={styles.lrow}
            aria-label={`${a.label}: ${formatNumber(a.value)} — review`}
          >
            <span className={`${styles.lIc} ${tone(a.severity)}`} aria-hidden="true">
              {a.severity === 'ok' ? CheckIcon : AlertIcon}
            </span>
            <span className={styles.lMid}>
              <b>{a.label}</b>
              <small>{a.sub}</small>
            </span>
            <span className={styles.attnNum}>{a.severity === 'ok' ? '0' : formatNumber(a.value)}</span>
            <span className={styles.chev}>{ChevIcon}</span>
          </NavLink>
        ))}
      </section>

      {/* BRANCH HEALTH SCORE — compact */}
      <section className={styles.card} aria-label="Branch health score">
        <header className={styles.cardHd} style={{ marginBottom: 8 }}>
          <h3>Branch health score</h3>
          <span className={styles.tag}>Daily</span>
        </header>
        <div className={styles.scoreRow}>
          <div className={styles.gauge}>
            <BranchGauge value={score} />
            <div className={styles.gaugeMid}>
              <span className={styles.gaugeNum}>{score}</span>
              <span className={styles.gaugeQ}>{scoreLabel(score)}</span>
            </div>
          </div>
          <div className={styles.scoreSide}>
            <div className={styles.scoreLbl}>Score · out of 100</div>
            {branch?.districtRank && (
              <div className={styles.sChips}>
                <span className={`${styles.sChip} ${styles.rank}`}>
                  {RankIcon}#{branch.districtRank} of {branch.districtBranchCount} in district
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* YOUR TEAM */}
      <section className={styles.card} aria-label="Your team">
        <header className={styles.cardHd}>
          <h3>Your team</h3>
          <NavLink to="/dashboard/agents" className={styles.link}>View all</NavLink>
        </header>
        {team.map((a) => {
          const m = a.metrics || {};
          const rate = Math.round(m.activeRate || 0);
          const initials = (a.name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
          const isTop = top && a.name === top.name;
          return (
            <NavLink to={`/dashboard/agents/${a.id}`} key={a.id} className={styles.lrow}>
              <span className={styles.av} aria-hidden="true">{initials}</span>
              <span className={styles.lMid}>
                <b>{a.name}</b>
                <small>{formatNumber(m.totalSubscribers || 0)} subscribers · {rate}% active</small>
              </span>
              <span className={styles.lEnd}>
                <span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(m.totalContributions || 0)}</span>
                {isTop && (
                  <span className={styles.tag} style={{ color: 'var(--color-green-ink, #1F6B41)' }}>Top</span>
                )}
              </span>
            </NavLink>
          );
        })}
        {team.length === 0 && (
          <p className={styles.scoreNote}>No agents on this branch yet.</p>
        )}
      </section>
    </>
  );
}
