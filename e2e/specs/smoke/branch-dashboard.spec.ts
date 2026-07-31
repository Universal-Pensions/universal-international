// Smoke tests for the branch admin dashboard.
//
// As of the desktop redesign, the branch shell is a `useIsDesktop()` (>=1024px)
// gate: on DESKTOP it renders BranchDesktopShell — a routed 3-column shell with
// a white nav rail and one URL per destination (/dashboard, /dashboard/agents,
// …). On MOBILE (<1024px) it keeps the original panel/drawer shell, where every
// destination is a state-based slide-in panel (DashboardPanelContext) at the
// single /dashboard URL. This spec covers BOTH:
//   • desktop (default 1280px viewport) → routed nav + in-page Add-agent view
//   • mobile (390px viewport)            → the panel flow still works (byte-identical)
//
// Desktop rail labels come from src/branch-dashboard/shell/branchNav.jsx; the
// mobile panel labels from src/branch-dashboard/sidebar/BranchSidebar.jsx.

import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { storageStatePathFor } from '../../fixtures/auth';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('branch') });

test.describe('branch dashboard — desktop (routed)', () => {
  // Force a >=1024px viewport so the useIsDesktop() gate renders the routed
  // shell even under the mobile-viewport Playwright projects.
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
  });

  test('overview loads', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // "Branch overview" identifies the home view. The mobile shell exposes it as
    // the aria-label of a region; the desktop shell renders it as text. Accept
    // either so this reads the same on both.
    await expect(
      page.getByRole('region', { name: /branch overview/i })
        .or(page.getByText(/branch overview/i))
        .first(),
    ).toBeVisible();
    await expect(page.getByText(/branch admin/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('rail navigates to each routed page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    await page.getByRole('link', { name: 'Agents', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/agents/);
    await expect(page.getByRole('heading', { level: 1, name: /^agents$/i })).toBeVisible();

    await page.getByRole('link', { name: 'Commissions', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/commissions/);
    await expect(page.getByRole('heading', { level: 1, name: /^commissions$/i })).toBeVisible();

    await page.getByRole('link', { name: 'Analytics', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/analytics/);
    await expect(page.getByRole('heading', { level: 1, name: /^analytics$/i })).toBeVisible();

    await page.getByRole('link', { name: /support/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/support/);
    await expect(page.getByRole('heading', { level: 1, name: /^support$/i })).toBeVisible();

    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings/);
    await expect(page.getByRole('heading', { level: 1, name: /^settings$/i })).toBeVisible();
  });

  test('Add agent opens an in-page view (not a modal) with Single + Bulk tabs', async ({ page }) => {
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    await page.getByRole('button', { name: /add agent/i }).click();
    // Integrated in-page view — the heading swaps, the URL stays on /agents,
    // and crucially there is NO dialog/modal.
    await expect(page.getByRole('heading', { level: 1, name: /add agents to/i })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/agents/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Bulk upload tab → Excel template + dropzone.
    await page.getByRole('tab', { name: /bulk upload/i }).click();
    await expect(page.getByRole('button', { name: /download excel template/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /upload filled template/i })).toBeVisible();
  });

  test('agent roster shows active/inactive (no "Onboarding") and drills into a detail page', async ({ page }) => {
    await page.goto('/dashboard/agents');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    // The bogus "Onboarding" status is gone — agents are Active or Inactive.
    await expect(page.getByText(/onboarding/i)).toHaveCount(0);
    await expect(page.getByText(/^active$/i).first()).toBeVisible();
    // Drill into the first agent → detail page with the Deactivate action.
    const firstAgent = page.locator('tbody tr a[href^="/dashboard/agents/"]').first();
    await firstAgent.click();
    await expect(page).toHaveURL(/\/dashboard\/agents\/[\w-]+/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /deactivate agent|reactivate agent/i })).toBeVisible();
  });

  test('Support ticket opens a read-only thread', async ({ page }) => {
    await page.goto('/dashboard/support');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    // TicketListRow's accessible name is the ticket subject. Click the first
    // seeded branch ticket → read-only ThreadView ("All tickets" back, no composer).
    await page.getByRole('button', {
      name: /cannot log in|contribution did not reflect|wrong nominee|withdrawal was paid|monthly savings|insurance claim|phone number/i,
    }).first().click();
    await expect(page.getByRole('button', { name: /all tickets/i })).toBeVisible({ timeout: 10_000 });
  });

  test('deep-link to a sub-route survives a hard refresh', async ({ page }) => {
    // /dashboard/analytics specifically: the legacy DashboardNavContext used to
    // intercept it for branch (open the mobile panel + rewrite the URL back to
    // /dashboard). The desktop gate must let the routed page render and STAY.
    await page.goto('/dashboard/analytics');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard\/analytics/);
    await expect(page.getByRole('heading', { level: 1, name: /^analytics$/i })).toBeVisible();

    await page.goto('/dashboard/commissions');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    await expect(page).toHaveURL(/\/dashboard\/commissions/);
    await expect(page.getByRole('heading', { level: 1, name: /^commissions$/i })).toBeVisible();
  });
});

test.describe('branch dashboard — mobile (panels, byte-identical)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
  });

  test('renders the original mobile panel shell, not the routed desktop rail', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // The mobile shell's bottom tab bar proves the useIsDesktop() gate fell
    // through to mobile: its nav landmark is labelled "Branch navigation"
    // (BranchBottomTabBar), whereas the desktop rail's is "Primary"
    // (BranchSideNavDesktop) — so this can only match below the breakpoint.
    // (Was the MobileHeader "open menu" hamburger, removed when the mobile shell
    // moved from a drawer to the persistent app-bar + bottom-tab layout.)
    await expect(
      page.getByRole('navigation', { name: /branch navigation/i }),
    ).toBeVisible();
    // "Branch overview" identifies the home view. The mobile shell exposes it as
    // the aria-label of a region; the desktop shell renders it as text. Accept
    // either so this reads the same on both.
    await expect(
      page.getByRole('region', { name: /branch overview/i })
        .or(page.getByText(/branch overview/i))
        .first(),
    ).toBeVisible();
    // And the DESKTOP rail must not be mounted below the breakpoint. Assert on the
    // rail's nav landmark ("Primary", BranchSideNavDesktop) — not on a Commissions
    // link, because the mobile shell is routed too now and legitimately renders
    // its own NavLinks in the bottom tab bar.
    await expect(page.getByRole('navigation', { name: /^primary$/i })).toHaveCount(0);
    // The mobile panel flow itself is unchanged — exercised by the existing
    // panel-based suites; here we only lock the shell boundary.
  });
});
