// CHECK 3b — TWO TABS, one browser profile. Tab A = distributor session.
// Tab B signs in as ADMIN *without* logging tab A out. localStorage
// upensions_token is shared; supabaseClient's fetchWithAuth re-reads it on
// EVERY request. AuthContext's storage listener only reacts to newValue===null.
import { browser, uiSignIn, PHONES, BASE } from './a22-lib.mjs';

const { b, ctx } = await browser();
const A = await ctx.newPage();
const B = await ctx.newPage();

console.log('--- Tab A: sign in as DISTRIBUTOR ---');
await uiSignIn(A, { landingPath: '/distributors', phone: PHONES.distributor });
await A.waitForTimeout(7000);
const a1 = await A.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
console.log('TAB A (distributor) BEFORE:', a1.slice(120, 560));

console.log('\n--- Tab B: sign in as ADMIN (tab A never logged out) ---');
await uiSignIn(B, { landingPath: '/admin', phone: PHONES.admin });
await B.waitForTimeout(6000);
console.log('TAB B (admin):', (await B.evaluate(() => document.body.innerText.replace(/\s+/g,' '))).slice(120, 420));

console.log('\n--- Tab A: still alive? role in localStorage now: ---');
console.log('upensions_auth =', await A.evaluate(() => localStorage.getItem('upensions_auth')));
console.log('tab A url =', A.url());

console.log('\n--- Tab A: force a refetch by navigating within the distributor dashboard ---');
const aReqs = [];
A.on('request', r => { const u = r.url(); if (u.includes('/rest/v1/')) aReqs.push(u.split('/rest/v1/')[1].split('?')[0]); });
A.on('response', async r => {
  if (r.url().includes('get_entity_metrics_rollup')) {
    const body = await r.text().catch(() => '');
    console.log('  >> tab A get_entity_metrics_rollup response:', body.slice(0, 300));
  }
});
await A.bringToFront();
// click Subscribers then back to Overview to force fresh mounts
await A.evaluate(() => {
  const t = [...document.querySelectorAll('button,a')].find(e => /^Subscribers$/i.test((e.innerText||'').trim()));
  if (t) t.click();
});
await A.waitForTimeout(5000);
await A.evaluate(() => {
  const t = [...document.querySelectorAll('button,a')].find(e => /^Overview$/i.test((e.innerText||'').trim()));
  if (t) t.click();
});
await A.waitForTimeout(6000);
const a2 = await A.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
console.log('TAB A AFTER tab-B admin login:', a2.slice(120, 620));
console.log('tab A rest calls:', JSON.stringify([...new Set(aReqs)]));
await A.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-twotab-A-after.png' });
await b.close(); process.exit(0);
