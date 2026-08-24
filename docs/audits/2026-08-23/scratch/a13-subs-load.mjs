import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
async function signInDistributor(page, phoneLocal) {
  await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: /^Log in$/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^Distributor Distribution network/i }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Distributor Admin/i }).first().click();
  await page.waitForTimeout(800);
  const tel = page.locator('input[name="phone"]:visible').first();
  await tel.waitFor({ state: 'visible', timeout: 15000 });
  await tel.fill(phoneLocal);
  await page.getByRole('button', { name: /send verification code/i }).first().click();
  await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 20000 });
  for (let k = 0; k < 6; k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
}
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
const reqs = [];
page.on('response', (r) => { const u=r.url(); if(/rest\/v1\/|\/api\//.test(u)) reqs.push(`${r.status()} ${u.split('?')[0].slice(-70)}`); });
await signInDistributor(page, '700000021');
await page.goto(`${BASE}/dashboard/subscribers`, { waitUntil: 'domcontentloaded' });
for (const t of [4000, 8000, 15000]) {
  await page.waitForTimeout(t===4000?4000:t-([4000,8000,15000][[4000,8000,15000].indexOf(t)-1]||0));
  const spinner = await page.locator('[class*="spinner"]').count();
  const txt = (await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(0,140);
  console.log(`@~${t}ms spinnerEls=${spinner} | ${txt}`);
}
await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/distributor/subscribers-375.png', fullPage: true });
console.log('NET (subscriber/entities):', reqs.filter(r=>/subscriber|entit|rollup/i.test(r)).slice(-8));
await b.close();
