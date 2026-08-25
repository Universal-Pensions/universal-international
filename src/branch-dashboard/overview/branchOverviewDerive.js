/**
 * branchOverviewDerive.js — pure branch-overview derivations (score, insights,
 * activity feed) and the single source of truth for them. The desktop Overview
 * page and the desktop Branch Copilot both read from here so they never
 * re-implement the score/insight/alert math inconsistently. (The old
 * BranchHealthScore.jsx that once held this logic was removed; its math lives
 * here and in deriveBranchAnalytics.js now.)
 *
 * All inputs come from existing hooks:
 *   - metrics: useEntityMetrics('branch', branchId)
 *   - agents:  useChildren + useChildrenMetrics merged (see BranchOverview.jsx)
 *   - commissionSummary: useEntityCommissionSummary('branch', branchId)
 */

import { formatUGX } from '../../utils/currency';

// A12-008 — a YoY baseline more than this many times smaller than the current
// month isn't a fair comparison (almost always a branch's negligible partial
// ramp-up month, e.g. 7,904 UGX vs a mature 1,185,832 UGX month = a "14903%"
// badge that reads as broken in a demo, not as growth). Past this multiple we
// report "not enough history" instead of the raw ratio. See monthlyContribStat.
const YOY_MAX_MULTIPLE = 20;

/* ── Derived metrics ── */
export function deriveMetrics(metrics = {}, agents = []) {
  const totalSubs = metrics.totalSubscribers || 0;
  const activeSubs = Math.round(totalSubs * ((metrics.activeRate || 0) / 100));
  const retentionRate = totalSubs > 0 ? (activeSubs / totalSubs) * 100 : 0;
  const totalContrib = agents.reduce((s, a) => s + (a.metrics?.totalContributions || 0), 0);
  const avgPerSub = totalSubs > 0 ? totalContrib / totalSubs : 0;
  const mc = metrics.monthlyContributions || [];
  let growthSum = 0, growthCount = 0;
  for (let i = 1; i < mc.length; i++) {
    if (mc[i - 1] > 0) { growthSum += ((mc[i] - mc[i - 1]) / mc[i - 1]) * 100; growthCount++; }
  }
  const avgMonthlyGrowth = growthCount > 0 ? growthSum / growthCount : 0;
  const totalAgents = agents.length || 1;
  const activeAgents = agents.filter((a) => a.status === 'active').length;
  const agentActivity = (activeAgents / totalAgents) * 100;
  return {
    totalSubs,
    activeSubs,
    dormant: totalSubs - activeSubs,
    retentionRate,
    avgPerSub,
    avgMonthlyGrowth,
    agentActivity,
    activeAgents,
  };
}

/* ── Score ── */
export function calcScore(derived) {
  const { retentionRate, avgPerSub, avgMonthlyGrowth, agentActivity } = derived;
  const avgContribScore = Math.min(100, (avgPerSub / 500_000) * 100);
  const growthScore = Math.min(100, Math.max(0, (avgMonthlyGrowth / 5) * 50 + 50));
  const total = Math.round(
    retentionRate * 0.30 + avgContribScore * 0.25 + agentActivity * 0.25 + growthScore * 0.20,
  );
  return Math.min(100, Math.max(0, total));
}

export function scoreLabel(s) {
  if (s >= 85) return 'Excellent';
  if (s >= 70) return 'Good';
  if (s >= 50) return 'Fair';
  return 'Needs Attention';
}

/* ── Score breakdown — the four weighted factors calcScore() combines, exposed so
 *    the desktop card can show WHAT drives the number: each factor's current
 *    value, its weight, and its 0–100 sub-score (the progress the factor itself
 *    is at). Keep in lockstep with calcScore(). ── */
