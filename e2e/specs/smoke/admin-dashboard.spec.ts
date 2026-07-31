// Admin dashboard smoke spec.
//
// Closes audit §7b.8 / F2-07 ("zero admin E2E") + §7b.15 ("admin WIP zero
// coverage at any layer"). The admin role ships a map-theme shell
// (src/admin-dashboard/AdminDashboardShell.jsx) that REUSES the distributor map /
// overlay / view panels (role-blind, RLS-scoped — admin holds the *_select_admin
// grants) and adds two admin-exclusive managers: Distributors + Employers.
//
// SIDEBAR (src/admin-dashboard/sidebar/AdminSidebar.jsx, reusing the distributor
// Sidebar.module.css) — redesigned rail (audit H4). Top-level aria-labelled
// buttons are now:
//   • "Distributor Network" — a GROUP launcher. Its flyout (NETWORK_SUB) lists
//     Distributors / Branches / Agents and is CLOSED by default
//     (networkMenuOpen = useState(false)). The three children DO NOT EXIST in the
//     DOM until the flyout is opened, so any interaction with them must first
//     click "Distributor Network".
//   • "Employers" — opens its admin panel directly (its own channel).
//   • "Subscribers" — opens the platform-wide subscriber manager DIRECTLY via
//     handleClick('subscribers') → setViewSubscribersOpen(true). There is NO
//     intermediate "View Existing Subscribers" button anymore.
//   • "Reports" (top), "Settings" (bottom rail).
// Commissions are intentionally NOT exposed to admin (the distributor→agent
// commission flow is out of admin's remit), so there is no Commissions tab or
// CommissionPanel here.
//
// This mirrors distributor-dashboard.spec.ts (same login helper, same
// describe/test shape, same ErrorBoundary guard).

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { storageStatePathFor } from '../../fixtures/auth';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('admin') });

// The "Distributor Network" group launcher. Its flyout is closed by default, so
// Distributors / Branches / Agents are NOT in the DOM until it is opened.
// Flyout children compose label + description + count into ONE accessible name
// ("Distributors Network operators across the platform 2"), so an EXACT-match
// regex like /^distributors$/ matches nothing. Anchor at the start and let the
// rest of the name follow.
function networkGroupButton(page: Page) {
  return page.getByRole('button', { name: /^distributor network$/i }).first();
}

/** A child inside the Distributor Network flyout, matched by its leading label. */
function networkChild(page: Page, label: RegExp) {
  return page.getByRole('button', { name: label }).first();
}

// Open the Distributor Network flyout and wait for a child (Distributors) to be
// reachable. The launcher carries aria-expanded; the children mount inside the
// AnimatePresence sub-menu once it is true. Idempotent enough for a smoke check:
// callers invoke it once before touching a NETWORK_SUB child.
async function openNetworkFlyout(page: Page) {
  const launcher = networkGroupButton(page);
  await launcher.click();
  await expect(launcher).toHaveAttribute('aria-expanded', 'true');
  // The flyout's Distributors child is the stable anchor that proves it opened.
  await expect(networkChild(page, /^distributors\b/i)).toBeVisible();
}

test.describe('admin dashboard smoke', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
    await page.goto('/dashboard');
    // Wait for the data fetches (platform overview + map) to settle so the error
    // boundary, if any, has mounted by the time we inspect the page. §7f map
    // drill-down is exercised separately in regression/map-drill.spec.ts.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('main dashboard loads with the admin sidebar visible', async ({ page }) => {
    // Stay on /dashboard (AdminDashboardShell, not redirected to login or
    // coming-soon).
    await expect(page).toHaveURL(/\/dashboard/);
    // The redesigned admin rail leads with the "Distributor Network" group
    // launcher, then its sibling channels (Employers, Subscribers) — a quick
    // reachability check across the role. The network children
    // (Distributors / Branches / Agents) live inside the CLOSED flyout, so they
    // are intentionally NOT asserted at load (see openNetworkFlyout).
    await expect(networkGroupButton(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^employers$/i }).first()).toBeVisible();
    await expect(selectors.dashboardShell.subscribersTab(page)).toBeVisible();
    // The network flyout is closed at load, so its children must NOT be present
    // yet — this pins the "closed by default" contract (networkMenuOpen=false).
    await expect(page.getByRole('button', { name: /^branches$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^agents$/i })).toHaveCount(0);
    // Commissions is intentionally NOT in the admin rail — assert its absence.
    await expect(selectors.dashboardShell.commissionsTab(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^reports$/i })).toBeVisible();
    await expect(selectors.dashboardShell.settingsTab(page)).toBeVisible();
  });

  test('Distributor Network flyout reveals its children, then Distributors panel opens', async ({ page }) => {
    // The group launcher's flyout is closed by default — its children only mount
    // once it is opened. Open it, then click the Distributors child.
    await openNetworkFlyout(page);
    await networkChild(page, /^distributors\b/i).click();
    // ViewDistributors renders <h2>Distributors</h2>.
    await expect(
      page.getByRole('heading', { name: /^distributors$/i, level: 2 }),
    ).toBeVisible();
  });

  test('Employers panel opens', async ({ page }) => {
    // Employers is its own channel — opens directly, no flyout.
    await page.getByRole('button', { name: /^employers$/i }).first().click();
    // ViewEmployers renders <h2>Employers</h2>.
    await expect(
      page.getByRole('heading', { name: /^employers$/i, level: 2 }),
    ).toBeVisible();
  });

  test('View branches panel opens (reused distributor panel, via the network flyout)', async ({ page }) => {
    // Branches now lives inside the Distributor Network flyout. Admin's branches
    // view is view-only (no "Create New Branch" — that is RLS-gated to the
    // distributor role).
    await openNetworkFlyout(page);
    await networkChild(page, /^branches\b/i).click();
    await expect(
      page.getByRole('heading', { name: /existing branches/i, level: 2 }),
    ).toBeVisible();
  });

  test('View agents panel opens (reused distributor panel, via the network flyout)', async ({ page }) => {
    await openNetworkFlyout(page);
    await networkChild(page, /^agents\b/i).click();
    await expect(
      page.getByRole('heading', { name: /existing agents/i, level: 2 }),
    ).toBeVisible();
  });

  test('View subscribers panel opens directly (platform-wide)', async ({ page }) => {
    // Subscribers opens the manager DIRECTLY now — there is no intermediate
    // "View Existing Subscribers" button on the admin rail.
    await selectors.dashboardShell.subscribersTab(page).click();
    await expect(
      page.getByRole('heading', { name: /subscribers/i, level: 2 }),
    ).toBeVisible();
    // Admin reads the platform total (incl. employer-onboarded), so the panel
    // must NOT show "Showing 0 of 0" — a regression that masked the platform read.
    await expect(page.getByText(/Showing 0 of 0/i)).toHaveCount(0);
  });

  test('Settings panel opens', async ({ page }) => {
    await selectors.dashboardShell.settingsTab(page).click();
    await expect(
      page.getByRole('heading', { name: /^settings$/i, level: 2 }),
    ).toBeVisible();
  });
});
