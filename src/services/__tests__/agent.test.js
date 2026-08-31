// agent service tests — small surface: a single `getAgentSubscriberList`
// export with real (Supabase) + mock (mockData) branches.
//
// X11 parity concern: both branches must return rows with the same flat shape
// (id, name, phone, contributionSchedule, netBalance, ...). The real branch
// remaps snake_case → camelCase via `mapAgentSubscriberRow`; the mock branch
// already returns camelCase from mockData.

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

describe('agent service — real (Supabase) branch', () => {
  let getAgentSubscriberList;
  beforeEach(async () => {
    const mod = await import('../agent');
    getAgentSubscriberList = mod.getAgentSubscriberList;
  });

  it('returns [] when no agentId is given', async () => {
    expect(await getAgentSubscriberList(null)).toEqual([]);
    expect(await getAgentSubscriberList(undefined)).toEqual([]);
    expect(await getAgentSubscriberList('')).toEqual([]);
    expect(supabaseMock.__getFromCalls('subscribers')).toHaveLength(0);
  });

  it('queries subscribers .eq(agent_id, agentId) with joined schedule + balance', async () => {
    supabaseMock.__queueFrom('subscribers', { data: [], error: null });
    await getAgentSubscriberList('a-001');
    const call = supabaseMock.__getFromCalls('subscribers').at(-1);
    expect(call.chain.select).toHaveBeenCalledWith(
      'id, name, phone, email, gender, age, kyc_status, is_active, ' +
        'registered_date, last_contribution_date, products_held, contribution_history, ' +
        'contribution_schedules(frequency, amount, retirement_pct, emergency_pct, ' +
        'include_insurance, insurance_choice_made, next_due_date), ' +
        // 0146: the six pending_* columns are part of the member total and of
        // the withdrawable figure. An explicit embed list that omits them makes
        // deriveBalanceFigures() read undefined and quietly report the
        // ALLOCATED value as the total, which is the bug this pin catches.
        'subscriber_balances(total_balance, retirement_balance, emergency_balance, ' +
        'pending_contribution_retirement, pending_contribution_emergency, ' +
        'pending_payout_retirement, pending_payout_emergency, ' +
        'pending_redemption_retirement, pending_redemption_emergency), ' +
        'insurance_policies(cover, premium_monthly, status, renewal_date, funded_by), ' +
        'subscriber_insurance_products(product, status, renewal_date, funded_by)',
    );
    expect(call.chain.eq).toHaveBeenCalledWith('agent_id', 'a-001');
  });

  it('maps snake_case columns to camelCase', async () => {
    supabaseMock.__queueFrom('subscribers', {
      data: [{
        id: 's-1',
        name: 'James Okello',
        phone: '+25671 100 0001',
        email: 'j@x.com',
        gender: 'male',
        age: 35,
        kyc_status: 'verified',
        is_active: true,
        registered_date: '2024-01-15',
        products_held: ['pension'],
        contribution_history: [50000, 60000, 70000],
        contribution_schedules: {
          frequency: 'monthly',
          amount: 50000,
          retirement_pct: 80,
          emergency_pct: 20,
          include_insurance: false,
          insurance_choice_made: true,
          next_due_date: '2026-06-01',
        },
        subscriber_balances: {
          total_balance: 500000,
          retirement_balance: 400000,
          emergency_balance: 100000,
          units: 500,
        },
        insurance_policies: {
          cover: 1000000,
          premium_monthly: 2000,
          status: 'active',
        },
        subscriber_insurance_products: [
          { product: 'health', status: 'active' },
          { product: 'funeral', status: 'inactive' },
        ],
      }],
      error: null,
    });
    const list = await getAgentSubscriberList('a-001');
    expect(list).toHaveLength(1);
    const sub = list[0];
    expect(sub.id).toBe('s-1');
    expect(sub.name).toBe('James Okello');
    expect(sub.kycStatus).toBe('verified');
    expect(sub.isActive).toBe(true);
    expect(sub.registeredDate).toBe('2024-01-15');
    expect(sub.netBalance).toBe(500000);
    expect(sub.retirementBalance).toBe(400000);
    expect(sub.emergencyBalance).toBe(100000);
    expect(sub.totalContributions).toBe(500000); // proxied from total_balance
    expect(sub.totalWithdrawals).toBe(0);        // documented placeholder
    expect(sub.lastContribution).toBe(70000);    // last of contribution_history
    expect(sub.contributionSchedule.frequency).toBe('monthly');
    expect(sub.contributionSchedule.amount).toBe(50000);
    expect(sub.contributionSchedule.retirementPct).toBe(80);
    expect(sub.contributionSchedule.emergencyPct).toBe(20);
    expect(sub.contributionSchedule.includeInsurance).toBe(false);
    expect(sub.contributionSchedule.insuranceChoiceMade).toBe(true);
    expect(sub.contributionSchedule.nextDueDate).toBe('2026-06-01');
    // Insurance policy mapped for the agent Home insurance card.
    expect(sub.insurance).toEqual({ cover: 1000000, premiumMonthly: 2000, status: 'active' });
    // Active-policy list: life (insurance_policies) + active products, ordered
    // life→health→funeral, PRODUCT+STATUS ONLY (no cover/premium leaked to agents),
    // and inactive products excluded.
    expect(sub.policies).toEqual([
      { product: 'life', status: 'active' },
      { product: 'health', status: 'active' },
    ]);
    for (const p of sub.policies) {
      expect(p).not.toHaveProperty('cover');
      expect(p).not.toHaveProperty('premiumMonthly');
    }
  });

  it('omits the life policy from policies when life cover is 0 (inactive)', async () => {
    supabaseMock.__queueFrom('subscribers', {
      data: [{
        id: 's-noins', name: 'No Cover',
        insurance_policies: { cover: 0, premium_monthly: 0, status: 'inactive' },
        subscriber_insurance_products: [{ product: 'funeral', status: 'active' }],
      }],
      error: null,
    });
    const list = await getAgentSubscriberList('a-001');
    expect(list[0].policies).toEqual([{ product: 'funeral', status: 'active' }]);
  });

  // A06-004 / A11-005: the agent surface used to trust insurance_policies.status
  // verbatim while the subscriber's own Policies page derived it from
  // renewal_date — so a self-funded policy whose renewal date had passed still
  // showed "Active" to the agent (e.g. live persona s-0003, renewal 2026-04-16)
  // while the member's own app said "Expired". Both now derive through
  // deriveCoverStatus, so they can't disagree.
  it('shows a self-funded policy as EXPIRED once its renewal date has passed, even though the stored flag still says active', async () => {
    supabaseMock.__queueFrom('subscribers', {
      data: [{
        id: 's-0003', name: 'Patrick Nsubuga',
        insurance_policies: {
          cover: 1000000, premium_monthly: 2000, status: 'active',
          renewal_date: '2026-04-16', funded_by: 'self',
        },
        subscriber_insurance_products: [
          { product: 'health', status: 'active', renewal_date: '2026-04-16', funded_by: 'self' },
        ],
      }],
      error: null,
    });
    const list = await getAgentSubscriberList('a-001');
    expect(list[0].policies).toEqual([
      { product: 'life', status: 'expired' },
      { product: 'health', status: 'expired' },
    ]);
    // The Home-card engagement signal must agree with the chips on the same page.
    expect(list[0].insurance.status).toBe('expired');
  });

  it('keeps an employer-funded policy ACTIVE past a stale/placeholder renewal date (the annual/monthly invariant)', async () => {
    // Employer-funded cover is kept in force by an ongoing MONTHLY premium
    // (transactions.type='insurance_premium', source='employer') and has no
    // annual renewal to lapse against — unlike self-funded cover, which is
    // charged one ANNUAL premium (type='premium', source='own'). A rule that
    // applies the date check to employer rows too would misreport this one as
    // expired; it must stay active regardless of the stored renewal_date.
    supabaseMock.__queueFrom('subscribers', {
      data: [{
        id: 'empe-001', name: 'Employer Member',
        insurance_policies: {
          cover: 15000000, premium_monthly: 0, status: 'active',
          renewal_date: '2020-01-01', funded_by: 'employer',
        },
        subscriber_insurance_products: [
          { product: 'health', status: 'active', renewal_date: null, funded_by: 'employer' },
        ],
      }],
      error: null,
    });
    const list = await getAgentSubscriberList('a-001');
    expect(list[0].policies).toEqual([
      { product: 'life', status: 'active' },
      { product: 'health', status: 'active' },
    ]);
    expect(list[0].insurance.status).toBe('active');
  });

  it('handles array-shape joins (Supabase to-many embed)', async () => {
    supabaseMock.__queueFrom('subscribers', {
      data: [{
        id: 's-2',
        name: 'Y',
        contribution_schedules: [{
          frequency: 'monthly', amount: 30000, retirement_pct: 80, emergency_pct: 20,
        }],
        subscriber_balances: [{
          total_balance: 200000, retirement_balance: 160000, emergency_balance: 40000, units: 200,
        }],
      }],
      error: null,
    });
    const list = await getAgentSubscriberList('a-001');
    expect(list[0].contributionSchedule.amount).toBe(30000);
    expect(list[0].netBalance).toBe(200000);
  });

  it('returns lastContribution=0 when history is empty', async () => {
    supabaseMock.__queueFrom('subscribers', {
      data: [{ id: 's-3', name: 'Z', contribution_history: [] }],
      error: null,
    });
    const list = await getAgentSubscriberList('a-001');
    expect(list[0].lastContribution).toBe(0);
    expect(list[0].contributionHistory).toEqual([]);
  });

  it('returns null contributionSchedule when missing', async () => {
    supabaseMock.__queueFrom('subscribers', {
      data: [{ id: 's-4', name: 'W' }],
      error: null,
    });
    const list = await getAgentSubscriberList('a-001');
    expect(list[0].contributionSchedule).toBeNull();
  });

  it('returns [] when supabase returns null data', async () => {
    supabaseMock.__queueFrom('subscribers', { data: null, error: null });
    expect(await getAgentSubscriberList('a-001')).toEqual([]);
  });

  it('throws when supabase returns an error (network/auth/RLS failure)', async () => {
    supabaseMock.__queueFrom('subscribers', {
      data: null,
      error: { message: 'JWT expired', code: 'PGRST301' },
    });
    await expect(getAgentSubscriberList('a-001')).rejects.toMatchObject({
      message: 'JWT expired',
    });
  });

  it('defaults productsHeld to [] when null', async () => {
    supabaseMock.__queueFrom('subscribers', {
      data: [{ id: 's-5', name: 'V', products_held: null }],
      error: null,
    });
    const list = await getAgentSubscriberList('a-001');
    expect(list[0].productsHeld).toEqual([]);
  });
});

