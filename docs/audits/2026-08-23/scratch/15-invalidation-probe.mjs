// Probe: after a SUCCESSFUL (faked, never reaches DB) approve_access_request,
// which reads does the app actually refetch?  Anything the write dirties but
// does not refetch is a stale-UI gap.
import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
let approveHits = 0;
await p.route('**/rest/v1/rpc/approve_access_request*', async (route) => {
  approveHits++;
  console.log('  >> FAKED SUCCESS for approve_access_request (never reaches DB). body=', route.request().postData());
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'faked', status: 'approved', kind: 'employer' }) });
});
await signIn(p, { landingPath: '/admin', phone: '+256700000041' });
await p.waitForTimeout(6000);
// baseline: read the Needs-attention chip
const chip = async () => (await p.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g,' ');
  return (t.match(/Pending access requests[^\d]{0,4}(\d+)/) || [])[1];
}));
console.log('Needs-attention "Pending access requests" =', await chip());

const rpcs = [];
p.on('request', (r) => { const u = r.url(); if (u.includes('/rest/v1/')) rpcs.push(r.method() + ' ' + u.split('/rest/v1/')[1].split('?')[0]); });

await p.getByRole('button', { name: /^Access requests$/ }).first().click();
await p.waitForTimeout(7000);
const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e=>e.offsetParent!==null).map(e=>(e.innerText||'').trim().replace(/\s+/g,' ').slice(0,30)));
console.log('buttons on access-requests page:', JSON.stringify(btns));
rpcs.length = 0;
const approve = p.getByRole('button', { name: /^Approve$/ }).first();
await approve.click();
await p.waitForTimeout(1500);
const after1 = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e=>e.offsetParent!==null).map(e=>(e.innerText||'').trim().replace(/\s+/g,' ').slice(0,30)));
console.log('buttons after first Approve click:', JSON.stringify(after1.slice(-8)));
console.log('dialog text:', (await p.evaluate(()=>document.body.innerText)).replace(/\s+/g,' ').slice(-500));
const conf = p.getByRole('button', { name: /Approve & create/ }).last();
await conf.click().catch((e)=>console.log('confirm click failed', e.message.slice(0,80)));
await p.waitForTimeout(4000);
console.log('approve intercepts:', approveHits);
console.log('READS REFETCHED AFTER APPROVE (still on Access requests page):', JSON.stringify([...new Set(rpcs)]));
rpcs.length = 0;
await p.getByRole('button', { name: /^Overview$/ }).first().click();
await p.waitForTimeout(6000);
console.log('READS REFETCHED ON RETURNING TO OVERVIEW:', JSON.stringify([...new Set(rpcs)]));
console.log('get_admin_attention refetched?', rpcs.some(r => r.includes('get_admin_attention')));
console.log('Needs-attention chip now =', await chip());
await b.close(); process.exit(0);
