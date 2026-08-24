// A15 Admin walkthrough harness. Throwaway — listed for removal in 15-admin.md.
import { chromium } from 'playwright';
export const BASE = 'http://localhost:5173';
export const SHOT = 'docs/audits/2026-08-23/screenshots/admin';

export async function ctx(width = 1440, height = 900) {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await c.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  return { b, c, page, errors };
}

// Real UI sign-in through /admin/login (role-fixed super-admin portal).
export async function adminLogin(page, { phone = '+256700000041', code = '123456' } = {}) {
  await page.goto(BASE + '/admin/login', { waitUntil: 'domcontentloaded' });
  const tel = page.locator('input[type="tel"]').first();
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.fill(phone);
  await page.getByRole('button', { name: /send verification code|continue/i }).first().click();
  const d0 = page.locator('input[name="otp-0"]');
  await d0.waitFor({ state: 'visible', timeout: 20000 });
  for (let i = 0; i < 6; i++) await page.locator(`input[name="otp-${i}"]`).fill(code[i]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
  await page.waitForTimeout(1500);
}

export function bodyText(page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
}
