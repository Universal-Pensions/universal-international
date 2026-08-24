// A22 throwaway — CROSS-ROLE CACHE BLEED via the browser BACK button.
// AuthContext.login() never clears the React Query cache; LandingLoginCard has
// no isAuthenticated guard; Back from /dashboard to a landing route is an SPA
// history pop, so the in-memory cache survives the role switch.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';

async function cardSignIn(page, tabName, phone) {
  if (tabName) {
    const tab = page.getByRole('tab', { name: new RegExp(tabName, 'i') }).first();
    if (await tab.count()) await tab.click();
  }
  const tel = page.locator('input[type="tel"]:visible').first();
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.fill(phone);
  await page.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
  await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 25000 });
  for (let k = 0; k < 6; k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
}
const snap = async (page) => {
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const fum = (t.match(/FUNDS UNDER MANAGEMENT ([^C]*)CONTRIBUTIONS ([^S]*)SUBSCRIBERS ([\d,]+)/) || []).slice(1);
  const top = (t.match(/BRANCH DISTRICT SUBSCRIBERS ACTIVE RATE FUM STATUS (.*?)(Needs attention|Today|$)/) || [])[1] || '';
  const hdr = (t.match(/Universal Pensions — Uganda · ([^F]*)/) || [])[1] || '';
  return { hdr: hdr.trim().slice(0, 70), fum: fum.join(' | '), top: top.trim().slice(0, 220) };
};

const b = await chromium.launch({ headless: true });

console.log('===== CONTROL: clean admin login =====');
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await cardSignIn(page, null, '+256700000041');
  await page.waitForTimeout(13000);
  console.log(JSON.stringify(await snap(page), null, 1));
  await ctx.close();
}

console.log('\n===== BLEED: distributor d-002 -> BACK -> /admin -> admin login (NO logout) =====');
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let reloads = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloads++; });
  await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await cardSignIn(page, 'Distributor', '+256700000022');
  await page.waitForTimeout(13000);
  console.log('STEP1 distributor:', JSON.stringify(await snap(page)));
  const navsBefore = reloads;
  await page.goBack();                     // SPA pop back to /distributors
  await page.waitForTimeout(1500);
  console.log('  url after Back:', page.url(), '| full page navigations so far:', reloads, '(was', navsBefore + ')');
  // client-side nav to the Administrators landing page
  const adminLink = page.getByRole('link', { name: /Administrator/i }).first();
  if (await adminLink.count()) { await adminLink.click(); } else { await page.getByRole('link', { name: /^Admin/i }).first().click(); }
  await page.waitForTimeout(2000);
  console.log('  url after clicking Administrators:', page.url(), '| navigations:', reloads);
  const stalled = [];
  await page.route('**/rest/v1/**', async (route) => { stalled.push(1); await new Promise(r => setTimeout(r, 9000)); return route.continue(); });
  await cardSignIn(page, null, '+256700000041');
  console.log('  SWITCHED TO:', await page.evaluate(() => localStorage.getItem('upensions_auth')));
  for (const ms of [700, 1500, 3000]) {
    await page.waitForTimeout(ms);
    console.log(`  admin view @+${ms}ms:`, JSON.stringify(await snap(page)));
  }
  await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-backbutton-bleed.png', fullPage: true });
  await ctx.close();
}
await b.close();
