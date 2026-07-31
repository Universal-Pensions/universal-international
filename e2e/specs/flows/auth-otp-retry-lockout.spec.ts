// Flow spec: SignInModal OTP retry + frontend lockout feedback loop.
//
// The demo backend accepts ANY 6-digit code (CLAUDE.md §10a) — there is no
// real OTP store, so we drive failure via the dev-only override at
// `src/services/auth.js:96` — `localStorage['upensions_otp_force']='invalid_otp'`
// forces `verifyOtp()` to throw without touching the network. Clearing it
// restores the demo's always-OK happy path. No real backend lockout exists;
// this spec asserts only the front-end feedback loop (OtpVerify.jsx).

import { test, expect, type Page } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { selectors } from '../../helpers/selectors';

test.describe('signin → OTP retry + lockout (UI feedback)', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
  });

  async function openOtpStep(page: Page) {
    await page.goto('/');
    await page.getByRole('button', { name: /^sign in$/i }).first().click();
    await expect(selectors.signInModal.surface(page).first()).toBeVisible();

    // Role tabs render ONLY when the card is given multiple `roles` (the
    // distributor landing offers distributor/branch/agent). The subscriber landing
    // passes a single `audience="subscriber"`, so there is nothing to pick — the
    // card is already scoped. Click the tab only if this surface has one.
    const subscriberTab = page.getByRole('tab', { name: /^subscriber\b/i })
      .or(page.getByRole('button', { name: /^subscriber\b/i }));
    if (await subscriberTab.first().isVisible({ timeout: 1_500 }).catch(() => false)) {
      await subscriberTab.first().click();
    }

    await page.locator('input[name="phone"]').fill('711000001'); // seeded s-0001
    await page.getByRole('button', { name: /send verification code/i }).click();
    await expect(page.getByRole('heading', { name: /verification code/i })).toBeVisible();
  }

  async function submitOtp(page: Page, code: string) {
    for (let i = 0; i < code.length; i++) {
      await page.getByRole('textbox', { name: new RegExp(`digit ${i + 1} of 6`, 'i') }).fill(code[i]!);
    }
    await page.locator('form').getByRole('button', { name: /verify & sign in/i }).click();
  }

  test('wrong code shows error → retry succeeds', async ({ page }) => {
    await openOtpStep(page);
    await page.evaluate(() => window.localStorage.setItem('upensions_otp_force', 'invalid_otp'));
    await submitOtp(page, '999999');
    await expect(page.getByRole('alert')).toContainText(/invalid code/i);

    await page.evaluate(() => window.localStorage.removeItem('upensions_otp_force'));
    await submitOtp(page, '123456');
    await expect(selectors.signInModal.surface(page)).toHaveCount(0, { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('5 consecutive wrong codes lock the form (MAX_ATTEMPTS=5)', async ({ page }) => {
    await openOtpStep(page);
    await page.evaluate(() => window.localStorage.setItem('upensions_otp_force', 'invalid_otp'));

    for (let i = 0; i < 5; i++) {
      await submitOtp(page, '999999');
      await expect(page.getByRole('alert')).toBeVisible();
    }

    // OtpVerify.jsx:100 surfaces "Too many incorrect attempts" and flips
    // `locked` → all digit inputs + the submit CTA disable.
    await expect(page.getByRole('alert')).toContainText(/too many incorrect attempts/i);
    await expect(page.getByRole('textbox', { name: /digit 1 of 6/i })).toBeDisabled();
    await expect(page.locator('form').getByRole('button', { name: /verify & sign in/i })).toBeDisabled();

    await page.evaluate(() => window.localStorage.removeItem('upensions_otp_force'));
  });
});
