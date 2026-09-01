// THE PRICING ENGINE, ACTUALLY EXECUTED.
//
// Everything else guarding migration 0147 is a regex over text — the migration
// contract tests grep supabase/migrations/*.sql, and the deployment contract
// greps pg_get_functiondef. Both prove the engine SAYS the right things. Neither
// has ever made it move a single unit. Every behavioural claim about forward
// dealing rested on ad-hoc probes that were thrown away, so a regression in the
// one function that buys and sells members' units would ship silently.
//
// This spec runs the whole lifecycle against the real deployed engine on the
// real schema, with the real constraints and the real deferrable triggers:
//
//     received -> pending -> published -> allocated -> requested -> held
//              -> struck -> settled, plus rejection, re-pricing and reversal
//
// ⚠️ IT TURNS THE KILL SWITCH ON. That is the only way to exercise any of this,
//    and it is safe for exactly one reason: EVERY statement runs inside ONE
//    transaction that is ALWAYS rolled back. Nothing commits — not the flag, not
//    a price, not a balance, not a ledger row. `fund_dealing_config` is restored
//    by the rollback itself rather than by a cleanup step that could be skipped.
//
//    This is not theoretical caution. During the audit that produced this file, a
//    probe issued an explicit COMMIT after enabling the flag and left forward
//    dealing ON against the live demo database; a later test run then booked
//    30,000 UGX of pending contributions and a 20,000 UGX redemption hold against
//    two real members. Hence: one connection, one transaction, one rollback, and
//    an afterAll that asserts the switch is still off.
//
// Run prereq: SUPABASE_DB_URL in .env.local. price_pending_transactions is
// granted to NOBODY (it moves money for arbitrary members and is called only
// from DEFINER code), so this cannot go through PostgREST — same approach as
// function-deployment-contract.spec.ts.

import { test, expect } from '@playwright/test';
import pgDefault from 'pg';

const hasDbUrl = !!process.env.SUPABASE_DB_URL;

type PgClient = {
  connect(): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};

/** A member's money, decomposed the way the design defines it. */
type Money = {
  total: number;        // headline: allocated + in-flight, what the member sees
  withdrawable: number; // allocated less anything a pending withdrawal claims
  allocated: number;    // units x book price — AUM, and what the publish gate reads
  units: number;
  invested: number;
  pendingIn: number;
  pendingOut: number;
  hold: number;
};

const n = (v: unknown) => Number(v ?? 0);

