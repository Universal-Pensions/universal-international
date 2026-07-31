import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { useBranchScope } from '../../contexts/BranchScopeContext';
import { useEntity, useEntityMetrics, useSetAgentStatus } from '../../hooks/useEntity';
import { useEntityCommissionSummary } from '../../hooks/useCommission';
import { useToast } from '../../contexts/ToastContext';
import { formatUGX, formatUGXShort, formatNumber } from '../../utils/currency';
import ErrorCard from '../../components/feedback/ErrorCard';
import { PageHead, MetricRow, Tile, Card, SectionHead, StatusBadge, Btn } from '../../employer-dashboard/desktop/ui';
import { employeesIcon, coinsIcon, walletIcon, checkIcon, pendingIcon, backIcon } from '../../employer-dashboard/desktop/icons';
import { PALETTE, GENDER_COLORS, axisTick, chartTooltip } from '../../employer-dashboard/reports/chartConfig';
import ui from '../../employer-dashboard/desktop/ui.module.css';
import styles from './AgentDetailDesktop.module.css';

const AGE_KEYS = ['18-25', '26-35', '36-45', '46-55', '56+'];

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '–';
}

export default function AgentDetailDesktop() {
  const { agentId } = useParams();
  const reduceMotion = useReducedMotion();
  const { branchId } = useBranchScope();
  const { addToast } = useToast();

  const { data: agent, isLoading, isError, error, refetch } = useEntity('agent', agentId);
  const { data: metrics = {} } = useEntityMetrics('agent', agentId);
  const { data: commission } = useEntityCommissionSummary('agent', agentId);
  const setStatus = useSetAgentStatus(branchId);

  const [confirming, setConfirming] = useState(false);

  const contribSeries = useMemo(() => {
    const series = (metrics.monthlyContributions || []).filter((v) => typeof v === 'number');
    const now = new Date();
    return series.map((v, i) => {
      const m = new Date(now.getFullYear(), now.getMonth() - (series.length - 1 - i), 1);
      return { label: m.toLocaleString('en-US', { month: 'short' }), total: v };
    });
  }, [metrics.monthlyContributions]);

  const gender = useMemo(() => {
    const gr = metrics.genderRatio || {};
    const male = gr.male || 0;
    const female = gr.female || 0;
    return { data: [{ name: 'Male', value: male }, { name: 'Female', value: female }], total: male + female };
  }, [metrics.genderRatio]);

  const ageData = useMemo(() => {
    const ad = metrics.ageDistribution || {};
    return AGE_KEYS.map((band) => ({ band, value: ad[band] || 0 }));
  }, [metrics.ageDistribution]);

  if (isError) {
    return <ErrorCard title="We couldn't load this agent" message={error} onRetry={refetch} />;
  }

  if (isLoading && !agent) {
    return <p className={styles.empty}>Loading agent…</p>;
  }

  if (!agent) {
    return (
      <div className={ui.stack}>
        <Link to="/dashboard/agents" className={styles.backlink}>{backIcon(18)} Agents</Link>
        <Card><p className={styles.notFound}>That agent isn&apos;t part of your branch (or no longer exists).</p></Card>
      </div>
    );
  }

  const active = agent.status === 'active';
  const m = metrics;

  async function applyStatus(next) {
    try {
      await setStatus.mutateAsync({ id: agent.id, status: next });
      addToast('success', next === 'inactive'
        ? `${agent.name} deactivated — they can no longer sign in.`
        : `${agent.name} reactivated.`);
      setConfirming(false);
    } catch (e) {
      addToast('error', e?.message || 'Could not update the agent. Please try again.');
    }
  }

  return (
    <div className={ui.stack}>
      <Link to="/dashboard/agents" className={styles.backlink}>{backIcon(18)} Agents</Link>
      <PageHead eyebrow="Agent" title={agent.name} sub={agent.phone || 'No phone on file'} />

      {/* Profile + status + deactivate */}
      <Card>
        <div className={styles.profile}>
          <span className={styles.profileAv} aria-hidden="true">{initials(agent.name)}</span>
          <div className={styles.profileMain}>
            <div className={styles.nameRow}>
              <span className={styles.profileName}>{agent.name}</span>
              <StatusBadge tone={active ? 'active' : 'inactive'}>{active ? 'Active' : 'Inactive'}</StatusBadge>
            </div>
            <div className={styles.metaRow}>
              {agent.employeeId && <span className={styles.metaItem}>ID&nbsp;<b>{agent.employeeId}</b></span>}
              {typeof agent.tenureMonths === 'number' && <span className={styles.metaItem}>Tenure&nbsp;<b>{agent.tenureMonths} mo</b></span>}
              {agent.email && <span className={styles.metaItem}>{agent.email}</span>}
            </div>
            {(agent.specialties?.length || agent.languages?.length) ? (
              <div className={styles.chips}>
                {(agent.specialties || []).map((s) => <span key={`s-${s}`} className={styles.chip}>{s}</span>)}
                {(agent.languages || []).map((l) => <span key={`l-${l}`} className={styles.chip}>{l}</span>)}
              </div>
            ) : null}
          </div>

          <div className={styles.actionCol}>
            {!confirming ? (
              active ? (
                <Btn variant="danger" onClick={() => setConfirming(true)} disabled={setStatus.isPending}>
                  Deactivate agent
                </Btn>
              ) : (
                <Btn variant="secondary" onClick={() => applyStatus('active')} disabled={setStatus.isPending}>
                  {checkIcon(16)} Reactivate agent
                </Btn>
              )
            ) : (
              <div className={styles.confirm}>
                <span className={styles.confirmText}>
                  Deactivate <b>{agent.name}</b>? They won&apos;t be able to sign in or onboard new subscribers. Their existing subscribers are unaffected.
                </span>
                <div className={styles.confirmBtns}>
                  <Btn variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={setStatus.isPending}>Cancel</Btn>
                  <Btn variant="danger" size="sm" onClick={() => applyStatus('inactive')} disabled={setStatus.isPending}>
                    {setStatus.isPending ? 'Deactivating…' : 'Deactivate'}
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <MetricRow cols={4}>
        <Tile accent="teal" icon={employeesIcon(18)} label="Subscribers" value={formatNumber(m.totalSubscribers || 0)} sub={`${Math.round(m.activeRate || 0)}% active`} />
        <Tile accent="indigo" icon={coinsIcon(18)} label="Contributions" value={formatUGXShort(m.totalContributions || 0)} sub="Lifetime collected" />
        <Tile accent="green" icon={walletIcon(18)} label="Funds under management" value={formatUGXShort(m.aum || 0)} sub="Subscriber savings" />
        <Tile accent="indigoSoft" icon={coinsIcon(18)} label="Daily collections" value={formatUGXShort(m.dailyContributions || 0)} sub={`${formatNumber(m.newSubscribersToday || 0)} new today`} />
      </MetricRow>

      {/* Drill deeper: this agent's own subscribers. The Subscribers tile above
          shows the COUNT; this opens the list behind it, scoped server-side to
          the agent. Mirrors the distributor shell's AgentDetail CTA so both
          shells expose the same affordance. */}
      <Link
        to={`/dashboard/agents/${agent.id}/subscribers`}
        className={styles.drillCta}
        data-testid="agent-view-subscribers"
        aria-label={`View subscribers for ${agent.name}`}
      >
        View subscribers
        <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" width="10" height="10">
          <path d="M4.5 2.5l3.5 3.5-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>

      <div className={styles.grid2}>
        {/* Commissions */}
        <Card>
          <SectionHead title="Commissions" tag="This agent" />
          <MetricRow cols={3}>
            <Tile accent="green" icon={checkIcon(18)} label="Settled" value={formatUGXShort(commission?.totalPaid || 0)} />
            <Tile accent="amber" icon={pendingIcon(18)} label="Due" value={formatUGXShort(commission?.totalDue || 0)} />
            <Tile accent="indigo" label="Settlement" value={`${Math.round(commission?.settlementRate || 0)}%`} />
          </MetricRow>
        </Card>

        {/* Activity */}
        <Card>
          <SectionHead title="Onboarding activity" />
          <div className={styles.actRow}><span className={styles.actK}>New today</span><span className={styles.actV}>{formatNumber(m.newSubscribersToday || 0)}</span></div>
          <div className={styles.actRow}><span className={styles.actK}>This week</span><span className={styles.actV}>{formatNumber(m.newSubscribersThisWeek || 0)}</span></div>
          <div className={styles.actRow}><span className={styles.actK}>This month</span><span className={styles.actV}>{formatNumber(m.newSubscribersThisMonth || 0)}</span></div>
        </Card>
      </div>

      {/* Contributions chart */}
      <Card>
        <SectionHead title="Contributions — last 12 months" tag="UGX collected" />
        {contribSeries.length === 0 ? (
          <p className={styles.empty}>No contribution history yet for this agent.</p>
        ) : (
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={contribSeries} margin={{ top: 12, right: 12, left: -8, bottom: 4 }}>
                <defs>
                  <linearGradient id="agentContribFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={PALETTE.indigo} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={PALETTE.indigo} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} tickFormatter={formatUGXShort} width={52} />
                <Tooltip cursor={{ stroke: PALETTE.lavender }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => formatUGX(v) })} />
                <Area type="monotone" dataKey="total" name="Collected" stroke={PALETTE.indigo} strokeWidth={2.5} fill="url(#agentContribFill)" isAnimationActive={!reduceMotion} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Demographics */}
      <div className={styles.grid2}>
        <Card>
          <SectionHead title="Subscriber gender" tag={`${formatNumber(gender.total)} subscribers`} />
          {gender.total === 0 ? (
            <p className={styles.empty}>No demographic data for this agent yet.</p>
          ) : (
            <div className={styles.donutWrap}>
              <div className={styles.donutChart}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={gender.data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" stroke="#FFFFFF" strokeWidth={2} isAnimationActive={!reduceMotion}>
                      {gender.data.map((e, i) => <Cell key={e.name} fill={GENDER_COLORS[i]} />)}
                    </Pie>
                    <Tooltip cursor={false} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${formatNumber(v)} subscribers` })} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className={styles.legend}>
                <div className={styles.lg}><span className={styles.sw} style={{ background: GENDER_COLORS[0] }} />Male<span className={styles.lgVal}>{Math.round((gender.data[0].value / gender.total) * 100)}%</span></div>
                <div className={styles.lg}><span className={styles.sw} style={{ background: GENDER_COLORS[1] }} />Female<span className={styles.lgVal}>{Math.round((gender.data[1].value / gender.total) * 100)}%</span></div>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionHead title="Subscriber age" tag="Distribution" />
          <div className={styles.chartBox}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ageData} margin={{ top: 8, right: 12, left: -16, bottom: 4 }}>
                <CartesianGrid stroke={PALETTE.gridLine} vertical={false} />
                <XAxis dataKey="band" tick={axisTick} tickLine={false} axisLine={{ stroke: PALETTE.gridLine }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: PALETTE.lavender, opacity: 0.4 }} content={(p) => chartTooltip({ ...p, valueFormatter: (v) => `${formatNumber(v)} subscribers` })} />
                <Bar dataKey="value" name="Subscribers" fill={PALETTE.indigo} radius={[6, 6, 0, 0]} isAnimationActive={!reduceMotion} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
