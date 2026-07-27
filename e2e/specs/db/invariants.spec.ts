// DB invariants spec — guards the post-0029 schema state of the live
// Supabase project (ilkhfnoyxlxwqadebnkp — Singapore ap-southeast-1, cutover
// 2026-06-05; replaced the dead Tokyo project zengmiugieqjqzaccbqe).
//
// The commission flow was simplified in migrations 0029/0030/0031 (applied +
// ledger-tracked in live): the maker-checker run/dispute/hold/confirm state
// machine was retired and the commission_status enum collapsed from seven
// states to the two-state `due → paid` model. The dropped objects
// (settlement_runs, the agent_*/branch_*/dispute RPCs, the
// disputed_at/previous_status/agent_confirmed columns, the released/confirmed/
// held/disputed enum values) MUST NOT reappear, and the new write RPCs
// (apply_settlement, mark_notifications_read) MUST be present. This guard
// encodes the CURRENT schema so a regression that re-introduces the old shape
// — or drops the new RPCs — fails the main full matrix loudly.
//
// What we assert:
//   1. Zero duplicate agent emails — UNIQUE INDEX ux_agents_email is live
//      (migration 0017).
//   2. Zero duplicate subscriber NIns — UNIQUE INDEX ux_subscribers_nin is
//      live (migration 0017). The `nin` column lives on `subscribers`, not
//      `agents`; the agents table has no national-ID column.
//   3. Every commission row carries a valid two-state status — `status IN
//      ('due','paid')` only (post-0029 commission_status enum, 0029 line 138).
//      No row may carry a dropped legacy value (released/confirmed/held/
//      disputed/in_run/rejected).
//   4. Every `paid` commission carries its settlement stamp — `paid_date` AND
//      `paid_amount` are populated (apply_settlement stamps both, 0031/0032);
//      and no `due` row leaks a `paid_date`. This is the post-collapse
//      replacement for the old "paid_date ⇒ terminal status" invariant.
//   5. Zero contribution schedules with `next_due_date < MOCK_NOW` —
//      contribution_schedules has no status column; we assert every schedule
//      row has a non-stale next_due_date RELATIVE TO THE SEED ANCHOR. The seed
//      generates next_due_date relative to the frozen MOCK_NOW (2026-05-26),
//      NOT wall-clock, so comparing against `new Date()` would fail purely from
//      real time elapsing since cutover (~1997 "stale" rows that are stale only
//      vs today, not vs the seed anchor — audit §4b.2). Comparing against
//      MOCK_NOW asserts the genuine invariant the seed guarantees.
//   6. The new `distributors` table is live with the d-001 row.
//   7. The new settlement write RPCs `apply_settlement` and
//      `mark_notifications_read` exist in pg_proc (replacing the dropped
//      `agent_dispute_line` probe — that RPC was removed by 0029 line 55).
//
// Run prereq: SUPABASE_SERVICE_ROLE_KEY in .env.local. Without it, every
// test in this file `test.skip()`s with a clear note — the e2e/fixtures/db
// throw is caught and re-raised as a skip rather than a hard failure, so
// CI without the secret still passes the rest of the suite. Locally this
// is wired by default via the existing .env.local.

import { test, expect } from '@playwright/test';
import { supabaseAdmin } from '../../fixtures/db';

// Seed anchor — mirrors `MOCK_NOW = new Date(2026, 4, 26)` (2026-05-26) in
// `src/data/mockData.js`. The seed generates `contribution_schedules
// .next_due_date` relative to THIS frozen anchor, not wall-clock, so the
// freshness invariant in assertion #5 must compare against it (not `new
// Date()`) — otherwise real time elapsing since cutover reports thousands of
// "stale" rows that are stale only vs today, never vs the seed (audit §4b.2).
// Kept as a local literal rather than importing mockData.js so this Node-side
// spec doesn't drag the app's mockGeo/mockBranchDefs graph into the Playwright
// runner. If MOCK_NOW moves in mockData.js, mirror it here.
const MOCK_NOW_ISO = '2026-05-26';

// The whole file is service-role-only. If the env var is missing, the
// supabaseAdmin client throws at import time; this guard catches the
// import-time error and surfaces a clean skip for the file.
const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.VITE_SUPABASE_URL;

