import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MOCK_NOW } from '../../constants/demoClock';
import { useAuth } from '../../contexts/AuthContext';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useEntity, useChildren, useEntityMetrics, useChildrenMetrics, useBranchPendingContributions } from '../../hooks/useEntity';
import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import { formatDate, formatRelativeTime } from '../../utils/date';
import ErrorCard from '../../components/feedback/ErrorCard';
import { MetricRow, Tile, Card, SectionHead, StatusBadge, Avatar } from '../../employer-dashboard/desktop/ui';
import { walletIcon, coinsIcon, employeesIcon, buildingIcon, checkIcon, handAddIcon } from '../../employer-dashboard/desktop/icons';
import ui from '../../employer-dashboard/desktop/ui.module.css';
import {
  deriveMetrics,
  calcScore,
  scoreLabel,
  scoreBreakdown,
  monthlyContribStat,
  generateActivity,
  computeAttention,
} from '../overview/branchOverviewDerive';
import styles from './OverviewDesktop.module.css';

/* Desktop drill target for a Needs-attention row. Dormant + overdue open the
   per-agent action list + nudge (AttentionAgentsDesktop); inactive agents go
   straight to the roster (already an agent-level view). Mirrors the mobile
   attentionRouteMobile mapping. */
function attentionTargetDesktop(type) {
  if (type === 'inactiveAgents') return { to: '/dashboard/agents' };
  return { to: `/dashboard/attention/${type}` };
}

/* Local light-theme gauge — the shared ScoreGauge is built for the dark hero
   (white strokes), so on a white card we use the mockup's indigo ring. */
function BranchGauge({ value }) {
  const r = 62;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, value || 0));
  const offset = c * (1 - clamped / 100);
  return (
    <svg width="150" height="150" viewBox="0 0 150 150" aria-hidden="true">
      <circle cx="75" cy="75" r={r} fill="none" stroke="#EEF0FA" strokeWidth="14" />
      <circle
        cx="75" cy="75" r={r} fill="none" stroke="url(#branchGaugeGrad)" strokeWidth="14"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
      />
      <defs>
        <linearGradient id="branchGaugeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-indigo-soft)" />
          <stop offset="1" stopColor="var(--color-indigo)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * `count` short month labels (e.g. "Jan"), oldest first, ending at `now`'s
 * calendar month — e.g. monthLabelsEndingAt(3, new Date(2026, 6, 15)) =>
 * ['May', 'Jun', 'Jul']. Pure + exported (A12-001) so the fix — label from the
 * demo clock, not the real wall clock — has a direct unit test without
 * needing to render the full data-fetching OverviewDesktop page; see
 * OverviewDesktop.test.js. Mirrors this directory's existing pattern of
 * extracting+exporting a page's pure logic for testing (employer
 * desktop/OverviewDesktop.jsx's `isInviteAwaiting`).
 */
export function monthLabelsEndingAt(count, now) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(m.toLocaleString('en-US', { month: 'short' }));
  }
  return out;
}

