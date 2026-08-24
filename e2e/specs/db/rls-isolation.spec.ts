// Cross-tenant RLS isolation spec — proves that a role-scoped caller CANNOT read
// another tenant's data at the DATABASE layer (not merely the UI filter).
//
// Closes audit §7b.10 / F2-09 ("zero cross-tenant RLS isolation test at any
// layer"). The nearest existing E2E (distributor-drill-agent-to-subscriber)
// verifies UI-level scoping (the component filter) — a RLS misconfig that still
// let the DB query succeed would pass it. This spec attacks the DB directly:
// mint a genuine role JWT for tenant A, stamp an ANON PostgREST client with it
// (so PostgREST runs `SET ROLE authenticated` and the RLS policies evaluate
// `auth.jwt() ->> 'app_role'/'<role>Id'` against A's claims), then attempt a
// read scoped to tenant B and assert ZERO rows come back.
//
// The RLS predicates under test (all read app_role + the role-scoped *Id claim,
// per CLAUDE.md §5.7 — NEVER auth.uid(), NEVER 'role'):
//   • commissions_select_agent   (0007): agent_id = jwt.agentId
//   • subscriber_balances_select_self (0007): subscriber_id = jwt.subscriberId
//   • subscribers_select_employer (0043): app_role='employer' AND
//       employer_id = jwt.employerId  (the live employer tenant boundary after
//       0045 retired public.employees → employees are now tagged subscribers)
//
// Service-role (supabaseAdmin) is used ONLY for setup/teardown + to confirm
// tenant B's rows genuinely exist (so a "0 rows" result is real isolation, not an
// empty table). The scoped reads go through the anon+JWT client.
//
// Run prereq: SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// + SUPABASE_JWT_SECRET in .env.local. Without them the file test.skip()s cleanly.

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../fixtures/db';
import { mintRoleJwt, PERSONA_FOR, type Role } from '../../fixtures/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const hasEnv =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!SUPABASE_URL &&
  !!ANON_KEY &&
  !!process.env.SUPABASE_JWT_SECRET;

/**
 * Build a PostgREST client that authenticates as `role`/`entityId` via a minted
 * HS256 JWT. The token rides in the global Authorization header so EVERY request
 * is evaluated by RLS as that tenant (the anon `apikey` flips PostgREST to the
 * `authenticated` Postgres role; the JWT claims drive the policy predicates).
 */
