import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
// SAFETY: block the destructive RPC for the whole session before we touch anything
let hits = 0;
await p.route('**/rest/v1/rpc/set_distributor_status*', async (route) => {
  hits++;
  console.log('  >> BLOCKED set_distributor_status (never reaches DB). body=', route.request().postData());
  await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST000', message: 'injected failure (audit A22)' }) });
});
await signIn(p, { landingPath: '/admin', phone: '+256700000041' });
await p.waitForTimeout(4000);
await p.getByRole('button', { name: /^Distributor Network$/ }).first().click();
await p.waitForTimeout(1200);
await p.getByRole('button', { name: /^Distributors Network operators/ }).first().click();
await p.waitForTimeout(9000);
const t0 = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g,' ');
console.log('URL', p.url());
console.log('PAGE:', t0.slice(0, 700));
const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e=>e.offsetParent!==null).map(e=>(e.getAttribute('aria-label')||e.innerText||'').trim().replace(/\s+/g,' ').slice(0,45)));
console.log('BUTTONS:', JSON.stringify(btns));
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/admin-distributors.png', fullPage: true });
await b.close(); process.exit(0);
