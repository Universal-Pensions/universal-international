import { chromium } from 'playwright';
import { signIn } from './lib.mjs';

const CASES = [
  { name: '500 server error', handler: (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST000', message: 'unexpected error while executing make_contribution' }) }) },
  { name: 'network drop', handler: (r) => r.abort('failed') },
  { name: '400 validation rejection', handler: (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: '22023', message: 'amount must be greater than zero', details: null, hint: null }) }) },
];

const b = await chromium.launch();
for (const c of CASES) {
  const p = await (await b.newContext()).newPage();
  await signIn(p, { landingPath: '/', phone: '+256711000001' });
  await p.goto('http://localhost:5173/dashboard/save', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(7000);
  let hits = 0;
  await p.route('**/rest/v1/rpc/make_contribution*', async (route) => { hits++; await c.handler(route); });
  const balBefore = ((await p.evaluate(() => document.body.innerText)).match(/New balance UGX [\d,]+/) || [])[0];
  await p.getByRole('button', { name: /^Top up extra$/ }).first().click().catch(()=>{});
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Top up UGX/ }).first().click();
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: /^Confirm & pay$/ }).first().click();
  await p.waitForTimeout(1600);
  const t1 = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g,' ');
  const alerts = await p.locator('[role="alert"], [role="status"]').allInnerTexts().catch(()=>[]);
  console.log(`\n=== CASE: ${c.name} ===`);
  console.log('  intercepts:', hits);
  console.log('  alert/status nodes:', JSON.stringify(alerts));
  console.log('  page shows error copy:', /could not|failed|error|try again|unable/i.test(t1));
  console.log('  still on /dashboard/save:', p.url());
  await p.screenshot({ path: `docs/audits/2026-08-23/scratch/money-write-${c.name.replace(/\W+/g,'-')}.png` });
  await p.context().close();
}
await b.close(); process.exit(0);
