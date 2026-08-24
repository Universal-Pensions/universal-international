// CHECK 5 — force (a) 500, (b) network drop, (c) 400 validation on the
// subscriber MONEY write (make_contribution). Poll continuously so the
// 3.5 s auto-dismissing toast cannot be missed.
import { browser, uiSignIn, PHONES, BASE } from './a22-lib.mjs';
import { chromium } from 'playwright';

const CASES = [
  { name: '500-server-error', h: r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code:'PGRST000', message:'unexpected error while executing make_contribution' }) }) },
  { name: 'network-drop',     h: r => r.abort('failed') },
  { name: '400-validation',   h: r => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code:'22023', message:'amount must be greater than zero' }) }) },
];

for (const c of CASES) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await uiSignIn(p, { landingPath: '/', phone: PHONES.subscriber });
  await p.goto(BASE + '/dashboard/save', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(7000);
  const balBefore = ((await p.evaluate(() => document.body.innerText)).match(/UGX [\d,]{7,}/g) || []).slice(0,3);
  let hits = 0;
  await p.route('**/rest/v1/rpc/make_contribution*', async r => { hits++; await new Promise(x=>setTimeout(x,600)); await c.h(r); });
  await p.getByRole('button', { name: /^Top up extra$/ }).first().click().catch(()=>{});
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: /^Top up UGX/ }).first().click().catch(e=>console.log('step2:', e.message.slice(0,60)));
  await p.waitForTimeout(900);
  const pay = p.getByRole('button', { name: /^Confirm & pay$/ }).first();
  console.log(`\n=== MONEY WRITE — ${c.name} ===`);
  console.log('balances before:', JSON.stringify(balBefore));
  console.log('pay button present:', await pay.count());
  await pay.click().catch(e=>console.log('pay click:', e.message.slice(0,60)));
  const frames = []; const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    frames.push({ t: Date.now()-t0,
      toasts: await p.evaluate(()=>[...document.querySelectorAll('[class*="toast" i],[role="status"],[role="alert"]')].map(e=>(e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean)),
      url: p.url().replace(BASE,''),
      head: (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(60, 200) });
    await p.waitForTimeout(200);
  }
  const cmp = frames.filter((x,i)=>i===0||JSON.stringify(x.toasts)!==JSON.stringify(frames[i-1].toasts)||x.url!==frames[i-1].url||x.head!==frames[i-1].head);
  console.log('intercepts:', hits);
  cmp.forEach(x=>console.log(`  +${x.t}ms url=${x.url} toasts=${JSON.stringify(x.toasts)}\n        head="${x.head}"`));
  const anyErr = frames.some(f => f.toasts.some(t=>/could not|couldn.t|fail|error|try again|unable/i.test(t)) || /could not|couldn.t|fail|try again|unable/i.test(f.head));
  console.log('USER SAW AN ERROR:', anyErr ? 'YES' : '*** NO — SILENT FAILURE ***');
  await p.screenshot({ path: `docs/audits/2026-08-23/scratch/a22-money-${c.name}.png` });
  await b.close();
}
process.exit(0);
