// CHECK 3 — cross-role cache bleed. Distributor -> logout -> Admin in ONE tab.
// Both roles read the SAME query key ['entityMetrics','country','ug'] with
// different RLS-scoped results, so a retained cache is directly visible.
import { browser, uiSignIn, PHONES, BASE } from './a22-lib.mjs';

const { b, ctx } = await browser();
const p = await ctx.newPage();
const reqs = [];
p.on('request', r => { const u = r.url(); if (u.includes('/rest/v1/')) reqs.push(r.method()+' '+u.split('/rest/v1/')[1].split('?')[0]); });

async function metricsRpcCount() { return reqs.filter(r => r.includes('get_entity_metrics_rollup')).length; }

console.log('--- session 1: distributor ---');
await uiSignIn(p, { landingPath: '/distributors', phone: PHONES.distributor });
await p.waitForTimeout(7000);
const distText = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
console.log('distributor rollup rpc calls:', await metricsRpcCount());
console.log('DISTRIBUTOR overview text (first 700):', distText.slice(0, 700));
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-bleed-1-distributor.png' });

// logout through the UI
console.log('--- logging out via UI ---');
const before = reqs.length;
await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button,[role="button"],a')];
  const t = btns.find(e => /log ?out|sign ?out/i.test(e.innerText || e.getAttribute('aria-label') || ''));
  if (t) { t.click(); return 'clicked:' + (t.innerText||'').trim(); }
  return 'NOT FOUND';
}).then(r => console.log('logout control:', r));
await p.waitForTimeout(2500);
console.log('url after logout:', p.url());
console.log('token after logout:', await p.evaluate(() => localStorage.getItem('upensions_token')));
console.log('auth after logout:', await p.evaluate(() => localStorage.getItem('upensions_auth')));

console.log('--- session 2: admin, SAME TAB, no reload ---');
reqs.length = 0;
await uiSignIn(p, { landingPath: '/admin', phone: PHONES.admin });
await p.waitForTimeout(8000);
const adminText = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
console.log('admin rollup rpc calls in session 2:', await metricsRpcCount());
console.log('ALL rest calls in session 2:', JSON.stringify([...new Set(reqs)]));
console.log('ADMIN overview text (first 700):', adminText.slice(0, 700));
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-bleed-2-admin.png' });

const num = (s, label) => { const m = s.match(new RegExp(label + '[^0-9]{0,30}([0-9][0-9,\\.]*)', 'i')); return m ? m[1] : null; };
console.log('distributor subscribers-ish:', num(distText,'Subscribers'), ' admin:', num(adminText,'Subscribers'));
await b.close(); process.exit(0);
