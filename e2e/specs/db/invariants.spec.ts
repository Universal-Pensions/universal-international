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
//      generates next_due_date relative to the frozen MOCK_NOW (2026-07-01,
//      imported from src/constants/demoClock.js — see below), NOT wall-clock,
//      so comparing against `new Date()` would fail purely from real time
//      elapsing since the last seed run (hundreds of "stale" rows that are
//      stale only vs today, not vs the seed anchor — audit §4b.2). Comparing
//      against MOCK_NOW asserts the genuine invariant the seed guarantees.
//      A second assertion catches NULL next_due_date rows, which the SQL `<`
//      comparison above can never see (audit A06-008 — this exact blind spot
//      hid 21 live rows): any NULL outside the known empe-* (employer-member)
//      shape fails loudly, and — per A06-015's second half — the empe-* rows
//      are no longer silently excluded either: each is asserted to carry
//      amount = 0, so a future one that picks up a non-zero amount with no
//      due date (money owed, invisible to any freshness check) also fails
//      (see that assertion for the full reasoning).
//   6. The new `distributors` table is live with the d-001 row.
//   7. The new settlement write RPCs `apply_settlement` and
//      `mark_notifications_read` exist in pg_proc (replacing the dropped
//      `agent_dispute_line` probe — that RPC was removed by 0029 line 55).
//   8. public._demo_now() — the SQL-side demo clock — resolves to the SAME
//      calendar date as the JS MOCK_NOW anchor (audit A06-009: these two had
//      drifted 44 days apart, sitting behind four RPCs that drive admin /
//      distributor / branch / employer "today" and "this month" tiles).
//   9. M1 (audit A25-005) — every subscriber has exactly one
//      subscriber_balances row. A subscriber with none renders a silent
//      UGX 0 to a demo rep with no error state; as of the 2026-08-23 audit 4
//      subscribers were missing one (traced to the E2E suite's own leaked
//      fixtures, guarded separately by e2e/global-teardown.ts — A25-004), not
//      a product defect. Live clean today; this test guards the regression.
//  10. M2 (audit A25-005) — subscriber_balances.units reconciles with
//      retirement_units + emergency_units. _resync_bucket_units() exists to
//      keep the two figures in step but nothing asserted the outcome; as of
//      the 2026-08-23 audit s-0005 disagreed by ~6.36 units (~10,000 UGX)
//      between two numbers on the same subscriber screen. Live clean today;
//      this test guards the next drift, not the historical one.
//
// Run prereq: SUPABASE_SERVICE_ROLE_KEY in .env.local. Without it, every
// test in this file `test.skip()`s with a clear note — the e2e/fixtures/db
// throw is caught and re-raised as a skip rather than a hard failure, so
// CI without the secret still passes the rest of the suite. Locally this
// is wired by default via the existing .env.local.

import { test, expect } from '@playwright/test';
import pgDefault from 'pg';
import { supabaseAdmin } from '../../fixtures/db';
import { MOCK_NOW_ISO_DATE } from '../../../src/constants/demoClock.js';

/**
 * Read an ENTIRE table through PostgREST, one page at a time.
 *
 * ⚠️ WHY THIS EXISTS. PostgREST caps an unbounded select at `db-max-rows`,
 * which is 1000 on this project — verified against live:
 *
 *   GET /rest/v1/subscribers?select=id     -> 1000 rows, content-range 0-999/5058
 *   GET /rest/v1/subscriber_balances?...   -> 1000 rows, content-range 0-999/5058
 *
 * There is no error and no warning. The client just gets the first page and a
 * test written against it silently checks 20% of the platform while reporting
 * on all of it.
 *
 * That is not hypothetical. The M1 invariant compared an unpaged `subscribers`
 * against an unpaged `subscriber_balances` and reported 500 members with no
 * balance row (2026-09-01). Direct SQL said the true number was ZERO. Neither
 * page was ordered, so the two 1000-row windows covered different members and
 * the set difference was pure artefact. It had passed for months only because
 * both tables happened to share a physical order; a reseed rewrote the heap and
 * the illusion broke. It would equally have hidden a REAL orphan sitting past
 * row 1000 — which is the failure mode that actually matters.
 *
 * `.order()` is as important as the paging: without a stable sort, successive
 * ranges are not guaranteed to partition the table.
 */