export function scoreBreakdown(derived = {}) {
  const { retentionRate = 0, avgPerSub = 0, avgMonthlyGrowth = 0, agentActivity = 0 } = derived;
  const avgContribScore = Math.min(100, (avgPerSub / 500_000) * 100);
  const growthScore = Math.min(100, Math.max(0, (avgMonthlyGrowth / 5) * 50 + 50));
  return [
    { key: 'retention', label: 'Retention', weight: 30, value: `${Math.round(retentionRate)}%`, sub: Math.round(retentionRate) },
    { key: 'contrib', label: 'Avg / subscriber', weight: 25, value: formatUGX(avgPerSub, { compact: true }), sub: Math.round(avgContribScore) },
    { key: 'agents', label: 'Agent activity', weight: 25, value: `${Math.round(agentActivity)}%`, sub: Math.round(agentActivity) },
    { key: 'growth', label: 'Growth', weight: 20, value: `${avgMonthlyGrowth >= 0 ? '+' : ''}${Math.round(avgMonthlyGrowth)}%`, sub: Math.round(growthScore) },
  ];
}

/* ── This-month contribution stat (matches the mobile hero's currMonth/prev) ── */
export function monthlyContribStat(metrics = {}) {
  const mc = metrics.monthlyContributions || [];
  const current = mc[11] || 0;
  const prev = mc[10] || 0;
  const changePct = prev ? Math.round(((current - prev) / prev) * 100) : 0;
  // Year-over-year: first non-zero vs last month in the 12-element window.
  // `yoyPct` is `null` (not 0, not a huge number) when there is no fair
  // baseline to compare against — see YOY_MAX_MULTIPLE. A missing/negligible
  // baseline must not read as "no change" (0%) or as a spike (14903%); the
  // caller should render an explicit "not enough history" state instead.
  const first = mc.find((v) => v > 0) || 0;
  const yoyUsable = first > 0 && current / first <= YOY_MAX_MULTIPLE;
  const yoyPct = yoyUsable ? Math.round(((current - first) / first) * 100) : null;
  return { current, prev, changePct, yoyPct, series: mc };
}

/* ── Insights ── */
export function generateInsights(metrics = {}, agents = []) {
  const insights = [];
  if (agents.length > 1) {
    const sorted = [...agents].sort(
      (a, b) => (b.metrics?.totalContributions || 0) - (a.metrics?.totalContributions || 0),
    );
    const top = sorted[0];
    const avg = agents.reduce((s, a) => s + (a.metrics?.totalContributions || 0), 0) / agents.length;
    if (avg > 0 && (top.metrics?.totalContributions || 0) / avg >= 1.3) {
      insights.push({
        type: 'positive',
        text: `${top.name.split(' ')[0]} leads with ${((top.metrics?.totalContributions || 0) / avg).toFixed(1)}x avg`,
        query: 'Top agents?',
      });
    }
  }
  const ar = metrics.activeRate || 0;
  if (ar >= 75) insights.push({ type: 'positive', text: `${Math.round(ar)}% retention — strong`, query: 'Active subscribers?' });
  else if (ar >= 50) insights.push({ type: 'warning', text: `${Math.round(ar)}% retention — needs work`, query: 'Active subscribers?' });
  else insights.push({ type: 'negative', text: `${Math.round(ar)}% retention — critical`, query: 'Active subscribers?' });

  const inactive = agents.filter((a) => a.status === 'inactive');
  if (inactive.length > 0) insights.push({ type: 'warning', text: `${inactive.length} agent${inactive.length > 1 ? 's' : ''} inactive`, query: 'Top agents?' });

  const mc = metrics.monthlyContributions || [];
  const curr = mc[11] || 0, prev = mc[10] || 0;
  if (prev > 0) {
    const pct = Math.round(((curr - prev) / prev) * 100);
    if (Math.abs(pct) > 3) insights.push({ type: pct > 0 ? 'positive' : 'negative', text: `Collections ${pct > 0 ? '+' : ''}${pct}% MoM`, query: 'Show monthly trend' });
  }
  return insights.slice(0, 4);
}

/* ── Activity feed (no Math.random jitter, so the desktop feed is stable
 *    across re-renders). `now`
 *    defaults to Date.now() inside the helper — kept out of the render path so
 *    the component stays pure (matches the mobile hero's pattern). ── */
