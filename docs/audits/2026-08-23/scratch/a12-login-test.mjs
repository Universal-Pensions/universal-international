import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const PHONE = '+256700000011';
const paths = ['/', '/distributors'];
const b = await chromium.launch({ headless: true });
for (const lp of paths) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  try {
    await p.goto(BASE + lp, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1200);
    let tel = p.locator('input[type="tel"]:visible').first();
    if (!(await tel.count())) {
      const sib = p.getByRole('button', { name: /^Sign in$/i }).first();
      if (await sib.count()) { await sib.click(); await p.waitForTimeout(1000); }
      tel = p.locator('input[type="tel"]:visible').first();
    }
    await tel.waitFor({ state: 'visible', timeout: 8000 });
    await tel.fill(PHONE);
    await p.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
    const d0 = p.locator('input[name="otp-0"]');
    await d0.waitFor({ state: 'visible', timeout: 8000 });
    for (let i = 0; i < 6; i++) await p.locator(`input[name="otp-${i}"]`).fill('123456'[i]);
    await p.getByRole('button', { name: /verify/i }).first().click();
    await p.waitForURL(/\/dashboard/, { timeout: 20000 });
    console.log('LANDING', lp, '=> URL', p.url());
  } catch (e) {
    console.log('LANDING', lp, '=> FAIL', String(e).split('\n')[0]);
  }
  await ctx.close();
}
await b.close();
