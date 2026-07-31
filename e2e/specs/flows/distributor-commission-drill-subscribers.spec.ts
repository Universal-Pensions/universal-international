// Flow spec — distributor commission drill: agents → agent detail → subscribers.
//
// FINDING BEING PINNED (audit HIGH-3): getCommissionSubscribers
// (src/services/commissions.js) used to SELECT `total_contributions` off the
// `subscribers` table. That column does NOT exist on `subscribers` — it lived on
// the retired `employees` table (dropped in migration 0045). Against real
// Supabase data PostgREST returns `400 / 42703` ("column does not exist"), the
// service guard throws, and the distributor/branch commission → agent →
// subscribers drill breaks (the list silently collapses to the empty state).
// Mock mode (VITE_USE_SUPABASE=false) never hits PostgREST, so the unit tests
// were blind to it — hence this REAL-DATA E2E.
//
// The fix sources the per-subscriber contribution figure from
// `subscriber_balances.total_balance` (embedded select), the same proxy
// agent.js / subscriber.js already use.
//
// EXPECTED OUTCOME:
//   • Pre-fix  → FAIL: the `/rest/v1/subscribers?...agent_id=eq.<id>` drill GET
//     returns 400 (42703), so `expect(drill.ok())` fails.
//   • Post-fix → PASS: the drill GET is 200 and real subscriber rows render.
//
// WHY THROUGH THE UI: the drill is exercised exactly as a distributor sees it —
// open CommissionPanel, open the agent list, pick an agent, drill into their
// subscriber list. The distributor storageState carries app_role='distributor'
// so RLS/embeds resolve like production. Agent NAMES collide in the seed (small
// name pool → ~1k dupes), so the test never assumes a fixed agent id: it types a
// real name only to narrow the list, then derives the ACTUAL clicked agent id
// from the drill request URL and asserts against that.

import { test, expect } from '@playwright/test';
import { storageStatePathFor } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { supabaseAdmin } from '../../fixtures/db';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('distributor') });
test.setTimeout(60_000);

// The subscriber drill query is `GET /rest/v1/subscribers?select=...&agent_id=eq.<id>`.
// This matches BOTH the pre-fix (…total_contributions…) and post-fix
// (…subscriber_balances(total_balance)…) select strings, since only the status
// (200 vs 400) differs — which is exactly what we assert on.
const SUBSCRIBERS_DRILL = /\/rest\/v1\/subscribers\?.*agent_id=eq\./;

/**
 * Any agent that owns ≥1 commission row appears in the CommissionPanel agent
 * list AND yields ≥1 subscriber row from getCommissionSubscribers (which maps
 * one output row per commission). Returns that agent's NAME — used ONLY to
 * narrow the search box; the test derives the real clicked id from the network.
 */
async function pickAgentNameWithCommissions(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('commissions')
    .select('agent_id')
    .not('agent_id', 'is', null)
    .limit(1);
  if (error) throw new Error(`pickAgentNameWithCommissions: ${error.message}`);
  const agentId = (data?.[0] as { agent_id: string } | undefined)?.agent_id;
  expect(agentId, 'seed must contain at least one commission with an agent').toBeTruthy();

  const { data: agentRow, error: aErr } = await supabaseAdmin
    .from('agents')
    .select('name')
    .eq('id', agentId!)
    .maybeSingle();
  if (aErr) throw new Error(`pickAgentNameWithCommissions name lookup: ${aErr.message}`);
  const name = (agentRow as { name: string } | null)?.name;
  expect(name, `agent ${agentId} should have a display name`).toBeTruthy();
  return name!;
}

/** Pull the concrete `agent_id` out of the captured drill request URL. */
function agentIdFromDrillUrl(url: string): string {
  const m = url.match(/agent_id=eq\.([^&]+)/);
  expect(m, `drill URL should carry agent_id=eq.<id>: ${url}`).toBeTruthy();
  return decodeURIComponent(m![1]);
}

/** getCommissionSubscribers returns one row per commission → this is the count. */
async function commissionCount(agentId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('commissions')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId);
  if (error) throw new Error(`commissionCount(${agentId}): ${error.message}`);
  return count ?? 0;
}

test.describe('distributor → commission drill → agent → subscribers (real data)', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
  });

  test('the agent → subscribers drill loads real rows (no 400/42703)', async ({ page }) => {
    const searchName = await pickAgentNameWithCommissions();

    // ── Open the CommissionPanel ────────────────────────────────────────────
    await page.goto('/dashboard');
    const commissionsBtn = page.getByRole('button', { name: /^commissions$/i });
    await expect(commissionsBtn).toBeVisible();
    await commissionsBtn.click();
    const panel = selectors.panel.commissions(page);
    await expect(panel).toBeVisible();

    // Home → agent list (the "Total" summary tile → all commissions, grouped by
    // agent). The tile is the only panel control whose label carries "records".
    await panel.getByRole('button', { name: /records/i }).first().click();

    // Narrow the (large, name-collision-heavy) agent list to a handful via the
    // search box, then take the first matching agent row.
    await panel.getByLabel('Search agents').fill(searchName);
    const agentRow = panel.getByRole('button').filter({ hasText: searchName }).first();
    await expect(agentRow).toBeVisible({ timeout: 15_000 });

    // Clicking the agent row sets selectedAgentId, which ENABLES
    // useCommissionSubscribers → fires the subscribers drill GET. Register the
    // response listener BEFORE the click so the response is captured.
    const drillPromise = page.waitForResponse(
      (r) => SUBSCRIBERS_DRILL.test(r.url()) && r.request().method() === 'GET',
      { timeout: 20_000 },
    );
    await agentRow.click();

    // ── THE CRUX ────────────────────────────────────────────────────────────
    // Pre-fix, this GET selects the non-existent `subscribers.total_contributions`
    // column → PostgREST 400 / 42703. Post-fix it embeds subscriber_balances and
    // resolves 200.
    const drill = await drillPromise;
    expect(
      drill.ok(),
      `subscribers drill must succeed (got HTTP ${drill.status()}); pre-fix select of the ` +
        'dropped subscribers.total_contributions column returns 400 / PostgREST 42703',
    ).toBe(true);

    // Derive the ACTUAL clicked agent (names collide, so never trust a fixed id)
    // and compute the authoritative row count the drill should render.
    const agentId = agentIdFromDrillUrl(drill.url());
    const expectedRows = await commissionCount(agentId);
    expect(
      expectedRows,
      `seed sanity: clicked agent ${agentId} should own ≥1 commission`,
    ).toBeGreaterThan(0);

    // ── Drill into the subscriber list (Onboarded stat → subscribers view) ────
    await panel.getByRole('button', { name: /onboarded/i }).first().click();

    // The drill renders REAL rows, not the empty state…
    await expect(
      panel.getByText(/no subscribers found/i),
      'a working drill renders real subscriber rows, not the empty state',
    ).toHaveCount(0);

    // …and the "<N> subscribers" subtitle shows a POSITIVE count (pre-fix the
    // thrown query left the list empty → "0 subscribers"). getCommissionSubscribers
    // returns one row per commission, so N == the agent's commission count
    // (capped at PostgREST's 1000-row default page).
    await expect(
      panel.getByText(/[1-9]\d*\s+subscribers/),
      'subscribers subtitle should report a positive count once the drill loads real data',
    ).toBeVisible({ timeout: 15_000 });

    // No crash into the global ErrorBoundary at any step.
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });
});