export function generateActivity(agents = [], now = Date.now()) {
  const base = now || 0;
  const events = [];
  agents.forEach((agent, ai) => {
    const m = agent.metrics || {};
    for (let i = 0; i < Math.min(m.newSubscribersToday || 0, 2); i++) {
      events.push({
        id: `reg-${agent.id}-${i}`,
        type: 'registration',
        text: `New subscriber via ${agent.name.split(' ')[0]}`,
        time: base - (ai * 2 + i) * 3600_000,
      });
    }
    if ((m.dailyContributions || 0) > 0) {
      events.push({
        id: `contrib-${agent.id}`,
        type: 'contribution',
        text: `${agent.name.split(' ')[0]} collected ${formatUGX(m.dailyContributions)}`,
        time: base - (ai * 2 + 1) * 3600_000,
      });
    }
  });
  return events.sort((a, b) => b.time - a.time).slice(0, 8);
}

/* ── Needs-attention rows.
 *
 *  Every row is AGENT-ACTIONABLE: the branch admin supervises agents, so each
 *  issue resolves by nudging the responsible agent(s), not by managing members
 *  directly. Each row carries a semantic `type` instead of a hard-coded route —
 *  every surface (mobile home/hub, desktop overview) maps that type onto its own
 *  drill-down (see `attentionRouteMobile`). The old "KYC issues" row was dropped
 *  (it was structurally ~0 — every subscriber is seeded `kyc_status='complete'`)
 *  and replaced with "Overdue contributions": ACTIVE members past their next
 *  scheduled payment date, counted per agent by the
 *  `get_branch_pending_contributions` RPC and passed in as `opts.overdue`.
 *
 *  @param {object} opts.overdue - branch-total overdue-contribution count
 *    (from useBranchPendingContributions). Defaults to 0 when unresolved so the
 *    row degrades to "all clear" rather than throwing.
 * ── */
export function computeAttention(metrics = {}, agents = [], { overdue = 0 } = {}) {
  const totalSubs = metrics.totalSubscribers || 0;
  const activeSubs = Math.round(totalSubs * ((metrics.activeRate || 0) / 100));
  const dormant = totalSubs - activeSubs;
  const inactiveAgents = agents.filter((a) => a.status === 'inactive').length;
  return [
    {
      type: 'dormant',
      value: dormant,
      label: 'Dormant subscribers',
      sub: 'Not contributing recently',
      severity: dormant > 0 ? 'warning' : 'ok',
    },
    {
      type: 'overdue',
      value: overdue,
      label: 'Overdue contributions',
      sub: 'Members past their payment date',
      severity: overdue > 0 ? 'warning' : 'ok',
    },
    {
      type: 'inactiveAgents',
      value: inactiveAgents,
      label: 'Inactive agents',
      sub: 'No recent field activity',
      severity: inactiveAgents > 0 ? 'warning' : 'ok',
    },
  ];
}

/* Map an attention row `type` to its MOBILE drill-down route. Dormant + overdue
 * open the per-agent action list (AttentionAgentsMobile); inactive agents go
 * straight to the roster (already an agent-level view). */
export function attentionRouteMobile(type) {
  if (type === 'dormant') return '/dashboard/attention/dormant';
  if (type === 'overdue') return '/dashboard/attention/overdue';
  return '/dashboard/agents';
}

/** Top-contributing agent + how many × the branch average (for copilot answers). */
export function topAgent(agents = []) {
  if (!agents.length) return null;
  const sorted = [...agents].sort(
    (a, b) => (b.metrics?.totalContributions || 0) - (a.metrics?.totalContributions || 0),
  );
  const top = sorted[0];
  const avg = agents.reduce((s, a) => s + (a.metrics?.totalContributions || 0), 0) / agents.length;
  const multiple = avg > 0 ? (top.metrics?.totalContributions || 0) / avg : 0;
  return {
    name: top.name,
    contributions: top.metrics?.totalContributions || 0,
    multiple,
  };
}
