// CHECK 2a — useUpdateProfile (useSubscriber.js) optimistic patch + rollback.
import { browser, uiSignIn, PHONES, BASE } from './a22-lib.mjs';
const { b, ctx } = await browser();
const p = await ctx.newPage();
await uiSignIn(p, { landingPath: '/', phone: PHONES.subscriber });
await p.waitForTimeout(4000);
await p.goto(BASE + '/dashboard/settings/profile', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
console.log('inputs:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent).map(e=>({n:e.name||e.id,v:e.value,t:e.type})))));
console.log('buttons:', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('button')].filter(e=>e.offsetParent).map(e=>(e.innerText||'').trim()))));
console.log('head:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(0,500));
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-profile-explore.png' });
await b.close(); process.exit(0);