test.describe('pricing engine — the full money lifecycle (executed, not grepped)', () => {
  test.skip(!hasDbUrl, 'requires SUPABASE_DB_URL in env (.env.local)');

  let db: PgClient;
  // What the live config said BEFORE this spec touched anything. The teardown
  // asserts we handed it back unchanged — hardcoding "off" would fail the day
  // forward dealing legitimately goes live, and would then be silenced rather
  // than fixed, which is how a safety assertion becomes noise.
  let baseline: { pricing_enabled: boolean; cutoff: string } | null = null;
  let basePending = 0;

  async function money(sub: string): Promise<Money> {
    const { rows } = await db.query(
      `SELECT total_balance, units, invested,
              pending_contribution_retirement + pending_contribution_emergency AS pin,
              pending_payout_retirement       + pending_payout_emergency       AS pout,
              pending_redemption_retirement   + pending_redemption_emergency   AS hold
         FROM public.subscriber_balances WHERE subscriber_id = $1`, [sub]);
    const r = rows[0] as Record<string, unknown>;
    return {
      allocated: n(r.total_balance),
      units: n(r.units),
      invested: n(r.invested),
      pendingIn: n(r.pin),
      pendingOut: n(r.pout),
      hold: n(r.hold),
      total: n(r.total_balance) + n(r.pin) + n(r.pout),
      withdrawable: n(r.total_balance) - n(r.hold),
    };
  }

  /** The three invariants that must hold for EVERY member, at every step. */
  async function guardrails(label: string) {
    const { rows } = await db.query<{ bucket_sum: string; unit_split: string; off_book: string; recon: string }>(`
      SELECT
        (SELECT count(*) FROM public.subscriber_balances
          WHERE abs(retirement_balance + emergency_balance - total_balance) > 0)            AS bucket_sum,
        (SELECT count(*) FROM public.subscriber_balances
          WHERE abs(COALESCE(retirement_units,0) + COALESCE(emergency_units,0) - units) > 0.000001) AS unit_split,
        (SELECT count(*) FROM public.subscriber_balances
          WHERE abs(total_balance - round(units * public.latest_nav())) > 1)                AS off_book,
        (SELECT count(*) FROM public.v_reconciliation_exceptions
          WHERE check_code <> 'agent_mismatch')                                            AS recon;`);
    const g = rows[0];
    expect(Number(g.bucket_sum), `${label}: retirement + emergency stopped equalling total`).toBe(0);
    expect(Number(g.unit_split), `${label}: bucket units stopped summing to units`).toBe(0);
    expect(Number(g.off_book), `${label}: member(s) carried a balance that units x price does not back`).toBe(0);
    expect(Number(g.recon), `${label}: new reconciliation exceptions appeared`).toBe(0);
  }

  const pick = async (where: string) => {
    const { rows } = await db.query<{ subscriber_id: string }>(
      `SELECT subscriber_id FROM public.subscriber_balances WHERE ${where}
        ORDER BY subscriber_id LIMIT 1`);
    expect(rows.length, `no fixture member matched: ${where}`).toBe(1);
    return rows[0].subscriber_id;
  };

  const asAdmin = () => db.query(
    `SELECT set_config('request.jwt.claims', '{"app_role":"admin","name":"engine-spec"}', true)`);
  const asMember = (sub: string) => db.query(
    `SELECT set_config('request.jwt.claims',
        json_build_object('app_role','subscriber','subscriberId',$1::text)::text, true)`, [sub]);

  /**
   * Carve an unpriced business day, inside this transaction.
   *
   * Two tests need a hole in the register. Depending on the LIVE register having
   * one made them silently degrade the moment somebody did their job and filled
   * it: on 2026-09-01 the back-dated test skipped and the readiness test failed,
   * purely because the gaps had been published. A test whose meaning depends on
   * production being untidy is not a test. So make the hole.
   *
   * Picks a past business day whose register row no priced transaction points
   * at (transactions.nav_snapshot_id is a real FK), so the delete cannot fail.
   */
  async function carveGap(): Promise<string> {
    const { rows } = await db.query<{ d: string }>(`
      SELECT n.nav_date::text AS d
        FROM public.nav_snapshots n
       WHERE n.fund_code = 'UPU-BAL' AND n.status = 'published'
         AND n.nav_date < public.kampala_today()
         AND public.is_business_day(n.nav_date)
         AND NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.nav_snapshot_id = n.id)
       ORDER BY n.nav_date DESC LIMIT 1`);
    expect(rows.length, 'no deletable register row to carve a gap from').toBe(1);
    await db.query(`DELETE FROM public.nav_snapshots WHERE fund_code='UPU-BAL' AND nav_date = $1`, [rows[0].d]);
    return rows[0].d;
  }

  const publish = (date: string, priceSql: string, confirm = false) => db.query(
    `SELECT public.publish_nav_snapshot(${date}, ${priceSql}, 'UPU-BAL', 'engine-spec', ${confirm}) AS r`);

  test.beforeAll(async () => {
    const { Client } = pgDefault as unknown as { Client: new (c: { connectionString: string }) => PgClient };
    db = new Client({ connectionString: process.env.SUPABASE_DB_URL as string });
    await db.connect();
    const { rows } = await db.query<{ pricing_enabled: boolean; cutoff: string }>(
      `SELECT pricing_enabled, to_char(cutoff_local_time,'HH24:MI:SS') AS cutoff
         FROM public.fund_dealing_config WHERE fund_code = 'UPU-BAL'`);
    baseline = rows[0];
    const { rows: pend } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.transactions WHERE pricing_status = 'pending'`);
    basePending = Number(pend[0].n);

    await db.query('BEGIN');
    // Everything below is transaction-local and dies with the ROLLBACK.
    await db.query(`UPDATE public.fund_dealing_config
                       SET pricing_enabled = true, cutoff_local_time = '23:59:59'
                     WHERE fund_code = 'UPU-BAL'`);
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.query('ROLLBACK');
    // Prove the rollback actually restored the switch, on a fresh snapshot.
    const { rows } = await db.query<{ pricing_enabled: boolean; cutoff: string; pending: string }>(
      `SELECT c.pricing_enabled, to_char(c.cutoff_local_time,'HH24:MI:SS') AS cutoff,
              (SELECT count(*) FROM public.transactions WHERE pricing_status='pending') AS pending
         FROM public.fund_dealing_config c WHERE c.fund_code = 'UPU-BAL'`);
    await db.end();
    // Restored to whatever it was, not to a hardcoded value.
    expect(
      rows[0].pricing_enabled,
      `this spec changed the live kill switch: it was ${baseline?.pricing_enabled}, now ${rows[0].pricing_enabled}`,
    ).toBe(baseline?.pricing_enabled);
    expect(rows[0].cutoff, 'this spec changed the live cutoff').toBe(baseline?.cutoff);
    // Still absolute: whatever the switch says, this spec must leave no money of
    // its own behind. With forward dealing live a real member CAN legitimately
    // have money pending, so compare against the baseline rather than zero.
    expect(
      Number(rows[0].pending),
      'this spec leaked pending money onto live members',
    ).toBe(basePending);
  });

  test('money received is visible immediately, withdrawable only once it buys units', async () => {
    const sub = await pick('units > 50 AND total_balance > 200000');
    const before = await money(sub);

    await db.query(
      `INSERT INTO public.transactions (id, subscriber_id, type, amount, date, received_at, status, method, txn_ref, source)
       VALUES ('tx-spec-c1', $1, 'contribution', 500000, now(),
               (public.kampala_today() || ' 08:00:00+03')::timestamptz,
               'settled', 'MTN Mobile Money', 'SPEC-C1', 'own')`, [sub]);

    const received = await money(sub);
    // Money never disappears: the total rises by the face value the instant it lands.
    expect(received.total - before.total).toBe(500000);
    // …but it has bought nothing, so none of it is withdrawable and no units moved.
    expect(received.withdrawable).toBe(before.withdrawable);
    expect(received.units).toBe(before.units);
    expect(received.allocated).toBe(before.allocated);
    expect(received.pendingIn).toBe(before.pendingIn + 500000);

    const { rows } = await db.query<{ pricing_status: string; unit_price_applied: string | null }>(
      `SELECT pricing_status, unit_price_applied FROM public.transactions WHERE id = 'tx-spec-c1'`);
    expect(rows[0].pricing_status).toBe('pending');
    expect(rows[0].unit_price_applied, 'a pending row must not carry a price').toBeNull();

    await guardrails('after receipt');
  });

  test('publishing the price allocates it with NO JUMP in the member total', async () => {
    const sub = await pick('units > 50 AND total_balance > 200000');
    const before = await money(sub);
    await asAdmin();
    // Publish at the CURRENT book price so revaluation is a no-op and the only
    // thing moving is the allocation itself.
    const { rows } = await publish('public.kampala_today()', 'public.latest_nav()');
    const r = (rows[0] as { r: Record<string, unknown> }).r;
    expect(Number(r.releasedContributions), 'the publish released nothing').toBeGreaterThan(0);

    const after = await money(sub);
    // THE headline property of the whole design, and it is exact — not a tolerance.
    expect(after.total - before.total).toBe(0);
    // The money becomes withdrawable at that instant, and not before.
    expect(after.withdrawable).toBe(before.withdrawable + 500000);
    expect(after.pendingIn).toBe(before.pendingIn - 500000);

    const { rows: tx } = await db.query<{ pricing_status: string; unit_price_applied: string; units_delta: string; nav_snapshot_id: string }>(
      `SELECT pricing_status, unit_price_applied, units_delta, nav_snapshot_id
         FROM public.transactions WHERE id = 'tx-spec-c1'`);
    expect(tx[0].pricing_status).toBe('priced');
    expect(tx[0].nav_snapshot_id, 'a priced row must name the register row it dealt against').not.toBeNull();
    // Units bought are exactly amount / price.
    expect(Number(tx[0].units_delta)).toBeCloseTo(500000 / Number(tx[0].unit_price_applied), 6);

    await guardrails('after allocation');
  });

  test('re-running the engine and re-publishing the same day allocate nothing', async () => {
    const sub = await pick('units > 50 AND total_balance > 200000');
    const before = await money(sub);
    await asAdmin();
    const { rows: a } = await db.query<{ r: Record<string, unknown> }>(
      `SELECT public.price_pending_transactions('UPU-BAL', NULL) AS r`);
    expect(Number(a[0].r.priced), 'a second engine pass allocated something').toBe(0);
    await publish('public.kampala_today()', 'public.latest_nav()');
    const after = await money(sub);
    expect(after.units).toBe(before.units);
    expect(after.total).toBe(before.total);
    await guardrails('after idempotency check');
  });

  test('a back-dated publish releases its queue, at ITS price, and leaves the member on the book', async () => {
    const sub = await pick('units > 50 AND total_balance > 200000');
    const day = await carveGap();

    await db.query(
      `INSERT INTO public.transactions (id, subscriber_id, type, amount, date, received_at, status, method, txn_ref, source)
       VALUES ('tx-spec-bd', $1, 'contribution', 400000, now(), ($2 || ' 08:00:00+03')::timestamptz,
               'settled','MTN Mobile Money','SPEC-BD','own')`, [sub, day]);

    // Money dealt on a day with no price must WAIT — never guess one.
    const { rows: q } = await db.query<{ pricing_status: string }>(
      `SELECT pricing_status FROM public.transactions WHERE id = 'tx-spec-bd'`);
    expect(q[0].pricing_status).toBe('pending');

    await asAdmin();
    const book = await db.query<{ p: string }>(`SELECT public.latest_nav() AS p`);
    const bookPrice = Number(book.rows[0].p);
    // Back-fill 3% below the book. `revalued` must be false (a back-dated
    // correction may not restate today's book) and yet the queue MUST release —
    // calling the engine inside the newest-day block is the classic way to
    // break this, and it strands the money forever.
    const { rows: pub } = await publish(`DATE '${day}'`, `round(${bookPrice} * 0.97, 2)`);
    const res = (pub[0] as { r: Record<string, unknown> }).r;
    expect(res.revalued, 'a back-dated publish must not restate the book').toBe(false);
    expect(Number(res.releasedContributions), 'a back-dated publish released nothing').toBeGreaterThan(0);

    const { rows: tx } = await db.query<{ unit_price_applied: string; pricing_status: string }>(
      `SELECT unit_price_applied, pricing_status FROM public.transactions WHERE id = 'tx-spec-bd'`);
    expect(tx[0].pricing_status).toBe('priced');
    // Dealt at ITS OWN dealing date's price, not today's book price.
    expect(Number(tx[0].unit_price_applied)).toBeCloseTo(Math.round(bookPrice * 0.97 * 100) / 100, 2);
    expect(Number(tx[0].unit_price_applied)).toBeLessThan(bookPrice);

    // …and the member is still carried at the book price afterwards. This is the
    // re-mark, and without it the member sits off-book by the market movement.
    const { rows: drift } = await db.query<{ d: string }>(
      `SELECT total_balance - round(units * public.latest_nav()) AS d
         FROM public.subscriber_balances WHERE subscriber_id = $1`, [sub]);
    expect(Number(drift.rows === undefined ? drift[0].d : drift[0].d)).toBe(0);

    await guardrails('after back-dated release');
  });

  test('a withdrawal holds units without moving the total, then strikes without moving it either', async () => {
    const sub = await pick('units > 50 AND emergency_balance > 150000');
    const start = await money(sub);

    await asMember(sub);
    const { rows: req } = await db.query<{ r: Record<string, unknown> }>(
      `SELECT public.request_withdrawal(gen_random_uuid()::text, 100000, 'emergency', 'engine spec', 'MTN Mobile Money') AS r`);
    const wd = req[0].r;
    expect(wd.pricingStatus, 'the receipt must tell the member it is not settled yet').toBe('pending');
    expect(wd.dealingDate, 'the receipt must say WHEN the amount is fixed').toBeTruthy();

    const held = await money(sub);
    // The units are still owned, so the total does not move…
    expect(held.total).toBe(start.total);
    expect(held.units).toBe(start.units);
    // …but the money is spoken for and cannot be requested twice.
    expect(held.withdrawable).toBe(start.withdrawable - 100000);
    expect(held.hold).toBe(start.hold + 100000);

    await asAdmin();
    await publish('public.kampala_today()', 'public.latest_nav()');

    const struck = await money(sub);
    // Still no jump: they stop owning units and start being owed exactly what
    // those units sold for.
    expect(struck.total).toBe(start.total);
    expect(struck.units).toBeLessThan(start.units);
    expect(struck.hold).toBe(start.hold);
    expect(struck.pendingOut).toBe(start.pendingOut + 100000);

    // The money leaves only when someone records that it actually reached them.
    await db.query(`SELECT public.settle_withdrawal($1)`, [wd.id]);
    const paid = await money(sub);
    expect(paid.total).toBe(start.total - 100000);
    expect(paid.pendingOut).toBe(start.pendingOut);

    await guardrails('after settlement');
  });

  test('a redemption that no longer fits is rejected, not silently part-paid', async () => {
    // Per-bucket sufficiency: a price fall can leave the requested POT worth less
    // than the frozen hold while the member still holds plenty of units overall.
    // Before this was checked, the GREATEST(0, ...) clamps absorbed the shortfall
    // and left the member carrying value that no units backed.
    const sub = await pick('units > 100 AND emergency_balance BETWEEN 60000 AND 400000');
    const { rows: pot } = await db.query<{ e: string }>(
      `SELECT emergency_balance AS e FROM public.subscriber_balances WHERE subscriber_id = $1`, [sub]);
    const ask = Math.floor(Number(pot[0].e) * 0.95);

    await asMember(sub);
    const { rows: req } = await db.query<{ r: Record<string, unknown> }>(
      `SELECT public.request_withdrawal(gen_random_uuid()::text, ${ask}, 'emergency', 'reject spec', 'MTN Mobile Money') AS r`);
    const wdId = req[0].r.id as string;
    const held = await money(sub);

    await asAdmin();
    await publish('public.kampala_today()', 'round(public.latest_nav() * 0.70, 2)', true);

    const after = await money(sub);
    const { rows: tx } = await db.query<{ pricing_status: string; units_delta: string | null }>(
      `SELECT pricing_status, units_delta FROM public.transactions
        WHERE subscriber_id = $1 AND type = 'withdrawal' ORDER BY received_at DESC LIMIT 1`, [sub]);

    expect(tx[0].pricing_status, 'the redemption should have been rejected').toBe('rejected');
    expect(tx[0].units_delta, 'a rejected row must record no unit movement').toBeNull();
    expect(after.units, 'units must be untouched by a rejection').toBe(held.units);
    expect(after.hold, 'the hold must be released').toBe(0);

    const { rows: w } = await db.query<{ status: string }>(
      `SELECT status FROM public.withdrawals WHERE id = $1`, [wdId]);
    expect(w[0].status, 'the member must see this in their history, not "processing" forever').toBe('rejected');

    await guardrails('after rejection');
  });

  test('AUM never absorbs money that has not bought units', async () => {
    // Plan D-10, and the reason the six pending components are separate columns
    // rather than folded into total_balance. If in-flight cash ever reached AUM,
    // three things break at once: subscriber_balances_bucket_sum_chk (a hard
    // equality), assert_book_revaluable() (which derives the implied price as
    // sum(total_balance)/sum(units) and refuses to publish on >2% drift), and
    // the per-member nav_mismatch check. The fund would also lose the one number
    // it must be able to defend — that AUM is units times a price it published.
    const sub = await pick('units > 50 AND total_balance > 200000');
    await db.query(
      `INSERT INTO public.transactions (id, subscriber_id, type, amount, date, received_at, status, method, txn_ref, source)
       VALUES ('tx-spec-aum', $1, 'contribution', 750000, now(),
               (public.kampala_today() || ' 08:00:00+03')::timestamptz,
               'settled','MTN Mobile Money','SPEC-AUM','own')`, [sub]);

    const { rows } = await db.query<{ aum: string; units: string; price: string; pending: string }>(`
      SELECT COALESCE(sum(total_balance), 0) AS aum,
             COALESCE(sum(units), 0)         AS units,
             public.latest_nav()             AS price,
             COALESCE(sum(pending_contribution_retirement + pending_contribution_emergency
                        + pending_payout_retirement + pending_payout_emergency), 0) AS pending
        FROM public.subscriber_balances`);
    const r = rows[0];
    expect(Number(r.pending), 'the fixture did not actually leave money in flight').toBeGreaterThan(0);

    // AUM is units x the published price, and the in-flight money is NOT in it.
    // 1 UGX per member of rounding is the documented tolerance.
    const implied = Number(r.units) * Number(r.price);
    expect(Math.abs(Number(r.aum) - implied) / implied).toBeLessThan(0.0001);

    // And the publish gate agrees — it is the thing that would start failing.
    const { rows: g } = await db.query<{ r: Record<string, unknown> }>(
      `SELECT public.assert_book_revaluable('UPU-BAL', public.latest_nav()) AS r`);
    expect(g[0].r.checked, 'assert_book_revaluable declined to check the book').toBe(true);
    expect(Number(g[0].r.driftPct), 'in-flight money has leaked into the book').toBeLessThan(2);

    await guardrails('with money in flight');
  });

  test('the readiness check refuses the flip while the register is behind', async () => {
    // The order of operations is load-bearing and nothing else records it:
    // publish first, flip second. Under forward dealing a contribution waits for
    // its dealing date's price, so flipping while the fund is days behind sends
    // every new contribution into a queue that cannot clear until somebody
    // back-fills the gap. Members would watch their money arrive, sit in "being
    // put into savings", and never move.
    await asAdmin();
    const read = async () => {
      const { rows } = await db.query<{ r: Record<string, unknown> }>(
        `SELECT public.forward_dealing_readiness('UPU-BAL') AS r`);
      return rows[0].r;
    };

    await carveGap();
    const before = await read();
    expect(Number(before.unpricedBusinessDays), 'carveGap did not produce a gap').toBeGreaterThan(0);
    expect(before.ready, 'readiness must be false while business days are unpriced').toBe(false);
    expect(JSON.stringify(before.blockers)).toMatch(/no published price/i);

    // Fill every gap, and it should flip to ready.
    const { rows: gaps } = await db.query<{ d: string }>(
      `SELECT m.nav_date::text AS d
         FROM public.nav_missing_days('UPU-BAL', NULL, public.kampala_today() - 1) m
        ORDER BY m.nav_date`);
    for (const g of gaps) {
      // confirm=true: a bulk back-fill is exactly the deliberate, scripted
      // action the +-10% move gate asks to be acknowledged, and an earlier test
      // in this transaction deliberately published 30% down.
      await publish(`DATE '${g.d}'`, 'public.latest_nav()', true);
    }

    const after = await read();
    expect(Number(after.unpricedBusinessDays)).toBe(0);
    expect(after.ready, `still blocked: ${JSON.stringify(after.blockers)}`).toBe(true);

    await guardrails('after back-filling the register');
  });

  test('the kill switch genuinely gates the engine', async () => {
    await db.query(`UPDATE public.fund_dealing_config SET pricing_enabled = false WHERE fund_code = 'UPU-BAL'`);
    const sub = await pick('units > 50 AND total_balance > 200000');
    await db.query(
      `INSERT INTO public.transactions (id, subscriber_id, type, amount, date, received_at, status, method, txn_ref, source)
       VALUES ('tx-spec-off', $1, 'contribution', 60000, now(), now(), 'settled','MTN Mobile Money','SPEC-OFF','own')`, [sub]);
    const { rows } = await db.query<{ pricing_status: string; unit_price_applied: string | null; units_delta: string | null }>(
      `SELECT pricing_status, unit_price_applied, units_delta FROM public.transactions WHERE id = 'tx-spec-off'`);
    // With the switch off a contribution prices synchronously, exactly as it did
    // before the redesign — that is what makes the flip reversible mid-day.
    expect(rows[0].pricing_status).toBe('priced');
    expect(rows[0].unit_price_applied).not.toBeNull();
    expect(rows[0].units_delta, 'the synchronous path must record its unit movement too').not.toBeNull();

    const { rows: eng } = await db.query<{ r: Record<string, unknown> }>(
      `SELECT public.price_pending_transactions('UPU-BAL', NULL) AS r`);
    expect(eng[0].r.skipped, 'the engine must refuse to run while the switch is off').toBe(true);

    await db.query(`UPDATE public.fund_dealing_config SET pricing_enabled = true WHERE fund_code = 'UPU-BAL'`);
  });
});
