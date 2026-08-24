// Employer service tests — UNIFIED MODEL (0043–0045) + UNIFIED CONTRIBUTION
// MODEL (migration 0092). The employer's staff are tagged subscribers; funding is
// a single company-wide config (Issue 2) applied by
// submit_employer_contribution_run (own + employer-source transactions).
//
// TWO-LEG run math (per ACTIVE member, derived from `compensation`). Both legs are
// INDEPENDENT shares of compensation and either may be zero:
//   employeeLeg = round(comp × employeePct / 100)
//   employerLeg = round(comp × employerPct / 100)
// The employer leg is NEVER a function of the employee leg (that was the deleted
// `employerMatchPct` basis), and there is no cap and no minimum.
//
// ⚠️ These tests must NEVER re-implement that math. It lives in exactly one place —
// `deriveContributionLegs` in src/utils/contributionModel.js, mirrored in PL/pgSQL
// by 0092 — and a hand-copied mirror here is worse than useless: at the seeded
// 10%/5% rates the OLD formula (10% + a 50% match of that leg) yields byte-identical
// shillings, so a local copy would go on passing while the service regressed.
// Hence: derive from the shared helper, and pin the resulting absolute totals below
// so a seed drift is loud rather than silently self-healing.
//
// Each leg > 0 posts a transaction (employee leg source:'own', employer leg
// source:'employer'). grandTotal = employerTotal + employeeTotal + insuranceTotal
// (0066); linesCreated counts DISTINCT funded members. NO commission side-effects.
//
// Two branches, mirroring subscriber.test.js:
//   * real (Supabase) branch — asserts the RPC/select call SHAPE.
//   * mock-fallback branch (VITE_USE_SUPABASE=false) — exercises the roster +
//     the two-leg employer-run math, suspended skips, and nonce idempotency.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeSupabaseMock } from '../../test/supabaseMock';
import { EMPLOYER, MEMBERS } from '../../data/employerSeed';
import { groupInsurancePremiumPerMember } from '../../utils/groupInsurance';
import { deriveContributionLegs, isLegZero, normalizeContributionConfig } from '../../utils/contributionModel';

const supabaseMock = makeSupabaseMock();

vi.mock('@/services/supabaseClient', () => ({
  supabase: supabaseMock, default: supabaseMock,
  getToken: vi.fn(), setToken: vi.fn(), clearToken: vi.fn(),
}));
vi.mock('../supabaseClient', () => ({
  supabase: supabaseMock, default: supabaseMock,
  getToken: vi.fn(), setToken: vi.fn(), clearToken: vi.fn(),
}));

beforeEach(() => supabaseMock.__reset());

const CFG = EMPLOYER.defaultContributionConfig;
const ACTIVE = MEMBERS.filter((m) => m.status === 'active');

/**
 * Expected two-leg contribution for one member under the company config.
 *
 * A pure delegation to the SHARED helper — the same function the employer-service
 * mock, the seed, the run-wizard preview and (mirrored in SQL) the live RPC all
 * call. Deriving here instead of restating the formula means this suite genuinely
 * tests the service against the model rather than against a second copy of it.
 * Derived from the member's `compensation`, NOT a self-set saving amount.
 */
function expectedLegs(m) {
  return deriveContributionLegs(CFG, Number(m.compensation ?? 0));
}
const EXPECTED_EMPLOYER_TOTAL = ACTIVE.reduce((s, m) => s + expectedLegs(m).employerLeg, 0);
const EXPECTED_EMPLOYEE_TOTAL = ACTIVE.reduce((s, m) => s + expectedLegs(m).employeeLeg, 0);
// Group insurance premium leg (employer-funded) = Σ enabled products at 0.2%/mo
// of cover — mirrors groupInsurancePremiumPerMember + the run RPC (0067). When on,
// every active member is funded and gets one (total-premium) insurance leg.
const EXPECTED_INSURANCE_LEG = groupInsurancePremiumPerMember(CFG);
// Distinct members funded = active members with at least one non-zero leg
// (pension OR insurance).
const EXPECTED_FUNDED = ACTIVE.filter((m) => {
  const { employeeLeg, employerLeg } = expectedLegs(m);
  return employeeLeg > 0 || employerLeg > 0 || EXPECTED_INSURANCE_LEG > 0;
}).length;
const EXPECTED_INSURANCE_TOTAL = EXPECTED_FUNDED * EXPECTED_INSURANCE_LEG;

