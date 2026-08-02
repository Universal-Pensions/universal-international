// Flow spec — agent dashboard drill-down: list → detail → schedule.
//
// This is the regression baseline. The audit established that the agent
// dashboard's subscriber drill is already correctly scoped:
//
//   • /dashboard/subscribers uses useAgentSubscribers(agentId)
//   • /dashboard/subscribers/:id and /schedule are URL-scoped to that
//     subscriber via React Router params + AgentScopeProvider
//
// We pin that the agent only sees their OWN subscribers and that one
// foreign subscriber id does not leak even when entered directly. If a
// future refactor on the shared services layer regresses the agent path,
// this spec catches it.
//
// Expected outcome TODAY: PASS.

import { test, expect } from '@playwright/test';
import { storageStatePathFor, PERSONA_FOR } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { supabaseAdmin } from '../../fixtures/db';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('agent') });
test.setTimeout(60_000);

const AGENT_ID = PERSONA_FOR.agent.entityId; // a-001

async function loadAgentScope() {
  const { data, error, count } = await supabaseAdmin
    .from('subscribers')
    .select('id,name', { count: 'exact' })
    .eq('agent_id', AGENT_ID)
    .limit(5);
  if (error) throw new Error(`loadAgentScope: ${error.message}`);
  const rows = (data ?? []) as { id: string; name: string }[];
  return { rows, total: count ?? 0 };
}

test.describe('agent → drill subscribers (regression baseline)', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
  });

  test('subscribers list page loads scoped to this agent', async ({ page }) => {
    const { total } = await loadAgentScope();
    expect(total, `seed sanity: agent ${AGENT_ID} should have at least one subscriber`).toBeGreaterThan(0);

    await page.goto('/dashboard/subscribers');
    await expect(page).toHaveURL(/\/dashboard\/subscribers$/);
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /my subscribers/i })).toBeVisible();
  });

  test('a known scoped subscriber renders on the list', async ({ page }) => {
    const { rows } = await loadAgentScope();
    expect(rows.length, 'expected at least one in-scope subscriber to render').toBeGreaterThan(0);

    await page.goto('/dashboard/subscribers');
    await expect(page.getByRole('heading', { level: 1, name: /my subscribers/i })).toBeVisible();

    // SubscribersPage virtualizes long lists, so a non-visible name might
    // mean "off-screen" rather than "missing". The realistic assertion is
    // that AT LEAST ONE of the top in-scope names is visible after the
    // list mounts. We take the first 3 candidates to avoid flake on order.
    //
    // Expressed as ONE locator alternation rather than a `Promise.race` over
    // three separate `toBeVisible` calls. That race was wrong twice over:
    // `Promise.race` settles on the first promise to FINISH, so a candidate
    // that timed out at 5.0s could beat one that would have become visible at
    // 5.1s and hand back `null`; and the fixed 5s budget was itself too tight
    // once the list is rendering under full-suite load. A single locator waits
    // for whichever name appears first and gets one honest timeout.
    const candidateNames = rows.slice(0, 3).map((r) => r.name);
    const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const anyCandidate = page
      .getByText(new RegExp(`^(?:${candidateNames.map(escapeRe).join('|')})$`))
      .first();

    await expect(
      anyCandidate,
      `expected one of [${candidateNames.join(', ')}] to be visible on the agent's subscriber list`,
    ).toBeVisible({ timeout: 20_000 });
  });

  test('subscriber detail and schedule pages load for an in-scope subscriber', async ({ page }) => {
    const { rows } = await loadAgentScope();
    expect(rows.length).toBeGreaterThan(0);
    const sub = rows[0];

    await page.goto(`/dashboard/subscribers/${sub.id}`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/subscribers/${sub.id}$`));
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // PageHeader renders <h1> per the smoke spec — assert any h1 lands.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.goto(`/dashboard/subscribers/${sub.id}/schedule`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/subscribers/${sub.id}/schedule$`));
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('a subscriber belonging to a different agent does not leak', async ({ page }) => {
    // Find a subscriber whose agent_id is NOT this agent. Direct URL
    // access should fail safely — either an empty "not found" state or a
    // redirect — but never render the foreign subscriber's data.
    const { data, error } = await supabaseAdmin
      .from('subscribers')
      .select('id,name')
      .neq('agent_id', AGENT_ID)
      .limit(1);
    if (error) throw new Error(`leak-check seed: ${error.message}`);
    const outsider = (data ?? [])[0] as { id: string; name: string } | undefined;
    expect(outsider, 'expected at least one outsider subscriber').toBeTruthy();

    await page.goto(`/dashboard/subscribers/${outsider!.id}`);
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // The outsider's name must NOT appear as a page heading (which is the
    // detail page's identity marker). The page may render a "not found"
    // shell — that's fine; what's not fine is rendering the foreign data.
    await expect(
      page.getByRole('heading', { level: 1, name: outsider!.name }),
      `outsider subscriber "${outsider!.name}" must not render on agent ${AGENT_ID}'s detail page`,
    ).toHaveCount(0);
  });
});
