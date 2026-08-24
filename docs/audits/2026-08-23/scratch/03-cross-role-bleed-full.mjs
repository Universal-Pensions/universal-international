import { chromium } from 'playwright';
import { signIn } from './lib.mjs';

const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
const reqs = [];
p.on('request', (r) => { const u = r.url(); if (u.includes('/rest/v1/')) reqs.push(u); });

// ── 1. sign in as ADMIN from the /admin landing card
await signIn(p, { landingPath: '/admin', phone: '+256700000041' });
await p.waitForTimeout(7000);
const adminText = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
console.log('[1] ADMIN /dashboard =', adminText.slice(0, 420));
await p.evaluate(() => { window.__auditMark = 'ADMIN_SESSION'; });

// ── 2. browser BACK → /admin landing (no auth guard), still same SPA instance
await p.goBack();
await p.waitForTimeout(1500);
console.log('[2] back ->', p.url(), '| SPA intact:', await p.evaluate(() => window.__auditMark));

// ── 3. client-side nav to the Distributors landing
await p.getByRole('link', { name: /^Distributors$/ }).first().click();
await p.waitForTimeout(1500);
console.log('[3] nav ->', p.url(), '| SPA intact:', await p.evaluate(() => window.__auditMark));

// ── 4. sign in as DISTRIBUTOR d-001 from that page — no logout in between
reqs.length = 0;
await signIn(p, { landingPath: '/distributors', phone: '+256700000021' }, { noGoto: true });
console.log('[4] logged in, url =', p.url(), '| SPA intact (NO page reload):', await p.evaluate(() => window.__auditMark));
console.log('[4] LS role now =', await p.evaluate(() => JSON.parse(localStorage.getItem('upensions_auth') || '{}').role));
await p.waitForTimeout(7000);
const distText = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
console.log('[5] DISTRIBUTOR /dashboard =', distText.slice(0, 1400));
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/bleed-distributor-after-admin.png', fullPage: true });

// control: fresh context, distributor only
const ctx2 = await b.newContext();
const p2 = await ctx2.newPage();
await signIn(p2, { landingPath: '/distributors', phone: '+256700000021' });
await p2.waitForTimeout(7000);
const cleanText = (await p2.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
console.log('[6] CONTROL distributor-only /dashboard =', cleanText.slice(0, 1400));
await p2.screenshot({ path: 'docs/audits/2026-08-23/scratch/control-distributor-clean.png', fullPage: true });

await b.close();
process.exit(0);
