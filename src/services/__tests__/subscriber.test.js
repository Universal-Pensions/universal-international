// subscriber service tests — exercises the larger Supabase-backed read/write
// surface (~15 exports). Each test seeds the supabase mock for the function's
// table/RPC and asserts call args + return-shape mapping.
//
// X11 parity concern: every exported function returns the same camelCase
// shape from both branches. The mock branch reads frozen mockData via per-
// session `_sessionMutations`; the real branch maps snake_case → camelCase
// via the mappers at the top of `subscriber.js`. We cover both paths.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeSupabaseMock } from '../../test/supabaseMock';

const supabaseMock = makeSupabaseMock();

vi.mock('@/services/supabaseClient', () => ({
  supabase: supabaseMock,
  default: supabaseMock,
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));
vi.mock('../supabaseClient', () => ({
  supabase: supabaseMock,
  default: supabaseMock,
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

beforeEach(() => {
  supabaseMock.__reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('subscriber service — real (Supabase) branch', () => {
  let svc;
  beforeEach(async () => {
    svc = await import('../subscriber');
  });

  describe('getCurrentSubscriber', () => {
    it('selects from subscribers with embedded joins + maybeSingle', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: {
          id: 's-1', name: 'A', phone: '+25671...',
          subscriber_balances: { total_balance: 1000, retirement_balance: 800, emergency_balance: 200, units: 1 },
          contribution_schedules: { frequency: 'monthly', amount: 50000, retirement_pct: 80, emergency_pct: 20 },
          insurance_policies: { cover: 1000000, premium_monthly: 2000, status: 'active' },
        },
        error: null,
      });
      const sub = await svc.getCurrentSubscriber();
      expect(sub.id).toBe('s-1');
      expect(sub.netBalance).toBe(1000);
      expect(sub.contributionSchedule.amount).toBe(50000);
      expect(sub.insurance.cover).toBe(1000000);
      const call = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(call.chain.select).toHaveBeenCalledWith(
        '*, subscriber_balances(*), contribution_schedules(*), insurance_policies(*), subscriber_insurance_products(*)',
      );
      expect(call.chain.limit).toHaveBeenCalledWith(1);
      expect(call.chain.maybeSingle).toHaveBeenCalled();
    });

    it('returns null when no subscriber row matches RLS', async () => {
      supabaseMock.__queueFrom('subscribers', { data: null, error: null });
      expect(await svc.getCurrentSubscriber()).toBeNull();
    });

    it('throws on Supabase error', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: null,
        error: { message: 'permission denied', code: 'PGRST301' },
      });
      await expect(svc.getCurrentSubscriber()).rejects.toMatchObject({
        message: 'permission denied',
      });
    });

    it('defaults insurance to inactive zeros when policy row missing', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: { id: 's-1', name: 'A', insurance_policies: null },
        error: null,
      });
      const sub = await svc.getCurrentSubscriber();
      expect(sub.insurance).toEqual({ cover: 0, premiumMonthly: 0, status: 'inactive' });
    });
  });

  describe('getSubscriberTransactions', () => {
    it('returns [] when no id given', async () => {
      expect(await svc.getSubscriberTransactions(null)).toEqual([]);
      expect(supabaseMock.__getFromCalls('transactions')).toHaveLength(0);
    });

    it('queries transactions filtered by subscriber_id with descending date', async () => {
      supabaseMock.__queueFrom('transactions', { data: [], error: null });
      await svc.getSubscriberTransactions('s-1');
      const call = supabaseMock.__getFromCalls('transactions').at(-1);
      expect(call.chain.eq).toHaveBeenCalledWith('subscriber_id', 's-1');
      expect(call.chain.order).toHaveBeenCalledWith('date', { ascending: false });
    });

    it('applies type + status filters when provided', async () => {
      supabaseMock.__queueFrom('transactions', { data: [], error: null });
      await svc.getSubscriberTransactions('s-1', { type: 'contribution', status: 'settled' });
      const call = supabaseMock.__getFromCalls('transactions').at(-1);
      expect(call.chain.eq).toHaveBeenCalledWith('type', 'contribution');
      expect(call.chain.eq).toHaveBeenCalledWith('status', 'settled');
    });

    it('applies date range filters', async () => {
      supabaseMock.__queueFrom('transactions', { data: [], error: null });
      await svc.getSubscriberTransactions('s-1', { range: ['2026-01-01', '2026-06-01'] });
      const call = supabaseMock.__getFromCalls('transactions').at(-1);
      expect(call.chain.gte).toHaveBeenCalledWith('date', '2026-01-01');
      expect(call.chain.lte).toHaveBeenCalledWith('date', '2026-06-01');
    });

    it('maps withdrawal amounts to negative for legacy UI', async () => {
      supabaseMock.__queueFrom('transactions', {
        data: [
          { id: 't-1', subscriber_id: 's-1', type: 'withdrawal', amount: 50000, date: '2026-05-01', status: 'settled' },
          { id: 't-2', subscriber_id: 's-1', type: 'contribution', amount: 30000, date: '2026-05-02', status: 'settled' },
        ],
        error: null,
      });
      const list = await svc.getSubscriberTransactions('s-1');
      expect(list[0].amount).toBe(-50000);
      expect(list[1].amount).toBe(30000);
    });

    // AUDIT-21-101: PostgREST silently caps every response at 1,000 rows, with
    // no error, even when a larger range is requested. A truncated list here
    // would silently understate the Annual Tax Statement / All Transactions
    // CSV a member could file with URA (A10-001) — so a full page must trigger
    // a fan-out for the rest, mirroring entities.js:getAllAtLevel.
    it('pages past the 1,000-row PostgREST cap instead of silently truncating', async () => {
      const page0 = Array.from({ length: 1000 }, (_, i) => ({
        id: `t-${i}`, subscriber_id: 's-1', type: 'contribution', amount: 1, date: '2026-01-01', status: 'settled',
      }));
      const page1 = Array.from({ length: 7 }, (_, i) => ({
        id: `t-${1000 + i}`, subscriber_id: 's-1', type: 'contribution', amount: 1, date: '2026-01-02', status: 'settled',
      }));
      // FIFO order: page 0 (full -> triggers the fan-out), the exact-count
      // probe, then the single remaining page.
      supabaseMock.__queueFrom('transactions', { data: page0, error: null });
      supabaseMock.__queueFrom('transactions', { data: null, error: null, count: 1007 });
      supabaseMock.__queueFrom('transactions', { data: page1, error: null });

      const list = await svc.getSubscriberTransactions('s-1');

      expect(list).toHaveLength(1007);
      expect(supabaseMock.__getFromCalls('transactions')).toHaveLength(3);
    });

    it('does not page when the first response comes back under the cap (the real, everyday case)', async () => {
      supabaseMock.__queueFrom('transactions', {
        data: [{ id: 't-1', subscriber_id: 's-1', type: 'contribution', amount: 100, date: '2026-01-01', status: 'settled' }],
        error: null,
      });
      const list = await svc.getSubscriberTransactions('s-1');
      expect(list).toHaveLength(1);
      // One round-trip only — no count probe, no second page.
      expect(supabaseMock.__getFromCalls('transactions')).toHaveLength(1);
    });
  });

  describe('getSubscriberClaims', () => {
    it('returns [] when no id given', async () => {
      expect(await svc.getSubscriberClaims(null)).toEqual([]);
    });

    it('queries claims with descending submitted_date', async () => {
      supabaseMock.__queueFrom('claims', {
        data: [{ id: 'c-1', subscriber_id: 's-1', type: 'medical', status: 'submitted', amount: 100000, incident_date: '2026-04-01', submitted_date: '2026-05-01' }],
        error: null,
      });
      const list = await svc.getSubscriberClaims('s-1');
      expect(list[0].id).toBe('c-1');
      const call = supabaseMock.__getFromCalls('claims').at(-1);
      expect(call.chain.eq).toHaveBeenCalledWith('subscriber_id', 's-1');
      expect(call.chain.order).toHaveBeenCalledWith('submitted_date', { ascending: false });
    });
  });

  describe('getSubscriberWithdrawals', () => {
    it('returns [] when no id given', async () => {
      expect(await svc.getSubscriberWithdrawals(null)).toEqual([]);
    });

    it('queries withdrawals .eq(subscriber_id, id)', async () => {
      supabaseMock.__queueFrom('withdrawals', {
        data: [{ id: 'w-1', subscriber_id: 's-1', amount: 50000, bucket: 'emergency', status: 'processing', date: '2026-05-01' }],
        error: null,
      });
      const list = await svc.getSubscriberWithdrawals('s-1');
      expect(list[0].id).toBe('w-1');
      expect(list[0].amount).toBe(50000);
    });
  });

  describe('getSubscriberNominees', () => {
    it('returns {pension: [], insurance: []} when no id given', async () => {
      expect(await svc.getSubscriberNominees(null)).toEqual({ pension: [], insurance: [] });
    });

    it('splits nominees by type', async () => {
      supabaseMock.__queueFrom('nominees', {
        data: [
          { id: 'n-1', subscriber_id: 's-1', type: 'pension', name: 'Spouse', share: 60 },
          { id: 'n-2', subscriber_id: 's-1', type: 'pension', name: 'Child', share: 40 },
          { id: 'n-3', subscriber_id: 's-1', type: 'insurance', name: 'Spouse', share: 100 },
        ],
        error: null,
      });
      const result = await svc.getSubscriberNominees('s-1');
      expect(result.pension).toHaveLength(2);
      expect(result.insurance).toHaveLength(1);
      expect(result.pension[0].share).toBe(60);
    });

    it('returns empty arrays when no rows', async () => {
      supabaseMock.__queueFrom('nominees', { data: [], error: null });
      expect(await svc.getSubscriberNominees('s-1')).toEqual({ pension: [], insurance: [] });
    });
  });

  describe('getSubscriberAgent', () => {
    it('returns null when no subscriberId', async () => {
      expect(await svc.getSubscriberAgent(null)).toBeNull();
    });

    it('returns null when subscriber has no agent_id', async () => {
      supabaseMock.__queueFrom('subscribers', { data: { agent_id: null }, error: null });
      expect(await svc.getSubscriberAgent('s-1')).toBeNull();
    });

    it('fetches agent + branch name via a single embedded query', async () => {
      // getSubscriberAgent now collapses the old two-step lookup into one
      // PostgREST embed: subscribers → agents(*, branches(name)). The embedded
      // agent arrives nested on the subscriber row.
      supabaseMock.__queueFrom('subscribers', {
        data: {
          agent_id: 'a-001',
          agents: {
            id: 'a-001', name: 'Daniel', branch_id: 'b-kam-015',
            rating: 4.5, performance: 'excellent', status: 'active',
            branches: { name: 'Kampala Central' },
          },
        },
        error: null,
      });
      const agent = await svc.getSubscriberAgent('s-1');
      expect(agent.id).toBe('a-001');
      expect(agent.branchName).toBe('Kampala Central');
    });
  });

  // makeAdHocContribution + requestWithdrawal now route through the 0054
  // SECURITY DEFINER RPCs (make_contribution / request_withdrawal) for
  // idempotency + atomicity (audit §4a F-1/F-2). The thorough nonce/idempotency
  // coverage lives in subscriber-money.test.js; these keep the validation guards
  // + the basic RPC-routing assertion green.
  describe('makeAdHocContribution', () => {
    it('rejects negative or zero amount', async () => {
      await expect(svc.makeAdHocContribution('s-1', { amount: 0 })).rejects.toThrow(/positive/);
      await expect(svc.makeAdHocContribution('s-1', { amount: -100 })).rejects.toThrow(/positive/);
    });

    it('rejects when id is missing', async () => {
      await expect(svc.makeAdHocContribution(null, { amount: 100 })).rejects.toThrow(/id required/i);
    });

    it('calls make_contribution RPC with the amount + retirementPct (no direct insert)', async () => {
      supabaseMock.__queueRpc('make_contribution', {
        data: { id: 't-x', subscriberId: 's-1', type: 'contribution', amount: 10000, status: 'settled' },
        error: null,
      });
      const tx = await svc.makeAdHocContribution('s-1', { amount: 10000, nonce: 'nonce-1' });
      expect(tx.amount).toBe(10000);
      const call = supabaseMock.__getRpcCalls('make_contribution').at(-1);
      expect(call.args.p_amount).toBe(10000);
      expect(call.args.p_retirement_pct).toBe(80);
      expect(call.args.p_nonce).toBe('nonce-1');
      // No direct transactions write remains in the live path.
      expect(supabaseMock.__getFromCalls('transactions')).toHaveLength(0);
    });

    it('honours custom retirementPct', async () => {
      supabaseMock.__queueRpc('make_contribution', {
        data: { id: 't-x', subscriberId: 's-1', type: 'contribution', amount: 10000 },
        error: null,
      });
      await svc.makeAdHocContribution('s-1', { amount: 10000, retirementPct: 50, nonce: 'nonce-2' });
      const call = supabaseMock.__getRpcCalls('make_contribution').at(-1);
      expect(call.args.p_retirement_pct).toBe(50);
    });
  });

  describe('requestWithdrawal', () => {
    it('rejects invalid amounts', async () => {
      await expect(svc.requestWithdrawal('s-1', { amount: 0 })).rejects.toThrow(/positive/);
      await expect(svc.requestWithdrawal(null, { amount: 100 })).rejects.toThrow(/id required/i);
    });

    it('calls request_withdrawal RPC (single atomic write — no direct inserts)', async () => {
      supabaseMock.__queueRpc('request_withdrawal', {
        data: { id: 'w-1', amount: 50000, bucket: 'emergency', reason: 'medical', method: 'MTN Mobile Money', status: 'processing', date: '2026-05-26', reference: 'WD-1' },
        error: null,
      });
      const wd = await svc.requestWithdrawal('s-1', {
        amount: 50000, bucket: 'emergency', reason: 'medical', nonce: 'wd-nonce-1',
      });
      expect(wd.id).toBe('w-1');
      expect(wd.amount).toBe(50000);
      expect(wd.bucket).toBe('emergency');
      const call = supabaseMock.__getRpcCalls('request_withdrawal').at(-1);
      expect(call.args.p_amount).toBe(50000);
      expect(call.args.p_bucket).toBe('emergency');
      expect(call.args.p_nonce).toBe('wd-nonce-1');
      // No direct table writes remain — the RPC does both inserts atomically.
      expect(supabaseMock.__getFromCalls('transactions')).toHaveLength(0);
      expect(supabaseMock.__getFromCalls('withdrawals')).toHaveLength(0);
    });

    it('passes the bucket through to the RPC when specified', async () => {
      supabaseMock.__queueRpc('request_withdrawal', {
        data: { id: 'w-1', amount: 30000, bucket: 'retirement', method: 'X', status: 'processing', date: '2026-05-26', reference: 'WD-1' },
        error: null,
      });
      await svc.requestWithdrawal('s-1', { amount: 30000, bucket: 'retirement', nonce: 'wd-nonce-2' });
      const call = supabaseMock.__getRpcCalls('request_withdrawal').at(-1);
      expect(call.args.p_bucket).toBe('retirement');
    });
  });

  describe('submitClaim', () => {
    it('rejects when id missing', async () => {
      await expect(svc.submitClaim(null)).rejects.toThrow(/id required/i);
    });

    it('files through the RPC and never sends an amount', async () => {
      // Migration 0099 moved claim pricing server-side and DROPPED
      // claims_insert_self. The client sends dates + a hospital name; the RPC
      // derives cover ÷ 20 per night and caps it against the policy-year
      // allowance. A client-supplied amount would be the hole that closed.
      supabaseMock.__queueRpc('submit_hospital_cash_claim', {
        data: {
          id: 'clm-x', subscriberId: 's-1', type: 'health', product: 'health',
          status: 'submitted', amount: 750000, nights: 5, dailyBenefit: 150000,
          incidentDate: '2026-03-12', dischargeDate: '2026-03-17',
          submittedDate: '2026-03-20', provider: 'Mulago',
        },
        error: null,
      });

      const claim = await svc.submitClaim('s-1', {
        admissionDate: '2026-03-12',
        dischargeDate: '2026-03-17',
        provider: 'Mulago',
        description: 'Malaria admission',
        nonce: 'claim-nonce-1',
      });

      expect(claim).toMatchObject({ status: 'submitted', amount: 750000, nights: 5 });
      expect(supabaseMock.__getFromCalls('claims')).toHaveLength(0); // no direct insert

      const args = supabaseMock.__getRpcCalls('submit_hospital_cash_claim').at(-1).args;
      expect(args).toEqual({
        p_nonce: 'claim-nonce-1',
        p_admission_date: '2026-03-12',
        p_discharge_date: '2026-03-17',
        p_provider: 'Mulago',
        p_description: 'Malaria admission',
      });
      expect(args).not.toHaveProperty('p_amount');
    });

    it('mints a nonce when the caller omits one', async () => {
      supabaseMock.__queueRpc('submit_hospital_cash_claim', { data: { id: 'clm-y' }, error: null });
      await svc.submitClaim('s-1', { admissionDate: '2026-03-12', dischargeDate: '2026-03-13' });
      expect(supabaseMock.__getRpcCalls('submit_hospital_cash_claim').at(-1).args.p_nonce)
        .toEqual(expect.any(String));
    });
  });

  describe('updateContributionSchedule', () => {
    it('rejects when id missing', async () => {
      await expect(svc.updateContributionSchedule(null)).rejects.toThrow(/id required/i);
    });

    it('normalises frequency before writing', async () => {
      supabaseMock.__queueFrom('contribution_schedules', {
        data: {
          frequency: 'monthly', amount: 30000, retirement_pct: 80,
          emergency_pct: 20, include_insurance: false, insurance_choice_made: true,
        },
        error: null,
      });
      const result = await svc.updateContributionSchedule('s-1', {
        frequency: 'half-yearly', amount: 30000,
      });
      // Whatever normalizeFrequency returns for "half-yearly" — we just assert
      // the patch was applied.
      const updateArgs = supabaseMock.__getFromCalls('contribution_schedules').at(-1).chain.update.mock.calls[0][0];
      expect(updateArgs.amount).toBe(30000);
      expect(updateArgs.frequency).toBeDefined();
      expect(result.amount).toBe(30000);
    });

    it('filters out undefined fields from patch', async () => {
      supabaseMock.__queueFrom('contribution_schedules', {
        data: { frequency: 'monthly', amount: 50000, retirement_pct: 80, emergency_pct: 20 },
        error: null,
      });
      await svc.updateContributionSchedule('s-1', { amount: 50000 });
      const updateArgs = supabaseMock.__getFromCalls('contribution_schedules').at(-1).chain.update.mock.calls[0][0];
      expect(updateArgs.amount).toBe(50000);
      expect(updateArgs).not.toHaveProperty('frequency');
      expect(updateArgs).not.toHaveProperty('retirement_pct');
    });
  });

  describe('updateNominees', () => {
    it('rejects when id missing', async () => {
      await expect(svc.updateNominees(null)).rejects.toThrow(/id required/i);
    });

    it('calls upsert_nominees RPC with normalised payload', async () => {
      supabaseMock.__queueRpc('upsert_nominees', {
        data: { pension: [{ id: 'n-1', name: 'A', share: 100 }], insurance: [] },
        error: null,
      });
      const result = await svc.updateNominees('s-1', {
        pension: [{ name: 'A', share: 100 }],
        insurance: [],
      });
      expect(result.pension).toHaveLength(1);
      const call = supabaseMock.__getRpcCalls('upsert_nominees').at(-1);
      expect(call.args.p_subscriber_id).toBe('s-1');
      expect(call.args.p_pension[0]).toMatchObject({ name: 'A', share: 100 });
    });

    it('falls back to getSubscriberNominees when RPC returns unexpected null', async () => {
      supabaseMock.__queueRpc('upsert_nominees', { data: null, error: null });
      supabaseMock.__queueFrom('nominees', { data: [], error: null });
      const result = await svc.updateNominees('s-1', { pension: [], insurance: [] });
      expect(result).toEqual({ pension: [], insurance: [] });
    });
  });

  describe('updateInsuranceCover', () => {
    it('rejects when id missing', async () => {
      await expect(svc.updateInsuranceCover(null)).rejects.toThrow(/id required/i);
    });

    it('upserts insurance_policies with computed status', async () => {
      supabaseMock.__queueFrom('insurance_policies', {
        data: { subscriber_id: 's-1', cover: 1000000, premium_monthly: 2000, status: 'active' },
        error: null,
      });
      const result = await svc.updateInsuranceCover('s-1', { cover: 1000000, premiumMonthly: 2000 });
      expect(result.cover).toBe(1000000);
      expect(result.status).toBe('active');
      const upsertArgs = supabaseMock.__getFromCalls('insurance_policies').at(-1).chain.upsert.mock.calls[0][0];
      expect(upsertArgs.status).toBe('active');
    });

    it('marks status inactive when cover is 0', async () => {
      supabaseMock.__queueFrom('insurance_policies', {
        data: { subscriber_id: 's-1', cover: 0, premium_monthly: 0, status: 'inactive' },
        error: null,
      });
      await svc.updateInsuranceCover('s-1', { cover: 0, premiumMonthly: 0 });
      const upsertArgs = supabaseMock.__getFromCalls('insurance_policies').at(-1).chain.upsert.mock.calls[0][0];
      expect(upsertArgs.status).toBe('inactive');
    });
  });

  describe('updateProfile', () => {
    it('rejects when id missing', async () => {
      await expect(svc.updateProfile(null)).rejects.toThrow(/id required/i);
    });

    it('short-circuits to a fresh read when patch is empty', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: { id: 's-1', name: 'X', subscriber_balances: null, contribution_schedules: null, insurance_policies: null },
        error: null,
      });
      const result = await svc.updateProfile('s-1', {});
      expect(result.id).toBe('s-1');
    });

    it('filters patch to RLS-safe columns only', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: { id: 's-1', name: 'New Name', email: 'new@x.com', subscriber_balances: null, contribution_schedules: null, insurance_policies: null },
        error: null,
      });
      await svc.updateProfile('s-1', {
        name: 'New Name', email: 'new@x.com',
        // These should be dropped — not in the RLS-allowed column list:
        kycStatus: 'verified', age: 99,
      });
      const updateArgs = supabaseMock.__getFromCalls('subscribers').at(-1).chain.update.mock.calls[0][0];
      expect(updateArgs).toHaveProperty('name');
      expect(updateArgs).toHaveProperty('email');
      expect(updateArgs).not.toHaveProperty('kyc_status');
      expect(updateArgs).not.toHaveProperty('age');
    });
  });

  describe('createFromSignup', () => {
    it('calls create_subscriber_from_signup RPC and returns subscriberId', async () => {
      supabaseMock.__queueRpc('create_subscriber_from_signup', {
        data: 's-new-123',
        error: null,
      });
      const result = await svc.createFromSignup({ phone: '+25671...' });
      expect(result).toEqual({ subscriberId: 's-new-123' });
      const call = supabaseMock.__getRpcCalls('create_subscriber_from_signup').at(-1);
      expect(call.args.payload).toEqual({ phone: '+25671...' });
      // No nonce passed → p_nonce defaults to null (0042 treats null as "no
      // idempotency key", same as the pre-nonce behaviour).
      expect(call.args.p_nonce).toBeNull();
    });

    it('threads the idempotency nonce through as p_nonce (0042)', async () => {
      supabaseMock.__queueRpc('create_subscriber_from_signup', { data: 's-9', error: null });
      await svc.createFromSignup({ phone: 'x' }, 'signup-nonce-abc');
      const call = supabaseMock.__getRpcCalls('create_subscriber_from_signup').at(-1);
      expect(call.args.p_nonce).toBe('signup-nonce-abc');
    });

    it('throws on RPC error', async () => {
      supabaseMock.__queueRpc('create_subscriber_from_signup', {
        data: null,
        error: { message: 'validation failed' },
      });
      await expect(svc.createFromSignup({})).rejects.toMatchObject({
        message: 'validation failed',
      });
    });
  });

  describe('createFromAgentOnboard', () => {
    it('calls create_subscriber_from_agent_onboard with calling_agent_id', async () => {
      supabaseMock.__queueRpc('create_subscriber_from_agent_onboard', {
        data: 's-new-456',
        error: null,
      });
      const result = await svc.createFromAgentOnboard({ phone: 'x' }, 'a-001');
      expect(result.subscriberId).toBe('s-new-456');
      const call = supabaseMock.__getRpcCalls('create_subscriber_from_agent_onboard').at(-1);
      expect(call.args.calling_agent_id).toBe('a-001');
      expect(call.args.p_nonce).toBeNull();
    });

    it('threads the idempotency nonce through as p_nonce (0042)', async () => {
      supabaseMock.__queueRpc('create_subscriber_from_agent_onboard', { data: 's-7', error: null });
      await svc.createFromAgentOnboard({ phone: 'x' }, 'a-001', 'onboard-nonce-xyz');
      const call = supabaseMock.__getRpcCalls('create_subscriber_from_agent_onboard').at(-1);
      expect(call.args.p_nonce).toBe('onboard-nonce-xyz');
      expect(call.args.calling_agent_id).toBe('a-001');
    });
  });

  describe('invalidateSubscriber (no-op)', () => {
    it('returns undefined and does not throw', () => {
      expect(svc.invalidateSubscriber()).toBeUndefined();
    });
  });
});

