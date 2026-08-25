/**
 * deriveBranchAnalytics.js — PURE derive engine for the branch-admin Analytics
 * page. Transforms the branch rollup `metrics`, the merged `agents` array (each
 * carrying its own `agent.metrics` rollup), the commission `commissionSummary`,
 * the network-wide `pendingDuesByAgent` rows, and the `settlements` feed into
 * view-ready chart shapes + KPI blocks, plus `build*Export()` helpers that emit
 * `{ rows, columns:[{key,label}] }` for downloadCsv / downloadSheet.
 *
 * No React, no `src/data/mockData.js`, no side effects — unit-testable in
 * isolation. All numbers stay RAW (no currency formatting); the UI/export layer
 * formats. Labels are plain ASCII.
 *
 * DATA-HONESTY NOTES (real traps in this codebase — see the page-build prompt):
 *  - The metrics RPC emits `activeRate` (PERCENTAGE 0–100), NEVER
 *    `activeSubscribers`. We always derive activeSubs = round(total * rate/100).
 *  - Branch gender/age come from the BRANCH-level `metrics.genderRatio`
 *    (already percentages) + `metrics.ageDistribution` (raw counts). We do NOT
 *    sum per-agent genderRatio (those are per-agent percentages — summing is
 *    mathematically wrong; that is the existing ReportsDesktop bug).
 *  - Commission `pendingDuesByAgent` / `settlements` are NETWORK-WIDE; we filter
 *    to the branch by `branchId` (or by the branch's agent ids as a fallback).
 *  - We do NOT expose growth-over-time of subscribers/AUM, withdrawals,
 *    coverageRate, or insurance — those are zero/unavailable on the seed.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// A12-008 — same guard as branchOverviewDerive.js's monthlyContribStat (this
// file's sibling pure-derive module for the same branch data — see that
// file's comment for the full rationale). A baseline more than this many
// times smaller than the current month is a ramp-up artifact, not a fair
// comparison; past it, yoyPct reports "not enough history" (null) rather than
// an absurd percentage.
const YOY_MAX_MULTIPLE = 20;

// Matches EMPTY_AGE_DISTRIBUTION keys in src/services/entities.js (raw counts).
const AGE_KEYS = ['18-25', '26-35', '36-45', '46-55', '56+'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** activeSubs from a rollup's totalSubscribers + activeRate (%). Never reads activeSubscribers. */
function activeSubsOf(m = {}) {
  const total = num(m.totalSubscribers);
  const rate = num(m.activeRate);
  return Math.round(total * (rate / 100));
}

/** Round a contribution series to 12 short-month labels, matching ReportsDesktop's logic. */
function trendFromSeries(series, now = new Date()) {
  const clean = (Array.isArray(series) ? series : []).filter((v) => typeof v === 'number');
  return clean.map((v, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (clean.length - 1 - i), 1);
    return { label: MONTHS[d.getMonth()], total: num(v) };
  });
}

/**
 * Main derive. All inputs default to safe empties so missing/zero data yields
 * zeros + empty arrays, never NaN/undefined/throw.
 *
 * @param {object}   metrics             branch rollup (useEntityMetrics('branch', branchId))
 * @param {object[]} agents              merged children (each with `.metrics` rollup + `.status`)
 * @param {object}   commissionSummary   getCommissionSummary OR getEntityCommissionSummary shape
 * @param {object[]} pendingDuesByAgent  network-wide getPendingDuesByAgent() rows
 * @param {object[]} settlements         network-wide listSettlements() rows
 * @param {string?}  branchId            branch id used to filter commission rows
 * @param {Date}     [now]               injectable clock (keeps month labels deterministic in tests)
 */