test.describe('DB invariants (ilkhfnoyxlxwqadebnkp)', () => {
  test.skip(!hasServiceRole, 'requires SUPABASE_SERVICE_ROLE_KEY in env');

  test('no duplicate agent emails', async () => {
    // Count rows that share an email with another row. The cleanest
    // formulation is: COUNT(*) where (email is not null AND email is in
    // the set of emails with count > 1). We use a parameter-free query via
    // postgres RPC convention — but supabase-js doesn't expose arbitrary
    // SQL by default, so we fetch all emails and dedupe client-side. The
    // agents table has ~2 000 rows so this is cheap.
    const { data, error } = await supabaseAdmin
      .from('agents')
      .select('email')
      .not('email', 'is', null);
    expect(error, 'agents query').toBeNull();
    const rows = data || [];
    const counts = new Map<string, number>();
    for (const r of rows) {
      const e = (r as { email: string | null }).email;
      if (!e) continue;
      counts.set(e, (counts.get(e) || 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1);
    expect(
      duplicates.length,
      `duplicate emails found: ${JSON.stringify(duplicates.slice(0, 5))}`,
    ).toBe(0);
  });

  test('no duplicate subscriber NIns', async () => {
    // NIN lives on `subscribers` (not `agents`). Schema: 0001 line 151.
    // The 0017 migration enforces a partial UNIQUE INDEX on the column.
    const { data, error } = await supabaseAdmin
      .from('subscribers')
      .select('nin')
      .not('nin', 'is', null);
    expect(error, 'subscribers nin query').toBeNull();
    const rows = data || [];
    const counts = new Map<string, number>();
    for (const r of rows) {
      const n = (r as { nin: string | null }).nin;
      if (!n) continue;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    const duplicates = [...counts.entries()].filter(([, n]) => n > 1);
    expect(
      duplicates.length,
      `duplicate NIns found: ${JSON.stringify(duplicates.slice(0, 5))}`,
    ).toBe(0);
  });

  test('every commission carries a valid two-state status (due | paid)', async () => {
    // Post-0029 the commission_status enum is exactly { due, paid } (0029
    // line 138). No row may carry a dropped legacy value. We count rows whose
    // status is NOT in the surviving set; any legacy value (or an unexpected
    // new one) makes the count non-zero and fails loudly. Querying for the
    // dropped values directly would error at the enum layer, so we invert.
    const VALID = ['due', 'paid'];
    const { data, error, count } = await supabaseAdmin
      .from('commissions')
      .select('id, status', { count: 'exact' })
      .not('status', 'in', `(${VALID.join(',')})`);
    expect(error, 'commissions status query').toBeNull();
    expect(
      count ?? 0,
      `commissions with a status outside {due,paid} (sample: ${JSON.stringify((data || []).slice(0, 3))})`,
    ).toBe(0);
  });

  test('paid commissions carry paid_date + paid_amount; due rows carry no paid_date', async () => {
    // apply_settlement (0031/0032) stamps status='paid' together with
    // paid_date + paid_amount in the same UPDATE, so a `paid` row missing
    // either is a corrupt settlement. Conversely a `due` row must not carry a
    // paid_date (it would mean a half-rolled-back settlement). Three cheap
    // head-only counts; each must be zero.
    const { count: paidNoDate, error: e1 } = await supabaseAdmin
      .from('commissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'paid')
      .is('paid_date', null);
    expect(e1, 'paid rows missing paid_date query').toBeNull();
    expect(paidNoDate ?? 0, 'paid commissions missing paid_date').toBe(0);

    const { count: paidNoAmount, error: e2 } = await supabaseAdmin
      .from('commissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'paid')
      .is('paid_amount', null);
    expect(e2, 'paid rows missing paid_amount query').toBeNull();
    expect(paidNoAmount ?? 0, 'paid commissions missing paid_amount').toBe(0);

    const { count: dueWithDate, error: e3 } = await supabaseAdmin
      .from('commissions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'due')
      .not('paid_date', 'is', null);
    expect(e3, 'due rows with paid_date query').toBeNull();
    expect(dueWithDate ?? 0, 'due commissions carrying a paid_date').toBe(0);
  });

  test('no schedules with next_due_date < MOCK_NOW (seed anchor)', async () => {
    // contribution_schedules has no status column (0001 line 189) —
    // every row is implicitly "active". We assert every row has a non-stale
    // next_due_date RELATIVE TO THE SEED ANCHOR (MOCK_NOW), not wall-clock:
    // the seed materialises next_due_date from the frozen MOCK_NOW
    // (2026-05-26), so comparing against `new Date()` would fail purely from
    // real time elapsing since cutover (audit §4b.2 — ~1997 rows stale only vs
    // today). Comparing against MOCK_NOW asserts the invariant the seed
    // actually guarantees.
    const isoDate = MOCK_NOW_ISO;
    const { count, error } = await supabaseAdmin
      .from('contribution_schedules')
      .select('*', { count: 'exact', head: true })
      .lt('next_due_date', isoDate);
    expect(error, 'schedules next_due_date query').toBeNull();
    expect(
      count ?? 0,
      `schedules with next_due_date before the seed anchor ${isoDate}`,
    ).toBe(0);
  });

  test('distributors table is live and d-001 row exists', async () => {
    const { count, error } = await supabaseAdmin
      .from('distributors')
      .select('*', { count: 'exact', head: true })
      .eq('id', 'd-001');
    expect(error, 'distributors d-001 lookup').toBeNull();
    expect(count, 'expected exactly one d-001 row').toBe(1);
  });

  test('settlement write RPCs (apply_settlement + mark_notifications_read) exist in pg_proc', async () => {
    // We can't query pg_proc directly via PostgREST — it's not exposed via
    // the public schema. The cleanest proof is to invoke each RPC with safe
    // sentinel input and confirm the error (if any) is NOT "function does not
    // exist" (PGRST202). The 0029 simplification dropped the dispute RPC this
    // test used to probe; the surviving write surface is apply_settlement
    // (0031/0032) + mark_notifications_read (0031).
    //
    // apply_settlement is distributor-gated and raises P0001 for a NULL-jwt
    // service-role caller (role IS DISTINCT FROM 'distributor'). That role-gate
    // error proves the function is present and wired. We pass an empty array so
    // nothing is settled even on the (impossible-here) happy path.
    //
    // NOTE on the apply_settlement overload: migration 0032 is NOW LIVE on the
    // Singapore project, so the function is the two-arg form
    // `apply_settlement(p_rows jsonb, p_nonce text)`. We probe with the two-arg
    // shape `{ p_rows: [], p_nonce: 'test-probe' }` so PostgREST resolves the
    // overload by its named-arg set; an empty p_rows means nothing is settled
    // even if the (impossible-here, NULL-jwt) happy path were reached. The
    // role-gate path still fires (P0001, role IS DISTINCT FROM 'distributor'),
    // proving the function is present and wired. A PGRST202 here would mean the
    // two-arg overload is missing — a deliberate tripwire.
    const fnMissing = (msg: string | null | undefined) =>
      /could not find.*function|PGRST202|does not exist/i.test(msg || '');

    const applyRes = await supabaseAdmin.rpc('apply_settlement', {
      p_rows: [],
      p_nonce: 'test-probe',
    });
    if (applyRes.error) {
      expect(
        fnMissing(applyRes.error.message),
        `apply_settlement missing from pg_proc: ${applyRes.error.message}`,
      ).toBe(false);
    }

    const markRes = await supabaseAdmin.rpc('mark_notifications_read', {
      p_ids: ['ntf-never-exists-00000000'],
    });
    if (markRes.error) {
      expect(
        fnMissing(markRes.error.message),
        `mark_notifications_read missing from pg_proc: ${markRes.error.message}`,
      ).toBe(false);
    }
  });

  // ── Attribution integrity (regression guard for the 2026-07-27 mass detach) ──
  // On 2026-07-27 a single `set_distributor_status('d-001','inactive')` nulled
  // `subscribers.agent_id` for 5,003 rows; reactivate never restored them, so every
  // per-region/branch/agent subscriber + AUM number collapsed while country-level
  // totals stayed right. Nothing in the suite noticed.
  //
  // We deliberately do NOT assert `agent_id IS NOT NULL` — a NULL agent_id is a
  // LEGITIMATE state (employer-channel members, self-onboarded savers, and the
  // in-flight detach that `deactivate-entities.spec.ts` creates on its own
  // throwaway ids under `fullyParallel`). What is never legitimate is a subscriber
  // that has NO agent and NO employer while its own commission rows still name the
  // agent that sold it — that is precisely the orphaned-attribution signature.
  test('no seeded subscriber is orphaned from an agent that still bills for it', async () => {
    const { data: orphans, error } = await supabaseAdmin
      .from('subscribers')
      .select('id, agent_id, employer_id, commissions!inner(agent_id)')
      .is('agent_id', null)
      .is('employer_id', null)
      .like('id', 's-%')
      .limit(25);

    expect(error, `orphaned-attribution probe: ${error?.message}`).toBeNull();
    expect(
      orphans?.length ?? 0,
      `subscribers with no agent + no employer but live commission rows naming an agent — ` +
        `mass-detach signature. Sample: ${JSON.stringify(orphans?.slice(0, 5) ?? [])}`,
    ).toBe(0);
  });
});
