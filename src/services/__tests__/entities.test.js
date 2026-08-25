// Entities service tests — Supabase mocked via `@/test/supabaseMock`.
//
// Most read-side tests can rely on mock fallback for the country sentinel +
// derived metrics, but the table-backed reads (getEntity, getChildren,
// getAllAtLevel) must go through the supabase mock so RLS / network calls are
// stubbed. `createBranch` is the original failing case — its INSERT was
// blocked by RLS in the live DB; here we assert the INSERT was issued with
// the right snake_case row and that the mapped response shape is correct.

import { vi, describe, it, expect, beforeEach } from 'vitest';
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

const {
  getCountry,
  getEntity,
  getChildren,
  getAllAtLevel,
  getEntityPage,
  createBranch,
  getEntityMetricsRollup,
  createDistributor,
  setDistributorStatus,
  getPlatformOverview,
  getEmployerGeoRollup,
  getEmployerActivityRollup,
} = await import('../entities');

beforeEach(() => {
  supabaseMock.__reset();
});

describe('entities service', () => {
  describe('getCountry()', () => {
    // Country is a static sentinel that returns mockData.COUNTRY — no DB hit,
    // so no mock setup is required. The service comments call this out.
    it('returns country data with an id and name', async () => {
      const country = await getCountry();
      expect(country).toBeDefined();
      expect(country.id).toBe('ug');
      expect(country.name).toBe('Uganda');
    });

    it('returns country data with metrics', async () => {
      const country = await getCountry();
      expect(country.metrics).toBeDefined();
      expect(country.metrics).not.toBeNull();
    });

    it('returns country data with a center coordinate', async () => {
      const country = await getCountry();
      expect(country.center).toBeDefined();
      expect(country.center).toHaveLength(2);
    });
  });

  describe('getEntity()', () => {
    it('returns a region entity by level and id', async () => {
      supabaseMock.__queueFrom('regions', {
        data: {
          id: 'r-central', name: 'Central', parent_id: 'ug',
          center_lng: 32.5825, center_lat: 0.3476,
        },
        error: null,
      });
      const region = await getEntity('region', 'r-central');
      expect(region).toBeDefined();
      expect(region.id).toBe('r-central');
      expect(region.name).toBe('Central');
      const call = supabaseMock.__getFromCalls('regions').at(-1);
      expect(call.chain.eq).toHaveBeenCalledWith('id', 'r-central');
      expect(call.chain.maybeSingle).toHaveBeenCalled();
    });

    it('returns a district entity by level and id', async () => {
      supabaseMock.__queueFrom('districts', {
        data: {
          id: 'd-kampala', name: 'Kampala', region_id: 'r-central',
          center_lng: 32.58, center_lat: 0.31, active: true,
        },
        error: null,
      });
      const district = await getEntity('district', 'd-kampala');
      expect(district).toBeDefined();
      expect(district.id).toBe('d-kampala');
      expect(district.name).toBe('Kampala');
      // Mapping: snake_case → camelCase parentId.
      expect(district.parentId).toBe('r-central');
    });

    it('returns null for a non-existent entity', async () => {
      supabaseMock.__queueFrom('regions', { data: null, error: null });
      const result = await getEntity('region', 'r-nonexistent');
      expect(result).toBeNull();
    });

    // A15-001 regression: mobile (and any other) subscriber DETAIL read
    // rendered Balance as "—" for members holding real money because the
    // `select('*')` on `subscribers` never embedded `subscriber_balances` —
    // `total_balance` isn't a column on `subscribers` at all. Guards both the
    // returned value AND the actual query shape, so a future revert back to
    // a bare `select('*')` fails this test even if the mock still returns a
    // balance (a query-shape assertion, not just an output assertion).
    it('embeds subscriber_balances(total_balance) on a subscriber detail read (A15-001)', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: {
          id: 'empe-001', name: 'Brian Okello', phone: '+256700000001',
          agent_id: 'a-001', district_id: 'd-kampala', kyc_status: 'complete',
          is_active: true, registered_date: '2025-01-05',
          // Raw PostgREST embed shape: an array on the relation name.
          subscriber_balances: [{ total_balance: 24786589 }],
        },
        error: null,
      });
      const sub = await getEntity('subscriber', 'empe-001');
      expect(sub).toBeDefined();
      expect(sub.id).toBe('empe-001');
      // The real money figure — not the 0 default a missing embed produces.
      expect(sub.totalBalance).toBe(24786589);

      const call = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(call.chain.select).toHaveBeenCalledWith(
        expect.stringContaining('subscriber_balances(total_balance)'),
      );
    });

    it('does not add the subscriber_balances embed for other levels (branch stays a bare *)', async () => {
      supabaseMock.__queueFrom('branches', {
        data: { id: 'b-1', name: 'Branch 1', district_id: 'd-kampala', status: 'active' },
        error: null,
      });
      await getEntity('branch', 'b-1');
      const call = supabaseMock.__getFromCalls('branches').at(-1);
      expect(call.chain.select).toHaveBeenCalledWith('*');
    });
  });

  describe('getChildren()', () => {
    it('returns child regions for the country', async () => {
      supabaseMock.__queueFrom('regions', {
        data: [
          { id: 'r-central',  name: 'Central',  parent_id: 'ug', center_lng: 32.5, center_lat: 0.3 },
          { id: 'r-eastern',  name: 'Eastern',  parent_id: 'ug', center_lng: 33.5, center_lat: 1.1 },
          { id: 'r-northern', name: 'Northern', parent_id: 'ug', center_lng: 32.3, center_lat: 2.7 },
          { id: 'r-western',  name: 'Western',  parent_id: 'ug', center_lng: 30.6, center_lat: 0.6 },
        ],
        error: null,
      });
      const regions = await getChildren('country', 'ug');
      expect(regions).toBeDefined();
      expect(Array.isArray(regions)).toBe(true);
      expect(regions.length).toBe(4);
      regions.forEach((r) => expect(r.parentId).toBe('ug'));
      const call = supabaseMock.__getFromCalls('regions').at(-1);
      expect(call.chain.eq).toHaveBeenCalledWith('parent_id', 'ug');
    });

    it('returns child districts for a region', async () => {
      supabaseMock.__queueFrom('districts', {
        data: [
          { id: 'd-kampala', name: 'Kampala', region_id: 'r-central', center_lng: 32.58, center_lat: 0.31 },
          { id: 'd-wakiso',  name: 'Wakiso',  region_id: 'r-central', center_lng: 32.55, center_lat: 0.40 },
        ],
        error: null,
      });
      const districts = await getChildren('region', 'r-central');
      expect(districts).toBeDefined();
      expect(Array.isArray(districts)).toBe(true);
      expect(districts.length).toBeGreaterThan(0);
      districts.forEach((d) => expect(d.parentId).toBe('r-central'));
    });

    it('returns an empty array for a level with no children', async () => {
      // 'subscriber' is not in LEVEL_PARENT_FK, so the service short-circuits
      // and returns [] without a network call.
      const result = await getChildren('subscriber', 'sub-1');
      expect(result).toEqual([]);
      expect(supabaseMock.__getFromCalls()).toHaveLength(0);
    });
  });

  describe('getAllAtLevel()', () => {
    it('returns regions from the table', async () => {
      supabaseMock.__queueFrom('regions', {
        data: [
          { id: 'r-central',  name: 'Central',  parent_id: 'ug', center_lng: 0, center_lat: 0 },
          { id: 'r-eastern',  name: 'Eastern',  parent_id: 'ug', center_lng: 0, center_lat: 0 },
          { id: 'r-northern', name: 'Northern', parent_id: 'ug', center_lng: 0, center_lat: 0 },
          { id: 'r-western',  name: 'Western',  parent_id: 'ug', center_lng: 0, center_lat: 0 },
        ],
        error: null,
      });
      const regions = await getAllAtLevel('region');
      expect(regions).toHaveLength(4);
      regions.forEach((r) => expect(r.parentId).toBe('ug'));
    });

    it('returns the full district list', async () => {
      // Build 136 lightweight rows to mirror the canonical seed count.
      const data = Array.from({ length: 136 }, (_, i) => ({
        id: `d-${i}`, name: `D${i}`, region_id: 'r-central',
        center_lng: 0, center_lat: 0,
      }));
      supabaseMock.__queueFrom('districts', { data, error: null });
      const districts = await getAllAtLevel('district');
      expect(districts).toHaveLength(136);
    });

    it('returns branches as an array with length > 0', async () => {
      supabaseMock.__queueFrom('branches', {
        data: [
          { id: 'b-1', name: 'Branch 1', district_id: 'd-kampala', center_lng: 0, center_lat: 0, manager_name: 'M', status: 'active' },
        ],
        error: null,
      });
      const branches = await getAllAtLevel('branch');
      expect(Array.isArray(branches)).toBe(true);
      expect(branches.length).toBeGreaterThan(0);
    });

    it('returns agents as an array with length > 0', async () => {
      supabaseMock.__queueFrom('agents', {
        data: [
          { id: 'a-1', name: 'Agent 1', branch_id: 'b-1', status: 'active', languages: [], specialties: [] },
        ],
        error: null,
      });
      const agents = await getAllAtLevel('agent');
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBeGreaterThan(0);
    });

    it('returns an empty array for an invalid level', async () => {
      // No LEVEL_TABLES entry → short-circuit, no network call.
      const result = await getAllAtLevel('nonexistent');
      expect(result).toEqual([]);
      expect(supabaseMock.__getFromCalls()).toHaveLength(0);
    });
  });

  describe('getEntityMetricsRollup()', () => {
    it('calls the RPC with snake_case args and returns the payload as-is', async () => {
      const payload = {
        'r-central': {
          totalSubscribers: 6629, totalAgents: 440, totalBranches: 67,
          totalContributions: 2084652550, totalWithdrawals: 70551422,
          aum: 2421263298, activeRate: 78, coverageRate: 91,
        },
      };
      supabaseMock.__queueRpc('get_entity_metrics_rollup', { data: payload, error: null });
      const result = await getEntityMetricsRollup('region', ['r-central']);
      expect(result).toEqual(payload);
      const calls = supabaseMock.__getRpcCalls('get_entity_metrics_rollup');
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toEqual({ p_level: 'region', p_entity_ids: ['r-central'] });
    });

    it('returns an empty object when entityIds is empty (no network)', async () => {
      const result = await getEntityMetricsRollup('region', []);
      expect(result).toEqual({});
      expect(supabaseMock.__getRpcCalls('get_entity_metrics_rollup')).toHaveLength(0);
    });

    it('returns an empty object when entityIds is null (no network)', async () => {
      const result = await getEntityMetricsRollup('region', null);
      expect(result).toEqual({});
      expect(supabaseMock.__getRpcCalls('get_entity_metrics_rollup')).toHaveLength(0);
    });

    it('returns an empty object when the RPC returns null data', async () => {
      supabaseMock.__queueRpc('get_entity_metrics_rollup', { data: null, error: null });
      const result = await getEntityMetricsRollup('agent', ['a-001']);
      expect(result).toEqual({});
    });

    it('throws if the RPC returns an error', async () => {
      supabaseMock.__queueRpc('get_entity_metrics_rollup', {
        data: null,
        error: { message: 'out_of_scope', code: 'P0003' },
      });
      await expect(getEntityMetricsRollup('country', ['ug'])).rejects.toMatchObject({
        code: 'P0003',
      });
    });
  });

  describe('createBranch()', () => {
    it('returns a new branch object with the provided data', async () => {
      const data = {
        name: 'Test Branch',
        districtId: 'd-kampala',
        cityTown: 'Kampala',
        address: '123 Test St',
        adminName: 'John Doe',
        adminPhone: '770000000',
      };
      // The service generates an id of the form `b-new-<timestamp>` and INSERTs.
      // We seed the supabase response with what the INSERT … RETURNING * call
      // resolves to.
      supabaseMock.__queueFrom('branches', {
        data: {
          id: 'b-new-1747000000000',
          name: 'Test Branch',
          district_id: 'd-kampala',
          manager_name: 'John Doe',
          manager_phone: '770000000',
          manager_email: null,
          status: 'active',
          center_lng: null,
          center_lat: null,
        },
        error: null,
      });
      const branch = await createBranch(data);
      expect(branch).toBeDefined();
      expect(branch.id).toMatch(/^b-new-/);
      expect(branch.name).toBe('Test Branch');
      // mapBranch maps district_id → parentId; the new branch is associated
      // with the supplied district.
      expect(branch.parentId).toBe('d-kampala');
      expect(branch.status).toBe('active');
      // Mappers return a zero-shape EMPTY_METRICS placeholder until real
      // aggregation is wired — see entities.js header comment.
      expect(branch.metrics).toMatchObject({ totalSubscribers: 0, totalAgents: 0, aum: 0 });
      // Confirm the INSERT row mapped camelCase → snake_case.
      const call = supabaseMock.__getFromCalls('branches').at(-1);
      expect(call.chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Branch',
          district_id: 'd-kampala',
          manager_name: 'John Doe',
          manager_phone: '770000000',
          status: 'active',
        })
      );
    });

    it('includes optional admin email when provided', async () => {
      const data = {
        name: 'Another Branch',
        districtId: 'd-jinja',
        cityTown: 'Jinja',
        address: '456 Main Rd',
        landmark: 'Near the bridge',
        poBox: 'P.O. Box 100',
        adminName: 'Jane Doe',
        adminPhone: '780000000',
        adminEmail: 'jane@example.com',
      };
      supabaseMock.__queueFrom('branches', {
        data: {
          id: 'b-new-1747000000001',
          name: 'Another Branch',
          district_id: 'd-jinja',
          manager_name: 'Jane Doe',
          manager_phone: '780000000',
          manager_email: 'jane@example.com',
          status: 'active',
          center_lng: null,
          center_lat: null,
        },
        error: null,
      });
      const branch = await createBranch(data);
      // The branches table only persists name/district_id/manager_*, not
      // landmark/poBox/cityTown — the original test asserted on fields the
      // service simply doesn't write. We assert on the fields that ARE
      // round-tripped (manager_email → mapped to `managerEmail` on the entity).
      expect(branch.managerEmail).toBe('jane@example.com');
      const call = supabaseMock.__getFromCalls('branches').at(-1);
      expect(call.chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ manager_email: 'jane@example.com' })
      );
    });
  });

  // ─── Admin-gated RPCs (0049/0050) — audit §7b.5 ───────────────────────────
  describe('createDistributor() — admin create_distributor RPC', () => {
    it('calls the RPC with snake_case p_* args and returns the mapped distributor', async () => {
      supabaseMock.__queueRpc('create_distributor', {
        data: {
          id: 'd-new-1', name: 'Western Region Distributor', parent_id: 'ug',
          manager_name: 'Jane Mgr', manager_phone: '+256770000000', manager_email: 'jane@x.com',
          registration_no: '80020002345678',
          status: 'active', created_at: '2026-06-08T00:00:00Z',
        },
        error: null,
      });
      const dist = await createDistributor({
        name: 'Western Region Distributor',
        managerName: 'Jane Mgr',
        managerPhone: '+256770000000',
        managerEmail: 'jane@x.com',
        registrationNo: '80020002345678',
      });
      // Mapped (camelCase) shape with the EMPTY_METRICS placeholder.
      expect(dist).toMatchObject({
        id: 'd-new-1', name: 'Western Region Distributor', parentId: 'ug',
        managerName: 'Jane Mgr', managerPhone: '+256770000000', managerEmail: 'jane@x.com',
        // 0095 — a distributor is a registered company in Uganda too.
        registrationNo: '80020002345678',
        status: 'active',
      });
      expect(dist.metrics).toMatchObject({ totalSubscribers: 0, totalAgents: 0, aum: 0 });
      const call = supabaseMock.__getRpcCalls('create_distributor').at(-1);
      expect(call.args).toEqual({
        p_name: 'Western Region Distributor',
        p_manager_name: 'Jane Mgr',
        p_manager_phone: '+256770000000',
        p_manager_email: 'jane@x.com',
        p_parent_id: 'ug',
        p_registration_no: '80020002345678',
      });
    });

    it('defaults optional manager fields to null and parent to "ug"', async () => {
      supabaseMock.__queueRpc('create_distributor', {
        data: { id: 'd-new-2', name: 'Minimal Dist', parent_id: 'ug', status: 'active' },
        error: null,
      });
      await createDistributor({ name: 'Minimal Dist' });
      const call = supabaseMock.__getRpcCalls('create_distributor').at(-1);
      expect(call.args).toEqual({
        p_name: 'Minimal Dist',
        p_manager_name: null,
        p_manager_phone: null,
        p_manager_email: null,
        p_parent_id: 'ug',
        p_registration_no: null,
      });
    });

    it('throws when the RPC returns an error (e.g. non-admin caller)', async () => {
      supabaseMock.__queueRpc('create_distributor', {
        data: null, error: { code: 'P0001', message: 'admin only' },
      });
      await expect(createDistributor({ name: 'X' })).rejects.toMatchObject({ code: 'P0001' });
    });
  });

  describe('setDistributorStatus() — admin set_distributor_status RPC (0060)', () => {
    it('passes p_distributor_id / p_status and returns the cascade summary', async () => {
      supabaseMock.__queueRpc('set_distributor_status', {
        data: { id: 'd-001', status: 'inactive', branchesUpdated: 316, agentsUpdated: 2049, subscribersDetached: 5000 },
        error: null,
      });
      const res = await setDistributorStatus('d-001', 'inactive');
      expect(res).toMatchObject({ id: 'd-001', status: 'inactive', subscribersDetached: 5000 });
      const call = supabaseMock.__getRpcCalls('set_distributor_status').at(-1);
      expect(call.args).toEqual({ p_distributor_id: 'd-001', p_status: 'inactive' });
    });

    it('throws when the RPC returns an error (e.g. non-admin caller)', async () => {
      supabaseMock.__queueRpc('set_distributor_status', {
        data: null, error: { code: 'P0001', message: 'admin only' },
      });
      await expect(setDistributorStatus('d-001', 'inactive')).rejects.toMatchObject({ code: 'P0001' });
    });
  });

  describe('getPlatformOverview() — admin get_platform_overview RPC', () => {
    it('calls the RPC with no args and returns the payload as-is', async () => {
      const payload = {
        totalSubscribers: 31000, subscribersViaDistributor: 29000,
        subscribersViaEmployer: 1500, subscribersDirect: 500,
        activeSubscribers: 25000, inactiveSubscribers: 6000,
        distributors: 1, employers: 1, branches: 314, agents: 2049,
        aum: 2421263298, totalContributions: 2084652550, totalWithdrawals: 70551422,
      };
      supabaseMock.__queueRpc('get_platform_overview', { data: payload, error: null });
      const overview = await getPlatformOverview();
      expect(overview).toEqual(payload);
      const calls = supabaseMock.__getRpcCalls('get_platform_overview');
      expect(calls).toHaveLength(1);
      // No-arg RPC.
      expect(calls[0].args).toBeUndefined();
    });

    it('returns an empty object when the RPC data is null', async () => {
      supabaseMock.__queueRpc('get_platform_overview', { data: null, error: null });
      expect(await getPlatformOverview()).toEqual({});
    });

    it('throws when the RPC returns an error', async () => {
      supabaseMock.__queueRpc('get_platform_overview', {
        data: null, error: { code: 'P0001', message: 'admin only' },
      });
      await expect(getPlatformOverview()).rejects.toMatchObject({ code: 'P0001' });
    });
  });

  describe('getEmployerGeoRollup() — admin get_employer_geo_rollup RPC', () => {
    it('calls the RPC with no args and returns the payload as-is', async () => {
      const payload = {
        byRegion: { 'r-central': { subscribers: 22, active: 18, aum: 1000, employers: 2 } },
        byDistrict: {
          'd-kampala': {
            subscribers: 16, active: 14, aum: 800, employers: 1,
            list: [{ id: 'emp-001', name: 'Nile Breweries Demo Ltd', subscribers: 16, active: 14, aum: 800 }],
          },
        },
      };
      supabaseMock.__queueRpc('get_employer_geo_rollup', { data: payload, error: null });
      const geo = await getEmployerGeoRollup();
      expect(geo).toEqual(payload);
      const calls = supabaseMock.__getRpcCalls('get_employer_geo_rollup');
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toBeUndefined();
    });

    it('returns an empty rollup when the RPC data is null', async () => {
      supabaseMock.__queueRpc('get_employer_geo_rollup', { data: null, error: null });
      expect(await getEmployerGeoRollup()).toEqual({ byRegion: {}, byDistrict: {} });
    });

    it('throws when the RPC returns an error', async () => {
      supabaseMock.__queueRpc('get_employer_geo_rollup', {
        data: null, error: { code: 'P0001', message: 'admin only' },
      });
      await expect(getEmployerGeoRollup()).rejects.toMatchObject({ code: 'P0001' });
    });
  });

  describe('getEmployerActivityRollup() — admin get_employer_activity_rollup RPC', () => {
    it('calls the RPC with no args and returns the payload as-is', async () => {
      const payload = {
        dailyContributions: 2358000, weeklyContributions: 2358000,
        monthlyContributions: [0, 0, 0, 0, 0, 0, 0, 0, 0, 2358000, 2358000, 7074000],
        dailyWithdrawals: 150000, monthlyWithdrawals: 330000,
        newSubscribersToday: 2, newSubscribersThisWeek: 2, newSubscribersThisMonth: 4,
        topEmployer: { name: 'Nile Breweries Demo Ltd', contribution: 7074000 },
      };
      supabaseMock.__queueRpc('get_employer_activity_rollup', { data: payload, error: null });
      const activity = await getEmployerActivityRollup();
      expect(activity).toEqual(payload);
      const calls = supabaseMock.__getRpcCalls('get_employer_activity_rollup');
      expect(calls).toHaveLength(1);
      expect(calls[0].args).toBeUndefined();
    });

    it('returns the all-zero shape (null topEmployer) when the RPC data is null', async () => {
      supabaseMock.__queueRpc('get_employer_activity_rollup', { data: null, error: null });
      const activity = await getEmployerActivityRollup();
      expect(activity.topEmployer).toBeNull();
      expect(activity.dailyContributions).toBe(0);
      expect(activity.monthlyContributions).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it('throws when the RPC returns an error', async () => {
      supabaseMock.__queueRpc('get_employer_activity_rollup', {
        data: null, error: { code: 'P0001', message: 'admin only' },
      });
      await expect(getEmployerActivityRollup()).rejects.toMatchObject({ code: 'P0001' });
    });
  });

  // A21-001: ViewSubscribers used to pull the ENTIRE scoped subscriber
  // collection (+ every agent + every branch) into memory just to virtualize
  // a ~20-row viewport. `getEntityPage` is the server-side paginate + filter +
  // sort path the audit found already built as dead code — these tests are
  // the regression guard for wiring it up for real, since it had NO test
  // coverage before (nothing had ever called it against the live schema).
  describe('getEntityPage()', () => {
    function subscriberRow(overrides = {}) {
      return {
        id: 's-1', name: 'Grace Nakato', phone: '+256700000001', email: null,
        gender: 'female', age: 34, dob: '1991-01-01', nin: null, occupation: null,
        agent_id: 'a-1', district_id: 'd-kampala', kyc_status: 'complete',
        is_active: true, registered_date: '2025-01-05',
        products_held: [], contribution_history: [], current_unit_value: 1000,
        unit_value_as_of: '2026-08-01',
        subscriber_balances: { total_balance: 500000 },
        ...overrides,
      };
    }

    it('issues exactly ONE query for subscribers — no second balance round-trip', async () => {
      // The embed (`subscriber_balances(total_balance)`) already rides on the
      // same `listColumns('subscriber')` projection this query uses, so a
      // second id-bounded `subscriber_balances` query is dead weight, not a
      // requirement. An earlier version of this function issued one;
      // regression guard that it's gone.
      supabaseMock.__queueFrom('subscribers', {
        data: [subscriberRow()], error: null, count: 1,
      });
      const page = await getEntityPage('subscriber', { offset: 0, limit: 50 });
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0].totalBalance).toBe(500000);
      expect(supabaseMock.__getFromCalls('subscribers')).toHaveLength(1);
      expect(supabaseMock.__getFromCalls('subscriber_balances')).toHaveLength(0);
    });

    // This test used to assert the `foreignTable: 'subscriber_balances'` form,
    // which pinned the BUG: supabase-js turns that into
    // `subscriber_balances.order=` — the EMBEDDED resource's order — so the
    // query carried no top-level ORDER BY at all, the panel was never
    // balance-sorted, and .range() paginated an unordered result. The test
    // asserted the argument shape rather than the emitted URL, so it certified
    // the broken call as correct and would have rejected the fix.
    it('sorts "balance" by a TOP-LEVEL order on the embedded column', async () => {
      supabaseMock.__queueFrom('subscribers', { data: [subscriberRow()], error: null, count: 1 });
      await getEntityPage('subscriber', { sortKey: 'balance' });
      const call = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(call.chain.order).toHaveBeenCalledWith('subscriber_balances(total_balance)', {
        ascending: false, nullsFirst: false,
      });
      // …and never the embedded spelling, which is the no-op.
      expect(call.chain.order).not.toHaveBeenCalledWith('total_balance', expect.objectContaining({
        foreignTable: 'subscriber_balances',
      }));
    });

    it('always appends a deterministic id tie-breaker for stable paging', async () => {
      supabaseMock.__queueFrom('subscribers', { data: [subscriberRow()], error: null, count: 1 });
      await getEntityPage('subscriber', { sortKey: 'balance' });
      const call = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(call.chain.order).toHaveBeenCalledWith('id', { ascending: true });
    });

    it('sorts "name" by the plain `name` column (no foreignTable)', async () => {
      supabaseMock.__queueFrom('subscribers', { data: [subscriberRow()], error: null, count: 1 });
      await getEntityPage('subscriber', { sortKey: 'name' });
      const call = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(call.chain.order).toHaveBeenCalledWith('name', { ascending: true, nullsFirst: false });
    });

    it('still substitutes registered_date for "contributions" (documented, pre-existing gap)', async () => {
      supabaseMock.__queueFrom('subscribers', { data: [subscriberRow()], error: null, count: 1 });
      await getEntityPage('subscriber', { sortKey: 'contributions' });
      const call = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(call.chain.order).toHaveBeenCalledWith('registered_date', { ascending: false, nullsFirst: false });
    });

    it('agentId scope pushes a single .eq(agent_id, …) to the server', async () => {
      supabaseMock.__queueFrom('subscribers', { data: [subscriberRow()], error: null, count: 1 });
      await getEntityPage('subscriber', { scope: { agentId: 'a-1' } });
      const call = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(call.chain.eq).toHaveBeenCalledWith('agent_id', 'a-1');
      // Only the one subscribers query — scope must not fan out to agents/branches.
      expect(supabaseMock.__getFromCalls('agents')).toHaveLength(0);
    });

    it('branchId scope resolves the branch\'s agents first, then .in(agent_id, …)s the subscribers', async () => {
      supabaseMock.__queueFrom('agents', {
        data: [{ id: 'a-1', name: 'A1', branch_id: 'b-1', status: 'active', languages: [], specialties: [] },
               { id: 'a-2', name: 'A2', branch_id: 'b-1', status: 'active', languages: [], specialties: [] }],
        error: null,
      });
      supabaseMock.__queueFrom('subscribers', { data: [subscriberRow()], error: null, count: 1 });
      await getEntityPage('subscriber', { scope: { branchId: 'b-1' } });

      const agentsCall = supabaseMock.__getFromCalls('agents').at(-1);
      expect(agentsCall.chain.eq).toHaveBeenCalledWith('branch_id', 'b-1');

      const subsCall = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(subsCall.chain.in).toHaveBeenCalledWith('agent_id', ['a-1', 'a-2']);
    });

    it('an agentless branch short-circuits to empty WITHOUT querying subscribers at all', async () => {
      // Mirrors getSubscribersForBranch's guard: in(agent_id, []) would ask
      // PostgREST for "any row where agent_id is in the empty set", which it
      // answers with EVERY row — the exact "scoped list leaks the network" bug
      // the drill-down e2e specs guard against.
      supabaseMock.__queueFrom('agents', { data: [], error: null });
      const page = await getEntityPage('subscriber', { scope: { branchId: 'b-empty' } });
      expect(page).toEqual({ rows: [], total: 0, hasMore: false });
      expect(supabaseMock.__getFromCalls('subscribers')).toHaveLength(0);
    });

    it('computes hasMore from offset + returned rows vs. total', async () => {
      supabaseMock.__queueFrom('subscribers', {
        data: [subscriberRow({ id: 's-1' }), subscriberRow({ id: 's-2' })],
        error: null, count: 5,
      });
      const page = await getEntityPage('subscriber', { offset: 0, limit: 2 });
      expect(page.total).toBe(5);
      expect(page.hasMore).toBe(true); // 0 + 2 < 5

      supabaseMock.__queueFrom('subscribers', {
        data: [subscriberRow({ id: 's-5' })], error: null, count: 5,
      });
      const lastPage = await getEntityPage('subscriber', { offset: 4, limit: 2 });
      expect(lastPage.hasMore).toBe(false); // 4 + 1 >= 5
    });

    it('search issues an ILIKE .or() across name/phone', async () => {
      supabaseMock.__queueFrom('subscribers', { data: [], error: null, count: 0 });
      await getEntityPage('subscriber', { search: 'grace' });
      const call = supabaseMock.__getFromCalls('subscribers').at(-1);
      expect(call.chain.or).toHaveBeenCalledWith('name.ilike.%grace%,phone.ilike.%grace%');
    });

    it('statusFilter "active"/"inactive" push .eq(is_active, …)', async () => {
      supabaseMock.__queueFrom('subscribers', { data: [], error: null, count: 0 });
      await getEntityPage('subscriber', { statusFilter: 'active' });
      expect(supabaseMock.__getFromCalls('subscribers').at(-1).chain.eq)
        .toHaveBeenCalledWith('is_active', true);

      supabaseMock.__queueFrom('subscribers', { data: [], error: null, count: 0 });
      await getEntityPage('subscriber', { statusFilter: 'inactive' });
      expect(supabaseMock.__getFromCalls('subscribers').at(-1).chain.eq)
        .toHaveBeenCalledWith('is_active', false);
    });
  });
});