async function roleClient(role: Role, entityId: string): Promise<SupabaseClient> {
  const token = await mintRoleJwt(role, entityId);
  return createClient(SUPABASE_URL as string, ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

test.describe('cross-tenant RLS isolation (DB layer)', () => {
  test.skip(
    !hasEnv,
    'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_JWT_SECRET',
  );

  test("agent A's JWT cannot read agent B's commissions", async () => {
    const agentA = PERSONA_FOR.agent.entityId; // 'a-001'
    const agentB = 'a-042'; // a distinct seeded agent (seed-supabase.mjs dp-a-002)

    // Ground truth (service-role): agent B genuinely HAS commissions, so a 0-row
    // scoped read is real isolation, not an empty table.
    const { count: bRowsAdmin, error: adminErr } = await supabaseAdmin
      .from('commissions')
      .select('*', { count: 'exact', head: true })
      .eq('agent_id', agentB);
    expect(adminErr, 'service-role count of agent B commissions').toBeNull();
    expect(bRowsAdmin ?? 0, 'agent B must have ≥1 commission for this probe to be meaningful')
      .toBeGreaterThan(0);

    // Attack: agent A's token, scoped to agent B's rows → RLS must return 0.
    const asAgentA = await roleClient('agent', agentA);
    const { data, error } = await asAgentA
      .from('commissions')
      .select('id, agent_id')
      .eq('agent_id', agentB);
    // RLS yields an empty set (not an error) for rows the policy excludes.
    expect(error, 'scoped read should not error, just return nothing').toBeNull();
    expect(
      (data ?? []).length,
      `agent A (${agentA}) leaked ${(data ?? []).length} of agent B (${agentB})'s commissions`,
    ).toBe(0);

    // Positive control: agent A CAN read its own commissions (proves the token +
    // policy work, so the 0 above is isolation — not a broken/blank token).
    const { data: ownData, error: ownErr } = await asAgentA
      .from('commissions')
      .select('id, agent_id')
      .eq('agent_id', agentA)
      .limit(5);
    expect(ownErr, "agent A's own read should succeed").toBeNull();
    for (const row of ownData ?? []) {
      expect((row as { agent_id: string }).agent_id, 'own read returns only own rows').toBe(agentA);
    }
  });

  test("subscriber A cannot read subscriber B's balance", async () => {
    const subA = PERSONA_FOR.subscriber.entityId; // 's-0001'
    const subB = 's-0002'; // a distinct seeded subscriber

    // Ground truth: subscriber B has a balance row.
    const { count: bBalAdmin, error: adminErr } = await supabaseAdmin
      .from('subscriber_balances')
      .select('*', { count: 'exact', head: true })
      .eq('subscriber_id', subB);
    expect(adminErr, 'service-role count of subscriber B balance').toBeNull();
    expect(bBalAdmin ?? 0, 'subscriber B must have a balance row').toBeGreaterThan(0);

    // Attack: subscriber A's token, scoped to subscriber B's balance → 0 rows.
    const asSubA = await roleClient('subscriber', subA);
    const { data, error } = await asSubA
      .from('subscriber_balances')
      .select('subscriber_id, total_balance')
      .eq('subscriber_id', subB);
    expect(error, 'scoped read should not error').toBeNull();
    expect(
      (data ?? []).length,
      `subscriber A (${subA}) leaked subscriber B (${subB})'s balance`,
    ).toBe(0);

    // Positive control: A can read its OWN balance.
    const { data: ownBal, error: ownErr } = await asSubA
      .from('subscriber_balances')
      .select('subscriber_id')
      .eq('subscriber_id', subA);
    expect(ownErr, "subscriber A's own balance read should succeed").toBeNull();
    expect((ownBal ?? []).length, 'A reads its own balance').toBeGreaterThan(0);
  });

  test("employer A's JWT cannot read employer B's tagged subscribers", async () => {
    // LIVE employer model (0043, after 0045 retired public.employees): an
    // employer's "employees" are REAL subscribers tagged via subscribers.
    // employer_id. The RLS predicate is subscribers_select_employer (0043):
    //   app_role = 'employer' AND employer_id = jwt.employerId
    // so employer A's token must read ZERO of employer B's tagged subscribers.
    //
    // employer A = emp-001 (seeded, has tagged subscribers). employer B is a
    // second tagged employer: the demo seed ships a SINGLE employer, so we seed
    // one foreign employer + one tagged subscriber via the service-role client
    // (mirroring how the settlement fixtures stage rows), then tear it down.
    const employerA = PERSONA_FOR.employer.entityId; // 'emp-001'
    const employerB = `emp-e2e-foreign-${Date.now()}`;
    const subBId = `s-e2e-emp-foreign-${Date.now()}`;

    // ── Seed employer B + one subscriber tagged to it (service-role bypasses RLS).
    const { error: empErr } = await supabaseAdmin
      .from('employers')
      .insert({ id: employerB, name: 'E2E Foreign Employer (RLS probe)' });
    expect(empErr, 'service-role insert of employer B').toBeNull();

    try {
      const { error: subErr } = await supabaseAdmin.from('subscribers').insert({
        id: subBId,
        name: 'E2E Foreign Member (RLS probe)',
        phone: `+25670000${Date.now().toString().slice(-5)}`,
        employer_id: employerB,
        agent_id: null, // tagged subscriber: no agent commission (0043)
      });
      expect(subErr, 'service-role insert of employer B subscriber').toBeNull();

      // Ground truth: employer A genuinely HAS tagged subscribers, AND employer B
      // has exactly the one we seeded — so a 0-row scoped read is real isolation.
      const { count: aRowsAdmin, error: aAdminErr } = await supabaseAdmin
        .from('subscribers')
        .select('*', { count: 'exact', head: true })
        .eq('employer_id', employerA);
      expect(aAdminErr, 'service-role count of employer A subscribers').toBeNull();
      expect(
        aRowsAdmin ?? 0,
        'employer A (emp-001) must have ≥1 tagged subscriber for this probe',
      ).toBeGreaterThan(0);

      const { count: bRowsAdmin, error: bAdminErr } = await supabaseAdmin
        .from('subscribers')
        .select('*', { count: 'exact', head: true })
        .eq('employer_id', employerB);
      expect(bAdminErr, 'service-role count of employer B subscribers').toBeNull();
      expect(bRowsAdmin ?? 0, 'employer B must have ≥1 tagged subscriber').toBeGreaterThan(0);

      // Attack: employer A's token, scoped to employer B's subscribers → RLS must
      // return 0 (an empty set, not an error, for rows the policy excludes).
      const asEmployerA = await roleClient('employer', employerA);
      const { data, error } = await asEmployerA
        .from('subscribers')
        .select('id, employer_id')
        .eq('employer_id', employerB);
      expect(error, 'scoped read should not error, just return nothing').toBeNull();
      expect(
        (data ?? []).length,
        `employer A (${employerA}) leaked ${(data ?? []).length} of employer B (${employerB})'s subscribers`,
      ).toBe(0);

      // Positive control: employer A CAN read its OWN tagged subscribers (proves
      // the token + policy work, so the 0 above is isolation — not a blank token).
      const { data: ownData, error: ownErr } = await asEmployerA
        .from('subscribers')
        .select('id, employer_id')
        .eq('employer_id', employerA)
        .limit(5);
      expect(ownErr, "employer A's own read should succeed").toBeNull();
      expect((ownData ?? []).length, 'employer A reads its own tagged subscribers').toBeGreaterThan(0);
      for (const row of ownData ?? []) {
        expect(
          (row as { employer_id: string }).employer_id,
          'own read returns only own rows',
        ).toBe(employerA);
      }
    } finally {
      // Teardown (newest-FK first): drop the tagged subscriber, then employer B.
      // ON DELETE SET NULL on subscribers.employer_id means an orphaned subscriber
      // would otherwise survive the employer delete, so remove it explicitly.
      // Both deletes are asserted — a swallowed error here is exactly how fixture
      // rows leak into the live demo DB unnoticed (audit A25-004).
      const { error: subDelErr } = await supabaseAdmin.from('subscribers').delete().eq('id', subBId);
      expect(subDelErr, `cleanup: deleting subscriber ${subBId}`).toBeNull();
      const { error: empDelErr } = await supabaseAdmin.from('employers').delete().eq('id', employerB);
      expect(empDelErr, `cleanup: deleting employer ${employerB}`).toBeNull();
    }
  });
});