// =============================================================================
// The seed contract these expectations rest on.
//
// Every EXPECTED_* above is DERIVED from the seed at import time, which makes the
// run assertions self-healing — and that is a hazard, not a feature: a seed edit
// that halved the company's funding would move both sides of every `toBe` and the
// suite would stay green. So pin the absolute shillings once, here. If this block
// fails, the SEED changed and the reseeded live ledger + the docs need to move with
// it; if only the run assertions below fail, the SERVICE regressed.
// =============================================================================
describe('employer seed contribution contract', () => {
  it('emp-001 is on the percent-only two-leg config (no mode, no basis keys)', () => {
    const c = normalizeContributionConfig(CFG);
    expect(c).toMatchObject({ employeePct: 10, employerPct: 5 });
    // The deleted keys must not linger in the seed — nothing reads them for
    // funding any more, and a stale `mode` re-routes normalizeContributionConfig
    // down its legacy branch.
    expect(CFG).not.toHaveProperty('mode');
    expect(CFG).not.toHaveProperty('employerMatchPct');
    expect(CFG).not.toHaveProperty('matchPct');
    // 0093 removed the per-leg basis and its flat-amount partner.
    expect(CFG).not.toHaveProperty('employeeBasis');
    expect(CFG).not.toHaveProperty('employerBasis');
    expect(CFG).not.toHaveProperty('employeeAmount');
    expect(CFG).not.toHaveProperty('employerAmount');
    // Both legs fund real money, so the run assertions below exercise both paths.
    expect(isLegZero(c.employeePct)).toBe(false);
    expect(isLegZero(c.employerPct)).toBe(false);
  });

  it('the 19-member active run population totals the seeded shillings exactly', () => {
    expect(EXPECTED_FUNDED).toBe(19);
    expect(EXPECTED_EMPLOYEE_TOTAL).toBe(1_972_000);
    expect(EXPECTED_EMPLOYER_TOTAL).toBe(986_000);
    // The employer leg is HALF the employee leg here only because 5% is half of
    // 10% — a coincidence of the rates, never a derivation. See the header note.
    expect(EXPECTED_INSURANCE_LEG).toBe(40_000);
    expect(EXPECTED_INSURANCE_TOTAL).toBe(760_000);
    expect(EXPECTED_EMPLOYEE_TOTAL + EXPECTED_EMPLOYER_TOTAL + EXPECTED_INSURANCE_TOTAL)
      .toBe(3_718_000);
  });
});

