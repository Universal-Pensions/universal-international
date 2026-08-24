import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const PHONE = '+256700000011';
const SS = 'docs/audits/2026-08-23/screenshots/branch';
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

async function visit(vp, name, route, tag) {
  const ctx = await b.newContext({ viewport: vp, storageState: state });
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type()==='error') errs.push(norm(m.text()).slice(0,120)); });
  p.on('pageerror', e => errs.push('PAGEERR '+norm(String(e)).slice(0,120)));
  await p.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2600);
  const url = p.url();
  const txt = norm(await p.evaluate(()=>document.body.innerText)).slice(0, 800);
  await p.screenshot({ path: `${SS}/${tag}-${vp.width}.png`, fullPage: true });
  console.log(`\n### [${name} ${vp.width}] route=${route} -> ${url}`);
  console.log('TEXT:', txt);
  if (errs.length) console.log('ERRORS:', JSON.stringify([...new Set(errs)]));
  await ctx.close();
}

const M = { width: 375, height: 812 };
// find a real ticket id from support first
const tctx = await b.newContext({ viewport: M, storageState: state });
const tp = await tctx.newPage();
await tp.goto(BASE + '/dashboard/support', { waitUntil: 'domcontentloaded' });
await tp.waitForTimeout(2600);
const ticketHref = await tp.evaluate(() => {
  const a = document.querySelector('a[href*="/dashboard/support/"]');
  return a ? a.getAttribute('href') : null;
});
console.log('MOBILE_SUPPORT_TICKET_HREF:', ticketHref);
await tctx.close();

for (const [n,r,t] of [
  ['m-overview','/dashboard','m-overview'],
  ['m-att-dormant','/dashboard/attention/dormant','m-att-dormant'],
  ['m-att-overdue','/dashboard/attention/overdue','m-att-overdue'],
  ['m-agents-new','/dashboard/agents/new','m-agents-new'],
  ['m-agent-detail','/dashboard/agents/a-087','m-agentdetail'],
  ['m-agent-subs','/dashboard/agents/a-087/subscribers','m-agentsubs'],
  ['m-agents','/dashboard/agents','m-agents'],
  ['m-commissions','/dashboard/commissions','m-commissions'],
  ['m-analytics','/dashboard/analytics','m-analytics'],
  ['m-reports','/dashboard/reports','m-reports'],
  ['m-support','/dashboard/support','m-support'],
  ['m-support-thread', ticketHref || '/dashboard/support/t-nonexistent','m-support-thread'],
  ['m-menu','/dashboard/menu','m-menu'],
  ['m-settings','/dashboard/settings','m-settings'],
]) await visit(M, n, r, t);

await b.close();
