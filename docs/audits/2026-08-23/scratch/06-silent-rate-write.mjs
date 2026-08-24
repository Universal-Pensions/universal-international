import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const consoleErrs = [];
p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 140)); });

await signIn(p, { landingPath: '/distributors', phone: '+256700000021' });
await p.waitForTimeout(4000);
// go to Commissions
await p.getByRole('link', { name: /^Commissions$/ }).first().click().catch(async () => {
  await p.getByText(/^Commissions$/).first().click();
});
await p.waitForTimeout(6000);
const before = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
console.log('COMMISSIONS PAGE (excerpt):', before.slice(0, 500));

// intercept the money-config write and force a 500
let intercepted = 0;
await p.route('**/rest/v1/rpc/set_commission_rate*', async (route) => {
  intercepted++;
  await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'injected 500' }) });
});

// find the rate editor
const editBtn = p.getByRole('button', { name: /edit|change/i });
const n = await editBtn.count();
console.log('edit-ish buttons:', n);
for (let i = 0; i < n; i++) console.log('  btn:', (await editBtn.nth(i).innerText()).replace(/\s+/g,' ').slice(0,50));
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/commissions-page.png', fullPage: true });
await b.close(); process.exit(0);