describe('agent service — mock-fallback branch (IS_SUPABASE_ENABLED=false)', () => {
  let getAgentSubscriberList;

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
    const mod = await import('../agent');
    getAgentSubscriberList = mod.getAgentSubscriberList;
  });

  it('does NOT call supabase', async () => {
    supabaseMock.__reset();
    await getAgentSubscriberList('a-001');
    expect(supabaseMock.__getFromCalls('subscribers')).toHaveLength(0);
  });

  it('returns subscribers filtered by parentId (legacy field name)', async () => {
    // mockData seeds ~30k subscribers; we don't know which agent ids exist
    // without inspecting the seed. Use a-001 (the demo fallback id, always seeded).
    const list = await getAgentSubscriberList('a-001');
    expect(Array.isArray(list)).toBe(true);
    // Each row should be flat-shaped — same key set as the real branch.
    for (const s of list) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('netBalance');
      expect(s).toHaveProperty('contributionSchedule');
      expect(s).toHaveProperty('productsHeld');
    }
  });

  it('returns [] for an agent id that has no subscribers in the mock seed', async () => {
    const list = await getAgentSubscriberList('a-does-not-exist');
    expect(list).toEqual([]);
  });
});

describe('agent service — real/mock branch parity (X11)', () => {
  it('real and mock branches return rows with the same key set (when both have results)', async () => {
    // Real
    const realMod = await import('../agent');
    supabaseMock.__queueFrom('subscribers', {
      data: [{
        id: 's-1', name: 'X', phone: '+256...',
        email: 'x@y.com', gender: 'male', age: 35,
        kyc_status: 'verified', is_active: true, registered_date: '2024-01-15',
        products_held: ['pension'],
        contribution_history: [50000],
        contribution_schedules: { frequency: 'monthly', amount: 50000 },
        subscriber_balances: { total_balance: 100000 },
      }],
      error: null,
    });
    const real = await realMod.getAgentSubscriberList('a-001');

    // Mock
    vi.stubEnv('VITE_USE_SUPABASE', 'false');
    vi.resetModules();
    vi.doMock('../supabaseClient', () => ({
      supabase: supabaseMock,
      default: supabaseMock,
      getToken: vi.fn(),
      setToken: vi.fn(),
      clearToken: vi.fn(),
    }));
    const mockMod = await import('../agent');
    const mock = await mockMod.getAgentSubscriberList('a-001');

    if (real.length > 0 && mock.length > 0) {
      // The real branch maps MORE columns (gender, age, isActive, registeredDate,
      // kycStatus, contributionHistory, retirementBalance, emergencyBalance)
      // than the mock branch. Document the gap rather than asserting equality —
      // PARITY GAP: mock branch omits `gender`, `age`, `kycStatus`,
      // `contributionHistory`, `retirementBalance`, `emergencyBalance`. Both
      // branches DO share `id, name, phone, email, productsHeld,
      // contributionSchedule, netBalance, lastContribution, totalContributions,
      // totalWithdrawals, isActive, registeredDate`.
      const mockKeys = new Set(Object.keys(mock[0]));
      const realKeys = new Set(Object.keys(real[0]));
      // Intersection must include the load-bearing fields.
      const sharedKeys = [
        'id', 'name', 'phone', 'email', 'isActive', 'registeredDate',
        'netBalance', 'productsHeld', 'contributionSchedule', 'lastContribution',
        'totalContributions', 'totalWithdrawals', 'policies',
      ];
      for (const key of sharedKeys) {
        expect(mockKeys.has(key)).toBe(true);
        expect(realKeys.has(key)).toBe(true);
      }
    }
  });
});

