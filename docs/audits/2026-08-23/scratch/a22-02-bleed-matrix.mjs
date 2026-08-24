// CHECK 3 (cont) — bleed matrix. admin->distributor, admin->subscriber,
// employer->branch. One tab, real UI logout between each.
import { browser, uiSignIn, PHONES } from './a22-lib.mjs';

const LANDING = { distributor: '/distributors', admin: '/admin', subscriber: '/', employer: '/employers', branch: '/distributors', agent: '/' };
const pairs = [['admin','distributor'], ['admin','subscriber'], ['employer','branch']];

const { b, ctx } = await browser();
for (const [a, c] of pairs) {
  const p = await ctx.newPage();
  const reqs = [];
  p.on('request', r => { const u = r.url(); if (u.includes('/rest/v1/')) reqs.push(u.split('/rest/v1/')[1].split('?')[0]); });
  console.log(`\n===== ${a} -> ${c} =====`);
  await uiSignIn(p, { landingPath: LANDING[a], phone: PHONES[a] });
  await p.waitForTimeout(7000);
  const t1 = (await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '))).slice(0, 420);
  console.log('[' + a + '] ' + t1);
  await p.evaluate(() => {
    const t = [...document.querySelectorAll('button,[role="button"],a')].find(e => /log ?out|sign ?out/i.test(e.innerText || e.getAttribute('aria-label') || ''));
    if (t) t.click();
  });
  await p.waitForTimeout(2500);
  const ls = await p.evaluate(() => Object.keys(localStorage));
  console.log('localStorage keys after logout:', JSON.stringify(ls));
  reqs.length = 0;
  await uiSignIn(p, { landingPath: LANDING[c], phone: PHONES[c] });
  await p.waitForTimeout(8000);
  const t2 = (await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '))).slice(0, 420);
  console.log('[' + c + '] ' + t2);
  console.log('rest calls after switch (' + reqs.length + '):', JSON.stringify([...new Set(reqs)].slice(0,20)));
  await p.close();
}
await b.close(); process.exit(0);
