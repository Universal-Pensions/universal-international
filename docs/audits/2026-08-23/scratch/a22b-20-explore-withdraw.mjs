import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/subscriber.json' });
const page = await ctx.newPage();
await page.route('**/rest/v1/rpc/request_withdrawal**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"XX000","message":"injected server error"}' }));
await page.goto(BASE + '/dashboard/withdraw', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
await page.getByRole('button', { name: /^Withdraw savings/i }).first().click();
await page.waitForTimeout(1500);
console.log('STEP2 body:', (await page.evaluate(() => document.body.innerText.replace(/\s+/g,' '))).slice(0, 700));
console.log('STEP2 buttons:', JSON.stringify(await page.getByRole('button').evaluateAll(els=>els.map(e=>({t:e.innerText.replace(/\s+/g,' ').trim().slice(0,40), dis:e.disabled})))));
console.log('STEP2 inputs:', JSON.stringify(await page.locator('input:visible').evaluateAll(els=>els.map(e=>({n:e.name,t:e.type,v:e.value})))));
const amt = page.locator('input:visible').first();
await amt.fill('50000');
await page.waitForTimeout(800);
console.log('after fill buttons:', JSON.stringify(await page.getByRole('button').evaluateAll(els=>els.map(e=>({t:e.innerText.replace(/\s+/g,' ').trim().slice(0,40), dis:e.disabled})))));
const req = page.getByRole('button', { name: /^Request withdrawal$/i }).first();
if (await req.isEnabled()) {
  await req.click();
  await page.waitForTimeout(1500);
  console.log('after request buttons:', JSON.stringify((await page.getByRole('button').allInnerTexts()).map(s=>s.replace(/\s+/g,' ').trim())));
  console.log('body:', (await page.evaluate(() => document.body.innerText.replace(/\s+/g,' '))).slice(0, 600));
  for (const rx of [/^Confirm/i, /^Yes/i, /^Withdraw/i, /^Request UGX/i]) {
    const btn = page.getByRole('button', { name: rx }).first();
    if (await btn.count() && await btn.isEnabled().catch(()=>false)) {
      await btn.click(); console.log('clicked', rx.source);
      for (const ms of [300,400,500,800]) { await page.waitForTimeout(ms); console.log('  alerts:', JSON.stringify(await page.locator('[role="alert"],[role="status"]').allInnerTexts())); }
      break;
    }
  }
}
await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-withdraw-explore.png', fullPage: true });
await b.close();