function ContributionsChart({ stat }) {
  const series = (stat.series || []).filter((v) => typeof v === 'number');
  const max = Math.max(...series, 1);
  const scaleMax = max * 1.08;
  const avg = series.length ? series.reduce((s, v) => s + v, 0) / series.length : 0;
  const avgPct = scaleMax > 0 ? (avg / scaleMax) * 100 : 0;
  const lastIdx = series.length - 1;

  // A12-001 — label from the demo clock (MOCK_NOW), not the real wall clock:
  // the underlying series comes from get_entity_metrics_rollup, which buckets
  // its 12 months relative to the SQL demo clock (public._demo_now()); MOCK_NOW
  // is the JS mirror of that same anchor (src/constants/demoClock.js), so the
  // last bar's label matches the month the data actually is (not "whatever
  // month it is on the machine running the demo").
  const labels = useMemo(
    () => monthLabelsEndingAt(series.length, MOCK_NOW),
    [series.length],
  );

  if (!series.length) {
    return <p className={styles.feedEmpty}>No contribution history yet for this branch.</p>;
  }

  return (
    <>
      <div className={styles.chartStat}>
        <span className={styles.chartStatVal}>{formatUGXShort(stat.current)}</span>
        {stat.yoyPct == null ? (
          <span className={`${styles.chartStatDelta} ${styles.chartStatNeutral}`}>Not enough history to compare yet</span>
        ) : stat.yoyPct !== 0 && (
          <span className={styles.chartStatDelta}>
            {stat.yoyPct >= 0 ? '▲' : '▼'} {Math.abs(stat.yoyPct)}% over the year
          </span>
        )}
      </div>
      <div className={styles.trend}>
        <div className={styles.avg} style={{ bottom: `${avgPct}%` }}>
          <span className={styles.avgLabel}>Avg {formatUGXShort(avg)}</span>
        </div>
        <div className={styles.cols}>
          {series.map((v, i) => {
            const h = scaleMax > 0 ? (v / scaleMax) * 100 : 0;
            const isCur = i === lastIdx;
            return (
              <div className={styles.barCol} key={i}>
                {isCur && <span className={styles.barTag}>{formatUGXShort(v)}</span>}
                <span className={`${styles.bar} ${isCur ? styles.barCur : ''}`} style={{ height: `${h}%` }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className={styles.xlabels}>
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </>
  );
}

function sortAgents(agents, key) {
  const arr = [...agents];
  if (key === 'subscribers') arr.sort((a, b) => (b.metrics?.totalSubscribers || 0) - (a.metrics?.totalSubscribers || 0));
  else if (key === 'active') arr.sort((a, b) => (b.metrics?.activeRate || 0) - (a.metrics?.activeRate || 0));
  else arr.sort((a, b) => (b.metrics?.totalContributions || 0) - (a.metrics?.totalContributions || 0));
  return arr;
}

const SORTS = [
  { key: 'contributions', label: 'Contributions' },
  { key: 'subscribers', label: 'Subscribers' },
  { key: 'active', label: 'Active Rate' },
];

export default function OverviewDesktop() {
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
  const breakdown = useMemo(() => scoreBreakdown(derived), [derived]);
  const month = useMemo(() => monthlyContribStat(metrics), [metrics]);
  const attention = useMemo(
    () => computeAttention(metrics, agents, { overdue: pending?.total || 0 }),
    [metrics, agents, pending],
  );
  const attnCount = attention.filter((a) => a.severity !== 'ok').length;
  const activity = useMemo(() => generateActivity(agents), [agents]);

  const [sortKey, setSortKey] = useState('contributions');
  const team = useMemo(() => sortAgents(agents, sortKey), [agents, sortKey]);

  if (isError || agentsError || (!branch && !isLoading)) {
    return (
      <ErrorCard
        title="We couldn't load your dashboard"
        message={error}
        onRetry={() => { refetch(); refetchAgents(); }}
      />
    );
  }

  if (isLoading && !branch) {
    return <div className={styles.loading}><div className={styles.spinner} /></div>;
  }

  const participationPct = derived.totalSubs > 0 ? Math.round((derived.activeSubs / derived.totalSubs) * 100) : 0;
  const inactiveAgents = agents.filter((a) => a.status !== 'active').length;
  const insightText = derived.dormant > 0
    ? `Reactivating ${formatNumber(derived.dormant)} dormant subscribers is the biggest lever to lift this score.`
    : 'Strong participation across the branch — keep your agents engaged to hold the score.';

  return (
    <div className={ui.stack}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Branch Overview</p>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{branch?.name || 'Your branch'}</h1>
          <span className={styles.roleBadge}><span className={styles.roleDot} aria-hidden="true" />Branch Admin</span>
        </div>
        <p className={styles.sub}>
          {/* A12-I02 — same identity source as the mobile hub (branches.manager_name
              first, JWT persona name as fallback), so the signed-in branch admin
              isn't greeted by two different names on two screens. */}
          Welcome back, {branch?.managerName || user?.name || 'Branch Admin'}&nbsp;·&nbsp;{formatDate(new Date(), { variant: 'long' })}
        </p>
      </header>

      <MetricRow cols={4}>
        <Tile
          accent="indigo"
          icon={walletIcon(18)}
          label="Funds under management"
          value={formatUGXShort(metrics.aum || 0)}
          sub="Total subscriber savings held"
        />
        <Tile
          accent="green"
          icon={coinsIcon(18)}
          label="Contributions this month"
          value={formatUGXShort(month.current)}
          sub={month.prev ? `${month.changePct >= 0 ? '▲' : '▼'} ${Math.abs(month.changePct)}% vs last month` : 'First month of collections'}
        />
        <Tile
          accent="teal"
          icon={employeesIcon(18)}
          label="Subscribers"
          value={formatNumber(derived.totalSubs)}
          sub={`${formatNumber(derived.activeSubs)} actively contributing · ${participationPct}%`}
        />
        <Tile
          accent="indigoSoft"
          icon={buildingIcon(18)}
          label="Agents"
          value={formatNumber(agents.length)}
          sub={`${formatNumber(derived.activeAgents)} active${inactiveAgents > 0 ? ` · ${formatNumber(inactiveAgents)} inactive` : ''}`}
        />
      </MetricRow>

      <div className={styles.grid2}>
        <div className={styles.col}>
          {/* Branch health score */}
          <Card>
            {/* A12-003 — "Live" (not "Recomputed daily"): the gauge below is
                calcScore(derived), computed fresh from this render's metrics/agents
                every time, never on a daily batch. */}
            <SectionHead title="Branch Health Score" tag="Live" />
            <div className={styles.scoreRow}>
              <div className={styles.gauge}>
                <BranchGauge value={score} />
                <div className={styles.gaugeMid}>
                  <span className={styles.gaugeNum}>{score}</span>
                  <span className={styles.gaugeQ}>{scoreLabel(score)}</span>
                </div>
              </div>
              <div className={styles.scoreMeta}>
                <div className={styles.sLabel}>Branch Score · out of 100</div>
                {branch?.districtRank && (
                  // A12-003 — district rank is ranked on branches.score, a stored
                  // column that is NOT recomputed alongside the live gauge above
                  // (verified live: gauge 84 vs stored branches.score 77 for the
                  // same branch). Showing that stored score alongside the rank
                  // makes the rank's own basis explicit instead of silently
                  // implying it tracks the live number next to it.
                  <div className={styles.rankChip}>
                    #{branch.districtRank} of {branch.districtBranchCount} in district · score {branch.score ?? '—'}
                  </div>
                )}
                <p className={styles.insight}>{insightText}</p>
              </div>
            </div>
            {/* What drives the score — the four weighted factors, boxed. */}
            <div className={styles.scoreFactors}>
              {breakdown.map((f) => (
                <div className={styles.factorBox} key={f.key}>
                  <div className={styles.factorTop}>
                    <span className={styles.factorLabel}>{f.label}</span>
                    <span className={styles.factorWeight}>{f.weight}%</span>
                  </div>
                  <div className={styles.factorVal}>{f.value}</div>
                  <div className={styles.factorBar}>
                    <span style={{ width: `${Math.max(0, Math.min(100, f.sub))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Contributions chart */}
          <Card>
            <SectionHead title="Contributions — last 12 months" tag="UGX" />
            <ContributionsChart stat={month} />
          </Card>
        </div>

        <div className={styles.col}>
          {/* Needs attention — status tiles */}
          <Card>
            <SectionHead
              title="Needs attention"
              action={
                <span className={`${styles.attnCount} ${attnCount > 0 ? styles.attnCountWarn : styles.attnCountOk}`}>
                  {attnCount > 0 ? `${attnCount} to action` : 'All clear'}
                </span>
              }
            />
            <div className={styles.attnList}>
              {attention.map((a) => {
                const tone = a.severity === 'alert' ? 'Alert' : a.severity === 'ok' ? 'Ok' : 'Warn';
                const target = attentionTargetDesktop(a.type);
                return (
                  <Link
                    to={target.to}
                    state={target.state}
                    className={`${styles.attnTile} ${styles[`rail${tone}`]}`}
                    key={a.label}
                    aria-label={`${a.label}: ${formatNumber(a.value)} — review`}
                  >
                    <span className={`${styles.attnIc} ${styles[`tint${tone}`]}`} aria-hidden="true">
                      {a.severity === 'ok' ? checkIcon(20) : (
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                          <circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" />
                        </svg>
                      )}
                    </span>
                    <span className={styles.attnMid}>
                      <b>{a.label}</b>
                      <small>{a.sub}</small>
                    </span>
                    <span className={`${styles.attnPill} ${styles[`pill${tone}`]}`}>
                      {a.severity === 'ok' ? 'Clear' : formatNumber(a.value)}
                    </span>
                    <span className={styles.attnChev} aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    </span>
                  </Link>
                );
              })}
            </div>
          </Card>

          {/* Today's snapshot */}
          <Card>
            <SectionHead title="Today's Snapshot" />
            <div className={styles.feedLive}>
              <span className={styles.liveDot} aria-hidden="true" /> Updated just now
            </div>
            {activity.length === 0 ? (
              <p className={styles.feedEmpty}>No agent activity yet today — onboardings and collections will appear here.</p>
            ) : (
              activity.map((ev) => (
                <div className={styles.fitem} key={ev.id}>
                  <span className={`${styles.fic} ${ev.type === 'contribution' ? styles.ficGreen : ''}`} aria-hidden="true">
                    {ev.type === 'contribution' ? coinsIcon(16) : handAddIcon(16)}
                  </span>
                  <div>
                    <div className={styles.ft}>{ev.text}</div>
                    <div className={styles.fm}>{formatRelativeTime(ev.time)}</div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>

      {/* Your team */}
      <Card>
        <SectionHead
          title="Your Team"
          action={
            <div className={styles.sortPills}>
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`${styles.sortPill} ${sortKey === s.key ? styles.sortPillOn : ''}`}
                  onClick={() => setSortKey(s.key)}
                  aria-pressed={sortKey === s.key}
                >
                  {s.label}
                </button>
              ))}
            </div>
          }
        />
        <div className={ui.tableCard}>
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Agent</th>
                <th className={ui.num}>Subscribers</th>
                <th className={ui.num}>Active rate</th>
                <th className={ui.num}>Contributions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {team.map((a) => {
                const m = a.metrics || {};
                const rate = Math.round(m.activeRate || 0);
                const active = a.status === 'active';
                return (
                  <tr key={a.id} className={ui.rowInteractive}>
                    <td>
                      <Link to={`/dashboard/agents/${a.id}`} className={`${styles.who} ${styles.teamLink}`}>
                        <Avatar name={a.name} />
                        <span>
                          <span className={styles.whoName}>{a.name}</span>
                          <span className={styles.whoMeta} style={{ display: 'block' }}>
                            {active ? 'Active agent' : 'Inactive'}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className={ui.num}>{formatNumber(m.totalSubscribers || 0)}</td>
                    <td className={ui.num}>
                      <span className={styles.miniBar}><i style={{ width: `${rate}%` }} /></span>
                      {rate}%
                    </td>
                    <td className={ui.num}>{formatUGX(m.totalContributions || 0)}</td>
                    <td>
                      <StatusBadge tone={active ? 'active' : 'inactive'}>
                        {active ? 'Active' : 'Inactive'}
                      </StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
