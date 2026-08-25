// Admin dashboard MOBILE smoke spec (<1024px) — audit A25-002.
//
// admin-dashboard.spec.ts (this directory) covers the DESKTOP admin shell
// (AdminDashboardShell — sidebar rail + flyout). Route-matrix
// (docs/audits/2026-08-23/a25/route-matrix.md) measured admin's REAL-DEVICE
// mobile coverage at 0/22 (0%) — the mobile-chromium / mobile-webkit
// Playwright PROJECTS never ran a single admin spec, because
// admin-dashboard.spec.ts was never in either project's `testMatch`
// whitelist (playwright.config.ts). That is backwards: admin ships a
// dedicated phone shell (AdminMobileShell.jsx — app bar + five-tab bottom
// nav: Home / Distributors / Employers / Network / Menu), not a squeezed
// desktop layout, so it is a real, distinct demo surface and nothing proved
// it worked on a phone.
//
// Scope (deliberately not full parity — see A25-002 in the ledger):
// smoke-level reachability for the five bottom-tab destinations plus a
// regression guard for the Reports deep-link (A13-001), mirroring the
// desktop admin-dashboard.spec.ts's BREADTH, not its depth. Deeper flows
// (create employer, approve access request, drill into a distributor
// profile) stay desktop-only coverage for now — see this task's report for
// what else remains (branch got the same treatment; distributor/employer
// did not).
//
// This file must be added to BOTH mobile-chromium and mobile-webkit
// `testMatch` arrays in playwright.config.ts or it never runs anywhere —
// the desktop chromium/webkit projects pick it up by default (no
// `testMatch` restriction there) but every test below self-skips via the
// `isMobile` fixture, since AdminDashboardShell (not AdminMobileShell)
// renders at their 1440px viewport.

import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { storageStatePathFor } from '../../fixtures/auth';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('admin') });

test.describe('admin dashboard — mobile shell (<1024px)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    // AdminMobileShell only mounts below the useIsDesktop() 1024px gate — on
    // the desktop projects AdminDashboardShell renders instead and every
    // selector below would miss. Real coverage of that shell lives in
    // admin-dashboard.spec.ts.
    test.skip(!isMobile, 'AdminMobileShell only — desktop coverage lives in admin-dashboard.spec.ts');
    await disableAnimations(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('home loads with the five-tab bottom bar visible', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard$/);
    const nav = page.getByRole('navigation', { name: 'Admin navigation' });
    await expect(nav).toBeVisible();
    for (const label of ['Home', 'Distributors', 'Employers', 'Network', 'Menu']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('Distributors tab opens the platform distributors list', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Distributors' }).click();
    await expect(page).toHaveURL(/\/dashboard\/distributors$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Distributors' }).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('Employers tab opens the platform employers list', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Employers' }).click();
    await expect(page).toHaveURL(/\/dashboard\/employers$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Employers' }).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('Network tab opens the branches/agents/subscribers hub', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Network' }).click();
    await expect(page).toHaveURL(/\/dashboard\/network$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Network' }).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('Menu tab opens the Reports/Support/Settings hub', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Menu' }).click();
    await expect(page).toHaveURL(/\/dashboard\/menu$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Menu' }).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  // Regression guard for A13-001 on the admin side of the same fix (the
  // shared ReportsMobile / ReportViewMobile components — see
  // AdminMobileShell.jsx's reports/:reportId route).
  test('Reports deep-link resolves on a phone (A13-001 regression guard)', async ({ page }) => {
    await page.goto('/dashboard/reports');
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' }).first()).toBeVisible();
    await expect(page.getByText(/all subscribers/i).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });
});
