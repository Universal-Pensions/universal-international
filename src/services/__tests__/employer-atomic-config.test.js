// Atomic employer config + group-insurance save (audit §7d-3, migration 0056).
//
// The employer Settings "Pension"/"Insurance" tabs used to save in TWO RPCs:
//   update_employer_profile(config)  THEN  apply_group_insurance(cover)
// chained in onSuccess — non-atomic, so a partial failure desynced the company
// config from `insurance_policies` (and the hero `insuredCount`). 0056 folds the
// insurance leg INTO update_employer_profile (one transaction), and saveConfig
// now fires a SINGLE `updateProfile.mutate({ defaultContributionConfig,
// insuranceEnabled, groupCover })` call. These tests pin the service seam that
// the single mutate call hits: update_employer_profile fires EXACTLY ONCE with
// the insurance fields, apply_group_insurance is NEVER called, and the legacy
// no-insurance patch still sends the identical one-arg shape (back-compat).
//
// DORMANT NOTE: the 3-arg update_employer_profile(jsonb, numeric, boolean) is
// PGRST202/404 on live until 0056 is applied at the G-DB gate — these tests mock
// supabase.rpc, so they pass ahead of that.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../../test/supabaseMock';

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

// The four config fixtures below deep-equal whatever object they are handed, so
// they would stay GREEN forever on a dead vocabulary. They carry the UNIFIED
// two-leg shape (migration 0092): all six canonical keys always written, each leg
// an independent share of compensation or a flat UGX amount, `mode` /
// `employerMatchPct` deleted. That is exactly what the Settings save now sends, so
// these tests pin the real p_patch payload rather than a shape nothing writes.

// The mapped row update_employer_profile returns (mapEmployer reads snake_case).
const EMPLOYER_ROW = {
  id: 'emp-001',
  name: 'Nile Breweries Ltd',
  default_contribution_config: {
    employeeBasis: 'percent', employeePct: 0, employeeAmount: 0,
    employerBasis: 'fixed', employerPct: 0, employerAmount: 50000,
    insuranceEnabled: true, groupCoverAmount: 5000000,
  },
};

describe('atomic employer config save — updateEmployerProfile insurance fold', () => {
  let svc;
  beforeEach(async () => { svc = await import('../employer'); });

  it('fires update_employer_profile EXACTLY ONCE with the insurance fields and never calls apply_group_insurance (enabled)', async () => {
    supabaseMock.__queueRpc('update_employer_profile', { data: EMPLOYER_ROW, error: null });

    // This is the exact object saveConfig passes to updateProfile.mutate(...) —
    // a company that funds the whole pension itself at a flat UGX 50,000/member
    // (staff leg zero), plus group cover.
    const defaultContributionConfig = {
      employeeBasis: 'percent',
      employeePct: 0,
      employeeAmount: 0,
      employerBasis: 'fixed',
      employerPct: 0,
      employerAmount: 50000,
      insuranceEnabled: true,
      groupCoverAmount: 5000000,
    };
    await svc.updateEmployerProfile({
      defaultContributionConfig,
      insuranceEnabled: true,
      groupCover: 5000000,
    });

    // EXACTLY ONE update_employer_profile call…
    const calls = supabaseMock.__getRpcCalls('update_employer_profile');
    expect(calls).toHaveLength(1);
    const { args } = calls[0];

    // …carrying the insurance fields…
    expect(args.p_insurance_enabled).toBe(true);
    expect(args.p_group_cover).toBe(5000000);

    // …with the config in p_patch but the control keys STRIPPED out of it
    // (they're RPC params, not employer columns).
    expect(args.p_patch.defaultContributionConfig).toEqual(defaultContributionConfig);
    expect(args.p_patch).not.toHaveProperty('insuranceEnabled');
    expect(args.p_patch).not.toHaveProperty('groupCover');

    // …and NO separate apply_group_insurance call (the whole point of 0056).
    expect(supabaseMock.__getRpcCalls('apply_group_insurance')).toHaveLength(0);
  });

  it('disabled save still folds into the one call (p_insurance_enabled=false, p_group_cover=null) — no apply_group_insurance', async () => {
    supabaseMock.__queueRpc('update_employer_profile', { data: EMPLOYER_ROW, error: null });

    await svc.updateEmployerProfile({
      defaultContributionConfig: {
        employeeBasis: 'percent', employeePct: 0, employeeAmount: 0,
        employerBasis: 'fixed', employerPct: 0, employerAmount: 50000,
        insuranceEnabled: false, groupCoverAmount: null,
      },
      insuranceEnabled: false,
      groupCover: null,
    });

    const calls = supabaseMock.__getRpcCalls('update_employer_profile');
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_insurance_enabled).toBe(false);
    expect(calls[0].args.p_group_cover).toBeNull();
    expect(supabaseMock.__getRpcCalls('apply_group_insurance')).toHaveLength(0);
  });

  it('back-compat: a profile-only patch sends ONLY { p_patch } (no insurance params, no apply_group_insurance)', async () => {
    supabaseMock.__queueRpc('update_employer_profile', { data: EMPLOYER_ROW, error: null });

    await svc.updateEmployerProfile({ name: 'New Co', district: 'Kampala' });

    const calls = supabaseMock.__getRpcCalls('update_employer_profile');
    expect(calls).toHaveLength(1);
    const { args } = calls[0];
    // Identical to the pre-0056 single-arg call shape — existing callers/tests
    // (employer.test.js) keep passing.
    expect(Object.keys(args)).toEqual(['p_patch']);
    expect(args.p_patch).toEqual({ name: 'New Co', district: 'Kampala' });
    expect(args).not.toHaveProperty('p_insurance_enabled');
    expect(args).not.toHaveProperty('p_group_cover');
    expect(supabaseMock.__getRpcCalls('apply_group_insurance')).toHaveLength(0);
  });

  it('forwards an enabled cover even when groupCover is a numeric string (coerced)', async () => {
    supabaseMock.__queueRpc('update_employer_profile', { data: EMPLOYER_ROW, error: null });

    await svc.updateEmployerProfile({
      // Both legs funded: staff 10% of pay, company 5% of pay. (Money-identical to
      // the legacy "10% + 50% match" this replaces — the match basis is deleted.)
      defaultContributionConfig: {
        employeeBasis: 'percent', employeePct: 10, employeeAmount: 0,
        employerBasis: 'percent', employerPct: 5, employerAmount: 0,
        insuranceEnabled: true, groupCoverAmount: 3000000,
      },
      insuranceEnabled: true,
      groupCover: '3000000',
    });

    const { args } = supabaseMock.__getRpcCalls('update_employer_profile')[0];
    expect(args.p_group_cover).toBe(3000000);
    expect(args.p_insurance_enabled).toBe(true);
    expect(supabaseMock.__getRpcCalls('apply_group_insurance')).toHaveLength(0);
  });
});