export function deriveBranchAnalytics({
  metrics = {},
  agents = [],
  commissionSummary = {},
  pendingDuesByAgent = [],
  settlements = [],
  branchId = null,
  now = new Date(),
} = {}) {
  const roster = Array.isArray(agents) ? agents : [];
  const m = metrics || {};

  /* ── Header ──────────────────────────────────────────────────────────── */
  const totalSubscribers = num(m.totalSubscribers);
  const activeRate = num(m.activeRate);
  const activeSubs = activeSubsOf(m);
  const dormant = Math.max(0, totalSubscribers - activeSubs);
  const totalAgents = roster.length;
  const activeAgents = roster.filter((a) => a.status === 'active').length;
  const inactiveAgents = totalAgents - activeAgents;

  const header = {
    aum: num(m.aum),
    totalContributions: num(m.totalContributions),
    totalSubscribers,
    activeSubs,
    activeRate,
    activeAgents,
    totalAgents,
  };

  /* ── Agents view ─────────────────────────────────────────────────────── */
  const branchAgentIds = new Set(roster.map((a) => a.id).filter(Boolean));

  // Commission due/paid per agent come from the (branch-filtered) commission
  // feeds, NOT from agent.metrics (which carries no commission fields).
  const branchDues = (Array.isArray(pendingDuesByAgent) ? pendingDuesByAgent : []).filter(
    (r) => (branchId != null && r.branchId === branchId) || branchAgentIds.has(r.agentId),
  );
  const branchSettlements = (Array.isArray(settlements) ? settlements : []).filter(
    (r) => (branchId != null && r.branchId === branchId) || branchAgentIds.has(r.agentId),
  );

  const dueByAgentId = new Map();
  for (const r of branchDues) dueByAgentId.set(r.agentId, num(r.pendingAmount));
  const paidByAgentId = new Map();
  for (const r of branchSettlements) {
    paidByAgentId.set(r.agentId, (paidByAgentId.get(r.agentId) || 0) + num(r.paidAmount));
  }

  const leaderboard = roster
    .map((a) => {
      const am = a.metrics || {};
      const subscribers = num(am.totalSubscribers);
      return {
        id: a.id,
        name: a.name || 'Unknown',
        status: a.status === 'active' ? 'active' : 'inactive',
        subscribers,
        activeRate: num(am.activeRate),
        activeSubs: activeSubsOf(am),
        contributions: num(am.totalContributions),
        aum: num(am.aum),
        commissionDue: dueByAgentId.get(a.id) || 0,
        commissionPaid: paidByAgentId.get(a.id) || 0,
      };
    })
    .sort((a, b) => b.contributions - a.contributions);

  const totalSubsAcrossAgents = leaderboard.reduce((s, a) => s + a.subscribers, 0);
  const totalContribAcrossAgents = leaderboard.reduce((s, a) => s + a.contributions, 0);

  const agentsView = {
    kpis: {
      activeAgents,
      totalAgents,
      inactiveAgents,
      avgSubsPerAgent: totalAgents ? Math.round(totalSubsAcrossAgents / totalAgents) : 0,
      avgContribPerAgent: totalAgents ? Math.round(totalContribAcrossAgents / totalAgents) : 0,
    },
    // Per-agent contribution share (raw UGX), largest first.
    contributionShare: [...leaderboard]
      .map((a) => ({ name: a.name, value: a.contributions }))
      .sort((a, b) => b.value - a.value),
    // Per-agent active rate (%), largest first.
    activeRateByAgent: [...leaderboard]
      .map((a) => ({ name: a.name, value: a.activeRate }))
      .sort((a, b) => b.value - a.value),
    leaderboard,
  };

  /* ── Subscribers view ────────────────────────────────────────────────── */
  // Branch-level gender — already percentages {male,female,other}. Read DIRECTLY
  // (never summed from per-agent ratios). 'Other' only when > 0.
  const gr = m.genderRatio || {};
  const gender = [
    { name: 'Male', value: num(gr.male) },
    { name: 'Female', value: num(gr.female) },
  ];
  if (num(gr.other) > 0) gender.push({ name: 'Other', value: num(gr.other) });

  // Branch-level age — raw counts across the fixed AGE_KEYS (stable axis).
  const ad = m.ageDistribution || {};
  const age = AGE_KEYS.map((band) => ({ band, value: num(ad[band]) }));

  // KYC — verified is the residual after pending + incomplete, clamped >= 0.
  const kycPending = num(m.kycPending);
  const kycIncomplete = num(m.kycIncomplete);
  const kycVerified = Math.max(0, totalSubscribers - kycPending - kycIncomplete);
  // kycVerifiedPct: 0 when there are no subscribers (avoids a misleading 100%
  // on an empty branch; documented choice).
  const kycVerifiedPct = totalSubscribers > 0 ? Math.round((kycVerified / totalSubscribers) * 100) : 0;

  const subscribersView = {
    kpis: {
      total: totalSubscribers,
      active: activeSubs,
      dormant,
      kycVerifiedPct,
    },
    activeDormant: [
      { name: 'Active', value: activeSubs },
      { name: 'Dormant', value: dormant },
    ],
    gender,
    age,
    kyc: { verified: kycVerified, pending: kycPending, incomplete: kycIncomplete },
  };

  /* ── Contributions view ──────────────────────────────────────────────── */
  const series = Array.isArray(m.monthlyContributions) ? m.monthlyContributions : [];
  const trend = trendFromSeries(series, now);

  let running = 0;
  const cumulative = trend.map((t) => {
    running += t.total;
    return { label: t.label, total: running };
  });

  const thisMonth = num(series[series.length - 1]);
  const prevMonth = num(series[series.length - 2]);
  const momPct = prevMonth > 0 ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100) : 0;
  // Year-over-year: this month vs the first non-zero month in the 12-element
  // window. `yoyPct` is `null` — not 0, not a huge number — when the baseline
  // isn't a fair comparison (see YOY_MAX_MULTIPLE); the UI renders an explicit
  // "not enough history" state for that case instead of a percentage.
  const firstNonZero = series.find((v) => num(v) > 0) || 0;
  const yoyUsable = firstNonZero > 0 && thisMonth / firstNonZero <= YOY_MAX_MULTIPLE;
  const yoyPct = yoyUsable ? Math.round(((thisMonth - firstNonZero) / firstNonZero) * 100) : null;
  const nonZero = series.filter((v) => num(v) > 0);
  const monthlyAvg = nonZero.length
    ? Math.round(nonZero.reduce((s, v) => s + num(v), 0) / nonZero.length)
    : 0;

  const contributionsView = {
    kpis: { thisMonth, momPct, yoyPct, monthlyAvg },
    trend,
    cumulative,
  };

  /* ── Commissions view ────────────────────────────────────────────────── */
  // Handle both summary shapes:
  //  - getCommissionSummary:        { totalCommissions, totalPaid, totalDue, countTotal, countPaid, countDue }
  //  - getEntityCommissionSummary:  { total, totalPaid, totalDue, countTotal, countPaid, countDue, settlementRate }
  const cs = commissionSummary || {};
  const commTotal = num(cs.totalCommissions ?? cs.total);
  const commPaid = num(cs.totalPaid);
  const commDue = num(cs.totalDue);
  const countTotal = num(cs.countTotal);
  const countPaid = num(cs.countPaid);
  // Prefer a provided settlementRate; else derive from counts; else fall back to
  // the paid/total AMOUNT ratio so a non-zero rate still shows when only amounts exist.
  let settlementRate;
  if (Number.isFinite(Number(cs.settlementRate)) && cs.settlementRate != null) {
    settlementRate = Math.round(num(cs.settlementRate));
  } else if (countTotal > 0) {
    settlementRate = Math.round((countPaid / countTotal) * 100);
  } else if (commTotal > 0) {
    settlementRate = Math.round((commPaid / commTotal) * 100);
  } else {
    settlementRate = 0;
  }

  const duesByAgent = [...branchDues]
    .map((r) => ({ name: r.agentName || 'Unknown', value: num(r.pendingAmount) }))
    .sort((a, b) => b.value - a.value);

  const sortedSettlements = [...branchSettlements].sort((a, b) =>
    String(b.createdAt || b.paidDate || '').localeCompare(String(a.createdAt || a.paidDate || '')),
  );

  const commissionsView = {
    kpis: { total: commTotal, paid: commPaid, due: commDue, settlementRate },
    paidVsDue: [
      { name: 'Paid', value: commPaid },
      { name: 'Due', value: commDue },
    ],
    duesByAgent,
    settlements: sortedSettlements,
  };

  return {
    header,
    agentsView,
    subscribersView,
    contributionsView,
    commissionsView,
  };
}

