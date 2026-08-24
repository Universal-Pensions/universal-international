// A22 throwaway — MONEY WRITES under (a) 500, (b) network drop, (c) validation 400.
// Every write is intercepted and failed, so no live money row is ever created.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';

const CASES = {
  contribution: {
    role: 'subscriber', path: '/dashboard/save', rpc: 'make_contribution',
    act: async (page) => { await page.getByRole('button', { name: /^Top up UGX/i }).first().click(); },
  },
  withdrawal: {
    role: 'subscriber', path: '/dashboard/withdraw', rpc: 'request_withdrawal',
    act: async (page) => {
      const b = page.getByRole('button', { name: /withdraw|request|confirm|continue/i }).first();
      await b.click();
    },
  },
};

const MODES = {
  '500':   (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"XX000","message":"injected server error"}' }),
  'abort': (route) => route.abort('failed'),
  '400':   (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"P0001","message":"amount must be greater than zero"}' }),
};

const which = process.argv[2] || 'contribution';
const c = CASES[which];
const b = await chromium.launch({ headless: true });
for (const [mode, handler] of Object.entries(MODES)) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: `e2e/.auth/${c.role}.json` });
  const page = await ctx.newPage();
  let hit = 0;
  await page.route(`**/rest/v1/rpc/${c.rpc}**`, (route) => { hit++; return handler(route); });
  await page.goto(BASE + c.path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const before = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  try { await c.act(page); } catch (e) { console.log(`  [${mode}] act failed: ${e.message.slice(0,120)}`); }
  const samples = [];
  for (const ms of [400, 400, 600, 1000, 2000]) {
    await page.waitForTimeout(ms);
    const al = await page.locator('[role="alert"],[role="status"]').allInnerTexts();
    samples.push(`t+${ms}:${JSON.stringify(al)}`);
  }
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log(`\n### ${which} / ${c.rpc} / mode=${mode} — intercepted ${hit}x`);
  console.log('  alerts over time:', samples.join(' '));
  console.log('  success-looking words after 8s:', /done|success|received|thank|confirmed|paid|complete/i.test(after) ? (after.match(/.{0,70}(done|success|received|thank|confirmed|paid|complete).{0,70}/i)||[])[0] : 'none');
  console.log('  page changed:', before.slice(0,120) !== after.slice(0,120));
  console.log('  tail:', after.slice(0, 300));
  await page.screenshot({ path: `docs/audits/2026-08-23/scratch/a22b-money-${which}-${mode}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
