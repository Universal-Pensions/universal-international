import { describe, it, expect } from 'vitest';
import {
  deriveBranchAnalytics,
  buildAgentsExport,
  buildSubscribersExport,
  buildContributionsExport,
  buildCommissionsExport,
  buildSettlementsExport,
} from '../deriveBranchAnalytics';

// Deterministic clock so 12-month labels don't drift with wall time.
const NOW = new Date(2026, 5, 1); // Jun 2026

const metrics = {
  totalSubscribers: 1000,
  activeRate: 60, // → 600 active, 400 dormant
  aum: 12_000_000,
  totalContributions: 30_000_000,
  kycPending: 20,
  kycIncomplete: 10, // → verified 970
  genderRatio: { male: 58, female: 42, other: 0 },
  ageDistribution: { '18-25': 100, '26-35': 400, '36-45': 300, '46-55': 150, '56+': 50 },
  monthlyContributions: [10, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 20],
};

const agents = [
  { id: 'a1', name: 'James Okello', status: 'active', metrics: { totalContributions: 9_000_000, totalSubscribers: 156, activeRate: 72, aum: 5_000_000 } },
  { id: 'a2', name: 'Grace Namubiru', status: 'active', metrics: { totalContributions: 3_000_000, totalSubscribers: 90, activeRate: 60, aum: 2_000_000 } },
  { id: 'a3', name: 'New Agent', status: 'inactive', metrics: { totalContributions: 0, totalSubscribers: 0, activeRate: 0, aum: 0 } },
];

const commissionSummary = {
  totalCommissions: 1_000_000,
  totalPaid: 600_000,
  totalDue: 400_000,
  countTotal: 50,
  countPaid: 30,
  countDue: 20,
};

// Network-wide rows: a1/a2 belong to branch b1; aX belongs to another branch.
const pendingDuesByAgent = [
  { agentId: 'a1', agentName: 'James Okello', branchId: 'b1', pendingAmount: 250_000, pendingCount: 5 },
  { agentId: 'a2', agentName: 'Grace Namubiru', branchId: 'b1', pendingAmount: 150_000, pendingCount: 3 },
  { agentId: 'aX', agentName: 'Other Branch Agent', branchId: 'b2', pendingAmount: 999_000, pendingCount: 9 },
];

const settlements = [
  { id: 's1', agentId: 'a1', agentName: 'James Okello', branchId: 'b1', paidAmount: 100_000, txnRef: 'TX-1', paidDate: '2026-05-10', lineCount: 2, createdAt: '2026-05-10T09:00:00Z' },
  { id: 's2', agentId: 'a2', agentName: 'Grace Namubiru', branchId: 'b1', paidAmount: 50_000, txnRef: 'TX-2', paidDate: '2026-05-20', lineCount: 1, createdAt: '2026-05-20T09:00:00Z' },
  { id: 's3', agentId: 'aX', agentName: 'Other Branch Agent', branchId: 'b2', paidAmount: 777_000, txnRef: 'TX-9', paidDate: '2026-05-01', lineCount: 7, createdAt: '2026-05-01T09:00:00Z' },
];

function build(overrides = {}) {
  return deriveBranchAnalytics({
    metrics,
    agents,
    commissionSummary,
    pendingDuesByAgent,
    settlements,
    branchId: 'b1',
    now: NOW,
    ...overrides,
  });
}

describe('deriveBranchAnalytics — header', () => {
  it('derives activeSubs from activeRate (never reads activeSubscribers)', () => {
    const { header } = build();
    expect(header.totalSubscribers).toBe(1000);
    expect(header.activeRate).toBe(60);
    expect(header.activeSubs).toBe(600); // 1000 * 60%
    expect(header.aum).toBe(12_000_000);
    expect(header.totalContributions).toBe(30_000_000);
    expect(header.activeAgents).toBe(2);
    expect(header.totalAgents).toBe(3);
  });

  it('ignores a stray activeSubscribers field if present', () => {
    const { header } = build({ metrics: { ...metrics, activeSubscribers: 12345 } });
    expect(header.activeSubs).toBe(600); // still derived, not the stray field
  });
});

