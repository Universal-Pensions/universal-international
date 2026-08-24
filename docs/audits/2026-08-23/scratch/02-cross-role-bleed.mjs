import { chromium } from 'playwright';
import { signIn } from './lib.mjs';

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const reqs = [];
p.on('request', (r) => { const u = r.url(); if (u.includes('/rest/v1/') || u.includes('/api/')) reqs.push(u); });

await signIn(p, { landingPath: '/admin', phone: '+256700000041' });
await p.waitForTimeout(6000);
console.log('=== ADMIN dashboard url:', p.url());
const adminText = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g,' ');
console.log('ADMIN TEXT:', adminText.slice(0, 1200));
await p.evaluate(() => { window.__auditMark = 'ADMIN_SESSION'; });
console.log('ADMIN role in LS:', await p.evaluate(() => JSON.parse(localStorage.getItem('upensions_auth')||'{}').role));

// browser BACK
await p.goBack();
await p.waitForTimeout(2000);
console.log('AFTER BACK url:', p.url(), 'mark survives:', await p.evaluate(() => window.__auditMark));

// client-side nav to Distributors landing
const link = p.getByRole('link', { name: /^Distributors$/ }).first();
if (await link.isVisible().catch(()=>false)) {
  await link.click();
  await p.waitForTimeout(1500);
}
console.log('AFTER NAV url:', p.url(), 'mark survives:', await p.evaluate(() => window.__auditMark));
await b.close();
process.exit(0);
