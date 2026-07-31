// Distributor dashboard smoke spec.
//
// The distributor shell is the default DashboardShell (src/dashboard/DashboardShell.jsx)
// — same one branch admins use, with role-aware behaviour. Unlike subscriber/agent
// dashboards which have routed sub-pages, distributor uses STATE-BASED panels
// (DashboardPanelContext) over a single URL `/dashboard`. The main content is the
// interactive UgandaMap on desktop (Playwright defaults to Desktop Chrome here),
// and panels slide in over it when sidebar items are clicked.
//
// Sidebar layout (src/dashboard/sidebar/Sidebar.jsx):
//   • Top-level buttons (aria-label): Overview, Branches, Agents, Subscribers,
//     Commissions, Reports
//   • Bottom buttons (aria-label): Settings, Log out
//   • Branches / Agents / Subscribers open a flyout submenu first; clicking the
//     submenu item then opens the panel. Commissions / Reports / Settings open
//     their panel directly.

import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { storageStatePathFor } from '../../fixtures/auth';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('distributor') });

// Note: branch-dashboard.spec.ts hits a known ViewAgents null-metrics crash
// because branch shell eagerly mounts ViewAgents. The distributor shell does
// NOT eagerly mount ViewAgents at country level, so these tests pass cleanly.
test.describe('distributor dashboard smoke', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
    await page.goto('/dashboard');
    // Wait for the data fetches to settle so the error boundary, if any, has
    // mounted by the time we inspect the page.
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    // No error-boundary fallback should be visible on any test.
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('main dashboard loads with sidebar visible', async ({ page }) => {
    // Stay on /dashboard (DashboardShell, not redirected to login or coming-soon).
    await expect(page).toHaveURL(/\/dashboard/);
    // Sidebar is the primary nav landmark on desktop; its Overview button is
    // always rendered and is a stable anchor for "the distributor shell mounted".
    await expect(selectors.dashboardShell.overviewTab(page)).toBeVisible();
    // Distributor sidebar exposes the full nav set (Branches/Agents/Subscribers/
    // Commissions/Reports) — a quick reachability check across the role.
    await expect(selectors.dashboardShell.branchesTab(page)).toBeVisible();
    await expect(selectors.dashboardShell.agentsTab(page)).toBeVisible();
    await expect(selectors.dashboardShell.subscribersTab(page)).toBeVisible();
    await expect(selectors.dashboardShell.commissionsTab(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /^reports$/i })).toBeVisible();
    await expect(selectors.dashboardShell.settingsTab(page)).toBeVisible();
  });

  test('Create branch panel opens', async ({ page }) => {
    // Branches is a flyout — but ONLY in map mode. In the default dash mode the
    // rail jumps straight to the branch LIST and offers no Create entry at all
    // (Sidebar.jsx `handleNav`), so enable Map view first: today that is the only
    // route to the create form.
    const mapViewToggle = page.getByRole('switch', { name: /map view/i });
    await expect(mapViewToggle).toBeVisible();
    if ((await mapViewToggle.getAttribute('aria-checked')) !== 'true') {
      await mapViewToggle.click();
    }
    await selectors.dashboardShell.branchesTab(page).click();
    await page.getByRole('button', { name: /create new branch/i }).click();
    // CreateBranch renders <h2>Create New Branch</h2>.
    await expect(
      page.getByRole('heading', { name: /create new branch/i, level: 2 }),
    ).toBeVisible();
  });

  test('View branches panel opens', async ({ page }) => {
    await selectors.openDistributorList(
      page,
      selectors.dashboardShell.branchesTab(page),
      page.getByRole('button', { name: /view existing branches/i }),
    );
    // ViewBranches renders <h2>Existing Branches</h2> on list view.
    await expect(
      page.getByRole('heading', { name: /existing branches/i, level: 2 }),
    ).toBeVisible();
  });

  test('View agents panel opens', async ({ page }) => {
    await selectors.openDistributorList(
      page,
      selectors.dashboardShell.agentsTab(page),
      page.getByRole('button', { name: /view existing agents/i }),
    );
    // ViewAgents renders <h2>Existing Agents</h2> on list view.
    await expect(
      page.getByRole('heading', { name: /existing agents/i, level: 2 }),
    ).toBeVisible();
  });

  test('View subscribers panel opens', async ({ page }) => {
    await selectors.openDistributorList(
      page,
      selectors.dashboardShell.subscribersTab(page),
      selectors.viewListPanel.viewExistingSubscribers(page),
    );
    // ViewSubscribers renders <h2>Subscribers <count></h2> — the inline count
    // span is part of the accessible name, so we use a substring match.
    await expect(
      page.getByRole('heading', { name: /subscribers/i, level: 2 }),
    ).toBeVisible();
    // Phase 3 audit assert: the seeded distributor has ~30k subscribers — the
    // count text must NOT be "0 of 0" (previous regression masked by EMPTY_METRICS).
    // Header includes the total subscriber count beside the heading.
    await expect(page.getByText(/Showing 0 of 0/i)).toHaveCount(0);
  });

  test('View reports panel opens', async ({ page }) => {
    // Reports opens directly from the sidebar (no submenu).
    await page.getByRole('button', { name: /^reports$/i }).click();
    // ViewReports renders <h2>Reports</h2> on hub view.
    await expect(
      page.getByRole('heading', { name: /^reports$/i, level: 2 }),
    ).toBeVisible();
  });

  test('Commission panel opens', async ({ page }) => {
    // Commissions opens directly.
    await selectors.dashboardShell.commissionsTab(page).click();
    // CommissionPanel renders its title in a <div> rather than a heading; the
    // wrapper carries aria-label="Commissions" and is role="dialog" as a slide-in
    // or role="region" as a routed full page — selectors.panel spans both.
    // (/commission settlement/ only ever matched the inner subtitle, never the root.)
    await expect(selectors.panel.commissions(page)).toBeVisible();
  });

  test('Settings panel opens', async ({ page }) => {
    // Settings sits in the bottom rail of the sidebar (not the top nav).
    await selectors.dashboardShell.settingsTab(page).click();
    // Settings renders <h2>Settings</h2>.
    await expect(
      page.getByRole('heading', { name: /^settings$/i, level: 2 }),
    ).toBeVisible();
  });
});
