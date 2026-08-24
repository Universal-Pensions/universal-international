// Deactivate-entities DB regression spec (audit L7) — guards the 0060 + 0061
// enforcement layer on the live Supabase project (ilkhfnoyxlxwqadebnkp —
// Singapore ap-southeast-1).
//
// !!! SERVICE-ROLE E2E ONLY — NOT RUN BY `npm test` / vitest. !!!
// ---------------------------------------------------------------------------
// This file uses the service-role admin client (e2e/fixtures/db.ts) which
// BYPASSES RLS, plus a minted admin JWT to drive the admin-gated status RPCs.
// It is part of the Playwright `db/` suite and is VALIDATED VIA `/qa` (a live
// `npm run test:e2e` run with SUPABASE_SERVICE_ROLE_KEY + SUPABASE_JWT_SECRET +
// VITE_SUPABASE_URL/ANON_KEY in env). vitest never imports it. Without the env
// it `test.skip()`s cleanly, exactly like the sibling db/ specs.
//
// PROD-SAFETY: every row this spec writes is namespaced under a `tst-` /
// `TST-` prefix (a dedicated throwaway distributor → branch → agent →
// subscriber chain, and a throwaway employer + member), created in beforeAll
// and torn down in afterAll. It NEVER deactivates the real seeded `d-001`
// distributor or `emp-001` employer (doing so would detach thousands of live
// subscribers). The cascade is proven on the isolated `tst-` graph only.
//
// What we assert (the 0060/0061 enforcement contract):
//   1. INSERT a subscriber tagged to an INACTIVE employer → raises (0060
//      BEFORE-INSERT trigger trg_block_inactive_employer_subscriber).
//   2. UPDATE-re-tag an existing subscriber's employer_id to an INACTIVE
//      employer → raises (0061 BEFORE-UPDATE trigger
//      trg_block_inactive_employer_subscriber_update). Detach (→ NULL) and
//      re-tag to an ACTIVE employer must still pass.
//   3. set_employer_status('inactive') flips employers.status AND detaches every
//      member (employer_id → NULL); reactivate is a pure status flip (no re-tag).
//   4. set_distributor_status('inactive') flips the distributor + its branches +
//      its agents to 'inactive' AND detaches every subscriber under the agent
//      tree (agent_id → NULL); reactivate flips status back without re-tagging.
//
// Run prereq: SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// + SUPABASE_JWT_SECRET in .env.local. Without them the file test.skip()s.

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../fixtures/db';
import { mintRoleJwt, PERSONA_FOR } from '../../fixtures/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const hasEnv =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!SUPABASE_URL &&
  !!ANON_KEY &&
  !!process.env.SUPABASE_JWT_SECRET;

// Throwaway IDs — all `tst-`/`TST-` namespaced so a partial-failure run is
// trivially identifiable and the afterAll teardown can target them exactly.
const RUN = Date.now().toString(36);
const TST = {
  distributor: `tst-dist-${RUN}`,
  branch: `tst-branch-${RUN}`,
  agent: `tst-agent-${RUN}`,
  treeSub: `tst-sub-tree-${RUN}`, // tagged to the tst agent (distributor cascade)
  employerActive: `tst-emp-active-${RUN}`,
  employerInactive: `tst-emp-inactive-${RUN}`,
  empMember: `tst-sub-emp-${RUN}`, // tagged to the active employer (employer cascade)
  retagSub: `tst-sub-retag-${RUN}`, // unattached; used for the 0061 UPDATE probe
  insertSub: `tst-sub-insert-${RUN}`, // never persists (insert is meant to raise)
};

// An admin-stamped anon client — drives the admin-gated status RPCs. The
// service-role client has a NULL JWT (app_role IS NULL), so the RPCs would
// RAISE 'role <null> cannot set …' for it; the minted admin token makes the
// (SELECT auth.jwt()) ->> 'app_role' = 'admin' gate pass.
let adminRpc: SupabaseClient;
// A real district id for the throwaway branch's NOT-NULL district_id FK.
let districtId: string;

function fnRaised(error: { message: string } | null): boolean {
  // The 0060/0061 triggers RAISE … USING ERRCODE = 'P0001'; PostgREST surfaces
  // the message. We only need a non-null error to prove the write was blocked.
  return !!error;
}

