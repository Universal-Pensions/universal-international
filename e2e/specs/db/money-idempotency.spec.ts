// Money idempotency + atomicity spec — exercises the subscriber money RPCs
// (make_contribution / request_withdrawal, migration 0054) at the DB layer.
//
// Pins audit §4a F-1 / F-2 / F-5: the subscriber Save (top-up) and Withdraw flows
// were routed through SECURITY DEFINER RPCs that (a) de-duplicate on a client
// nonce so a replay credits/debits EXACTLY ONCE (F-1), (b) fold the withdrawal's
// two writes into one atomic body so a partial failure leaves no orphaned debit
// (F-2), and (c) RAISE when a withdrawal exceeds the available balance (F-5).
//
// These RPCs gate on app_role='subscriber' and derive the subscriber from the
// verified JWT `subscriberId` claim (NEVER a client-supplied id), so they CANNOT
// be called by the service-role client (NULL jwt → role gate raises P0001). We
// therefore mint a subscriber JWT, stamp an ANON PostgREST client with it, and
// invoke the RPCs as a genuine logged-in subscriber. The service-role client
// reads the balance before/after + cleans up (the AFTER INSERT balance trigger
// has no reverse-on-delete, so the balance row is restored explicitly).
//
// What we assert:
//   1. make_contribution(nonce, amount) called TWICE with the SAME nonce credits
//      the balance by exactly ONE amount (not two) — one transactions row, one
//      money_nonces row (F-1).
//   2. request_withdrawal over the available balance RAISEs (F-5) — and leaves NO
//      orphaned debit (no new withdrawal transaction, balance unchanged) (F-2).
//
// Run prereq: SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// + SUPABASE_JWT_SECRET in .env.local. Without them the file test.skip()s cleanly.
//
// >>> LIVE-DB GATE <<<
// make_contribution / request_withdrawal are DORMANT (PGRST202) until migration
// 0054 is applied to live. Once applied, this runs green; the cleanup restores the
// balance + removes the rows so the demo DB is left untouched.

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../../fixtures/db';
import { mintRoleJwt } from '../../fixtures/auth';
import { randomUUID } from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const hasEnv =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!SUPABASE_URL &&
  !!ANON_KEY &&
  !!process.env.SUPABASE_JWT_SECRET;

// A low-traffic seeded subscriber so the test's balance arithmetic is isolated
// (s-0005 is the last of the five demo subscribers).
const SUBSCRIBER_ID = 's-0005';
const CONTRIB_AMOUNT = 10_000; // UGX

type BalanceRow = {
  retirement_balance: number;
  emergency_balance: number;
  total_balance: number;
  units: number;
  // ⚠️ THE DERIVED UNIT SPLIT IS PART OF THE SNAPSHOT, and leaving it out is
  // how this file silently leaked money into the live demo DB.
  // `subscriber_balances_bucket_units_sum` is a DEFERRABLE CONSTRAINT TRIGGER
  // requiring retirement_units + emergency_units = units. Restoring `units`
  // alone leaves the two bucket columns at their POST-contribution values, so
  // the restore aborts at COMMIT with 23514 — and because the restore's error
  // was never checked, it aborted in silence and the fixture member kept the
  // test's money. Measured: three runs left s-0005 +30,000 UGX and +18.917
  // units on live. The production path never hits this because every writer
  // calls _resync_bucket_units(), which is deliberately not granted to any API
  // role — so a PostgREST restore has to carry the split itself.
  retirement_units: number;
  emergency_units: number;
  // And the COST BASIS. Omitted from the first fix, and it leaked exactly the
  // same way: a contribution raises `invested`, the restore never lowered it,
  // and five test runs left live member s-0005 carrying +50,000 UGX of basis
  // with no ledger row behind it. `invested` is the denominator of every growth
  // figure the platform shows, so an inflated basis silently understates that
  // member's return forever. Restore EVERY column the money triggers touch —
  // the safe list is "all of them", not "the ones that looked important".
  invested: number;
};