/* ── Download builders ─────────────────────────────────────────────────────
 * Each returns { rows, columns:[{key,label}] } in the shape downloadCsv /
 * downloadSheet expect. Numbers stay RAW. */

/** One row per agent. */
export function buildAgentsExport(agentsView = {}) {
  const columns = [
    { key: 'name', label: 'Agent' },
    { key: 'status', label: 'Status' },
    { key: 'subscribers', label: 'Subscribers' },
    { key: 'activeRate', label: 'Active rate (%)' },
    { key: 'contributions', label: 'Contributions (UGX)' },
    { key: 'aum', label: 'AUM (UGX)' },
    { key: 'commissionDue', label: 'Commission due (UGX)' },
    { key: 'commissionPaid', label: 'Commission paid (UGX)' },
  ];
  const rows = (agentsView.leaderboard || []).map((a) => ({
    name: a.name,
    status: a.status === 'active' ? 'Active' : 'Inactive',
    subscribers: num(a.subscribers),
    activeRate: num(a.activeRate),
    contributions: num(a.contributions),
    aum: num(a.aum),
    commissionDue: num(a.commissionDue),
    commissionPaid: num(a.commissionPaid),
  }));
  return { rows, columns };
}

/**
 * Subscriber composition summary — one flat table covering Active/Dormant
 * counts, each gender %, each age-band count, and KYC verified/pending/incomplete.
 * `category` carries the unit so a reader can tell counts (subscribers) from
 * percentages (gender) apart without a separate column.
 */
