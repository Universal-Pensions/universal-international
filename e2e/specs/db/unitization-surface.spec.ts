// The API surface introduced by the unitization redesign (0143-0155), asserted
// from a REAL subscriber JWT rather than from psql.
//
// Every finding this file guards was made by auditing that work, and every one
// of them was invisible from a superuser connection - which is how they got in.
// The owner and service_role bypass RLS, so a probe run over SUPABASE_DB_URL
// says nothing about what a signed-in member can actually reach. These tests go
// through PostgREST with a subscriber token, which is the only view that
// answers the question.
//
// What is guarded:
//
//   1. v_pending_pricing_orphans (0148) was granted SELECT to `authenticated`.
//      A view is not covered by RLS: without security_invoker it executes as its
//      OWNER (postgres, rolbypassrls), so every policy on transactions and
//      subscribers was bypassed. It projects member NAMES and AMOUNTS. Closed in
//      0150. It leaked nothing only because it filters pricing_status='pending'
//      and nothing can be pending until the kill switch is turned on.
//
//   2. get_pending_pricing_summary (0147) was SECURITY DEFINER, granted to
//      `authenticated`, and had NO app_role gate, so any member could read
//      platform-wide pending money. Gated in 0155.
//
//   3. nav_price_row and four sibling helpers (0143/0145) were DEFINER over the
//      admin-only calendar and register with ZERO client call sites.
//      nav_price_row in particular handed any member a day-by-day oracle over
//      the fund's price history that nav_snapshots' admin-only policy exists to
//      prevent. Revoked in 0155.
//
//   4. The three new config/reference tables carried INSERT/UPDATE/DELETE for
//      `authenticated` from Supabase's default privileges - inert behind FORCE
//      RLS, but 0132 already named that shape "a loaded trap for tomorrow".
//      Revoked in 0150.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mintRoleJwt, PERSONA_FOR } from '../../fixtures/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const ready = !!(SUPABASE_URL && ANON_KEY);

/** A client carrying a real subscriber token - the view that actually matters. */
async function subscriberClient() {
  const token = await mintRoleJwt('subscriber', PERSONA_FOR.subscriber.entityId);
  return createClient(SUPABASE_URL as string, ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

test.describe('unitization API surface (as a signed-in subscriber)', () => {
  test.skip(!ready, 'requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');

  test('a member cannot read the pending-pricing view (cross-tenant names and amounts)', async () => {
    const sb = await subscriberClient();
    const { error } = await sb.from('v_pending_pricing_orphans').select('*').limit(5);
    // STRICT: the read must be REFUSED, not merely empty.
    //
    // "error or zero rows" would be a test that cannot fail. The view filters
    // pricing_status='pending', and nothing can be pending while the kill switch
    // is off - so it returns zero rows to everyone right now, and a lenient
    // assertion would have passed against the LEAKING version too. The whole
    // point is that the grant is gone, so demand the refusal.
    expect(
      error,
      'a subscriber could SELECT from v_pending_pricing_orphans. It bypasses RLS ' +
        '(a view without security_invoker runs as its owner) and projects member ' +
        'names and amounts across every tenant. It returns no rows only because ' +
        'nothing is pending yet.',
    ).not.toBeNull();
  });

  test('a member cannot read platform-wide pending money totals', async () => {
    const sb = await subscriberClient();
    const { error } = await sb.rpc('get_pending_pricing_summary', { p_fund: 'UPU-BAL' });
    expect(
      error,
      'get_pending_pricing_summary returned data to a subscriber. It reports how much ' +
        'money is unallocated and how much is queued to leave, for the whole platform.',
    ).not.toBeNull();
  });

  test('a member cannot use the SQL-only helpers as a price/calendar oracle', async () => {
    const sb = await subscriberClient();
    for (const [fn, params] of [
      ['nav_price_row', { p_date: '2026-08-19', p_fund: 'UPU-BAL' }],
      ['nav_missing_days', { p_fund: 'UPU-BAL' }],
      ['is_business_day', { p_date: '2026-08-19' }],
      ['next_business_day', { p_date: '2026-08-19' }],
      ['kampala_now', {}],
    ] as const) {
      const { error } = await sb.rpc(fn, params as Record<string, unknown>);
      expect(error, `${fn}() is callable by a subscriber; it has no client call site.`).not.toBeNull();
    }
  });

  test('dealing_date_for STAYS callable — the point-of-sale note depends on it', async () => {
    const sb = await subscriberClient();
    const { data, error } = await sb.rpc('dealing_date_for', {
      p_received_at: '2026-09-04T13:59:00+03:00',
      p_fund: 'UPU-BAL',
    });
    expect(error, 'dealing_date_for must remain callable — useDealingDate() calls it').toBeNull();
    expect(String(data)).toContain('2026-09-04');
  });

  test('the new config and reference tables are not reachable at all', async () => {
    const sb = await subscriberClient();
    // STRICT again: each of these has FORCE RLS with an admin-only SELECT policy,
    // so a SELECT would return zero rows even WITH the grant in place. Only
    // demanding the refusal proves the grant itself is gone — and the grant is
    // the "loaded trap for tomorrow" that 0132 named.
    for (const t of ['business_holidays', 'fund_dealing_config', 'nav_snapshot_versions']) {
      const { error } = await sb.from(t).select('*').limit(1);
      expect(error, `${t} is still readable by a subscriber`).not.toBeNull();
    }
  });

  test('a member cannot write to the dealing config — the kill switch is not theirs', async () => {
    const sb = await subscriberClient();
    const { error } = await sb
      .from('fund_dealing_config')
      .update({ pricing_enabled: true })
      .eq('fund_code', 'UPU-BAL');
    expect(error, 'a subscriber was able to flip the pricing kill switch').not.toBeNull();
  });
});