test.describe('deactivate-entities enforcement (0060 + 0061)', () => {
  test.skip(
    !hasEnv,
    'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_JWT_SECRET',
  );

  test.beforeAll(async () => {
    const token = await mintRoleJwt('admin', PERSONA_FOR.admin.entityId);
    adminRpc = createClient(SUPABASE_URL as string, ANON_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    // Pick any existing district for the throwaway branch FK (branches.district_id
    // is NOT NULL REFERENCES districts). The seed has ~135 districts.
    const { data: dRow, error: dErr } = await supabaseAdmin
      .from('districts')
      .select('id')
      .limit(1)
      .maybeSingle();
    if (dErr) throw new Error(`district lookup: ${dErr.message}`);
    if (!dRow) throw new Error('no districts seeded — cannot build the throwaway branch');
    districtId = (dRow as { id: string }).id;

    // --- Build the isolated graph (all ACTIVE to start) ----------------------
    // Distributor → branch (distributor_id) → agent (branch_id) → subscriber.
    const { error: distErr } = await supabaseAdmin.from('distributors').insert({
      id: TST.distributor, name: 'TST throwaway distributor', status: 'active',
    });
    if (distErr) throw new Error(`seed distributor: ${distErr.message}`);

    const { error: brErr } = await supabaseAdmin.from('branches').insert({
      id: TST.branch, name: 'TST throwaway branch', district_id: districtId,
      distributor_id: TST.distributor, status: 'active',
    });
    if (brErr) throw new Error(`seed branch: ${brErr.message}`);

    const { error: agErr } = await supabaseAdmin.from('agents').insert({
      id: TST.agent, name: 'TST throwaway agent', branch_id: TST.branch, status: 'active',
    });
    if (agErr) throw new Error(`seed agent: ${agErr.message}`);

    const { error: tSubErr } = await supabaseAdmin.from('subscribers').insert({
      id: TST.treeSub, name: 'TST tree member', phone: `+25679${RUN.slice(-7).padStart(7, '0')}`,
      agent_id: TST.agent, is_active: true, is_demo_signup: true,
    });
    if (tSubErr) throw new Error(`seed tree subscriber: ${tSubErr.message}`);

    // Two throwaway employers: one ACTIVE (holds a member for the cascade), one
    // INACTIVE (the INSERT/UPDATE blockers target it).
    const { error: empAErr } = await supabaseAdmin.from('employers').insert({
      id: TST.employerActive, name: 'TST active employer', status: 'active',
    });
    if (empAErr) throw new Error(`seed active employer: ${empAErr.message}`);

    const { error: empIErr } = await supabaseAdmin.from('employers').insert({
      id: TST.employerInactive, name: 'TST inactive employer', status: 'inactive',
    });
    if (empIErr) throw new Error(`seed inactive employer: ${empIErr.message}`);

    const { error: mSubErr } = await supabaseAdmin.from('subscribers').insert({
      id: TST.empMember, name: 'TST employer member', phone: `+25678${RUN.slice(-7).padStart(7, '0')}`,
      employer_id: TST.employerActive, is_active: true, is_demo_signup: true,
    });
    if (mSubErr) throw new Error(`seed employer member: ${mSubErr.message}`);

    // An unattached subscriber for the 0061 UPDATE-re-tag probe (employer_id NULL).
    const { error: rSubErr } = await supabaseAdmin.from('subscribers').insert({
      id: TST.retagSub, name: 'TST retag probe', phone: `+25677${RUN.slice(-7).padStart(7, '0')}`,
      employer_id: null, is_active: true, is_demo_signup: true,
    });
    if (rSubErr) throw new Error(`seed retag-probe subscriber: ${rSubErr.message}`);
  });

  test.afterAll(async () => {
    if (!hasEnv) return;
    // Tear down in FK-safe order. Subscribers first (children of agents /
    // employers), then agent → branch → distributor, then employers. Best-effort:
    // each delete is independent so a mid-run failure still cleans the rest —
    // but every error is COLLECTED and asserted at the end rather than ignored,
    // because a silently-swallowed delete failure is exactly how fixture rows
    // (this file's own `tst-*` rows included) leak into the live demo DB
    // permanently unnoticed (audit A25-004).
    const subIds = [TST.treeSub, TST.empMember, TST.retagSub, TST.insertSub];
    const teardownErrors: string[] = [];
    // Remove any subscriber-FK child rows the inserts may have spawned (none are
    // expected for these bare inserts, but keep teardown orphan-proof).
    for (const table of ['subscriber_balances', 'transactions', 'contribution_schedules',
      'insurance_policies', 'nominees', 'claims', 'withdrawals', 'commissions']) {
      const { error } = await supabaseAdmin.from(table).delete().in('subscriber_id', subIds);
      if (error) teardownErrors.push(`${table}: ${error.message}`);
    }
    const { error: subErr } = await supabaseAdmin.from('subscribers').delete().in('id', subIds);
    if (subErr) teardownErrors.push(`subscribers: ${subErr.message}`);
    const { error: agentErr } = await supabaseAdmin.from('agents').delete().eq('id', TST.agent);
    if (agentErr) teardownErrors.push(`agents: ${agentErr.message}`);
    const { error: branchErr } = await supabaseAdmin.from('branches').delete().eq('id', TST.branch);
    if (branchErr) teardownErrors.push(`branches: ${branchErr.message}`);
    const { error: distErr } = await supabaseAdmin.from('distributors').delete().eq('id', TST.distributor);
    if (distErr) teardownErrors.push(`distributors: ${distErr.message}`);
    const { error: empErr } = await supabaseAdmin
      .from('employers')
      .delete()
      .in('id', [TST.employerActive, TST.employerInactive]);
    if (empErr) teardownErrors.push(`employers: ${empErr.message}`);

    expect(
      teardownErrors,
      `cleanup: all teardown deletes must succeed — failures: ${teardownErrors.join('; ')}`,
    ).toEqual([]);
  });

  test('0060: INSERT a subscriber tagged to an INACTIVE employer raises', async () => {
    // The throwaway INACTIVE employer cannot admit a new member. The BEFORE-INSERT
    // trigger RAISEs P0001, so the insert must error and leave no row.
    const { error } = await supabaseAdmin.from('subscribers').insert({
      id: TST.insertSub, name: 'TST should-not-persist', phone: `+25676${RUN.slice(-7).padStart(7, '0')}`,
      employer_id: TST.employerInactive, is_active: true, is_demo_signup: true,
    });
    expect(fnRaised(error), 'insert under inactive employer must be blocked by 0060').toBe(true);

    // And no row leaked through.
    const { count, error: cErr } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('id', TST.insertSub);
    expect(cErr, 'post-insert count').toBeNull();
    expect(count ?? 0, 'blocked insert must leave no subscriber row').toBe(0);
  });

  test('0061: UPDATE-re-tag to an INACTIVE employer raises; detach + active re-tag pass', async () => {
    // (a) Re-tag the unattached probe subscriber to the INACTIVE employer → blocked.
    const { error: blocked } = await supabaseAdmin
      .from('subscribers')
      .update({ employer_id: TST.employerInactive })
      .eq('id', TST.retagSub);
    expect(fnRaised(blocked), 'UPDATE-re-tag to inactive employer must be blocked by 0061').toBe(true);

    // The probe row's employer_id is unchanged (still NULL).
    const { data: afterBlock, error: rbErr } = await supabaseAdmin
      .from('subscribers')
      .select('employer_id')
      .eq('id', TST.retagSub)
      .maybeSingle();
    expect(rbErr, 'probe re-read after blocked re-tag').toBeNull();
    expect((afterBlock as { employer_id: string | null } | null)?.employer_id ?? null).toBeNull();

    // (b) Re-tag to the ACTIVE throwaway employer → allowed (legitimate attach).
    const { error: okRetag } = await supabaseAdmin
      .from('subscribers')
      .update({ employer_id: TST.employerActive })
      .eq('id', TST.retagSub);
    expect(okRetag, 're-tag to an ACTIVE employer must be allowed').toBeNull();

    // (c) Detach (employer_id → NULL) → always allowed, even though the source
    //     employer could be inactive — the 0061 guard is scoped to a non-null
    //     DISTINCT re-tag, so a detach passes untouched.
    const { error: okDetach } = await supabaseAdmin
      .from('subscribers')
      .update({ employer_id: null })
      .eq('id', TST.retagSub);
    expect(okDetach, 'detach (employer_id → NULL) must be allowed').toBeNull();
  });

  test('set_employer_status: deactivate flips status + detaches members; reactivate re-links them', async () => {
    // Sanity: the active throwaway employer holds its member.
    const { count: before, error: bErr } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('employer_id', TST.employerActive);
    expect(bErr, 'pre-deactivate member count').toBeNull();
    expect(before ?? 0, 'active throwaway employer must hold ≥1 member for the cascade to be meaningful')
      .toBeGreaterThanOrEqual(1);

    // Deactivate via the admin-gated RPC.
    const deact = await adminRpc.rpc('set_employer_status', {
      p_employer_id: TST.employerActive, p_status: 'inactive',
    });
    expect(deact.error, `set_employer_status(inactive): ${deact.error?.message}`).toBeNull();

    // Status flipped.
    const { data: empRow, error: eErr } = await supabaseAdmin
      .from('employers').select('status').eq('id', TST.employerActive).maybeSingle();
    expect(eErr, 'employer status re-read').toBeNull();
    expect((empRow as { status: string } | null)?.status).toBe('inactive');

    // Members detached (employer_id → NULL); none remain tagged.
    const { count: after, error: aErr } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('employer_id', TST.employerActive);
    expect(aErr, 'post-deactivate member count').toBeNull();
    expect(after ?? 0, 'all members must detach on employer deactivate').toBe(0);

    // Reactivate flips status back AND replays the detach journal (0080).
    const react = await adminRpc.rpc('set_employer_status', {
      p_employer_id: TST.employerActive, p_status: 'active',
    });
    expect(react.error, `set_employer_status(active): ${react.error?.message}`).toBeNull();

    const { data: empRow2 } = await supabaseAdmin
      .from('employers').select('status').eq('id', TST.employerActive).maybeSingle();
    expect((empRow2 as { status: string } | null)?.status).toBe('active');

    // 0080: reactivate REPLAYS the detach journal, so every detached member is
    // re-linked — the deactivate→reactivate pair is a round trip, not a one-way
    // door. (Pre-0080 this asserted 0.) See 0080_reversible_entity_detach.sql.
    const { count: afterReact } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('employer_id', TST.employerActive);
    expect(afterReact ?? 0, 'reactivate must re-link every detached member (0080 journal replay)')
      .toBe(before ?? 0);
  });

  test('set_distributor_status: deactivate flips distributor + branches + agents and detaches the agent tree', async () => {
    // Sanity: the agent tree holds its subscriber.
    const { count: subsBefore, error: sbErr } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', TST.agent);
    expect(sbErr, 'pre-deactivate agent-tree subscriber count').toBeNull();
    expect(subsBefore ?? 0, 'throwaway agent must hold ≥1 subscriber for the cascade to be meaningful')
      .toBeGreaterThanOrEqual(1);

    // Deactivate the throwaway distributor.
    const deact = await adminRpc.rpc('set_distributor_status', {
      p_distributor_id: TST.distributor, p_status: 'inactive',
    });
    expect(deact.error, `set_distributor_status(inactive): ${deact.error?.message}`).toBeNull();

    // Distributor + its branch + its agent are all 'inactive'.
    const { data: distRow } = await supabaseAdmin
      .from('distributors').select('status').eq('id', TST.distributor).maybeSingle();
    expect((distRow as { status: string } | null)?.status, 'distributor inactive').toBe('inactive');

    const { data: brRow } = await supabaseAdmin
      .from('branches').select('status').eq('id', TST.branch).maybeSingle();
    expect((brRow as { status: string } | null)?.status, 'branch cascaded to inactive').toBe('inactive');

    const { data: agRow } = await supabaseAdmin
      .from('agents').select('status').eq('id', TST.agent).maybeSingle();
    expect((agRow as { status: string } | null)?.status, 'agent cascaded to inactive').toBe('inactive');

    // Subscriber detached from the agent tree (agent_id → NULL).
    const { count: subsAfter, error: saErr } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', TST.agent);
    expect(saErr, 'post-deactivate agent-tree subscriber count').toBeNull();
    expect(subsAfter ?? 0, 'all agent-tree subscribers must detach on distributor deactivate').toBe(0);

    // is_active is NEVER touched — the detached subscriber stays active.
    const { data: detached } = await supabaseAdmin
      .from('subscribers').select('is_active').eq('id', TST.treeSub).maybeSingle();
    expect((detached as { is_active: boolean } | null)?.is_active, 'detached subscriber stays active').toBe(true);

    // Reactivate flips status back AND replays the detach journal (0080).
    const react = await adminRpc.rpc('set_distributor_status', {
      p_distributor_id: TST.distributor, p_status: 'active',
    });
    expect(react.error, `set_distributor_status(active): ${react.error?.message}`).toBeNull();

    const { data: distRow2 } = await supabaseAdmin
      .from('distributors').select('status').eq('id', TST.distributor).maybeSingle();
    expect((distRow2 as { status: string } | null)?.status, 'distributor reactivated').toBe('active');

    // 0080: the journal replay re-tags the whole detached agent tree.
    // (Pre-0080 this asserted 0 — one-way detach.)
    const { count: subsReact } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', TST.agent);
    expect(subsReact ?? 0, 'reactivate must re-tag the detached subscriber (0080 journal replay)')
      .toBe(subsBefore ?? 0);
  });
});