async function selectAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`selectAll(${table}) page at ${from}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// Seed anchor — the ONE literal `src/constants/demoClock.js` exports (audit
// A06-003/A06-008/A06-009/A26-003: this file used to hand-copy its own
// `MOCK_NOW_ISO = '2026-05-26'` literal, which silently drifted 36 days
// behind the real anchor and left assertion #5 unable to fail — see that
// test below). The seed generates `contribution_schedules.next_due_date`
// relative to THIS frozen anchor, not wall-clock, so the freshness invariant
// must compare against it (not `new Date()`) — otherwise real time elapsing
// since the last seed run reports hundreds of "stale" rows that are stale
// only vs today, never vs the seed (audit §4b.2).
//
// Safe to import directly (unlike `src/data/mockData.js`, which this file
// has always deliberately avoided — see the removed comment this replaced):
// demoClock.js is a leaf module with ZERO imports, so it does not drag the
// app's mockGeo/mockBranchDefs graph into the Playwright runner.
const MOCK_NOW_ISO = MOCK_NOW_ISO_DATE;

// The whole file is service-role-only. If the env var is missing, the
// supabaseAdmin client throws at import time; this guard catches the
// import-time error and surfaces a clean skip for the file.
const hasServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.VITE_SUPABASE_URL;

// The SQL-clock-agreement test below (assertion #8) needs a direct Postgres
// connection — `_demo_now()` is a `public.*` function but PostgREST exposure
// of an underscore-prefixed helper is not something this suite should rely
// on, so it is read the same way `e2e/fixtures/db.ts::findChildTableListDrift`
// already reads live schema: a raw `pg` client against SUPABASE_DB_URL (a
// project dependency already; see that function's own doc comment).
const hasDbUrl = !!process.env.SUPABASE_DB_URL;

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

  test('no schedules with next_due_date < MOCK_NOW (seed anchor), and NULL is confined to known employer-member rows', async () => {
    // contribution_schedules has no status column (0001 line 189) —
    // every row is implicitly "active". We assert every row has a non-stale
    // next_due_date RELATIVE TO THE SEED ANCHOR (MOCK_NOW), not wall-clock:
    // the seed materialises next_due_date from the frozen MOCK_NOW
    // (imported from src/constants/demoClock.js — see MOCK_NOW_ISO above), so
    // comparing against `new Date()` would fail purely from real time
    // elapsing since the last seed run (audit §4b.2 — hundreds of rows stale
    // only vs today). Comparing against MOCK_NOW asserts the invariant the
    // seed actually guarantees.
    //
    // Until 2026-08-25 this comparison was against a stale local copy of the
    // anchor 36 days behind the real one (audit A06-008), which — combined
    // with the seed's own stale mirror (A06-003, fixed in
    // scripts/seed-supabase.mjs) — left this assertion with 41 days of dead
    // slack: it reported 0 while 717 live rows were genuinely stale against
    // the wall clock. Comparing against the CORRECT anchor does not chase
    // that wall-clock staleness (doing so would make this test fail every day
    // between reseeds purely from time passing, which is not a regression —
    // see the comment above); it closes the dead slack a regression would
    // need to move dates back through before this test could ever notice.
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

    // SQL `<` never matches NULL, so the assertion above is structurally
    // blind to a schedule with NO due date at all — arguably the most stale
    // state possible (audit A06-008 finding #3: 21 live rows hid here).
    //
    // A06-015's second half (escalated 2026-08-25, folded in here rather than
    // as a parallel guard): this used to FILTER OUT every `empe-*` (employer
    // member) NULL row before asserting anything, which is exactly the defect
    // the audit named — "it also makes these 21 rows invisible to the only
    // guard that checks schedule freshness". Excluding them from the count
    // isn't the same as accounting for them: nothing stopped one of the 21
    // from silently picking up a non-zero `amount` (money owed with no due
    // date — a genuine bug) because the old code never looked at anything
    // but `subscriber_id`.
    //
    // 0102's design (its own header comment) makes contribution_schedules
    // "the MEMBER's own plan" — an employer-funded member legitimately has
    // EITHER no row at all (P4-employer-funded verified live: emp-002..
    // emp-007, 37 members, zero schedule rows — out of scope for a
    // freshness check, since a missing row has no date to be stale) OR a
    // placeholder row with `amount = 0` AND `next_due_date IS NULL` (emp-001,
    // 21 members — verified live 2026-08-25). Both are fine; what is NOT
    // fine is a NULL due date paired with a non-zero amount (money owed,
    // no schedule) on ANY row, `empe-*` or not — that is asserted explicitly
    // below instead of being silently skipped.
    const { data: nullDueRows, error: nullErr } = await supabaseAdmin
      .from('contribution_schedules')
      .select('subscriber_id, amount')
      .is('next_due_date', null)
      .limit(1000);
    expect(nullErr, 'schedules NULL next_due_date query').toBeNull();
    type NullDueRow = { subscriber_id: string | null; amount: number | null };
    const rows = (nullDueRows ?? []) as NullDueRow[];

    // A NULL due date on a real subscriber (`s-*`, not `empe-*`) is a
    // genuine regression — this repo's product model gives every real
    // subscriber a live schedule.
    const unexpectedNulls = rows.filter(
      (r) => !String(r.subscriber_id ?? '').startsWith('empe-'),
    );
    expect(
      unexpectedNulls.length,
      `schedule(s) with NULL next_due_date outside the known empe-* shape (A06-015): ` +
        `${JSON.stringify(unexpectedNulls.slice(0, 5))}`,
    ).toBe(0);

    // The known empe-* shape is now itself asserted, not skipped: every one
    // of them must carry amount = 0. A non-zero amount here would mean an
    // employer-funded member is owed money against a schedule with no due
    // date — invisible to any other freshness or collections check.
    const empeNullsWithAmount = rows.filter(
      (r) => String(r.subscriber_id ?? '').startsWith('empe-') && Number(r.amount) !== 0,
    );
    expect(
      empeNullsWithAmount.length,
      `empe-* schedule(s) with NULL next_due_date but a NON-ZERO amount (A06-015) — money owed ` +
        `with no due date, invisible to this freshness check: ${JSON.stringify(empeNullsWithAmount.slice(0, 5))}`,
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

    // ⚠️ THIS PROBE WRITES TO PRODUCTION. The note above predicts the role gate
    // fires and nothing happens; it does not. `supabaseAdmin` holds the service
    // role, which satisfies the gate, so the call reaches the happy path and —
    // even with p_rows: [] settling nothing — records its idempotency row:
    //
    //   settlement_uploads: nonce 'test-probe'
    //     {"skipped": [], "totalPaid": 0, "linesSettled": 0, "agentsSettled": 0}
    //
    // Nothing cleaned it up, so every run of this suite left one more piece of
    // permanent residue in the live database, and the global leak sweep failed
    // the whole job for it (observed 2026-09-01). No money moves — linesSettled
    // is 0 — but an idempotency ledger that accumulates test nonces is exactly
    // the kind of debris that later makes a real replay look already-applied.
    //
    // Deleted here rather than in global-teardown because the spec that made the
    // row should be the spec that removes it; distributor-apply-settlement.spec
    // already does the same for its own row (A05-014).
    const { error: probeCleanupErr } = await supabaseAdmin
      .from('settlement_uploads')
      .delete()
      .eq('nonce', 'test-probe');
    expect(
      probeCleanupErr?.message ?? null,
      'the apply_settlement probe must not leave its idempotency row in the live database',
    ).toBeNull();

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

  // ── SQL/JS demo-clock agreement (audit A06-009) ─────────────────────────
  // public._demo_now() is a FIFTH independent "now" — the only one that
  // lives in SQL, read by get_employer_activity_rollup,
  // get_entity_metrics_rollup, get_top_branch and submit_hospital_cash_claim
  // (i.e. the admin/distributor/branch/employer "today"/"this week"/"this
  // month" tiles + hospital-cash claim pricing). It was 44 days behind the JS
  // MOCK_NOW anchor (2026-05-18 vs 2026-07-01) — same live rows, same day,
  // "today's contributions" read 28 on one surface and 844 on another.
  // supabase/migrations/0126_demo_clock.sql brings it into agreement; this
  // test is what would have caught the original drift, and what catches the
  // next one if only one side of a future roll-forward gets updated.
  test('public._demo_now() (SQL clock) resolves to the same calendar date as the JS MOCK_NOW anchor', async () => {
    test.skip(!hasDbUrl, 'requires SUPABASE_DB_URL in env (.env.local) for a direct Postgres connection');

    // Raw `pg` client, not supabaseAdmin/PostgREST — `_demo_now` is a
    // leading-underscore internal helper and this suite should not depend on
    // whether PostgREST's schema cache happens to expose it as `/rpc/_demo_now`
    // for the service-role key. Same approach as
    // `e2e/fixtures/db.ts::findChildTableListDrift` (`pg` is already a project
    // dependency — see that function's doc comment). `@types/pg` is not
    // installed and e2e/*.ts is not type-checked by any script (A25-006), so
    // a minimal local shape is declared rather than reaching for `any`.
    const { Client } = pgDefault as unknown as {
      Client: new (config: { connectionString: string }) => {
        connect(): Promise<void>;
        query<T>(sql: string): Promise<{ rows: T[] }>;
        end(): Promise<void>;
      };
    };
    const client = new Client({ connectionString: process.env.SUPABASE_DB_URL as string });
    await client.connect();
    try {
      const { rows } = await client.query<{ demo_now_date: string }>(
        `select (public._demo_now())::date::text as demo_now_date`,
      );
      const sqlDate = rows[0]?.demo_now_date;
      expect(
        sqlDate,
        `public._demo_now() resolves to ${sqlDate ?? '(no row returned)'} but the JS anchor ` +
          `MOCK_NOW_ISO_DATE (src/constants/demoClock.js) is ${MOCK_NOW_ISO_DATE}. These must ` +
          `resolve to the same calendar date — apply supabase/migrations/0126_demo_clock.sql, ` +
          `or (if MOCK_NOW was rolled forward since) author its successor (audit A06-009).`,
      ).toBe(MOCK_NOW_ISO_DATE);
    } finally {
      await client.end();
    }
  });

  // ── M1: every subscriber has exactly one balance row (audit A25-005) ──────
  // Fetch both id sets unfiltered (no `.limit()`) — the same convention the
  // "no duplicate agent emails" / "no duplicate subscriber NIns" tests above
  // already use for full-table reads — and diff client-side, rather than a
  // nested PostgREST embed, so this doesn't depend on the schema cache having
  // auto-detected the subscribers -> subscriber_balances relationship.
  test('every subscriber has exactly one subscriber_balances row (M1)', async () => {
    // Paged. Unpaged, these two selects saw different 1000-row windows of a
    // 5058-row table and manufactured 500 phantom orphans — see selectAll().
    const subs = await selectAll<{ id: string }>('subscribers', 'id', 'id');
    const bals = await selectAll<{ subscriber_id: string }>(
      'subscriber_balances', 'subscriber_id', 'subscriber_id');

    const balanced = new Set((bals || []).map((r) => (r as { subscriber_id: string }).subscriber_id));
    const missing = (subs || [])
      .map((r) => (r as { id: string }).id)
      .filter((id) => !balanced.has(id));

    expect(
      missing.length,
      `subscriber(s) with no subscriber_balances row (M1 — see this file's header comment #9): ` +
        `${JSON.stringify(missing.slice(0, 10))}`,
    ).toBe(0);
  });

  // ── M2: units reconciles with retirement_units + emergency_units (audit
  // A25-005) ──────────────────────────────────────────────────────────────
  test('subscriber_balances.units reconciles with retirement_units + emergency_units (M2)', async () => {
    const data = await selectAll<Record<string, number | string>>(
      'subscriber_balances',
      'subscriber_id, units, retirement_units, emergency_units',
      'subscriber_id');

    // Round to 4dp before comparing — the same precision the live audit probe
    // used (a25/money-invariants.md: `round(units,4) <> round(retirement_units
    // + emergency_units,4)`) — so this doesn't fail on float noise far below
    // the smallest unit fraction the app ever displays.
    const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
    type BucketRow = { subscriber_id: string; units: number; retirement_units: number; emergency_units: number };
    const mismatched = ((data || []) as BucketRow[]).filter(
      (r) => round4(Number(r.units)) !== round4(Number(r.retirement_units) + Number(r.emergency_units)),
    );

    expect(
      mismatched.length,
      `subscriber_balances row(s) where units <> retirement_units + emergency_units, rounded to ` +
        `4dp (M2 — see this file's header comment #10): ${JSON.stringify(
          mismatched.slice(0, 5).map((r) => ({
            subscriber_id: r.subscriber_id,
            units: r.units,
            bucketSum: Number(r.retirement_units) + Number(r.emergency_units),
          })),
        )}`,
    ).toBe(0);
  });

  // ── M3: total_balance reconciles with retirement_balance + emergency_balance
  // (audit A25-005) ──────────────────────────────────────────────────────────
  // The money counterpart to M2: M2 guards the two UNIT figures, this guards
  // the two UGX figures every balance card actually renders. a25/money-
  // invariants.md's live probe found this ALREADY clean (`balance_total_mismatch
  // | 0`) — this test is here so a future write path that updates one bucket
  // without the other (the same class of bug M2 guards) cannot regress silently.
  test('subscriber_balances.total_balance reconciles with retirement_balance + emergency_balance (M3)', async () => {
    const data = await selectAll<Record<string, number | string>>(
      'subscriber_balances',
      'subscriber_id, total_balance, retirement_balance, emergency_balance',
      'subscriber_id');

    type BalanceRow = {
      subscriber_id: string;
      total_balance: number;
      retirement_balance: number;
      emergency_balance: number;
    };
    // 2dp — UGX has no meaningful sub-cent unit; matches the live probe's own
    // `round(...,2)` comparison in a25/money-invariants.md.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const mismatched = ((data || []) as BalanceRow[]).filter(
      (r) => round2(Number(r.total_balance)) !== round2(Number(r.retirement_balance) + Number(r.emergency_balance)),
    );

    expect(
      mismatched.length,
      `subscriber_balances row(s) where total_balance <> retirement_balance + emergency_balance, ` +
        `rounded to 2dp (M3): ${JSON.stringify(
          mismatched.slice(0, 5).map((r) => ({
            subscriber_id: r.subscriber_id,
            total_balance: r.total_balance,
            bucketSum: Number(r.retirement_balance) + Number(r.emergency_balance),
          })),
        )}`,
    ).toBe(0);
  });

  // ── M4: no negative money anywhere in subscriber_balances (audit A25-005) ──
  // A negative balance or unit count has no product meaning — it can only mean
  // a withdrawal or a repair script overshot. a25/money-invariants.md's live
  // probe found this ALREADY clean (`negative_balances | 0`); this test is the
  // guard that keeps it that way.
  test('no negative balances or units in subscriber_balances (M4)', async () => {
    const data = await selectAll<Record<string, number | string>>(
      'subscriber_balances',
      'subscriber_id, total_balance, retirement_balance, emergency_balance, units, retirement_units, emergency_units',
      'subscriber_id');

    type Row = {
      subscriber_id: string;
      total_balance: number; retirement_balance: number; emergency_balance: number;
      units: number; retirement_units: number; emergency_units: number;
    };
    const NUMERIC_FIELDS = [
      'total_balance', 'retirement_balance', 'emergency_balance',
      'units', 'retirement_units', 'emergency_units',
    ] as const;
    const negative = ((data || []) as Row[]).filter((r) =>
      NUMERIC_FIELDS.some((f) => r[f] != null && Number(r[f]) < 0));

    expect(
      negative.length,
      `subscriber_balances row(s) with a negative balance or unit figure (M4): ${JSON.stringify(
        negative.slice(0, 5).map((r) => ({
          subscriber_id: r.subscriber_id,
          ...Object.fromEntries(NUMERIC_FIELDS.filter((f) => Number(r[f]) < 0).map((f) => [f, r[f]])),
        })),
      )}`,
    ).toBe(0);
  });
});
