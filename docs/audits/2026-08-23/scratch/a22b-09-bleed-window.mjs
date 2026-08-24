// A22 throwaway — widen the bleed window: after the role switch, stall every
// PostgREST response 6s so anything painted from cache is unmistakable.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/admin.json' });
const page = await ctx.newPage();

await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
const a = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('ADMIN  :', (a.match(/FUNDS UNDER MANAGEMENT ([^C]*)CONTRIBUTIONS ([^S]*)SUBSCRIBERS ([\d,]+)/) || []).slice(1).join(' | '));

// Now stall PostgREST (not /api/auth) so post-switch paints come from cache.
let stall = false;
await page.route('**/rest/v1/**', async (route) => {
  if (stall) await new Promise((r) => setTimeout(r, 6000));
  return route.continue();
});

await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const tab = page.getByRole('tab', { name: /Distributor/i }).first();
if (await tab.count()) await tab.click();
const tel = page.locator('input[type="tel"]:visible').first();
await tel.waitFor({ state: 'visible', timeout: 20000 });
await tel.fill('+256700000022');
await page.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 25000 });
for (let k = 0; k < 6; k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
stall = true;
await page.getByRole('button', { name: /verify/i }).first().click();
await page.waitForURL(/\/dashboard/, { timeout: 40000 });

const stored = await page.evaluate(() => localStorage.getItem('upensions_auth'));
console.log('SWITCHED TO:', stored);
for (let i = 0; i < 22; i++) {
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const m = t.match(/FUNDS UNDER MANAGEMENT ([^C]*)CONTRIBUTIONS ([^S]*)SUBSCRIBERS ([\d,]+)/);
  const hdr = (t.match(/Universal Pensions — Uganda · ([^F]*)/) || [])[1] || '';
  if (i === 0 || i === 2 || i === 5 || i === 10 || i === 21) {
    console.log(`  t+${(i+1)*0.4}s hdr="${hdr.trim().slice(0,60)}" ${m ? m.slice(1).join(' | ') : 'NO-METRIC-BLOCK'}`);
    if (i === 2) await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-bleed-window.png' });
  }
}
await b.close();
