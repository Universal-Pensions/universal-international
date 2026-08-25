// A16-002 regression guard. The legacy `Navbar` (FAQ / Contact / About) hid its
// "Start saving" CTA at <=920px but only showed the hamburger drawer at
// <=768px — a breakpoint `LandingLayout` never lets this component see (it
// swaps to `LandingMobileShell` at <=768px first). That left a 769-920px band
// — real iPad-portrait widths (iPad Air 820, iPad Pro 11" 834) — with neither
// the CTA nor a menu button reachable. Fixed by raising the burger/drawer
// breakpoint to 920px so it now covers exactly the gap the CTA leaves behind.
import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';

test.describe('landing nav — 769-920px band (A16-002)', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
    // iPad Air portrait — inside the gap band, and not covered by any of the
    // 4 configured projects (desktop 1440, mobile 375/390).
    await page.setViewportSize({ width: 834, height: 1194 });
  });

  test('FAQ shows a menu button (not a dead end) at 834px', async ({ page }) => {
    await page.goto('/faq');
    // The desktop CTA link exists in the DOM but is display:none at this width.
    await expect(page.getByRole('link', { name: 'Start saving' })).not.toBeVisible();
    // The hamburger — previously only active <=768px, i.e. never reachable on
    // a route this component renders on — is now visible and opens the drawer.
    const burger = page.getByRole('button', { name: 'Open menu' });
    await expect(burger).toBeVisible();
    await burger.click();
    await expect(page.getByRole('button', { name: 'Close menu' })).toBeVisible();
  });

  test('Contact and About carry the same fix', async ({ page }) => {
    for (const path of ['/contact', '/about']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    }
  });
});