async function subscriberClient(subscriberId: string): Promise<SupabaseClient> {
  const token = await mintRoleJwt('subscriber', subscriberId);
  return createClient(SUPABASE_URL as string, ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function readBalance(subscriberId: string): Promise<BalanceRow> {
  const { data, error } = await supabaseAdmin
    .from('subscriber_balances')
    .select('retirement_balance, emergency_balance, total_balance, units, retirement_units, emergency_units, invested')
    .eq('subscriber_id', subscriberId)
    .maybeSingle();
  if (error) throw new Error(`readBalance(${subscriberId}): ${error.message}`);
  return (data as BalanceRow) ?? {
    retirement_balance: 0,
    emergency_balance: 0,
    total_balance: 0,
    units: 0,
    retirement_units: 0,
    emergency_units: 0,
    invested: 0,
  };
}

// ⚠️ SERIAL. Both tests in this file snapshot, mutate and restore the balance of
// ONE fixed LIVE subscriber (s-0005). Under `fullyParallel: true` Playwright is
// free to run them on different workers: two snapshots taken, two unconditional
// restores applied, last writer wins — leaving a real demo member on a stale
// balance. distributor-apply-settlement.spec.ts already carries this exact
// guard, with a note saying the collision class "already leaked live rows during
// this remediation programme"; the fix was applied to one file out of the four
// that share live fixtures.
test.describe.configure({ mode: 'serial' });

test.describe('money RPC idempotency + atomicity (DB layer)', () => {
  test.skip(
    !hasEnv,
    'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY + SUPABASE_JWT_SECRET',
  );

  // Snapshot the subscriber's balance up front; afterEach restores it (the
  // contribution trigger has no reverse-on-delete) and removes the rows the test
  // created (transactions + money_nonces) so the demo DB is left clean.
  let snapshot: BalanceRow | null = null;
  const createdNonces: string[] = [];

  test.beforeEach(async () => {
    snapshot = await readBalance(SUBSCRIBER_ID);
    createdNonces.length = 0;
  });

  test.afterEach(async () => {
    // Remove any transactions created by the test's nonces (the result JSON stores
    // the tx id; simplest robust cleanup is to delete the money_nonces rows AND
    // the contribution/withdrawal transactions they spawned, then restore balance).
    // Every delete's error is COLLECTED rather than asserted inline so a single
    // failure can't skip the balance restore below — but the collected list IS
    // asserted at the end; a silently-swallowed cleanup failure is exactly how
    // fixture rows leak into the live demo DB unnoticed (audit A25-004).
    const teardownErrors: string[] = [];
    for (const nonce of createdNonces) {
      const { data: ledger } = await supabaseAdmin
        .from('money_nonces')
        .select('result')
        .eq('nonce', nonce)
        .maybeSingle();
      const txId = (ledger as { result?: { id?: string } } | null)?.result?.id;
      if (txId) {
        const { error: txnErr } = await supabaseAdmin.from('transactions').delete().eq('id', txId);
        if (txnErr) teardownErrors.push(`transactions ${txId}: ${txnErr.message}`);
        const { error: wErr } = await supabaseAdmin.from('withdrawals').delete().eq('id', txId);
        if (wErr) teardownErrors.push(`withdrawals ${txId}: ${wErr.message}`);
      }
      const { error: nonceErr } = await supabaseAdmin.from('money_nonces').delete().eq('nonce', nonce);
      if (nonceErr) teardownErrors.push(`money_nonces ${nonce}: ${nonceErr.message}`);
    }
    // Restore the balance row to its pre-test snapshot (the AFTER INSERT trigger
    // moved it; deleting the tx does not move it back).
    if (snapshot) {
      const { error: restoreErr } = await supabaseAdmin
        .from('subscriber_balances')
        .update({
          retirement_balance: snapshot.retirement_balance,
          emergency_balance: snapshot.emergency_balance,
          total_balance: snapshot.total_balance,
          units: snapshot.units,
          // See BalanceRow: without these two the deferrable bucket-units
          // constraint rejects the whole restore at COMMIT.
          retirement_units: snapshot.retirement_units,
          emergency_units: snapshot.emergency_units,
          invested: snapshot.invested,
        })
        .eq('subscriber_id', SUBSCRIBER_ID);
      // ASSERTED, not swallowed. A restore that fails silently is precisely how
      // a real demo member ends up carrying a test's money indefinitely, which
      // is audit finding A25-004 in a different costume.
      if (restoreErr) teardownErrors.push(`balance restore: ${restoreErr.message}`);
    }
    snapshot = null;
    expect(
      teardownErrors,
      `cleanup: all teardown deletes must succeed — failures: ${teardownErrors.join('; ')}`,
    ).toEqual([]);
  });

  test('make_contribution is idempotent: same nonce twice credits exactly once', async () => {
    const before = await readBalance(SUBSCRIBER_ID);
    const nonce = `e2e-contrib-${randomUUID()}`;
    createdNonces.push(nonce);

    const asSub = await subscriberClient(SUBSCRIBER_ID);

    // First call — credits the balance by CONTRIB_AMOUNT.
    const first = await asSub.rpc('make_contribution', {
      p_nonce: nonce,
      p_amount: CONTRIB_AMOUNT,
    });
    expect(first.error, `first make_contribution: ${first.error?.message}`).toBeNull();
    expect(first.data, 'first call returns the inserted transaction').toBeTruthy();

    // Second call — SAME nonce. The ledger short-circuits and returns the prior
    // row WITHOUT re-crediting.
    const second = await asSub.rpc('make_contribution', {
      p_nonce: nonce,
      p_amount: CONTRIB_AMOUNT,
    });
    expect(second.error, `replay make_contribution: ${second.error?.message}`).toBeNull();
    // The replay returns the SAME transaction id as the first call.
    expect(
      (second.data as { id?: string })?.id,
      'replay returns the prior transaction id (no new insert)',
    ).toBe((first.data as { id?: string })?.id);

    // Balance moved by exactly ONE contribution, not two (F-1).
    const after = await readBalance(SUBSCRIBER_ID);
    expect(
      after.total_balance - before.total_balance,
      'two same-nonce contributions credit the balance exactly once',
    ).toBe(CONTRIB_AMOUNT);

    // Exactly one money_nonces row + one transaction for this nonce.
    const { count: nonceCount } = await supabaseAdmin
      .from('money_nonces')
      .select('*', { count: 'exact', head: true })
      .eq('nonce', nonce);
    expect(nonceCount ?? 0, 'exactly one nonce-ledger row').toBe(1);

    const txId = (first.data as { id?: string })?.id;
    const { count: txCount } = await supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('id', txId as string);
    expect(txCount ?? 0, 'exactly one transactions row for the nonce').toBe(1);
  });

  test('request_withdrawal over the balance RAISEs and leaves no orphaned debit', async () => {
    const before = await readBalance(SUBSCRIBER_ID);

    // Count the subscriber's existing withdrawal transactions so we can prove no
    // orphaned debit row is added when the over-balance withdrawal is rejected.
    const { count: wdTxBefore } = await supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('subscriber_id', SUBSCRIBER_ID)
      .eq('type', 'withdrawal');

    const nonce = `e2e-withdraw-${randomUUID()}`;
    // We do NOT push this nonce to createdNonces: a rejected withdrawal records
    // NOTHING (no money_nonces row, no transaction), so there is nothing to clean.

    const asSub = await subscriberClient(SUBSCRIBER_ID);

    // Request more than the available balance → F-5 RAISE (P0001).
    const overAmount = before.total_balance + 1_000_000;
    const res = await asSub.rpc('request_withdrawal', {
      p_nonce: nonce,
      p_amount: overAmount,
    });
    expect(res.error, 'an over-balance withdrawal must be rejected').not.toBeNull();
    expect(
      res.error?.message ?? '',
      `the rejection should cite the balance guard: ${res.error?.message}`,
    ).toMatch(/exceeds available balance|exceeds/i);

    // No orphaned debit (F-2): the withdrawal transaction count is unchanged and
    // the balance is untouched (the function body never inserted anything).
    const { count: wdTxAfter } = await supabaseAdmin
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('subscriber_id', SUBSCRIBER_ID)
      .eq('type', 'withdrawal');
    expect(
      wdTxAfter ?? 0,
      'a rejected over-balance withdrawal inserts no debit transaction',
    ).toBe(wdTxBefore ?? 0);

    // The nonce ledger recorded nothing for a rejected withdrawal.
    const { count: nonceCount } = await supabaseAdmin
      .from('money_nonces')
      .select('*', { count: 'exact', head: true })
      .eq('nonce', nonce);
    expect(nonceCount ?? 0, 'a rejected withdrawal writes no nonce-ledger row').toBe(0);

    const after = await readBalance(SUBSCRIBER_ID);
    expect(after.total_balance, 'a rejected withdrawal leaves the balance unchanged').toBe(
      before.total_balance,
    );
  });
});
