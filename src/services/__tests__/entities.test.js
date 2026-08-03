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
});
