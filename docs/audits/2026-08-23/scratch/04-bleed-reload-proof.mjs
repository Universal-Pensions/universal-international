import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const post = [];
await signIn(p, { landingPath: '/admin', phone: '+256700000041' });
await p.waitForTimeout(7000);
await p.goBack(); await p.waitForTimeout(1200);
await p.getByRole('link', { name: /^Distributors$/ }).first().click(); await p.waitForTimeout(1200);
p.on('request', (r) => { const u = r.url(); if (u.includes('/rest/v1/')) post.push(u.split('/rest/v1/')[1].split('?')[0]); });
await signIn(p, { landingPath: '/distributors', phone: '+256700000021' }, { noGoto: true });
await p.waitForTimeout(8000);
const grab = () => p.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g,' ');
  const pick = (re) => (t.match(re) || [null,null])[1];
  return {
    branches: pick(/·\s*([\d,]+)\s*branches/),
    fum: pick(/FUNDS UNDER MANAGEMENT\s*([^ ]+ [\d.]+B)/),
    subs: pick(/SUBSCRIBERS\s*([\d,]+)/),
    agents: pick(/AGENTS\s*([\d,]+)/),
    contrib: pick(/CONTRIBUTIONS\s*(UGX [\d.]+B)/),
  };
});
console.log('AFTER ROLE-SWITCH (no reload):', JSON.stringify(await grab()));
console.log('PostgREST calls made after distributor login:', [...new Set(post)].join(', ') || '(none)');
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(9000);
console.log('AFTER HARD RELOAD (same distributor JWT):', JSON.stringify(await grab()));
await b.close(); process.exit(0);