describe('deriveBranchAnalytics — agentsView', () => {
  it('computes agent KPIs with safe averages', () => {
    const { agentsView } = build();
    expect(agentsView.kpis.activeAgents).toBe(2);
    expect(agentsView.kpis.totalAgents).toBe(3);
    expect(agentsView.kpis.inactiveAgents).toBe(1);
    // subs across agents = 156 + 90 + 0 = 246; /3 = 82
    expect(agentsView.kpis.avgSubsPerAgent).toBe(82);
    // contrib across agents = 12,000,000 / 3 = 4,000,000
    expect(agentsView.kpis.avgContribPerAgent).toBe(4_000_000);
  });

  it('leaderboard is sorted by contributions desc and merges branch commission feeds', () => {
    const { agentsView } = build();
    const lb = agentsView.leaderboard;
    expect(lb.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
    const james = lb[0];
    expect(james.activeSubs).toBe(Math.round(156 * 0.72)); // 112
    expect(james.commissionDue).toBe(250_000);
    expect(james.commissionPaid).toBe(100_000);
    // a3 has no commission rows → zeros, not undefined
    expect(lb[2].commissionDue).toBe(0);
    expect(lb[2].commissionPaid).toBe(0);
  });

  it('contributionShare and activeRateByAgent are sorted desc', () => {
    const { agentsView } = build();
    expect(agentsView.contributionShare).toEqual([
      { name: 'James Okello', value: 9_000_000 },
      { name: 'Grace Namubiru', value: 3_000_000 },
      { name: 'New Agent', value: 0 },
    ]);
    expect(agentsView.activeRateByAgent.map((a) => a.value)).toEqual([72, 60, 0]);
  });
});

describe('deriveBranchAnalytics — subscribersView', () => {
  it('reads BRANCH-level gender percentages directly (not summed from agents)', () => {
    const { subscribersView } = build();
    // 58/42 are the branch-level percentages, NOT a sum of per-agent ratios.
    expect(subscribersView.gender).toEqual([
      { name: 'Male', value: 58 },
      { name: 'Female', value: 42 },
    ]);
    // 'Other' omitted because it's 0.
    expect(subscribersView.gender.some((g) => g.name === 'Other')).toBe(false);
  });

  it('includes Other only when > 0', () => {
    const { subscribersView } = build({
      metrics: { ...metrics, genderRatio: { male: 50, female: 45, other: 5 } },
    });
    expect(subscribersView.gender).toEqual([
      { name: 'Male', value: 50 },
      { name: 'Female', value: 45 },
      { name: 'Other', value: 5 },
    ]);
  });

  it('reads BRANCH-level age counts directly across AGE_KEYS', () => {
    const { subscribersView } = build();
    expect(subscribersView.age).toEqual([
      { band: '18-25', value: 100 },
      { band: '26-35', value: 400 },
      { band: '36-45', value: 300 },
      { band: '46-55', value: 150 },
      { band: '56+', value: 50 },
    ]);
  });

  it('does NOT sum per-agent genderRatio — branch ratio wins even if agents carry their own', () => {
    const agentsWithRatios = agents.map((a) => ({
      ...a,
      metrics: { ...a.metrics, genderRatio: { male: 90, female: 10, other: 0 } },
    }));
    const { subscribersView } = build({ agents: agentsWithRatios });
    // If we (wrongly) summed agents we'd get 270/30; we read the branch's 58/42.
    expect(subscribersView.gender[0].value).toBe(58);
    expect(subscribersView.gender[1].value).toBe(42);
  });

  it('computes active/dormant + KYC residual', () => {
    const { subscribersView } = build();
    expect(subscribersView.kpis.active).toBe(600);
    expect(subscribersView.kpis.dormant).toBe(400);
    expect(subscribersView.activeDormant).toEqual([
      { name: 'Active', value: 600 },
      { name: 'Dormant', value: 400 },
    ]);
    expect(subscribersView.kyc).toEqual({ verified: 970, pending: 20, incomplete: 10 });
    expect(subscribersView.kpis.kycVerifiedPct).toBe(97); // 970/1000
  });

  it('clamps KYC verified to >= 0 when pending+incomplete exceed total', () => {
    const { subscribersView } = build({
      metrics: { ...metrics, totalSubscribers: 5, kycPending: 10, kycIncomplete: 10 },
    });
    expect(subscribersView.kyc.verified).toBe(0);
  });
});

describe('deriveBranchAnalytics — contributionsView', () => {
  it('builds 12 short-month trend labels deterministically from the clock', () => {
    const { contributionsView } = build();
    // Window ends Jun 2026 → 12 months back = Jul..Jun.
    expect(contributionsView.trend.map((t) => t.label)).toEqual([
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    ]);
    expect(contributionsView.trend[11].total).toBe(20);
  });

  it('cumulative is a correct running total of the trend', () => {
    const { contributionsView } = build();
    const trendTotals = contributionsView.trend.map((t) => t.total);
    let running = 0;
    const expected = trendTotals.map((v) => (running += v));
    expect(contributionsView.cumulative.map((c) => c.total)).toEqual(expected);
    // Final cumulative === sum of the whole series.
    expect(contributionsView.cumulative[11].total).toBe(trendTotals.reduce((s, v) => s + v, 0));
  });

  it('computes thisMonth / MoM / YoY / monthlyAvg', () => {
    const { contributionsView } = build();
    expect(contributionsView.kpis.thisMonth).toBe(20);
    expect(contributionsView.kpis.momPct).toBe(Math.round(((20 - 18) / 18) * 100)); // +11
    expect(contributionsView.kpis.yoyPct).toBe(Math.round(((20 - 10) / 10) * 100)); // +100
    const avg = Math.round([10, 12, 11, 13, 14, 13, 15, 16, 15, 17, 18, 20].reduce((s, v) => s + v, 0) / 12);
    expect(contributionsView.kpis.monthlyAvg).toBe(avg);
  });

  // A12-008 regression guard: reproduces the live "▲14903% over the year"
  // badge (7,904 UGX ramp-up first month vs a mature 1,185,832 UGX month) —
  // the SAME bug shape as branchOverviewDerive.test.js's guard, but for this
  // module's independent yoyPct computation (this file feeds the Analytics
  // page; branchOverviewDerive.js feeds the Overview page — two pure derive
  // modules, so each needs its own guard and its own test).
  it('yoyPct is null (not a huge percentage) when the baseline is a negligible ramp-up sliver', () => {
    const { contributionsView } = build({
      metrics: { ...metrics, monthlyContributions: [7904, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1_100_000, 1_185_832] },
    });
    expect(contributionsView.kpis.thisMonth).toBe(1_185_832);
    expect(contributionsView.kpis.yoyPct).toBeNull();
  });
});

describe('deriveBranchAnalytics — commissionsView', () => {
  it('reads totals from getCommissionSummary shape and derives settlementRate from counts', () => {
    const { commissionsView } = build();
    expect(commissionsView.kpis).toEqual({
      total: 1_000_000,
      paid: 600_000,
      due: 400_000,
      settlementRate: 60, // 30/50
    });
    expect(commissionsView.paidVsDue).toEqual([
      { name: 'Paid', value: 600_000 },
      { name: 'Due', value: 400_000 },
    ]);
  });

  it('reads the getEntityCommissionSummary shape (total + provided settlementRate)', () => {
    const { commissionsView } = build({
      commissionSummary: { total: 800_000, totalPaid: 200_000, totalDue: 600_000, countTotal: 40, countPaid: 10, settlementRate: 25 },
    });
    expect(commissionsView.kpis.total).toBe(800_000);
    expect(commissionsView.kpis.settlementRate).toBe(25); // provided wins
  });

  it('derives settlementRate from amounts when no counts are present', () => {
    const { commissionsView } = build({
      commissionSummary: { totalCommissions: 1000, totalPaid: 250, totalDue: 750 },
    });
    expect(commissionsView.kpis.settlementRate).toBe(25); // 250/1000
  });

  it('filters dues + settlements to the branch by branchId (drops other-branch rows)', () => {
    const { commissionsView } = build();
    expect(commissionsView.duesByAgent).toEqual([
      { name: 'James Okello', value: 250_000 },
      { name: 'Grace Namubiru', value: 150_000 },
    ]);
    // aX (b2) excluded.
    expect(commissionsView.duesByAgent.some((d) => d.name === 'Other Branch Agent')).toBe(false);
    expect(commissionsView.settlements.map((s) => s.id)).toEqual(['s2', 's1']); // newest first, b2 dropped
  });

  it('falls back to branch agent ids when branchId is null', () => {
    const { commissionsView } = build({ branchId: null });
    // a1/a2 are in the roster → included; aX not in roster → excluded.
    expect(commissionsView.duesByAgent.map((d) => d.name).sort()).toEqual(['Grace Namubiru', 'James Okello']);
    expect(commissionsView.settlements.every((s) => s.agentId !== 'aX')).toBe(true);
  });
});

describe('deriveBranchAnalytics — empty / zero inputs', () => {
  it('returns safe zeros and empty arrays (no NaN / throw) for all-empty input', () => {
    const r = deriveBranchAnalytics({});
    expect(r.header).toEqual({
      aum: 0,
      totalContributions: 0,
      totalSubscribers: 0,
      activeSubs: 0,
      activeRate: 0,
      activeAgents: 0,
      totalAgents: 0,
    });
    expect(r.agentsView.leaderboard).toEqual([]);
    expect(r.agentsView.kpis.avgSubsPerAgent).toBe(0);
    expect(r.agentsView.kpis.avgContribPerAgent).toBe(0);
    expect(r.subscribersView.kpis.kycVerifiedPct).toBe(0); // no subscribers → 0, not 100
    expect(r.subscribersView.gender).toEqual([
      { name: 'Male', value: 0 },
      { name: 'Female', value: 0 },
    ]);
    expect(r.subscribersView.age).toHaveLength(5);
    expect(r.contributionsView.trend).toEqual([]);
    expect(r.contributionsView.cumulative).toEqual([]);
    // A12-008: no non-zero month anywhere → no fair YoY baseline → null, not a
    // fabricated 0% ("no change" would be a lie when there is nothing to compare).
    expect(r.contributionsView.kpis).toEqual({ thisMonth: 0, momPct: 0, yoyPct: null, monthlyAvg: 0 });
    expect(r.commissionsView.kpis).toEqual({ total: 0, paid: 0, due: 0, settlementRate: 0 });
    expect(r.commissionsView.duesByAgent).toEqual([]);
    expect(r.commissionsView.settlements).toEqual([]);

    // No NaN anywhere in the KPI blocks.
    const allNums = [
      ...Object.values(r.header),
      ...Object.values(r.agentsView.kpis),
      ...Object.values(r.subscribersView.kpis),
      ...Object.values(r.contributionsView.kpis),
      ...Object.values(r.commissionsView.kpis),
    ];
    for (const n of allNums) expect(Number.isNaN(n)).toBe(false);
  });

  it('handles zero monthly series without NaN MoM/YoY', () => {
    const { contributionsView } = build({
      metrics: { ...metrics, monthlyContributions: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    });
    expect(contributionsView.kpis.momPct).toBe(0);
    // A12-008: an all-zero series has no non-zero baseline to compare against.
    expect(contributionsView.kpis.yoyPct).toBeNull();
    expect(contributionsView.kpis.monthlyAvg).toBe(0);
    expect(contributionsView.cumulative[11].total).toBe(0);
  });
});

describe('build*Export', () => {
  it('buildAgentsExport: one row per agent with the 8 expected columns', () => {
    const { agentsView } = build();
    const { rows, columns } = buildAgentsExport(agentsView);
    expect(columns.map((c) => c.key)).toEqual([
      'name', 'status', 'subscribers', 'activeRate', 'contributions', 'aum', 'commissionDue', 'commissionPaid',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      name: 'James Okello',
      status: 'Active',
      subscribers: 156,
      activeRate: 72,
      contributions: 9_000_000,
      aum: 5_000_000,
      commissionDue: 250_000,
      commissionPaid: 100_000,
    });
    expect(rows[2].status).toBe('Inactive');
  });

  it('buildSubscribersExport: composition rows for status/gender/age/KYC', () => {
    const { subscribersView } = build();
    const { rows, columns } = buildSubscribersExport(subscribersView);
    expect(columns.map((c) => c.key)).toEqual(['segment', 'category', 'value']);
    // 2 status + 2 gender + 5 age + 3 KYC = 12 rows.
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => r.segment === 'Status' && r.category === 'Active').value).toBe(600);
    expect(rows.find((r) => r.segment === 'Gender (%)' && r.category === 'Male').value).toBe(58);
    expect(rows.find((r) => r.segment === 'Age band' && r.category === '26-35').value).toBe(400);
    expect(rows.find((r) => r.segment === 'KYC' && r.category === 'Verified').value).toBe(970);
  });

  it('buildContributionsExport: one row per month with month/contributions/cumulative', () => {
    const { contributionsView } = build();
    const { rows, columns } = buildContributionsExport(contributionsView);
    expect(columns.map((c) => c.key)).toEqual(['month', 'contributions', 'cumulative']);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ month: 'Jul', contributions: 10, cumulative: 10 });
    expect(rows[11].cumulative).toBe(174); // sum of the whole series
  });

  it('buildCommissionsExport: dues-by-agent rows', () => {
    const { commissionsView } = build();
    const { rows, columns } = buildCommissionsExport(commissionsView);
    expect(columns.map((c) => c.key)).toEqual(['agent', 'pending']);
    expect(rows).toEqual([
      { agent: 'James Okello', pending: 250_000 },
      { agent: 'Grace Namubiru', pending: 150_000 },
    ]);
  });

  it('buildSettlementsExport: settlement history rows (newest first, branch-scoped)', () => {
    const { commissionsView } = build();
    const { rows, columns } = buildSettlementsExport(commissionsView);
    expect(columns.map((c) => c.key)).toEqual(['agent', 'paid', 'txnRef', 'paidDate', 'lines']);
    expect(rows).toEqual([
      { agent: 'Grace Namubiru', paid: 50_000, txnRef: 'TX-2', paidDate: '2026-05-20', lines: 1 },
      { agent: 'James Okello', paid: 100_000, txnRef: 'TX-1', paidDate: '2026-05-10', lines: 2 },
    ]);
  });

  it('build*Export tolerate empty views without throwing', () => {
    expect(buildAgentsExport({}).rows).toEqual([]);
    expect(buildSubscribersExport({}).rows).toHaveLength(3); // 3 KYC rows always emitted
    expect(buildContributionsExport({}).rows).toEqual([]);
    expect(buildCommissionsExport({}).rows).toEqual([]);
    expect(buildSettlementsExport({}).rows).toEqual([]);
  });
});
