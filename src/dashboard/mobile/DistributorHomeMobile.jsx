import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  useEntityMetrics,
  useChildren,
  useChildrenMetrics,
  useTopEntities,
} from '../../hooks/useEntity';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import styles from './distributorMobile.module.css';

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
const WalletIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 9h19M16 12h2.5" />
  </svg>
);
const PinIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" />
  </svg>
);

function scoreLabel(s) {
  if (s >= 75) return 'Strong';
  if (s >= 60) return 'Good';
  if (s >= 45) return 'Fair';
  return 'Needs work';
}

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

/* Compact light gauge — mirrors DistributorOverview's ring, sized to the mobile
   84px home card. */
function HomeGauge({ value }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value || 0));
  const offset = c * (1 - clamped / 100);
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r={r} fill="none" stroke="#EEF0FA" strokeWidth="9" />
      <circle
        cx="42" cy="42" r={r} fill="none" stroke="url(#distHomeGaugeGrad)" strokeWidth="9"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
      />
      <defs>
        <linearGradient id="distHomeGaugeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-indigo-soft)" />
          <stop offset="1" stopColor="var(--color-indigo)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * DistributorHomeMobile — the distributor-admin PHONE home (<1024px) and the
 * REFERENCE pattern for the other distributor mobile pages. Mirrors
 * DistributorOverview's data wiring (country rollup + the 0077 top-N RPC +
 * commission summary + region coverage) but renders the trimmed mobile Home:
 * a grad hero (Funds under management + this-month delta + a 4-up strip), a
 * Needs-attention card, a compact Network health score, and Top branches /
 * Top agents lists.
 */
