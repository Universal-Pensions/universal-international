// A22 throwaway — cross-role cache bleed on the SHARED key ['topEntities','branch',null,6].
// Admin (national) and distributor (RLS-scoped) both populate it. login() does not clear the cache.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/admin.json' });
const page = await ctx.newPage();
const grab = async () => {
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const m = t.match(/Top branches View all ([\d,]+) → BRANCH DISTRICT SUBSCRIBERS ACTIVE RATE FUM STATUS (.*?)(Needs attention|Today’s snapshot|$)/);
  return m ? `viewAll=${m[1]} :: ${m[2].trim().slice(0, 330)}` : 'NO TOP-BRANCH TABLE';
};

await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(13000);
console.log('ADMIN top branches:\n  ' + await grab() + '\n');

let stall = false;
await page.route('**/rest/v1/**', async (route) => {
  if (stall) await new Promise((r) => setTimeout(r, 8000));
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
console.log('SWITCHED TO:', await page.evaluate(() => localStorage.getItem('upensions_auth')));
for (const ms of [800, 1500, 3000, 6000]) {
  await page.waitForTimeout(ms);
  console.log(`  after ~${ms}ms: ` + await grab());
}
await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-topbranch-bleed.png', fullPage: true });
await b.close();