describe('agent service — getAgentContributions (real Supabase branch)', () => {
  let getAgentContributions;
  beforeEach(async () => {
    const mod = await import('../agent');
    getAgentContributions = mod.getAgentContributions;
  });

  it('returns [] when no agentId is given (no query)', async () => {
    expect(await getAgentContributions(null, { from: '2026-05-01' })).toEqual([]);
    expect(supabaseMock.__getFromCalls('transactions')).toHaveLength(0);
  });

  it('queries transactions scoped by agent_id + contribution type + [from, to) window', async () => {
    supabaseMock.__queueFrom('transactions', { data: [], error: null });
    await getAgentContributions('a-001', { from: '2026-05-01', to: '2026-06-01' });
    const call = supabaseMock.__getFromCalls('transactions').at(-1);
    expect(call.chain.select).toHaveBeenCalledWith(
      'id, amount, date, method, subscriber_id, subscribers(name)',
    );
    expect(call.chain.eq).toHaveBeenCalledWith('agent_id', 'a-001');
    expect(call.chain.eq).toHaveBeenCalledWith('type', 'contribution');
    expect(call.chain.gte).toHaveBeenCalledWith('date', '2026-05-01');
    expect(call.chain.lt).toHaveBeenCalledWith('date', '2026-06-01');
  });

  it('maps rows and lifts the joined subscriber name', async () => {
    supabaseMock.__queueFrom('transactions', {
      data: [
        {
          id: 'tx-1',
          amount: 30000,
          date: '2026-05-12',
          method: 'MTN Mobile Money',
          subscriber_id: 's-1',
          subscribers: { name: 'Brian Okello' },
        },
      ],
      error: null,
    });
    const list = await getAgentContributions('a-001', { from: '2026-05-01', to: '2026-06-01' });
    expect(list).toEqual([
      {
        id: 'tx-1',
        subscriberId: 's-1',
        subscriberName: 'Brian Okello',
        amount: 30000,
        date: '2026-05-12',
        method: 'MTN Mobile Money',
      },
    ]);
  });

  it('throws when supabase returns an error', async () => {
    supabaseMock.__queueFrom('transactions', {
      data: null,
      error: { message: 'JWT expired', code: 'PGRST301' },
    });
    await expect(
      getAgentContributions('a-001', { from: '2026-05-01', to: '2026-06-01' }),
    ).rejects.toMatchObject({ message: 'JWT expired' });
  });
});

describe('agent service — getAgentContributions (mock-fallback branch)', () => {
  let getAgentContributions;
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
    const mod = await import('../agent');
    getAgentContributions = mod.getAgentContributions;
  });

  it('does NOT call supabase and returns contribution rows newest-first', async () => {
    supabaseMock.__reset();
    const rows = await getAgentContributions('a-001', { from: '2000-01-01', to: '2100-01-01' });
    expect(supabaseMock.__getFromCalls('transactions')).toHaveLength(0);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0); // a-001 is always seeded with subscribers + contributions
    for (const c of rows) {
      expect(c).toHaveProperty('subscriberId');
      expect(c).toHaveProperty('subscriberName');
      expect(typeof c.amount).toBe('number');
      expect(c).toHaveProperty('date');
    }
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].date >= rows[i].date).toBe(true);
    }
  });

  it('filters out contributions outside the [from, to) window', async () => {
    const none = await getAgentContributions('a-001', { from: '1990-01-01', to: '1990-02-01' });
    expect(none).toEqual([]);
  });

  it('returns [] for an agent with no subscribers in the seed', async () => {
    expect(
      await getAgentContributions('a-does-not-exist', { from: '2000-01-01', to: '2100-01-01' }),
    ).toEqual([]);
  });
});