export default function DistributorHomeMobile() {
  const { user } = useAuth();

  const { data: metrics = {}, isLoading, isError, error, refetch } = useEntityMetrics('country', 'ug');
  const { data: regions = [] } = useChildren('country', 'ug');
  const { data: regionMetrics = {} } = useChildrenMetrics('country', 'ug');
  const { data: commission } = useEntityCommissionSummary('country', 'ug');
  const { data: topBranches = [] } = useTopEntities('branch', 'aum', 5);
  const { data: topAgents = [] } = useTopEntities('agent', 'contributions', 5);

  const m = metrics ?? {};
  const subs = m.totalSubscribers || 0;
  const activeRate = Math.round(m.activeRate || 0);
  const active = Math.round((subs * (m.activeRate || 0)) / 100);
  const inactive = Math.max(0, subs - active);
  const agentCount = m.totalAgents || 0;
  const branchCount = m.totalBranches || 0;
  const aum = m.aum || 0;

  const monthly = Array.isArray(m.monthlyContributions) ? m.monthlyContributions : [];
  const thisMonth = monthly.length ? monthly[monthly.length - 1] : 0;
  const lastMonth = monthly.length > 1 ? monthly[monthly.length - 2] : 0;
  const monthChange = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

  // Network health = the active-contribution rate (the always-populated signal,
  // same choice as DistributorOverview).
  const health = activeRate;

  const emptyRegions = useMemo(
    () => regions.filter((r) => (regionMetrics[r.id]?.totalSubscribers ?? 0) === 0),
    [regions, regionMetrics],
  );

  if (isError) {
    return <ErrorCard title="We couldn't load your network" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && !subs) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const firstName = (user?.name || 'Distributor Admin').split(' ')[0];

  return (
    <>
      {/* HERO — funds under management */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Network overview">
        <div className={styles.greetLine}>
          <b>Welcome back, {firstName}</b> · National Network
        </div>
        <div className={styles.frame}>
          <div className={styles.frameLbl}>Funds under management · total subscriber savings</div>
          <div className={styles.heroVal}>UGX {formatUGXShort(aum)}</div>
          {thisMonth > 0 && (
            <div className={styles.frameSub}>
              {monthChange != null && (
                <span className={`${styles.delta} ${monthChange >= 0 ? styles.up : styles.down}`}>
                  {monthChange >= 0 ? '▲' : '▼'} {Math.abs(monthChange)}%
                </span>
              )}
              UGX {formatUGXShort(thisMonth)} contributed this month
            </div>
          )}
        </div>
        <div className={`${styles.statStrip} ${styles.statStrip4}`}>
          <NavLink to="/dashboard/subscribers" aria-label="View subscribers">
            <b>{formatNumber(subs)}</b>
            <small>Subscribers</small>
          </NavLink>
          <div>
            <b className={styles.g}>{activeRate}%</b>
            <small>Active rate</small>
          </div>
          <NavLink to="/dashboard/agents" aria-label="View agents">
            <b>{formatNumber(agentCount)}</b>
            <small>Agents</small>
          </NavLink>
          <NavLink to="/dashboard/branches" aria-label="View branches">
            <b>{formatNumber(branchCount)}</b>
            <small>Branches</small>
          </NavLink>
        </div>
      </section>

      {/* NEEDS ATTENTION */}
      <section className={styles.card} aria-label="Needs attention">
        <header className={styles.cardHd}><h3>Needs attention</h3></header>
        <NavLink to="/dashboard/subscribers" className={styles.lrow} aria-label={`Dormant subscribers: ${formatNumber(inactive)}`}>
          <span className={`${styles.lIc} ${styles.tintAmber}`} aria-hidden="true">{AlertIcon}</span>
          <span className={styles.lMid}>
            <b>Dormant subscribers</b>
            <small>No recent contribution</small>
          </span>
          <span className={styles.attnNum}>{formatNumber(inactive)}</span>
          <span className={styles.chev}>{ChevIcon}</span>
        </NavLink>
        {commission && commission.totalDue > 0 && (
          <NavLink to="/dashboard/commissions" className={styles.lrow} aria-label="Commissions due">
            <span className={`${styles.lIc} ${styles.tintIndigo}`} aria-hidden="true">{WalletIcon}</span>
            <span className={styles.lMid}>
              <b>Commissions due</b>
              <small>{commission.settlementRate}% settled this cycle</small>
            </span>
            <span className={styles.lAmt} style={{ fontSize: 14 }}>{formatUGX(commission.totalDue)}</span>
            <span className={styles.chev}>{ChevIcon}</span>
          </NavLink>
        )}
        {emptyRegions.length > 0 && (
          <NavLink to="/dashboard/branches" className={styles.lrow} aria-label="Regions with no members">
            <span className={`${styles.lIc} ${styles.tintRed}`} aria-hidden="true">{PinIcon}</span>
            <span className={styles.lMid}>
              <b>{emptyRegions.length === 1 ? 'Region with no members' : 'Regions with no members'}</b>
              <small>{emptyRegions.map((r) => r.name).join(' · ')} — coverage gap</small>
            </span>
            <span className={styles.attnNum}>{emptyRegions.length}</span>
            <span className={styles.chev}>{ChevIcon}</span>
          </NavLink>
        )}
      </section>

      {/* NETWORK HEALTH SCORE — compact */}
      <section className={styles.card} aria-label="Network health score">
        <header className={styles.cardHd} style={{ marginBottom: 8 }}>
          <h3>Network health score</h3>
          <span className={styles.tag}>Daily</span>
        </header>
        <div className={styles.scoreRow}>
          <div className={styles.gauge}>
            <HomeGauge value={health} />
            <div className={styles.gaugeMid}>
              <span className={styles.gaugeNum}>{health}</span>
              <span className={styles.gaugeQ}>{scoreLabel(health)}</span>
            </div>
          </div>
          <div className={styles.scoreSide}>
            <div className={styles.scoreLbl}>Score · out of 100</div>
            <div className={styles.sChips}>
              <span className={styles.sChip} data-tone="active">{formatNumber(active)} active members</span>
              <span className={styles.sChip}>{formatNumber(branchCount)} branches</span>
            </div>
            <p className={styles.scoreNote}>
              Driven by a {activeRate}% active-contribution rate across {formatNumber(subs)} members.
            </p>
          </div>
        </div>
      </section>

      {/* TOP BRANCHES */}
      <section className={styles.card} aria-label="Top branches">
        <header className={styles.cardHd}>
          <h3>Top branches</h3>
          <NavLink to="/dashboard/branches" className={styles.link}>View all</NavLink>
        </header>
        {topBranches.map((b) => {
          const bm = b.m || {};
          const rate = Math.round(bm.activeRate || 0);
          return (
            <NavLink to={`/dashboard/branches/${b.id}`} key={b.id} className={styles.lrow}>
              <span className={styles.av} aria-hidden="true">{initials(b.name)}</span>
              <span className={styles.lMid}>
                <b>{b.name}</b>
                <small>{b.parentName || '—'} · {formatNumber(bm.totalSubscribers || 0)} subs · {rate}% active</small>
              </span>
              <span className={styles.lEnd}>
                <span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(bm.aum || 0)}</span>
              </span>
              <span className={styles.chev}>{ChevIcon}</span>
            </NavLink>
          );
        })}
        {topBranches.length === 0 && <p className={styles.scoreNote}>No branches yet.</p>}
      </section>

      {/* TOP AGENTS */}
      <section className={styles.card} aria-label="Top agents">
        <header className={styles.cardHd}>
          <h3>Top agents</h3>
          <NavLink to="/dashboard/agents" className={styles.link}>View all</NavLink>
        </header>
        {topAgents.map((a) => {
          const am = a.m || {};
          return (
            <NavLink to={`/dashboard/agents/${a.id}`} key={a.id} className={styles.lrow}>
              <span className={styles.av} data-tone="teal" aria-hidden="true">{initials(a.name)}</span>
              <span className={styles.lMid}>
                <b>{a.name}</b>
                <small>{a.parentName || '—'} · {formatNumber(am.totalSubscribers || 0)} subs</small>
              </span>
              <span className={styles.lEnd}>
                <span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(am.totalContributions || 0)}</span>
              </span>
              <span className={styles.chev}>{ChevIcon}</span>
            </NavLink>
          );
        })}
        {topAgents.length === 0 && <p className={styles.scoreNote}>No agents yet.</p>}
      </section>
    </>
  );
}
