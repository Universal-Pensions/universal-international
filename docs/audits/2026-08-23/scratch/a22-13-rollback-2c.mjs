import { seed, BASE } from './a22-lib.mjs';
import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await seed(ctx, 'agent');
const p = await ctx.newPage();
await p.goto(BASE + '/dashboard/subscribers/s-0001/schedule', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
for (let i = 0; i < 6; i++) await p.locator(`input[name="otp-${i}"]`).fill('123456'[i]);
await p.locator('button:visible', { hasText: /verify/i }).first().click();
await p.waitForTimeout(5000);
console.log('=== 2c after OTP ===');
console.log((await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(60, 800));
const inputs = await p.evaluate(()=>[...document.querySelectorAll('input,select')].filter(e=>e.offsetParent).map(e=>({t:e.type,v:e.value,n:e.name||e.id})));
console.log('inputs:', JSON.stringify(inputs));
const btns = await p.evaluate(()=>[...document.querySelectorAll('button')].filter(e=>e.offsetParent).map(e=>(e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean));
console.log('buttons:', JSON.stringify(btns.slice(0,25)));

let hits = 0;
await p.route('**/rest/v1/**', async route => {
  const r = route.request();
  if (r.method() !== 'GET' && !/rpc\/(get|list)_/.test(r.url())) {
    hits++; console.log('  >> blocked write:', r.method(), r.url().split('/rest/v1/')[1].split('?')[0], (r.postData()||'').slice(0,140));
    await new Promise(x=>setTimeout(x, 700));
    return route.fulfill({ status: 500, contentType:'application/json', body:'{"message":"injected 500 — schedule write"}' });
  }
  return route.continue();
});
// change the amount
const amt = p.locator('input:visible').filter({ hasNot: p.locator('[name^="otp"]') }).first();
const all = await p.locator('input:visible').all();
for (const el of all) {
  const n = await el.getAttribute('name');
  if (n && n.startsWith('otp')) continue;
  const t = await el.getAttribute('type');
  if (t === 'text' && (await el.getAttribute('placeholder') || '').includes('Ask')) continue;
  const v = await el.inputValue();
  console.log('editing input name=' + n + ' type=' + t + ' value=' + v);
  if (/^\d[\d,]*$/.test(v.replace(/[^0-9,]/g,'')) || t === 'number') { await el.fill('123456'); break; }
}
await p.waitForTimeout(400);
const save = p.locator('button:visible', { hasText: /save|update|confirm|apply/i }).first();
console.log('save btn:', await save.count() ? (await save.innerText()).trim() : 'NONE');
if (await save.count()) {
  await save.click();
  const out = []; const t0 = Date.now();
  while (Date.now() - t0 < 7000) {
    out.push({ t: Date.now()-t0,
      toasts: await p.evaluate(()=>[...document.querySelectorAll('[class*="toast" i],[role="status"],[role="alert"]')].map(e=>(e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean)),
      url: p.url() });
    await p.waitForTimeout(180);
  }
  const c = out.filter((x,i)=>i===0||JSON.stringify(x.toasts)!==JSON.stringify(out[i-1].toasts)||x.url!==out[i-1].url);
  console.log('write intercepts:', hits);
  c.forEach(x=>console.log(`  +${x.t}ms url=${x.url.replace('http://localhost:5173','')} toasts=${JSON.stringify(x.toasts)}`));
  console.log('final screen:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(60,520));
}
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-rollback-2c-done.png' });
await b.close(); process.exit(0);
