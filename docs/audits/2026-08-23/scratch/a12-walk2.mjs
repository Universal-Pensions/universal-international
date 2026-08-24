import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const PHONE = '+256700000011';
const SS = 'docs/audits/2026-08-23/screenshots/branch';
const b = await chromium.launch({ headless: true });
const norm = (s) => (s||'').replace(/\s+/g,' ').trim();

// --- login as BRANCH via /distributors, selecting the Branch role tab ---
const lctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const lp = await lctx.newPage();
await lp.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
await lp.waitForTimeout(1200);
// click Branch role tab
const branchTab = lp.getByRole('tab', { name: /^Branch$/ }).first();
await branchTab.waitFor({ state: 'visible', timeout: 10000 });
await branchTab.click();
await lp.waitForTimeout(400);
let tel = lp.locator('input[type="tel"]:visible').first();
await tel.waitFor({ state: 'visible', timeout: 10000 });
await tel.fill(PHONE);
await lp.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
await lp.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 10000 });
for (let i = 0; i < 6; i++) await lp.locator(`input[name="otp-${i}"]`).fill('123456'[i]);
await lp.getByRole('button', { name: /verify/i }).first().click();
await lp.waitForURL(/\/dashboard/, { timeout: 20000 });
await lp.waitForTimeout(2000);
console.log('POST-LOGIN URL:', lp.url());
console.log('POST-LOGIN TEXT:', norm(await lp.evaluate(()=>document.body.innerText)).slice(0,500));
const state = await lctx.storageState();
await lctx.close();

async function visit(vp, name, route, tag) {
  const ctx = await b.newContext({ viewport: vp, storageState: state });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type()==='error') errs.push(norm(m.text()).slice(0,140)); });
  p.on('pageerror', e => errs.push('PAGEERR '+norm(String(e)).slice(0,140)));
  await p.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2600);
  const url = p.url();
  const txt = norm(await p.evaluate(()=>document.body.innerText)).slice(0, 1100);
  await p.screenshot({ path: `${SS}/${tag}-${vp.width}.png`, fullPage: true });
  console.log(`\n### [${name} ${vp.width}] route=${route} -> url=${url}`);
  console.log('TEXT:', txt);
  if (errs.length) console.log('ERRORS:', JSON.stringify([...new Set(errs)]));
  await ctx.close();
}

const D = { width: 1440, height: 900 };
for (const [n,r,t] of [
  ['overview','/dashboard','d-overview'],
  ['attention-dormant','/dashboard/attention/dormant','d-att-dormant'],
  ['attention-overdue','/dashboard/attention/overdue','d-att-overdue'],
  ['agents','/dashboard/agents','d-agents'],
  ['agent-detail','/dashboard/agents/a-087','d-agentdetail'],
  ['agent-subs','/dashboard/agents/a-087/subscribers','d-agentsubs'],
  ['commissions','/dashboard/commissions','d-commissions'],
  ['analytics','/dashboard/analytics','d-analytics'],
  ['reports-redirect','/dashboard/reports','d-reports'],
  ['support','/dashboard/support','d-support'],
  ['settings','/dashboard/settings','d-settings'],
  ['bogus','/dashboard/zzz-nope','d-bogus'],
]) await visit(D, n, r, t);

await b.close();