// =============================================================================
// Real (Supabase) branch — call shape
// =============================================================================
describe('employer service — real (Supabase) branch', () => {
  let svc;
  beforeEach(async () => { svc = await import('../employer'); });

  describe('submitContributionRun → submit_employer_contribution_run', () => {
    it('passes p_period_label / p_method / p_nonce (no rows) and returns data', async () => {
      supabaseMock.__queueRpc('submit_employer_contribution_run', {
        data: { runId: 'run-x', linesCreated: 14, employerTotal: 700000, employeeTotal: 0, grandTotal: 700000, skipped: [] },
        error: null,
      });
      const result = await svc.submitContributionRun('emp-001', { periodLabel: 'May 2026', method: 'Bank transfer', nonce: 'n-1' });
      expect(result.runId).toBe('run-x');
      const call = supabaseMock.__getRpcCalls('submit_employer_contribution_run').at(-1);
      expect(call.args.p_period_label).toBe('May 2026');
      expect(call.args.p_method).toBe('Bank transfer');
      expect(call.args.p_nonce).toBe('n-1');
    });

    it('throws on RPC error', async () => {
      supabaseMock.__queueRpc('submit_employer_contribution_run', { data: null, error: { message: 'permission denied' } });
      await expect(svc.submitContributionRun('emp-001', { nonce: 'n' })).rejects.toMatchObject({ message: 'permission denied' });
    });
  });

  describe('createSubscriberFromEmployerOnboard → create_subscriber_from_employer_onboard', () => {
    it('passes payload / calling_employer_id / p_nonce and wraps the id', async () => {
      supabaseMock.__queueRpc('create_subscriber_from_employer_onboard', { data: 's-999', error: null });
      const res = await svc.createSubscriberFromEmployerOnboard('emp-001', { fullName: 'Jane Akello', phone: '700100099' }, 'n-2');
      expect(res).toEqual({ subscriberId: 's-999' });
      const call = supabaseMock.__getRpcCalls('create_subscriber_from_employer_onboard').at(-1);
      expect(call.args.calling_employer_id).toBe('emp-001');
      expect(call.args.p_nonce).toBe('n-2');
      expect(call.args.payload.fullName).toBe('Jane Akello');
    });
  });

  describe('applyGroupInsurance', () => {
    it('calls apply_group_insurance with p_cover', async () => {
      supabaseMock.__queueRpc('apply_group_insurance', { data: { updated: 16, cover: 5000000 }, error: null });
      const summary = await svc.applyGroupInsurance('emp-001', { cover: 5000000 });
      expect(summary).toEqual({ updated: 16, cover: 5000000 });
      expect(supabaseMock.__getRpcCalls('apply_group_insurance').at(-1).args.p_cover).toBe(5000000);
    });
  });

  describe('setEmployerStatus → set_employer_status (admin, 0060)', () => {
    it('passes p_employer_id / p_status and returns the detach summary', async () => {
      supabaseMock.__queueRpc('set_employer_status', {
        data: { id: 'emp-001', status: 'inactive', membersDetached: 16 }, error: null,
      });
      const res = await svc.setEmployerStatus('emp-001', 'inactive');
      expect(res).toEqual({ id: 'emp-001', status: 'inactive', membersDetached: 16 });
      const call = supabaseMock.__getRpcCalls('set_employer_status').at(-1);
      expect(call.args.p_employer_id).toBe('emp-001');
      expect(call.args.p_status).toBe('inactive');
    });
    it('throws on RPC error', async () => {
      supabaseMock.__queueRpc('set_employer_status', { data: null, error: { message: 'permission denied' } });
      await expect(svc.setEmployerStatus('emp-001', 'inactive')).rejects.toMatchObject({ message: 'permission denied' });
    });
  });

  describe('getEmployees → subscribers WHERE employer_id', () => {
    it('selects subscribers filtered by employer_id and maps the member shape', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: [{ id: 's-1', employer_id: 'emp-001', name: 'Jane', phone: '700100099', is_active: true, kyc_status: 'pending',
          subscriber_balances: { total_balance: 300000, retirement_balance: 240000, emergency_balance: 60000, units: 300 },
          contribution_schedules: { amount: 100000, retirement_pct: 80, emergency_pct: 20, frequency: 'monthly' } }],
        error: null,
      });
      const members = await svc.getEmployees('emp-001');
      expect(supabaseMock.__getFromCalls('subscribers').at(-1).chain.eq).toHaveBeenCalledWith('employer_id', 'emp-001');
      expect(members[0]).toMatchObject({ id: 's-1', status: 'active', netBalance: 300000, monthlyContribution: 100000, kycStatus: 'pending' });
    });

    it('maps a missing kyc_status to "complete" (legacy rows are not "pending")', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: [{ id: 's-2', employer_id: 'emp-001', name: 'Sam', is_active: true }],
        error: null,
      });
      const members = await svc.getEmployees('emp-001');
      expect(members[0].kycStatus).toBe('complete');
    });
  });

  describe('getEmployerMetrics', () => {
    it('calls the get_employer_metrics RPC', async () => {
      supabaseMock.__queueRpc('get_employer_metrics', { data: { headcount: 16, active: 14 }, error: null });
      const m = await svc.getEmployerMetrics();
      expect(m.headcount).toBe(16);
      expect(supabaseMock.__getRpcCalls('get_employer_metrics').length).toBe(1);
    });

    // A14-001: on live emp-001 data the RPC's own totalContributions summed EVERY
    // type='contribution' row for a tagged member (including personal savings
    // from before/outside employer sponsorship) to 182,689,000, while the
    // run-linked leg tiles/Runs page totalled 15,734,000 — an 11.6x gap on one
    // screen. This pins that getEmployerMetrics() no longer trusts the RPC's
    // contribution fields: it overrides them with the SAME run-linked source
    // getEmployerContributions() exposes, so the Hero/leg-tiles/Runs/Analytics
    // can never disagree again, while demographic fields the RPC computes
    // correctly (headcount/active/suspended/totalBalance/insuredCount) pass
    // through untouched.
    it('overrides the RPC contribution totals with the run-linked total (not the RPC sum)', async () => {
      const thisYear = new Date().getFullYear();
      supabaseMock.__queueRpc('get_employer_metrics', {
        data: {
          headcount: 21, active: 19, suspended: 2, totalBalance: 197491903,
          // Inflated (all-history) figures the RPC computes today — must be
          // REPLACED, not surfaced.
          totalContributions: 182689000, ownContributions: 120292000, employerContributions: 62397000,
          employerYtd: 62397000, employeeYtd: 120292000,
          insuredCount: 21,
        },
        error: null,
      });
      supabaseMock.__queueFrom('transactions', {
        data: [
          // Run-linked (contribution_run_id set) — the only rows getEmployerContributions
          // would actually return (its query filters `.not('contribution_run_id','is',null)`).
          { id: 't-1', subscriber_id: 'empe-001', type: 'contribution', source: 'own', amount: 105000, date: `${thisYear}-05-15T12:00:00.000Z`, contribution_run_id: 'run-001' },
          { id: 't-2', subscriber_id: 'empe-001', type: 'contribution', source: 'employer', amount: 210000, date: `${thisYear - 5}-05-15T12:00:00.000Z`, contribution_run_id: 'run-001' },
        ],
        error: null,
      });

      const m = await svc.getEmployerMetrics('emp-001');

      // Demographic fields: untouched pass-through from the RPC.
      expect(m).toMatchObject({ headcount: 21, active: 19, suspended: 2, totalBalance: 197491903, insuredCount: 21 });
      // Contribution fields: the run-linked sum (105000 + 210000 = 315000), NOT
      // the RPC's inflated 182,689,000.
      expect(m.totalContributions).toBe(315000);
      expect(m.ownContributions).toBe(105000);
      expect(m.employerContributions).toBe(210000);
      expect(m.totalContributions).not.toBe(182689000);
      // YTD splits by the transaction's own year, not the RPC's YTD fields.
      expect(m.employeeYtd).toBe(105000); // this year's 'own' txn only
      expect(m.employerYtd).toBe(0); // the 'employer' txn is 5 years old
    });

    it('with no run-linked contributions, reports 0 rather than the RPC sum (post-cleanup empty state)', async () => {
      supabaseMock.__queueRpc('get_employer_metrics', {
        data: { headcount: 3, active: 3, totalContributions: 21300000, ownContributions: 21300000, employerContributions: 0 },
        error: null,
      });
      supabaseMock.__queueFrom('transactions', { data: [], error: null });
      const m = await svc.getEmployerMetrics('emp-002');
      expect(m.totalContributions).toBe(0);
      expect(m.ownContributions).toBe(0);
      expect(m.employerContributions).toBe(0);
    });
  });

  describe('removeEmployee', () => {
    it('calls the remove_employer_member RPC (un-link, not suspend)', async () => {
      supabaseMock.__queueRpc('remove_employer_member', { data: { id: 's-1', removed: true }, error: null });
      const res = await svc.removeEmployee('emp-001', 's-1');
      expect(res).toMatchObject({ id: 's-1', removed: true });
      expect(supabaseMock.__getRpcCalls('remove_employer_member').length).toBe(1);
    });
  });

  describe('updateMemberCompensation → update_employer_member_compensation (v2, 0062)', () => {
    it('passes p_subscriber_id / p_compensation and returns the updated row', async () => {
      supabaseMock.__queueRpc('update_employer_member_compensation', {
        data: { id: 's-1', compensation: 1500000, updated: 1 }, error: null,
      });
      const res = await svc.updateMemberCompensation('emp-001', 's-1', 1500000);
      expect(res).toMatchObject({ id: 's-1', compensation: 1500000, updated: 1 });
      const call = supabaseMock.__getRpcCalls('update_employer_member_compensation').at(-1);
      expect(call.args.p_subscriber_id).toBe('s-1');
      expect(call.args.p_compensation).toBe(1500000);
    });

    it('throws on RPC error', async () => {
      supabaseMock.__queueRpc('update_employer_member_compensation', { data: null, error: { message: 'permission denied' } });
      await expect(svc.updateMemberCompensation('emp-001', 's-1', 1000)).rejects.toMatchObject({ message: 'permission denied' });
    });
  });

  // ─── Seven previously-untested reads/writes (audit §7b.6) ─────────────────

  describe('getEmployer', () => {
    it('selects the employer by id and maps the row', async () => {
      supabaseMock.__queueFrom('employers', {
        data: { id: 'emp-001', name: 'Acme Ltd', sector: 'Manufacturing', registration_no: 'RN-1', district: 'Kampala' },
        error: null,
      });
      const emp = await svc.getEmployer('emp-001');
      expect(supabaseMock.__getFromCalls('employers').at(-1).chain.eq).toHaveBeenCalledWith('id', 'emp-001');
      expect(emp).toMatchObject({ id: 'emp-001', name: 'Acme Ltd', sector: 'Manufacturing', registrationNo: 'RN-1', district: 'Kampala' });
    });

    it('returns null when the row is missing (PGRST116)', async () => {
      supabaseMock.__queueFrom('employers', { data: null, error: { code: 'PGRST116', message: 'no row' } });
      expect(await svc.getEmployer('emp-999')).toBeNull();
    });
  });

  describe('getEmployee', () => {
    it('selects one member, fetches their txn breakdown, and folds own/employer totals', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: { id: 's-1', employer_id: 'emp-001', name: 'Jane', is_active: true,
          subscriber_balances: { total_balance: 300000 } },
        error: null,
      });
      // fetchMemberBreakdown reads transactions (type=contribution) split by source.
      supabaseMock.__queueFrom('transactions', {
        data: [
          { amount: 100000, source: 'own', type: 'contribution' },
          { amount: 40000, source: 'employer', type: 'contribution' },
        ],
        error: null,
      });
      const member = await svc.getEmployee('s-1');
      expect(supabaseMock.__getFromCalls('subscribers').at(-1).chain.eq).toHaveBeenCalledWith('id', 's-1');
      expect(member).toMatchObject({
        id: 's-1', name: 'Jane', netBalance: 300000,
        ownContributions: 100000, employerContributions: 40000, totalContributions: 140000,
      });
    });

    it('returns null when the member is missing (PGRST116)', async () => {
      supabaseMock.__queueFrom('subscribers', { data: null, error: { code: 'PGRST116', message: 'no row' } });
      expect(await svc.getEmployee('s-999')).toBeNull();
    });

    it('short-circuits with null for a falsy id (no network)', async () => {
      expect(await svc.getEmployee('')).toBeNull();
      expect(supabaseMock.__getFromCalls('subscribers')).toHaveLength(0);
    });
  });

  describe('getContributionRun', () => {
    it('fetches the run header + its lines, attaching the member name to each line', async () => {
      supabaseMock.__queueFrom('contribution_runs', {
        data: { id: 'run-1', employer_id: 'emp-001', period_label: 'May 2026', status: 'completed', grand_total: 700000 },
        error: null,
      });
      supabaseMock.__queueFrom('transactions', {
        data: [{ id: 't-1', subscriber_id: 's-1', amount: 50000, type: 'contribution', source: 'employer',
          contribution_run_id: 'run-1', subscribers: { name: 'Jane' } }],
        error: null,
      });
      const { run, lines } = await svc.getContributionRun('run-1');
      expect(supabaseMock.__getFromCalls('contribution_runs').at(-1).chain.eq).toHaveBeenCalledWith('id', 'run-1');
      expect(supabaseMock.__getFromCalls('transactions').at(-1).chain.eq).toHaveBeenCalledWith('contribution_run_id', 'run-1');
      expect(run).toMatchObject({ id: 'run-1', periodLabel: 'May 2026', grandTotal: 700000 });
      expect(lines[0]).toMatchObject({ id: 't-1', amount: 50000, memberName: 'Jane' });
    });

    it('returns null when the run is missing (PGRST116)', async () => {
      supabaseMock.__queueFrom('contribution_runs', { data: null, error: { code: 'PGRST116', message: 'no row' } });
      expect(await svc.getContributionRun('run-999')).toBeNull();
    });
  });

  describe('getEmployeeContributions', () => {
    it('selects contribution txns for one member newest-first and maps them', async () => {
      supabaseMock.__queueFrom('transactions', {
        data: [{ id: 't-1', subscriber_id: 's-1', amount: 50000, type: 'contribution', source: 'employer', date: '2026-05-01' }],
        error: null,
      });
      const rows = await svc.getEmployeeContributions('s-1');
      const call = supabaseMock.__getFromCalls('transactions').at(-1);
      expect(call.chain.eq).toHaveBeenCalledWith('subscriber_id', 's-1');
      expect(call.chain.eq).toHaveBeenCalledWith('type', 'contribution');
      expect(call.chain.order).toHaveBeenCalledWith('date', { ascending: false });
      expect(rows[0]).toMatchObject({ id: 't-1', amount: 50000, source: 'employer' });
    });

    it('short-circuits with [] for a falsy id (no network)', async () => {
      expect(await svc.getEmployeeContributions('')).toEqual([]);
      expect(supabaseMock.__getFromCalls('transactions')).toHaveLength(0);
    });
  });

  describe('getEmployerLeaderboard', () => {
    it('ranks the employer against the seeded competitor field, flagging "you"', async () => {
      // getContributionRuns → newest run's PENSION total (employee + employer) is
      // the employer's monthly leaderboard figure (insurance is excluded).
      supabaseMock.__queueFrom('contribution_runs', {
        data: [{ id: 'run-1', employer_id: 'emp-001', employee_total: 6_000_000_000, employer_total: 3_000_000_000, insurance_total: 500_000_000, grand_total: 9_500_000_000, run_at: '2026-05-01' }],
        error: null,
      });
      // getEmployer → company name.
      supabaseMock.__queueFrom('employers', { data: { id: 'emp-001', name: 'Acme Ltd' }, error: null });
      const board = await svc.getEmployerLeaderboard('emp-001');
      expect(Array.isArray(board)).toBe(true);
      // Best-first ranking with consecutive ranks.
      expect(board.map((e) => e.rank)).toEqual(board.map((_, i) => i + 1));
      // A huge grandTotal puts "you" at rank 1.
      const you = board.find((e) => e.isYou);
      expect(you).toBeDefined();
      expect(you.name).toBe('Acme Ltd');
      expect(you.rank).toBe(1);
    });

    it('returns [] for a falsy employerId (no network)', async () => {
      expect(await svc.getEmployerLeaderboard('')).toEqual([]);
    });
  });

  describe('updateEmployerProfile', () => {
    it('passes a profile-only patch (no insurance leg) and maps the returned employer', async () => {
      supabaseMock.__queueRpc('update_employer_profile', {
        data: { id: 'emp-001', name: 'Acme Renamed', sector: 'Tech' }, error: null,
      });
      const emp = await svc.updateEmployerProfile({ name: 'Acme Renamed', sector: 'Tech' });
      expect(emp).toMatchObject({ id: 'emp-001', name: 'Acme Renamed', sector: 'Tech' });
      const call = supabaseMock.__getRpcCalls('update_employer_profile').at(-1);
      expect(call.args.p_patch).toEqual({ name: 'Acme Renamed', sector: 'Tech' });
      // No insurance leg when insuranceEnabled is absent.
      expect('p_insurance_enabled' in call.args).toBe(false);
      expect('p_group_cover' in call.args).toBe(false);
    });

    it('folds the company-wide insurance leg into the same RPC call when insuranceEnabled is present', async () => {
      supabaseMock.__queueRpc('update_employer_profile', { data: { id: 'emp-001', name: 'Acme' }, error: null });
      await svc.updateEmployerProfile({ contactName: 'Sam', insuranceEnabled: true, groupCover: 5000000 });
      const call = supabaseMock.__getRpcCalls('update_employer_profile').at(-1);
      // Insurance control keys are stripped from p_patch and become their own RPC args.
      expect(call.args.p_patch).toEqual({ contactName: 'Sam' });
      expect(call.args.p_insurance_enabled).toBe(true);
      expect(call.args.p_group_cover).toBe(5000000);
    });

    it('throws on RPC error', async () => {
      supabaseMock.__queueRpc('update_employer_profile', { data: null, error: { message: 'permission denied' } });
      await expect(svc.updateEmployerProfile({ name: 'X' })).rejects.toMatchObject({ message: 'permission denied' });
    });
  });

  describe('cancelEmployerInvite', () => {
    it('calls the cancel_employer_invite RPC with p_token', async () => {
      supabaseMock.__queueRpc('cancel_employer_invite', { data: null, error: null });
      await svc.cancelEmployerInvite('inv-1');
      const call = supabaseMock.__getRpcCalls('cancel_employer_invite').at(-1);
      expect(call.args.p_token).toBe('inv-1');
    });

    it('throws on RPC error', async () => {
      supabaseMock.__queueRpc('cancel_employer_invite', { data: null, error: { message: 'not found' } });
      await expect(svc.cancelEmployerInvite('inv-x')).rejects.toMatchObject({ message: 'not found' });
    });
  });

  // ─── Admin-gated employer RPCs (0049) — audit §7b.5 ───────────────────────

  describe('createEmployer (admin) → create_employer RPC', () => {
    it('passes snake_case p_* args and maps the returned employer', async () => {
      supabaseMock.__queueRpc('create_employer', {
        data: { id: 'emp-new-1', name: 'New Co', sector: 'Retail', registration_no: 'RN-9',
          contact_name: 'Pat', contact_phone: '+256700000000', contact_email: 'pat@x.com', district: 'Jinja' },
        error: null,
      });
      const emp = await svc.createEmployer({
        name: 'New Co', sector: 'Retail', registrationNo: 'RN-9',
        contactName: 'Pat', contactPhone: '+256700000000', contactEmail: 'pat@x.com', district: 'Jinja',
      });
      expect(emp).toMatchObject({ id: 'emp-new-1', name: 'New Co', sector: 'Retail', registrationNo: 'RN-9', district: 'Jinja' });
      const call = supabaseMock.__getRpcCalls('create_employer').at(-1);
      expect(call.args).toMatchObject({
        p_name: 'New Co', p_sector: 'Retail', p_registration_no: 'RN-9',
        p_contact_name: 'Pat', p_contact_phone: '+256700000000', p_contact_email: 'pat@x.com',
        p_district: 'Jinja',
      });
    });

    it('defaults optional fields to null when omitted (v2: no cadence / config args)', async () => {
      supabaseMock.__queueRpc('create_employer', { data: { id: 'emp-new-2', name: 'Minimal Co' }, error: null });
      await svc.createEmployer({ name: 'Minimal Co' });
      const call = supabaseMock.__getRpcCalls('create_employer').at(-1);
      expect(call.args.p_sector).toBeNull();
      expect(call.args.p_registration_no).toBeNull();
      // v2 (migration 0062): the admin UI no longer sends cadence/config — the
      // RPC still accepts them (defaulting server-side), but the client must NOT
      // pass them. funding is driven entirely by per-member `compensation`.
      expect('p_payroll_cadence' in call.args).toBe(false);
      expect('p_default_contribution_config' in call.args).toBe(false);
    });

    it('throws when the RPC returns an error (non-admin caller)', async () => {
      supabaseMock.__queueRpc('create_employer', { data: null, error: { code: 'P0001', message: 'admin only' } });
      await expect(svc.createEmployer({ name: 'X' })).rejects.toMatchObject({ code: 'P0001' });
    });
  });

  describe('getAllEmployersMetrics (admin) → get_all_employers_metrics RPC', () => {
    it('calls the no-arg RPC and returns the rows array', async () => {
      const rows = [{ id: 'emp-001', name: 'Acme', headcount: 16, activeCount: 14 }];
      supabaseMock.__queueRpc('get_all_employers_metrics', { data: rows, error: null });
      const result = await svc.getAllEmployersMetrics();
      expect(result).toEqual(rows);
      const calls = supabaseMock.__getRpcCalls('get_all_employers_metrics');
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toBeUndefined();
    });

    it('returns [] when the RPC data is null', async () => {
      supabaseMock.__queueRpc('get_all_employers_metrics', { data: null, error: null });
      expect(await svc.getAllEmployersMetrics()).toEqual([]);
    });

    it('throws on RPC error', async () => {
      supabaseMock.__queueRpc('get_all_employers_metrics', { data: null, error: { code: 'P0001', message: 'admin only' } });
      await expect(svc.getAllEmployersMetrics()).rejects.toMatchObject({ code: 'P0001' });
    });
  });
});

