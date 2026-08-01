// Regression spec: ViewBranches list distinguishes "no match" from "no data".
//
// Why: previously the panel rendered a single generic "No branches" empty
// state for both filter-mismatch and genuinely-empty data — making it hard
// for a distributor to know whether to widen their search or invite a new
// branch admin. Phase 4 split these into two paths inside ViewBranches.jsx
// (lines 821-833):
//   - search.trim() === '' && !regionFilter && statusFilter === 'all'
//       → "No branches yet."
//   - otherwise → "No branches match … Try adjusting your search or filters."
//
// Coverage:
//   1. Filter-mismatch test — type a known-impossible query, assert the
//      "Try adjusting" copy renders.
//   2. Zero-rows test — service-role DELETE every branch row, reload, assert
//      "No branches yet" renders, then RESTORE via the original rows
//      snapshot. This MUST run with --workers=1 (set in CI) so we don't
//      race other specs that depend on branches existing.
//
// The destructive zero-rows test is gated behind ALLOW_DESTRUCTIVE_E2E=true
// — without it we run only the safer filter-mismatch test. CI doesn't set
// the flag by default; the test will skip until intentionally enabled.

import { test, expect } from '@playwright/test';
import { storageStatePathFor } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { supabaseAdmin } from '../../fixtures/db';

test.use({ storageState: storageStatePathFor('distributor') });

test.describe('ViewBranches empty states', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
  });

  test('filter-mismatch surface renders the adjust-filters copy', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /^overview$/i })).toBeVisible();

    // Open ViewBranches.
    //
    // ONE click, not two. The distributor two-mode redesign (65dcab5,
    // 2026-07-22) made `/dashboard` open in DASH mode, where the rail navigates
    // straight to a full-page ViewBranches — `Sidebar.jsx` renders the
    // Branch/Agent/Subscriber flyouts (`View Existing Branches`, `Create New
    // Branch`) only when `mapMode` is true. This spec previously clicked
    // "Branches" and then the flyout item, which no longer exists in dash mode.
    // The panel heading is the same `<h2>Existing Branches</h2>` in both modes,
    // so only the navigation changed.
    await page.getByRole('button', { name: /^branches$/i }).click();
    await expect(page.getByRole('heading', { name: /existing branches/i, level: 2 })).toBeVisible();

    // Type a query that won't match any branch — Z-prefixed random suffix.
    const noMatchQuery = `Zzzz-no-branch-${Date.now()}`;
    const search = page.getByRole('textbox', { name: /search branches/i });
    await expect(search).toBeVisible();
    await search.fill(noMatchQuery);

    // The "Try adjusting" copy from the EmptyState component.
    await expect(page.getByText(/try adjusting your search or filters/i)).toBeVisible({ timeout: 10_000 });

    // The "No branches yet" copy MUST NOT appear — that's the other arm.
    await expect(page.getByText(/no branches yet/i)).toHaveCount(0);
  });

  test('zero-rows surface renders the no-data copy', async ({ page }, testInfo) => {
    // This deletes every branch row and restores them in afterEach. Only
    // run on demand — otherwise it would race subscriber/agent flows that
    // depend on branches.
    if (process.env.ALLOW_DESTRUCTIVE_E2E !== 'true') {
      test.skip(true, 'Destructive: deletes all branches. Set ALLOW_DESTRUCTIVE_E2E=true to run.');
      return;
    }

    // Step 1: snapshot every branch row.
    const { data: snapshot, error: snapErr } = await supabaseAdmin
      .from('branches')
      .select('*');
    expect(snapErr, 'snapshot branches').toBeNull();
    expect(snapshot, 'expected at least one branch to snapshot').not.toBeNull();
    const rows = snapshot!;

    // Step 2: delete every row.
    const { error: delErr } = await supabaseAdmin
      .from('branches')
      .delete()
      .neq('id', '__never__'); // matches all
    expect(delErr, 'delete all branches').toBeNull();

    // Step 3: reload + assert no-data copy.
    try {
      await page.goto('/dashboard');
      await page.getByRole('button', { name: /^branches$/i }).click();
      await page.getByRole('button', { name: /view existing branches/i }).click();
      await expect(page.getByRole('heading', { name: /existing branches/i, level: 2 })).toBeVisible();

      await expect(page.getByText(/no branches yet/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/try adjusting your search or filters/i)).toHaveCount(0);
    } finally {
      // Step 4: ALWAYS restore — even on test failure. afterEach would run
      // after the page goto, which means a slow restore could race the
      // next test reading rows; we do the restore here in the try/finally
      // so the row data is guaranteed back before the spec exits.
      const { error: insErr } = await supabaseAdmin
        .from('branches')
        .insert(rows);
      // If restore fails we MUST surface it — the seed is broken and no
      // further spec will succeed until it's manually fixed.
      expect(insErr, `cleanup: restoring ${rows.length} branches after delete`).toBeNull();
    }
    testInfo.annotations.push({
      type: 'destructive',
      description: 'deleted + restored every branch row',
    });
  });
});
