// A22 throwaway — DECISIVE: does the React Query cache survive a role switch?
// Measure: after switching distributor(d-002) -> admin WITHOUT logout, is
// get_entity_metrics_rollup(country,[ug]) re-requested? (15-min staleTime, so a
// surviving cache entry means the admin renders d-002's scoped rollup, unfetched.)
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';

async function cardSignIn(page, tabName, phone) {
  if (tabName) { const t = page.getByRole('tab', { name: new RegExp(tabName, 'i') }).first(); if (await t.count()) await t.click(); }
  const tel = page.locator('input[type="tel"]:visible').first();
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.fill(phone);
  await page.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
  await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 25000 });
  for (let k = 0; k < 6; k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
}

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let phase = 'A';
const country = { A: 0, B: 0 };
page.on('request', (r) => {
  if (!/rest\/v1\/rpc\/get_entity_metrics_rollup/.test(r.url())) return;
  const pd = r.postData() || '';
  if (/"p_level":"country"/.test(pd) && /\[\s*"ug"\s*\]/.test(pd)) country[phase]++;
});
// Also record any hard reload (would wipe the JS heap and invalidate the test).
let docLoads = 0;
page.on('response', (r) => { if (r.request().resourceType() === 'document' && r.url().startsWith(BASE)) docLoads++; });

await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await cardSignIn(page, 'Distributor', '+256700000022');
await page.waitForTimeout(12000);
const t1 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('A) distributor session:', (t1.match(/Universal Pensions — Uganda · ([^F]*)/)||[])[1]);
console.log('   get_entity_metrics_rollup(country,[ug]) requests in phase A:', country.A);
console.log('   document loads so far:', docLoads);

phase = 'B';
await page.goBack();                       // SPA history pop — no document load
await page.waitForTimeout(1500);
const link = page.getByRole('link', { name: /Administrator/i }).first();
await link.click();
await page.waitForTimeout(2000);
console.log('   url now:', page.url(), '| document loads:', docLoads, '(unchanged => SPA cache intact)');
await cardSignIn(page, null, '+256700000041');
await page.waitForTimeout(15000);
const t2 = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('B) admin session after switch:', (t2.match(/Universal Pensions — Uganda · ([^F]*)/)||[])[1]);
console.log('   get_entity_metrics_rollup(country,[ug]) requests in phase B:', country.B);
console.log('   document loads total:', docLoads);
console.log('   CONTRIBUTIONS block:', (t2.match(/CONTRIBUTIONS ([^S]*)SUBSCRIBERS/)||[])[1]);
await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-cache-survives.png', fullPage: true });
await b.close();
