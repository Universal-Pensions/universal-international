// A13 — distributor MOBILE (375px) walkthrough. Real UI sign-in. Report-only.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const SHOT = 'docs/audits/2026-08-23/screenshots/distributor';
const consoleErrors = [];

async function signInDistributor(page, phoneLocal) {
  await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: /^Log in$/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Distributor Distribution network/i }).first().click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Distributor Admin/i }).first().click();
  await page.waitForTimeout(900);
  const tel = page.locator('input[name="phone"]:visible').first();
  await tel.waitFor({ state: 'visible', timeout: 15000 });
  await tel.fill(phoneLocal);
  await page.getByRole('button', { name: /send verification code/i }).first().click();
  await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 20000 });
  for (let k = 0; k < 6; k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
}
const txt = (p) => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0,200)); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + String(e).slice(0,200)));

await signInDistributor(page, '700000021');
await page.waitForTimeout(9000);
console.log('LOGIN url:', page.url());
await page.screenshot({ path: `${SHOT}/home-375.png`, fullPage: true });
console.log('HOME text:', (await txt(page)).slice(0, 520));

const routes = ['branches','agents','commissions','subscribers','support','settings','menu'];
for (const r of routes) {
  await page.goto(`${BASE}/dashboard/${r}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOT}/${r}-375.png`, fullPage: true });
  console.log(`ROUTE /dashboard/${r} -> ${page.url()} | ${(await txt(page)).slice(0,150)}`);
}

console.log('\n=== REPORTS BOUNCE TEST (mobile) ===');
await page.goto(`${BASE}/dashboard/menu`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const reportsTile = page.getByRole('link', { name: /Reports/i }).first();
console.log('Reports tile present in Menu:', await reportsTile.count());
await reportsTile.click();
await page.waitForTimeout(3500);
console.log('After TAP Reports tile -> url:', page.url());
await page.screenshot({ path: `${SHOT}/reports-tile-tap-375.png`, fullPage: true });
console.log('Screen text after tap:', (await txt(page)).slice(0,160));

await page.goto(`${BASE}/dashboard/reports`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
console.log('Deep-link /dashboard/reports -> settled url:', page.url());
await page.screenshot({ path: `${SHOT}/reports-deeplink-375.png`, fullPage: true });

await page.goto(`${BASE}/dashboard/reports/contributions`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
console.log('Deep-link /dashboard/reports/contributions -> settled url:', page.url());
await page.screenshot({ path: `${SHOT}/reports-view-deeplink-375.png`, fullPage: true });

console.log('\nCONSOLE ERRORS (mobile):', JSON.stringify([...new Set(consoleErrors)].slice(0,15)));
await b.close();