// =============================================================================
// Mock-fallback branch — roster + employer-run math + idempotency
// =============================================================================
describe('employer service — mock-fallback branch (IS_SUPABASE_ENABLED=false)', () => {
  let svc;
  beforeEach(async () => {
    vi.stubEnv('VITE_USE_SUPABASE', 'false');
    vi.resetModules();
    vi.doMock('../supabaseClient', () => ({
      supabase: supabaseMock, default: supabaseMock,
      getToken: vi.fn(), setToken: vi.fn(), clearToken: vi.fn(),
    }));
    svc = await import('../employer');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('getEmployees returns the seeded members (member shape)', async () => {
    const members = await svc.getEmployees('emp-001');
    expect(members).toHaveLength(MEMBERS.length);
    expect(members[0]).toMatchObject({ id: MEMBERS[0].id, status: 'active' });
    expect(members[0].netBalance).toBeGreaterThan(0);
  });

  it('seeded members are all KYC-complete (pending KYC = pending invites, not members)', async () => {
    const members = await svc.getEmployees('emp-001');
    // Real signup always completes KYC; no employer member is ever pending.
    const pending = members.filter((m) => m.kycStatus === 'pending' || m.kycStatus === 'incomplete');
    expect(pending).toHaveLength(0);
    expect(members.every((m) => typeof m.kycStatus === 'string')).toBe(true);
  });

  it('removeEmployee un-links a member from the roster (mock) — it does not suspend', async () => {
    const before = await svc.getEmployees('emp-001');
    const target = before.find((m) => m.status === 'active');
    const res = await svc.removeEmployee('emp-001', target.id);
    expect(res).toMatchObject({ id: target.id, removed: true });

    const after = await svc.getEmployees('emp-001');
    expect(after).toHaveLength(before.length - 1);
    expect(after.find((m) => m.id === target.id)).toBeUndefined();
    // Other members are untouched (no status change anywhere).
    expect(after.filter((m) => m.status === 'suspended')).toHaveLength(
      before.filter((m) => m.status === 'suspended').length,
    );
  });

  it('bulkCreateEmployerInvites creates one pending invite per row (mock)', async () => {
    const res = await svc.bulkCreateEmployerInvites([
      { fullName: 'Bulk One', phone: '700000001', email: 'one@example.com' },
      { fullName: 'Bulk Two', phone: '700000002', email: 'two@example.com' },
    ]);
    expect(res).toMatchObject({ created: 2, failed: 0, total: 2 });
    const pending = await svc.listPendingInvites('emp-001');
    expect(pending.length).toBe(2);
  });

  it('submitContributionRun posts BOTH legs (own + employer) to every active member (v2 two-leg)', async () => {
    const result = await svc.submitContributionRun('emp-001', { periodLabel: 'May 2026', method: 'Bank transfer', nonce: 'run-1' });
    // linesCreated = DISTINCT funded members (not transaction rows).
    expect(result.linesCreated).toBe(EXPECTED_FUNDED);
    expect(result.employerTotal).toBe(EXPECTED_EMPLOYER_TOTAL);
    expect(result.employeeTotal).toBe(EXPECTED_EMPLOYEE_TOTAL);
    // Insurance is a distinct, employer-funded third leg; grand = all three.
    expect(result.insuranceTotal).toBe(EXPECTED_INSURANCE_TOTAL);
    expect(result.grandTotal).toBe(EXPECTED_EMPLOYER_TOTAL + EXPECTED_EMPLOYEE_TOTAL + EXPECTED_INSURANCE_TOTAL);
    // The seeded company config funds BOTH legs (10% of pay from staff, 5% of pay
    // from the company — see the seed contract block above), so a run that posted
    // only one leg would still match one of the totals. Assert both are real money.
    expect(result.employeeTotal).toBeGreaterThan(0);
    expect(result.employerTotal).toBeGreaterThan(0);
    expect(result.insuranceTotal).toBeGreaterThan(0);
    // Suspended members are excluded from the run entirely (parity with the live SQL
    // `WHERE is_active`), so they never appear in skipped[] — only zero_contribution can.
    expect(result.skipped.some((s) => s.reason === 'suspended')).toBe(false);
  });

  it('writes the correct two-leg per-member transactions (own + employer) for the run', async () => {
    const result = await svc.submitContributionRun('emp-001', { periodLabel: 'May 2026', method: 'Bank transfer', nonce: 'run-legs' });
    const { run, lines } = await svc.getContributionRun(result.runId);
    expect(run.id).toBe(result.runId);

    // A member funded on both legs gets three lines: own + employer + insurance.
    const sample = ACTIVE.find((m) => {
      const { employeeLeg, employerLeg } = expectedLegs(m);
      return employeeLeg > 0 && employerLeg > 0;
    });
    const memberLines = lines.filter((l) => l.subscriberId === sample.id);
    expect(memberLines).toHaveLength(3);

    const { employeeLeg, employerLeg } = expectedLegs(sample);
    const ownLine = memberLines.find((l) => l.source === 'own');
    // The employer PENSION leg and the insurance leg both carry source='employer',
    // so disambiguate the pension leg by type='contribution'.
    const employerLine = memberLines.find((l) => l.source === 'employer' && l.type === 'contribution');
    const insuranceLine = memberLines.find((l) => l.type === 'insurance_premium');
    expect(ownLine.amount).toBe(employeeLeg);
    expect(employerLine.amount).toBe(employerLeg);
    // Both pension legs land WHOLLY in retirement (0102 / EMPLOYER_FUNDED_SPLIT).
    // The member's own retirementPct is deliberately not consulted: it governs
    // only money they add themselves, never what their employer's settings fund.
    // Asserted against the member's stored pct so this fails loudly if the split
    // is ever reconnected — `sample` carries the seed's 80/20.
    expect(Number(sample.contributionSchedule?.retirementPct)).toBeLessThan(100);
    expect(ownLine.retirementAmount).toBe(employeeLeg);
    expect(ownLine.emergencyAmount).toBe(0);
    expect(employerLine.retirementAmount).toBe(employerLeg);
    expect(employerLine.emergencyAmount).toBe(0);
    // The insurance leg is employer-funded, flat, and NOT split into ret/emg.
    expect(insuranceLine.amount).toBe(EXPECTED_INSURANCE_LEG);
    expect(insuranceLine.source).toBe('employer');
    expect(insuranceLine.retirementAmount).toBe(0);
    expect(insuranceLine.emergencyAmount).toBe(0);
    // All three legs carry the run id and no agent commission (employer source).
    expect(ownLine.contributionRunId).toBe(result.runId);
    expect(employerLine.contributionRunId).toBe(result.runId);
    expect(insuranceLine.contributionRunId).toBe(result.runId);
  });

  it('updateMemberCompensation updates the member compensation override (mock)', async () => {
    const target = ACTIVE[0];
    const res = await svc.updateMemberCompensation('emp-001', target.id, 1750000);
    expect(res).toMatchObject({ id: target.id, compensation: 1750000, updated: 1 });
    const member = await svc.getEmployee(target.id);
    expect(member.compensation).toBe(1750000);
  });

  it('is idempotent — replaying the same nonce returns the prior result', async () => {
    const a = await svc.submitContributionRun('emp-001', { periodLabel: 'May', method: 'Bank transfer', nonce: 'dup' });
    const b = await svc.submitContributionRun('emp-001', { periodLabel: 'May', method: 'Bank transfer', nonce: 'dup' });
    expect(b.employerTotal).toBe(a.employerTotal);
    expect(b.linesCreated).toBe(a.linesCreated);
  });

  it('getEmployerMetrics reports the roster counts + own/employer totals', async () => {
    const m = await svc.getEmployerMetrics();
    expect(m.headcount).toBe(MEMBERS.length);
    expect(m.active).toBe(ACTIVE.length);
    expect(m.suspended).toBe(MEMBERS.length - ACTIVE.length);
    expect(m.employerContributions).toBeGreaterThan(0);
    expect(m.ownContributions).toBeGreaterThan(0);
    // `modeSplit` (a per-member co-contribution/employer-only headcount) is DELETED
    // from both the RPC (0092) and this mock: funding is one company-wide two-leg
    // config, so there is no per-member funding shape left to split members by.
    expect(m).not.toHaveProperty('modeSplit');
  });
});

// =============================================================================
// Employer invites (KYC onboarding) — 0047 RPC call shapes
// =============================================================================
describe('employer service — invites (real Supabase branch)', () => {
  let svc; let subSvc;
  beforeEach(async () => {
    svc = await import('../employer');
    subSvc = await import('../subscriber');
  });

  // `collectSchedule` is a KYC-DEPTH flag, never a funding one: true = collect the
  // full record (insurance products + policy + both nominee sets). 0092 makes
  // create_employer_invite write it as a CONSTANT TRUE, because how complete a
  // record an invite collects has nothing to do with who pays — the employer's
  // company-wide config sets both legs, so no invitee ever states an amount.
  // These stay call-SHAPE tests (the value is whatever the RPC/row carries), but
  // the fixtures use true so the suite stops enshrining a value the RPC can no
  // longer return.
  it('createEmployerInvite passes p_prefill and returns { token, collectSchedule }', async () => {
    supabaseMock.__queueRpc('create_employer_invite', { data: { token: 'inv-1', collectSchedule: true }, error: null });
    const res = await svc.createEmployerInvite({ fullName: 'Jane Akello', phone: '700100099' });
    expect(res).toEqual({ token: 'inv-1', collectSchedule: true });
    expect(supabaseMock.__getRpcCalls('create_employer_invite').at(-1).args.p_prefill.fullName).toBe('Jane Akello');
  });

  it('listPendingInvites filters employer_invites by employer + pending and maps', async () => {
    supabaseMock.__queueFrom('employer_invites', {
      data: [{ token: 'inv-1', employer_id: 'emp-001', prefill: { fullName: 'Jane' }, collect_schedule: true, status: 'pending' }],
      error: null,
    });
    const rows = await svc.listPendingInvites('emp-001');
    const call = supabaseMock.__getFromCalls('employer_invites').at(-1);
    expect(call.chain.eq).toHaveBeenCalledWith('employer_id', 'emp-001');
    expect(call.chain.eq).toHaveBeenCalledWith('status', 'pending');
    expect(rows[0]).toMatchObject({ token: 'inv-1', collectSchedule: true, prefill: { fullName: 'Jane' } });
  });

  it('getEmployerInvite passes p_token', async () => {
    supabaseMock.__queueRpc('get_employer_invite', { data: { employerId: 'emp-001', employerName: 'X', prefill: {}, collectSchedule: true }, error: null });
    const inv = await subSvc.getEmployerInvite('inv-1');
    expect(inv.collectSchedule).toBe(true);
    expect(supabaseMock.__getRpcCalls('get_employer_invite').at(-1).args.p_token).toBe('inv-1');
  });

  it('createFromEmployerInvite passes payload / p_token / p_nonce and wraps the id', async () => {
    supabaseMock.__queueRpc('create_subscriber_from_employer_invite', { data: 's-777', error: null });
    const res = await subSvc.createFromEmployerInvite({ fullName: 'Jane' }, 'inv-1', 'n-1');
    expect(res).toEqual({ subscriberId: 's-777' });
    const call = supabaseMock.__getRpcCalls('create_subscriber_from_employer_invite').at(-1);
    expect(call.args.p_token).toBe('inv-1');
    expect(call.args.p_nonce).toBe('n-1');
    expect(call.args.payload.fullName).toBe('Jane');
  });
});
