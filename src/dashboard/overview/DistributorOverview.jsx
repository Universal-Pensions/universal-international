import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDashboard } from '../../contexts/DashboardContext';
import {
  useEntityMetrics,
  useAllEntities,
  useAllEntitiesMap,
  useChildren,
  useChildrenMetrics,
  useTopEntities,
  useEntity,
} from '../../hooks/useEntity';
import { useAuth } from '../../contexts/AuthContext';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { formatUGX, formatNumber } from '../../utils/currency';
import { EASE_OUT_EXPO as EASE } from '../../utils/motion';
import MiniChart from '../shared/MiniChart';
import styles from './DistributorOverview.module.css';

/* ── Inline icons (a small kit beyond shared/Icons.jsx) ───────────────────── */
const svg = (d, o = {}) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width={o.w || 20} height={o.w || 20}>
    {d}
  </svg>
);
const IC = {
  wallet: svg(<>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
    <path d="M16 12h2.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M2.5 9h19" stroke="currentColor" strokeWidth="1.75" />
  </>),
  coins: svg(<>
    <ellipse cx="8" cy="7" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M2.5 7v5c0 1.4 2.46 2.5 5.5 2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <ellipse cx="16" cy="15" rx="5.5" ry="2.5" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10.5 15v2c0 1.38 2.46 2.5 5.5 2.5s5.5-1.12 5.5-2.5v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </>),
  person: svg(<>
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
    <path d="M5 21v-1a7 7 0 0114 0v1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </>),
  employees: svg(<>
    <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.75" />
    <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <circle cx="18" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.75" />
    <path d="M21 21v-1.5a3 3 0 00-3-3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </>),
  building: svg(<>
    <path d="M3 21h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M5 21V7l7-4 7 4v14" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    <rect x="9" y="13" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.75" />
  </>),
  analytics: svg(<>
    <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 14l4-4 4 4 5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  alert: svg(<>
    <path d="M12 3l9 16H3l9-16z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    <path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </>),
  pending: svg(<>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </>),
  pin: svg(<>
    <path d="M12 21s7-6.3 7-11a7 7 0 10-14 0c0 4.7 7 11 7 11z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.75" />
  </>),
  spark: svg(<>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </>),
  handAdd: svg(<>
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
    <path d="M5 21v-1a7 7 0 0110-6.3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    <path d="M18 15v6M15 18h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </>),
  chevron: (w = 14) => svg(<path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />, { w }),
  up: (w = 12) => svg(<path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />, { w }),
  down: (w = 12) => svg(<path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />, { w }),
};

function initials(name = '') {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function scoreQuality(s) {
  if (s >= 75) return 'Strong';
  if (s >= 60) return 'Good';
  if (s >= 45) return 'Fair';
  return 'Needs work';
}

function Tile({ tone, icon, label, value, sub, subTone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  // Stable test hooks. The tile's accessible name is the whole card
  // ("Subscribers 4,601 3,605 active · 78%"), so a name regex can't isolate the
  // count and digit-stripping the label would concatenate value + sub into
  // nonsense. These give the KPI contract an explicit handle that survives copy
  // and ordering changes — see distributor-renders-data.spec.ts.
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <Tag
      className={styles.tile}
      data-tone={tone}
      data-clickable={onClick ? 'true' : undefined}
      data-testid={`kpi-${slug}`}
      onClick={onClick}
    >
      <span className={styles.tileIcon}>{icon}</span>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue} data-testid={`kpi-${slug}-value`}>{value}</span>
      {sub != null && <span className={styles.tileSub} data-tone={subTone}>{sub}</span>}
    </Tag>
  );
}

/**
 * Rich national dashboard landing for the distributor in dash mode (country
 * level). Ports the map-view mockup's `renderDashboard()` — KPI tiles + health +
 * trend + top branches/agents + needs-attention — onto the app's real rollup
 * data. Region/district drill in dash mode still falls back to OverlayPanel.
 */
export default function DistributorOverview() {
  const {
    drillDown,
    setViewSubscribersOpen,
    setViewAgentsOpen,
    setViewBranchesOpen,
    setCommissionsOpen,
  } = useDashboard();

  const { data: metrics } = useEntityMetrics('country', 'ug');
  // Full branch list is still needed for the "inactive branches" attention row
  // (status only); the top-N tables no longer pull it.
  const { data: branchesRaw = [] } = useAllEntities('branch');
  const { data: regions = [] } = useChildren('country', 'ug');
  const { data: regionMetrics = {} } = useChildrenMetrics('country', 'ug');
  // This distributor's own identity + footprint. `regions` is reference
  // geography (all 4, un-scoped); `branchesRaw` IS scoped to the caller (0084),
  // so the branch list is what tells us where this operator actually trades.
  const { user } = useAuth();
  const distributorId = user?.distributorId ?? 'd-001';
  const { data: distributor } = useEntity('distributor', distributorId);
  const { data: districtsMap = {} } = useAllEntitiesMap('district');
  const { data: commission } = useEntityCommissionSummary('country', 'ug');
  // Bounded server-side top-N (0077) — replaces the old whole-collection pull +
  // client-side sort of every agent/branch just to render two 6-row tables. Rows
  // are display-ready (identity + parent name + metrics).
  const { data: topBranches = [] } = useTopEntities('branch', 'aum', 6);
  const { data: topAgents = [] } = useTopEntities('agent', 'contributions', 6);

  const m = metrics ?? {};
  const subs = m.totalSubscribers || 0;
  const activeRate = Math.round(m.activeRate || 0);
  // `activeRate` is ROUNDed to a whole percent server-side, so reconstructing a
  // headcount from it drifts (5,004 x 79% = 3,953 against a true 3,940). 0082
  // returns the exact count; the multiply is only a pre-0082 fallback.
  const active = m.activeSubscribers ?? Math.round((subs * (m.activeRate || 0)) / 100);
  const inactive = Math.max(0, subs - active);
  const agentCount = m.totalAgents || 0;
  const branchCount = m.totalBranches || 0;
  const aum = m.aum || 0;
  const coverage = Math.round(m.coverageRate || 0);

  const monthly = Array.isArray(m.monthlyContributions) ? m.monthlyContributions : [];
  const monthlyHasData = monthly.some((v) => v > 0);
  const thisMonth = monthly.length ? monthly[monthly.length - 1] : 0;
  const lastMonth = monthly.length > 1 ? monthly[monthly.length - 2] : 0;
  const monthChange = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;

  // Network health = the active-contribution rate — the canonical, always-populated
  // network-health signal (the per-branch `score` mean is dragged down by the
  // zero-member branches in the empty regions, and coverageRate isn't rolled up
  // at country level).
  const health = activeRate;

  // Regions this distributor actually OPERATES IN — i.e. where it owns at least
  // one branch. d-001 is national (4); d-002 runs the Busoga cluster (1).
  const operatedRegions = useMemo(() => {
    const ids = new Set(
      branchesRaw.map((b) => districtsMap[b.parentId]?.parentId).filter(Boolean),
    );
    const hit = regions.filter((r) => ids.has(r.id));
    // Before the branch list resolves, fall back to all regions rather than
    // flashing "0 regions".
    return hit.length ? hit : regions;
  }, [branchesRaw, districtsMap, regions]);

  // A coverage gap only means something inside your OWN footprint. Filtering
  // over all four regions told a regional operator it had "3 regions with no
  // members" — Central, Northern and Western, which it has never traded in and
  // cannot see. That reads as failure rather than as a deliberate territory.
  const emptyRegions = useMemo(
    () => operatedRegions.filter((r) => (regionMetrics[r.id]?.totalSubscribers ?? 0) === 0),
    [operatedRegions, regionMetrics],
  );
  const inactiveBranches = useMemo(
    () => branchesRaw.filter((b) => b.status === 'inactive'),
    [branchesRaw],
  );

  const dash = health / 100;
  const CIRC = 2 * Math.PI * 54;

  return (
    <motion.div
      className={styles.root}
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      {/* ── Header ── */}
      <div className={styles.header}>
        <p className={styles.eyebrow}>Distributor · Network overview</p>
        <div className={styles.titleRow}>
          {/* The operator's OWN name. Hardcoding "National Network" was fine
              while d-001 was the only distributor; it now mislabels every other
              operator's dashboard as the national one. */}
          <h1 className={styles.title}>{distributor?.name || 'National Network'}</h1>
          <span className={styles.roleBadge}><span className={styles.roleDot} />Distributor Admin</span>
        </div>
        <p className={styles.sub}>
          Universal Pensions — Uganda · {formatNumber(operatedRegions.length)}{' '}
          {operatedRegions.length === 1 ? 'region' : 'regions'} · {formatNumber(branchCount)} branches · updated today
        </p>
      </div>

      {/* ── KPI tiles ── */}
      <div className={styles.tiles}>
        <Tile tone="indigo" icon={IC.wallet} label="Funds under management" value={formatUGX(aum)}
          sub={`Across ${formatNumber(operatedRegions.length)} ${operatedRegions.length === 1 ? 'region' : 'regions'} · ${formatNumber(branchCount)} branches`} />
        <Tile tone="green" icon={IC.coins} label="Contributions" value={formatUGX(m.totalContributions || 0)}
          sub={monthChange != null
            ? <span className={styles.chg} data-dir={monthChange >= 0 ? 'up' : 'down'}>{monthChange >= 0 ? IC.up(11) : IC.down(11)}{Math.abs(monthChange)}% this month</span>
            : `${coverage}% coverage`} />
        <Tile tone="teal" icon={IC.person} label="Subscribers" value={formatNumber(subs)}
          sub={`${formatNumber(active)} active · ${activeRate}%`} onClick={() => setViewSubscribersOpen(true)} />
        <Tile tone="indigoSoft" icon={IC.employees} label="Agents" value={formatNumber(agentCount)}
          sub={`Across ${formatNumber(branchCount)} branches`} onClick={() => setViewAgentsOpen(true)} />
      </div>

      {/* ── Split ── */}
      <div className={styles.split}>
        <div className={styles.col}>
          {/* Health score */}
          <section className={styles.card}>
            <div className={styles.cardHead}><span className={styles.cardIc}>{IC.alert}</span>Network Health Score</div>
            <div className={styles.scoreRow}>
              <div className={styles.gauge}>
                <svg width="128" height="128" viewBox="0 0 128 128">
                  <circle cx="64" cy="64" r="54" fill="none" stroke="var(--color-lavender)" strokeWidth="12" />
                  <circle cx="64" cy="64" r="54" fill="none" stroke="url(#doGauge)" strokeWidth="12" strokeLinecap="round"
                    strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - dash)} transform="rotate(-90 64 64)" />
                  <defs>
                    <linearGradient id="doGauge" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#5E63A8" /><stop offset="1" stopColor="#292867" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className={styles.gaugeMid}>
                  <div className={styles.gaugeNum}>{health}</div>
                  <div className={styles.gaugeQ}>{scoreQuality(health)}</div>
                </div>
              </div>
              <div className={styles.scoreMeta}>
                <div className={styles.scoreLabel}>Network score · out of 100</div>
                <div className={styles.scoreChips}>
                  <span className={styles.sChip} data-tone="active">{formatNumber(active)} active members</span>
                  <span className={styles.sChip}>{formatNumber(branchCount)} branches</span>
                </div>
                <p className={styles.scoreText}>
                  Driven by a {activeRate}% active-contribution rate across {formatNumber(subs)} members.
                  {emptyRegions.length > 0
                    ? ` Biggest lever: coverage — ${emptyRegions.length} ${emptyRegions.length === 1 ? 'region has' : 'regions have'} branches and agents in place but no members yet.`
                    : ' Coverage spans every region.'}
                </p>
              </div>
            </div>
          </section>

          {/* Contributions trend */}
          {monthlyHasData && (
            <section className={styles.card}>
              <div className={styles.cardHead}><span className={styles.cardIc} data-tone="teal">{IC.analytics}</span>Contributions — last 12 months</div>
              <div className={styles.trendTop}>
                <b className={styles.trendVal}>{formatUGX(thisMonth)}</b>
                {monthChange != null && (
                  <span className={styles.chg} data-dir={monthChange >= 0 ? 'up' : 'down'}>
                    {monthChange >= 0 ? IC.up() : IC.down()}{Math.abs(monthChange)}% vs last month
                  </span>
                )}
              </div>
              <MiniChart data={monthly} />
            </section>
          )}

          {/* Top branches */}
          <section className={styles.tableCard}>
            <div className={styles.tableHead}>
              <div className={styles.tableTitle}><span className={styles.cardIc}>{IC.building}</span>Top branches</div>
              <button className={styles.tableLink} onClick={() => setViewBranchesOpen(true)}>View all {formatNumber(branchCount)} →</button>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.tbl}>
                <thead>
                  <tr><th>Branch</th><th>District</th><th className={styles.num}>Subscribers</th><th>Active rate</th><th className={styles.num}>FUM</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {topBranches.map((b) => {
                    const bm = b.m || {};
                    const ar = Math.round(bm.activeRate || 0);
                    const isActive = b.status !== 'inactive';
                    return (
                      <tr key={b.id} className={styles.rowAct} onClick={() => drillDown('branch', b.id)} aria-label={`View ${b.name}`}>
                        <td>
                          <span className={styles.member}>
                            <span className={styles.avatar}>{initials(b.name)}</span>
                            <span className={styles.memberText}>
                              <span className={styles.mName}>{b.name}</span>
                              <span className={styles.mSub}>{b.managerName || '—'}</span>
                            </span>
                          </span>
                        </td>
                        <td>{b.parentName || '—'}</td>
                        <td className={styles.num}>{formatNumber(bm.totalSubscribers || 0)}</td>
                        <td><span className={styles.miniBar}><i style={{ width: `${ar}%` }} /></span>{ar}%</td>
                        <td className={styles.num}>{formatUGX(bm.aum || 0)}</td>
                        <td><span className={styles.stBadge} data-status={isActive ? 'active' : 'inactive'}>{isActive ? 'Active' : 'Inactive'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className={styles.col}>
          {/* Needs attention */}
          <section className={styles.card}>
            <div className={styles.cardHead}><span className={styles.cardIc}>{IC.alert}</span>Needs attention</div>
            <div className={styles.attn}>
              <button className={styles.attnRow} onClick={() => setViewSubscribersOpen(true)}>
                <span className={styles.attnIc} data-tone="amber">{IC.pending}</span>
                <span className={styles.attnVal}>{formatNumber(inactive)}</span>
                <span className={styles.attnTx}><span className={styles.attnL}>Dormant subscribers</span><span className={styles.attnS}>No recent contribution</span></span>
                <span className={styles.attnGo}>Review {IC.chevron()}</span>
              </button>
              {commission && commission.totalDue > 0 && (
                <button className={styles.attnRow} onClick={() => setCommissionsOpen(true)}>
                  <span className={styles.attnIc} data-tone="indigo">{IC.wallet}</span>
                  <span className={styles.attnVal}>{formatUGX(commission.totalDue)}</span>
                  <span className={styles.attnTx}><span className={styles.attnL}>Commissions due</span><span className={styles.attnS}>{commission.settlementRate}% settled this cycle</span></span>
                  <span className={styles.attnGo}>Settle {IC.chevron()}</span>
                </button>
              )}
              {emptyRegions.length > 0 && (
                <button className={styles.attnRow} onClick={() => setViewSubscribersOpen(true)}>
                  <span className={styles.attnIc} data-tone="red">{IC.pin}</span>
                  <span className={styles.attnVal}>{emptyRegions.length}</span>
                  <span className={styles.attnTx}><span className={styles.attnL}>Regions with no members</span><span className={styles.attnS}>{emptyRegions.map((r) => r.name).join(' & ')} — coverage gap</span></span>
                  <span className={styles.attnGo}>Review {IC.chevron()}</span>
                </button>
              )}
              {inactiveBranches.length > 0 && (
                <button className={styles.attnRow} onClick={() => setViewBranchesOpen(true)}>
                  <span className={styles.attnIc} data-tone="indigo">{IC.alert}</span>
                  <span className={styles.attnVal}>{inactiveBranches.length}</span>
                  <span className={styles.attnTx}><span className={styles.attnL}>{inactiveBranches.length === 1 ? 'Inactive branch' : 'Inactive branches'}</span><span className={styles.attnS}>{inactiveBranches.slice(0, 2).map((b) => b.name).join(' · ')}{inactiveBranches.length > 2 ? ' …' : ''}</span></span>
                  <span className={styles.attnGo}>Review {IC.chevron()}</span>
                </button>
              )}
            </div>
          </section>

          {/* Today snapshot */}
          <section className={styles.card}>
            <div className={styles.cardHead}><span className={styles.cardIc} data-tone="teal">{IC.spark}</span>Today&rsquo;s snapshot</div>
            <div className={styles.feed}>
              <div className={styles.feedLive}><span className={styles.feedPulse} /> Updated just now</div>
              <div className={styles.fitem}>
                <span className={styles.fic} data-tone="green">{IC.handAdd}</span>
                <span className={styles.ftext}><span className={styles.ft}><b>{formatNumber(m.newSubscribersToday || 0)}</b> new subscribers enrolled today</span><span className={styles.fm}>network-wide</span></span>
              </div>
              <div className={styles.fitem}>
                <span className={styles.fic} data-tone="green">{IC.coins}</span>
                <span className={styles.ftext}><span className={styles.ft}>Contributions collected — <b>{formatUGX(m.dailyContributions || 0)}</b></span><span className={styles.fm}>today</span></span>
              </div>
              <div className={styles.fitem}>
                <span className={styles.fic}>{IC.handAdd}</span>
                <span className={styles.ftext}><span className={styles.ft}><b>{formatNumber(m.newSubscribersThisWeek || 0)}</b> enrolled this week</span><span className={styles.fm}>{formatNumber(m.newSubscribersThisMonth || 0)} this month</span></span>
              </div>
            </div>
          </section>

          {/* Top agents */}
          <section className={styles.tableCard}>
            <div className={styles.tableHead}>
              <div className={styles.tableTitle}><span className={styles.cardIc} data-tone="teal">{IC.employees}</span>Top agents</div>
              <button className={styles.tableLink} onClick={() => setViewAgentsOpen(true)}>View all →</button>
            </div>
            <div className={styles.tableScroll}>
              <table className={styles.tbl}>
                <thead><tr><th>Agent</th><th className={styles.num}>Subs</th><th className={styles.num}>Contributions</th></tr></thead>
                <tbody>
                  {topAgents.map((a) => (
                    <tr key={a.id} className={styles.rowAct} onClick={() => drillDown('agent', a.id)} aria-label={`View ${a.name}`}>
                      <td>
                        <span className={styles.member}>
                          <span className={styles.avatar} data-tone="teal">{initials(a.name)}</span>
                          <span className={styles.memberText}>
                            <span className={styles.mName}>{a.name}</span>
                            <span className={styles.mSub}>{a.parentName || '—'}</span>
                          </span>
                        </span>
                      </td>
                      <td className={styles.num}>{formatNumber(a.m?.totalSubscribers || 0)}</td>
                      <td className={styles.num}>{formatUGX(a.m?.totalContributions || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  );
}