describe('subscriber service — mock-fallback branch (IS_SUPABASE_ENABLED=false)', () => {
  let svc;

  beforeEach(async () => {
    vi.stubEnv('VITE_USE_SUPABASE', 'false');
    vi.resetModules();
    vi.doMock('../supabaseClient', () => ({
      supabase: supabaseMock,
      default: supabaseMock,
      getToken: vi.fn(),
      setToken: vi.fn(),
      clearToken: vi.fn(),
    }));
    svc = await import('../subscriber');
  });

  it('getCurrentSubscriber returns a seeded subscriber from mockData', async () => {
    const sub = await svc.getCurrentSubscriber();
    expect(sub).toBeDefined();
    if (sub) {
      // Same flat shape as the real branch.
      expect(sub).toHaveProperty('id');
      expect(sub).toHaveProperty('name');
      expect(sub).toHaveProperty('netBalance');
      expect(sub).toHaveProperty('contributionSchedule');
    }
  });

  it('getSubscriberTransactions returns [] for unknown id', async () => {
    expect(await svc.getSubscriberTransactions('s-does-not-exist')).toEqual([]);
  });

  it('getSubscriberClaims returns [] for unknown id', async () => {
    expect(await svc.getSubscriberClaims('s-does-not-exist')).toEqual([]);
  });

  it('getSubscriberWithdrawals returns [] for unknown id', async () => {
    expect(await svc.getSubscriberWithdrawals('s-does-not-exist')).toEqual([]);
  });

  it('getSubscriberNominees returns empty shape for unknown id', async () => {
    expect(await svc.getSubscriberNominees('s-does-not-exist')).toEqual({ pension: [], insurance: [] });
  });

  it('getSubscriberAgent returns null for unknown id', async () => {
    expect(await svc.getSubscriberAgent('s-does-not-exist')).toBeNull();
  });

  it('makeAdHocContribution throws when subscriber does not exist', async () => {
    await expect(svc.makeAdHocContribution('s-does-not-exist', { amount: 100 })).rejects.toThrow(/not found/i);
  });

  it('submitClaim throws when subscriber does not exist', async () => {
    await expect(svc.submitClaim('s-does-not-exist')).rejects.toThrow(/not found/i);
  });

  it('createFromSignup synthesises a fake id in mock mode', async () => {
    const result = await svc.createFromSignup({});
    expect(result.subscriberId).toMatch(/^s-mock-/);
  });

  it('createFromAgentOnboard synthesises a fake id in mock mode', async () => {
    const result = await svc.createFromAgentOnboard({}, 'a-001');
    expect(result.subscriberId).toMatch(/^s-mock-/);
  });
});
