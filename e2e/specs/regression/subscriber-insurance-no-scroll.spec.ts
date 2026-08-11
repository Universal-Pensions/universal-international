// Regression net for the Insurance cover desktop layout.
//
// THE BUG THIS PINS: `InsurancePage.module.css` used to cap `.page` at 640px on
// desktop. `flow.splitHost` (desktopFlow.module.css) is `container-type:
// inline-size` and is a CHILD of `.page`, so that cap pinned the SIZE CONTAINER
// at 640px — which made `@container (max-width: 900px)` match at EVERY viewport.
// The two-column split therefore never opened, the sticky "Your cover" rail fell
// to the bottom of the page, and the page scrolled on every desktop. It looked
// like a stretched mobile layout, which is exactly how it was reported.
//
// Two assertions, and the ORDER of importance is the opposite of what you'd
// guess: `toBeInViewport()` on the rail is the one that actually catches the
// container-query regression. A pure scrollHeight check passes on a tall enough
// viewport even when the split has collapsed, because the collapsed layout
// simply stacks — it is only *too tall* on shorter screens.
//
// 1024x768 is the floor case deliberately: browser chrome leaves ~625px of real
// viewport there, which is the tightest desktop this page ever has to fit.

import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { storageStatePathFor } from '../../fixtures/auth';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('subscriber') });

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  // The old 900px container floor collapsed the split for every viewport in the
  // 1024-1204 band once the 240px rail was subtracted — i.e. most laptops.
  { width: 1100, height: 800 },
  { width: 1024, height: 768 },
];

test.describe('Insurance cover — desktop fits without scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
  });

  for (const viewport of VIEWPORTS) {
    test(`fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/dashboard/settings/insurance');

      await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
      await expect(
        page.getByRole('heading', { level: 1, name: /insurance cover/i }),
      ).toBeVisible();

      // THE regression assertion: the cover summary lives in the sticky right
      // rail and must be readable without scrolling. When the container query
      // misfires this drops below the fold and fails here.
      await expect(page.getByText('Your cover')).toBeInViewport();

      // The subscriber desktop shell scrolls <main>, not the document
      // (.shell is position: fixed; inset: 0; overflow: hidden).
      const overflow = await page
        .locator('main')
        .first()
        .evaluate((el) => el.scrollHeight - el.clientHeight);
      expect(
        overflow,
        `Insurance cover overflowed by ${overflow}px at ${viewport.width}x${viewport.height} — `
          + 'check the height budget in InsurancePage.module.css before adding content.',
      ).toBeLessThanOrEqual(2);
    });
  }
});
