// Shared UI-login helper for A10 subscriber walkthrough. NO token injection.
import { chromium } from '@playwright/test';
export const BASE = 'http://localhost:5173';

export async function launch(width = 1440, height = 950) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  return { b, ctx, page };
}

// Sign in through the REAL UI as a subscriber. phone: exact phone to type.
// Any 6-digit OTP works. Returns after /dashboard is reached.
export async function loginSubscriber(page, phone = '+256711000001', otp = '123456') {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  // Open the SignInModal via the landing nav "Sign in" (role=subscriber preset).
  await page.getByRole('button', { name: /^Sign in$/i }).first().click();
  // Phone step
  const phoneInput = page.getByLabel('Phone number');
  await phoneInput.waitFor({ state: 'visible', timeout: 10000 });
  await phoneInput.fill(phone.replace(/^\+256/, '')); // input strips +256; type national part
  await page.getByRole('button', { name: /Send verification code/i }).click();
  // OTP step — 6 single-char inputs
  const d0 = page.getByLabel('Digit 1 of 6');
  await d0.waitFor({ state: 'visible', timeout: 10000 });
  for (let i = 0; i < 6; i++) {
    await page.getByLabel(`Digit ${i + 1} of 6`).fill(otp[i]);
  }
  await page.getByRole('button', { name: /Verify & sign in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  await page.waitForTimeout(1500);
}
