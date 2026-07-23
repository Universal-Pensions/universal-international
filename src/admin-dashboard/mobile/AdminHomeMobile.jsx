import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import {
  usePlatformOverview,
  useEntityMetrics,
  useAllEntities,
  useTopEntities,
} from '../../hooks/useEntity';
import { formatUGXShort, formatNumber } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
// Reuse the distributor mobile vocabulary — the platform's phone look is uniform.
import styles from '../../dashboard/mobile/distributorMobile.module.css';

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
const NodeIcon = (
  <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="5" r="2.2" /><circle cx="5" cy="19" r="2.2" /><circle cx="19" cy="19" r="2.2" /><path d="M12 7.2v3.8M12 11H5.8a1 1 0 0 0-1 1v4.6M12 11h6.2a1 1 0 0 1 1 1v4.6" />
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

function HomeGauge({ value }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value || 0));
  const offset = c * (1 - clamped / 100);
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
      <circle cx="42" cy="42" r={r} fill="none" stroke="#EEF0FA" strokeWidth="9" />
      <circle cx="42" cy="42" r={r} fill="none" stroke="url(#adminHomeGaugeGrad)" strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
      <defs>
        <linearGradient id="adminHomeGaugeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-indigo-soft)" />
          <stop offset="1" stopColor="var(--color-indigo)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * AdminHomeMobile — the super-admin PHONE home (<1024px). Platform-wide framing
 * (usePlatformOverview: subscribers incl. the employer channel, distributor +
 * employer counts, channel split) plus the shared health gauge, top branches /
 * agents (0077 RPC) and needs-attention. Mirrors AdminOverview's data.
 */