export function buildSubscribersExport(subscribersView = {}) {
  const columns = [
    { key: 'segment', label: 'Segment' },
    { key: 'category', label: 'Category' },
    { key: 'value', label: 'Value' },
  ];
  const rows = [];
  for (const s of subscribersView.activeDormant || []) {
    rows.push({ segment: 'Status', category: s.name, value: num(s.value) });
  }
  for (const g of subscribersView.gender || []) {
    rows.push({ segment: 'Gender (%)', category: g.name, value: num(g.value) });
  }
  for (const a of subscribersView.age || []) {
    rows.push({ segment: 'Age band', category: a.band, value: num(a.value) });
  }
  const kyc = subscribersView.kyc || {};
  rows.push({ segment: 'KYC', category: 'Verified', value: num(kyc.verified) });
  rows.push({ segment: 'KYC', category: 'Pending', value: num(kyc.pending) });
  rows.push({ segment: 'KYC', category: 'Incomplete', value: num(kyc.incomplete) });
  return { rows, columns };
}

/** One row per month: month label, contributions, cumulative. */
export function buildContributionsExport(contributionsView = {}) {
  const columns = [
    { key: 'month', label: 'Month' },
    { key: 'contributions', label: 'Contributions (UGX)' },
    { key: 'cumulative', label: 'Cumulative (UGX)' },
  ];
  const trend = contributionsView.trend || [];
  const cumulative = contributionsView.cumulative || [];
  const rows = trend.map((t, i) => ({
    month: t.label,
    contributions: num(t.total),
    cumulative: num(cumulative[i]?.total),
  }));
  return { rows, columns };
}

/** Pending dues by agent. */
export function buildCommissionsExport(commissionsView = {}) {
  const columns = [
    { key: 'agent', label: 'Agent' },
    { key: 'pending', label: 'Pending amount (UGX)' },
  ];
  const rows = (commissionsView.duesByAgent || []).map((d) => ({
    agent: d.name,
    pending: num(d.value),
  }));
  return { rows, columns };
}

/** Settlement history (newest first). */
export function buildSettlementsExport(commissionsView = {}) {
  const columns = [
    { key: 'agent', label: 'Agent' },
    { key: 'paid', label: 'Amount paid (UGX)' },
    { key: 'txnRef', label: 'Txn reference' },
    { key: 'paidDate', label: 'Paid date' },
    { key: 'lines', label: 'Lines settled' },
  ];
  const rows = (commissionsView.settlements || []).map((s) => ({
    agent: s.agentName || 'Unknown',
    paid: num(s.paidAmount),
    txnRef: s.txnRef || '',
    paidDate: s.paidDate ? String(s.paidDate).slice(0, 10) : '',
    lines: num(s.lineCount),
  }));
  return { rows, columns };
}
