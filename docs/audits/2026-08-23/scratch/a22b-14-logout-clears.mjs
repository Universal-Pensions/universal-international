// A22 throwaway — control: the SANCTIONED path (Log out button) DOES clear the cache.
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
let docLoads = 0, phase = 'A'; const rollup = { A: 0, B: 0 };
page.on('response', (r) => { if (r.request().resourceType() === 'document' && r.url().startsWith(BASE)) docLoads++; });
page.on('request', (r) => {
  if (!/rest\/v1\/rpc\/get_entity_metrics_rollup/.test(r.url())) return;
  const pd = r.postData() || '';
  if (/"p_level":"country"/.test(pd) && /\[\s*"ug"\s*\]/.test(pd)) rollup[phase]++;
});
await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await cardSignIn(page, null, '+256700000041');
await page.waitForTimeout(14000);
let t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('A) ADMIN:', (t.match(/FUNDS UNDER MANAGEMENT ([^C]*)/)||[])[1], '| rollup reqs:', rollup.A, '| docLoads:', docLoads);
phase = 'B';
await page.getByRole('button', { name: /^Log out$/i }).first().click();
await page.waitForTimeout(2500);
console.log('   after Log out -> url:', page.url(), '| docLoads:', docLoads);
await page.getByRole('link', { name: /Distributor/i }).first().click();
await page.waitForTimeout(2000);
await cardSignIn(page, 'Distributor', '+256700000022');
await page.waitForTimeout(14000);
t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('B) DISTRIBUTOR after LOGOUT+login:', (t.match(/Universal Pensions — Uganda · ([^F]*)FUNDS UNDER MANAGEMENT ([^C]*)/)||[]).slice(1).join(' || '));
console.log('   rollup reqs phase B:', rollup.B, '| docLoads total:', docLoads);
await b.close();