export default function AdminHomeMobile() {
  const { data: platform = {}, isLoading, isError, error, refetch } = usePlatformOverview();
  const { data: country = {} } = useEntityMetrics('country', 'ug');
  const { data: distributorsRaw = [] } = useAllEntities('distributor');
  const { data: topBranches = [] } = useTopEntities('branch', 'aum', 5);
  const { data: topAgents = [] } = useTopEntities('agent', 'contributions', 5);

  const p = platform ?? {};
  const subs = p.totalSubscribers || 0;
  const active = p.activeSubscribers || 0;
  const inactive = p.inactiveSubscribers != null ? p.inactiveSubscribers : Math.max(0, subs - active);
  const activeRate = subs > 0 ? Math.round((active / subs) * 100) : 0;
  const aum = p.aum || 0;

  const monthly = Array.isArray(country.monthlyContributions) ? country.monthlyContributions : [];
  const thisMonth = monthly.length ? monthly[monthly.length - 1] : 0;
  const lastMonth = monthly.length > 1 ? monthly[monthly.length - 2] : 0;
  const monthChange = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

  const health = activeRate;
  const inactiveDistributors = useMemo(
    () => distributorsRaw.filter((d) => d.status === 'inactive'),
    [distributorsRaw],
  );

  if (isError) {
    return <ErrorCard title="We couldn't load the platform" message={error} onRetry={() => refetch()} />;
  }
  if (isLoading && !subs) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  return (
    <>
      {/* HERO */}
      <section className={`${styles.card} ${styles.cardGrad}`} aria-label="Platform overview">
        <div className={styles.greetLine}>
          <b>National Platform</b> · all channels
        </div>
        <div className={styles.frame}>
          <div className={styles.frameLbl}>Funds under management · platform-wide savings</div>
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
            <b>{formatNumber(subs)}</b><small>Subscribers</small>
          </NavLink>
          <div><b className={styles.g}>{activeRate}%</b><small>Active rate</small></div>
          <NavLink to="/dashboard/agents" aria-label="View agents">
            <b>{formatNumber(p.agents || 0)}</b><small>Agents</small>
          </NavLink>
          <NavLink to="/dashboard/branches" aria-label="View branches">
            <b>{formatNumber(p.branches || 0)}</b><small>Branches</small>
          </NavLink>
        </div>
      </section>

      {/* PLATFORM NETWORK */}
      <section className={styles.card} aria-label="Platform network">
        <header className={styles.cardHd}><h3>Platform network</h3></header>
        <NavLink to="/dashboard/distributors" className={styles.lrow}>
          <span className={`${styles.lIc} ${styles.tintIndigo}`} aria-hidden="true">{NodeIcon}</span>
          <span className={styles.lMid}><b>Distributors</b><small>Network operators</small></span>
          <span className={styles.attnNum}>{formatNumber(p.distributors || 0)}</span>
          <span className={styles.chev}>{ChevIcon}</span>
        </NavLink>
        <NavLink to="/dashboard/employers" className={styles.lrow}>
          <span className={`${styles.lIc} ${styles.tintTeal}`} aria-hidden="true">{NodeIcon}</span>
          <span className={styles.lMid}><b>Employers</b><small>B2B pension accounts</small></span>
          <span className={styles.attnNum}>{formatNumber(p.employers || 0)}</span>
          <span className={styles.chev}>{ChevIcon}</span>
        </NavLink>
      </section>

      {/* CHANNELS */}
      <section className={styles.card} aria-label="Acquisition channels">
        <header className={styles.cardHd} style={{ marginBottom: 8 }}><h3>Where members come from</h3></header>
        <div className={styles.statStrip}>
          <div><b>{formatNumber(p.subscribersViaDistributor || 0)}</b><small>Via agents</small></div>
          <div><b>{formatNumber(p.subscribersViaEmployer || 0)}</b><small>Via employers</small></div>
          <div><b>{formatNumber(p.subscribersDirect || 0)}</b><small>Direct</small></div>
        </div>
      </section>

      {/* NEEDS ATTENTION */}
      <section className={styles.card} aria-label="Needs attention">
        <header className={styles.cardHd}><h3>Needs attention</h3></header>
        <NavLink to="/dashboard/subscribers" className={styles.lrow}>
          <span className={`${styles.lIc} ${styles.tintAmber}`} aria-hidden="true">{AlertIcon}</span>
          <span className={styles.lMid}><b>Dormant subscribers</b><small>No recent contribution</small></span>
          <span className={styles.attnNum}>{formatNumber(inactive)}</span>
          <span className={styles.chev}>{ChevIcon}</span>
        </NavLink>
        {inactiveDistributors.length > 0 && (
          <NavLink to="/dashboard/distributors" className={styles.lrow}>
            <span className={`${styles.lIc} ${styles.tintRed}`} aria-hidden="true">{AlertIcon}</span>
            <span className={styles.lMid}><b>{inactiveDistributors.length === 1 ? 'Inactive distributor' : 'Inactive distributors'}</b><small>Deactivated network operators</small></span>
            <span className={styles.attnNum}>{inactiveDistributors.length}</span>
            <span className={styles.chev}>{ChevIcon}</span>
          </NavLink>
        )}
      </section>

      {/* NETWORK HEALTH */}
      <section className={styles.card} aria-label="Network health score">
        <header className={styles.cardHd} style={{ marginBottom: 8 }}>
          <h3>Network health score</h3><span className={styles.tag}>Daily</span>
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
              <span className={styles.sChip}>{formatNumber(p.branches || 0)} branches</span>
            </div>
            <p className={styles.scoreNote}>
              Driven by a {activeRate}% active-contribution rate across {formatNumber(subs)} members platform-wide.
            </p>
          </div>
        </div>
      </section>

      {/* TOP BRANCHES */}
      <section className={styles.card} aria-label="Top branches">
        <header className={styles.cardHd}><h3>Top branches</h3><NavLink to="/dashboard/branches" className={styles.link}>View all</NavLink></header>
        {topBranches.map((b) => {
          const bm = b.m || {};
          const rate = Math.round(bm.activeRate || 0);
          return (
            <NavLink to={`/dashboard/branches/${b.id}`} key={b.id} className={styles.lrow}>
              <span className={styles.av} aria-hidden="true">{initials(b.name)}</span>
              <span className={styles.lMid}><b>{b.name}</b><small>{b.parentName || '—'} · {formatNumber(bm.totalSubscribers || 0)} subs · {rate}% active</small></span>
              <span className={styles.lEnd}><span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(bm.aum || 0)}</span></span>
              <span className={styles.chev}>{ChevIcon}</span>
            </NavLink>
          );
        })}
        {topBranches.length === 0 && <p className={styles.scoreNote}>No branches yet.</p>}
      </section>

      {/* TOP AGENTS */}
      <section className={styles.card} aria-label="Top agents">
        <header className={styles.cardHd}><h3>Top agents</h3><NavLink to="/dashboard/agents" className={styles.link}>View all</NavLink></header>
        {topAgents.map((a) => {
          const am = a.m || {};
          return (
            <NavLink to={`/dashboard/agents/${a.id}`} key={a.id} className={styles.lrow}>
              <span className={styles.av} data-tone="teal" aria-hidden="true">{initials(a.name)}</span>
              <span className={styles.lMid}><b>{a.name}</b><small>{a.parentName || '—'} · {formatNumber(am.totalSubscribers || 0)} subs</small></span>
              <span className={styles.lEnd}><span className={styles.lAmt} style={{ fontSize: 13 }}>{formatUGXShort(am.totalContributions || 0)}</span></span>
              <span className={styles.chev}>{ChevIcon}</span>
            </NavLink>
          );
        })}
        {topAgents.length === 0 && <p className={styles.scoreNote}>No agents yet.</p>}
      </section>
    </>
  );
}
