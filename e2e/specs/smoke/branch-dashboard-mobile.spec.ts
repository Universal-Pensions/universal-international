// Branch admin dashboard MOBILE smoke spec (<1024px) — audit A25-002.
//
// branch-dashboard.spec.ts (this directory) exercises the DESKTOP branch
// shell plus a narrow-viewport ("mobile 390px") describe block that forces a
// small viewport on the DESKTOP chromium engine — that is a responsive-
// layout check, not the real-device mobile-chromium / mobile-webkit
// Playwright PROJECTS that docs/audits/2026-08-23/a25/route-matrix.md
// measures (branch was 0/12, 0%, there). Neither branch spec file is in
// either mobile project's `testMatch` whitelist (playwright.config.ts), so
// branch had genuinely zero coverage on the two engines that produced 22 of
// the suite's 30 baseline failures.
//
// BranchMobileShell.jsx (the shipped "flat 5-tab nav" redesign, 2026-06-27)
// is a fully ROUTED phone shell — Home / Agents / Commissions / Analytics /
// Branch (the hub), each a real URL under /dashboard — not the state-based
// panel shell that branch-dashboard.spec.ts's own header comment describes
// (that comment predates the redesign; the routed shell is what is actually
// live today). This spec proves the five destinations are reachable on the
// real mobile engines.
//
// Scope (deliberately not full parity — see A25-002 in the ledger):
// smoke-level reachability for the five bottom-tab destinations. Deeper
// flows (add agent, settle commissions) stay desktop-only coverage for now.
//
// This file must be added to BOTH mobile-chromium and mobile-webkit
// `testMatch` arrays in playwright.config.ts or it never runs anywhere —
// the desktop chromium/webkit projects pick it up by default (no
// `testMatch` restriction there) but every test below self-skips via the
// `isMobile` fixture, since the branch desktop shell renders at their
// 1440px viewport instead.

import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { storageStatePathFor } from '../../fixtures/auth';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('branch') });

test.describe('branch dashboard — mobile shell (<1024px)', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(!isMobile, 'BranchMobileShell only — desktop/narrow-viewport coverage lives in branch-dashboard.spec.ts');
    await disableAnimations(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('home loads with the five-tab bottom bar visible', async ({ page }) => {
    await expect(page).toHaveURL(/\/dashboard$/);
    const nav = page.getByRole('navigation', { name: 'Branch navigation' });
    await expect(nav).toBeVisible();
    for (const label of ['Home', 'Agents', 'Commissions', 'Analytics', 'Branch']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
  });

  test('Agents tab opens the agent roster', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Branch navigation' }).getByRole('link', { name: 'Agents' }).click();
    await expect(page).toHaveURL(/\/dashboard\/agents$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Agents' }).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('Commissions tab opens the commissions page', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Branch navigation' }).getByRole('link', { name: 'Commissions' }).click();
    await expect(page).toHaveURL(/\/dashboard\/commissions$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Commissions' }).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('Analytics tab opens the analytics page', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Branch navigation' }).getByRole('link', { name: 'Analytics' }).click();
    await expect(page).toHaveURL(/\/dashboard\/analytics$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' }).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });

  test('Branch tab opens the hub (Support/Settings/sign out)', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Branch navigation' }).getByRole('link', { name: 'Branch' }).click();
    await expect(page).toHaveURL(/\/dashboard\/menu$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Branch' }).first()).toBeVisible();
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
  });
});
