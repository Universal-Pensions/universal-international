import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/subscriber.json' });
const page = await ctx.newPage();
const rpcs = [];
await page.route('**/rest/v1/rpc/**', (route) => {
  const n = route.request().url().split('/rpc/')[1].split('?')[0];
  rpcs.push(n);
  if (/make_contribution|request_withdrawal|fund_insurance|submit_/.test(n)) {
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"XX000","message":"injected server error"}' });
  }
  return route.continue();
});
await page.goto(BASE + '/dashboard/save', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
await page.getByRole('button', { name: /^Top up UGX/i }).first().click();
await page.waitForTimeout(1500);
console.log('after click 1 — buttons:', JSON.stringify((await page.getByRole('button').allInnerTexts()).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean)));
let t = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
console.log('body:', t.slice(0, 700));
await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-topup-step1.png', fullPage: true });
// try the obvious confirm
for (const rx of [/^Pay UGX/i, /^Confirm/i, /^Pay now/i, /^Continue/i, /I have paid/i, /^Done$/i]) {
  const btn = page.getByRole('button', { name: rx }).first();
  if (await btn.count()) {
    console.log('clicking:', rx.source);
    await btn.click();
    await page.waitForTimeout(1200);
    const al = await page.locator('[role="alert"],[role="status"]').allInnerTexts();
    t = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
    console.log('  alerts:', JSON.stringify(al), '| rpcs:', JSON.stringify(rpcs.slice(-4)));
    console.log('  body:', t.slice(0, 400));
    await page.screenshot({ path: `docs/audits/2026-08-23/scratch/a22b-topup-${rx.source.replace(/[^a-z]/gi,'')}.png`, fullPage: true });
  }
}
await b.close();
