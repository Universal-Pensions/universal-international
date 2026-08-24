import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const PHONE = '+256700000011';
const b = await chromium.launch({ headless: true });
const norm = (s) => (s||'').replace(/\s+/g,' ').trim();
const lctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const lp = await lctx.newPage();
await lp.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
await lp.waitForTimeout(1000);
await lp.getByRole('tab', { name: /^Branch$/ }).first().click();
await lp.waitForTimeout(300);
let tel = lp.locator('input[type="tel"]:visible').first();
await tel.waitFor({ state: 'visible', timeout: 10000 });
await tel.fill(PHONE);
await lp.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
await lp.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 10000 });
for (let i = 0; i < 6; i++) await lp.locator(`input[name="otp-${i}"]`).fill('123456'[i]);
await lp.getByRole('button', { name: /verify/i }).first().click();
await lp.waitForURL(/\/dashboard/, { timeout: 20000 });
const state = await lctx.storageState();
await lctx.close();

for (const vp of [{width:1440,height:900,tag:'desktop'},{width:375,height:812,tag:'mobile'}]) {
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, storageState: state });
  const p = await ctx.newPage();
  // direct nav
  await p.goto(BASE + '/dashboard/reports', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  console.log(`[${vp.tag}] direct /dashboard/reports FINAL URL:`, p.url());
  // also from overview then pushState nav to reports
  await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  await p.evaluate(() => window.history.pushState({}, '', '/dashboard/reports'));
  await p.waitForTimeout(200);
  // trigger a router re-eval by dispatching popstate
  await p.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
  await p.waitForTimeout(2500);
  console.log(`[${vp.tag}] pushState reports FINAL URL:`, p.url(), '| heading:', norm(await p.evaluate(()=>document.body.innerText)).slice(0,60));
  await ctx.close();
}
await b.close();
