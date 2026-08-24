import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const consoleErrs = [];
p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 160)); });

await signIn(p, { landingPath: '/distributors', phone: '+256700000021' });
await p.waitForTimeout(3000);
await p.getByText(/^Commissions$/).first().click();
await p.waitForTimeout(6000);

let intercepted = 0;
await p.route('**/rest/v1/rpc/set_commission_rate*', async (route) => {
  intercepted++;
  console.log('  >> INTERCEPTED set_commission_rate, injecting 500. body=', route.request().postData());
  await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'injected 500 (audit A22)' }) });
});

const rateBefore = await p.locator('text=/UGX \\d/').first().innerText().catch(() => 'n/a');
console.log('rate displayed BEFORE:', (await p.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g,' ');
  return (t.match(/RATE PER SUBSCRIBER ([^ ]+ [^ ]+)/) || [])[1];
})));

await p.getByLabel('Edit commission rate').click();
await p.waitForTimeout(600);
const input = p.getByLabel('Commission rate in UGX');
await input.fill('9999');
await p.getByRole('button', { name: /^Save$/ }).first().click();
await p.waitForTimeout(4000);

const after = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
console.log('intercepted count:', intercepted);
console.log('rate displayed AFTER failed save:', (after.match(/RATE PER SUBSCRIBER ([^ ]+ [^ ]+)/) || [])[1]);
console.log('any role=alert on screen:', await p.locator('[role="alert"]').count());
console.log('any toast:', await p.locator('[class*="toast" i], [class*="Toast"]').count());
console.log('page mentions error/failed/could not:', /could not|failed|error|try again/i.test(after));
console.log('console errors:', JSON.stringify(consoleErrs.slice(0, 5)));
console.log('editor still open (input present):', await input.count());
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/rate-write-500.png', fullPage: false });
await b.close(); process.exit(0);
