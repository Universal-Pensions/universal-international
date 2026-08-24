import { seed, BASE } from './a22-lib.mjs';
import { chromium } from 'playwright';
const sample = async (p, ms, fn) => {
  const out = []; const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const toasts = await p.evaluate(() => [...document.querySelectorAll('[class*="toast" i],[role="status"],[role="alert"]')].map(e=>(e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean));
    out.push({ t: Date.now()-t0, v: await fn(p), toasts });
    await p.waitForTimeout(150);
  }
  return out;
};
/* ---- 2b ---- */
{
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await seed(ctx, 'admin');
  const p = await ctx.newPage();
  let hits = 0;
  await p.route('**/rest/v1/rpc/set_distributor_status**', async r => { hits++; await new Promise(x=>setTimeout(x,700)); return r.fulfill({ status: 500, contentType:'application/json', body:'{"message":"injected 500 — set_distributor_status"}' }); });
  await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500);
  await p.evaluate(()=>{const t=[...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).find(e=>/^Distributor Network$/i.test((e.innerText||'').trim().split('\n')[0]));if(t)t.click();});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{const t=[...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).find(e=>/^Distributors$/i.test((e.innerText||'').trim().split('\n')[0]));if(t)t.click();});
  await p.waitForTimeout(5000);
  const pill = pg => pg.evaluate(() => { const m = document.body.innerText.replace(/\s+/g,' ').match(/Karamoja Pilot Network[^]{0,140}?(ACTIVE|INACTIVE)/); return m?m[1]:null; });
  console.log('\n=== 2b useSetDistributorStatus (admin) ===');
  console.log('pill BEFORE:', await pill(p));
  await p.locator('button:visible', { hasText: /^Deactivate$/ }).last().click();
  await p.waitForTimeout(900);
  await p.locator('button:visible', { hasText: /^Deactivate$/ }).last().click();
  const s = await sample(p, 7000, pill);
  const compact = s.filter((x,i)=>i===0 || x.v!==s[i-1].v || JSON.stringify(x.toasts)!==JSON.stringify(s[i-1].toasts));
  console.log('rpc intercepts:', hits);
  compact.forEach(x=>console.log(`  +${x.t}ms pill=${x.v} toasts=${JSON.stringify(x.toasts)}`));
  console.log('pill FINAL:', await pill(p));
  await b.close();
}
/* ---- 2c ---- */
{
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await seed(ctx, 'agent');
  const p = await ctx.newPage();
  await p.goto(BASE + '/dashboard/subscribers/s-0001/schedule', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(7000);
  console.log('\n=== 2c useUpdateSubscriberSchedule (agent) ===');
  console.log('page:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(60, 700));
  const inputs = await p.evaluate(()=>[...document.querySelectorAll('input,select')].filter(e=>e.offsetParent).map(e=>({t:e.type,v:e.value,n:e.name||e.id,ph:e.placeholder})));
  console.log('inputs:', JSON.stringify(inputs));
  const btns = await p.evaluate(()=>[...document.querySelectorAll('button')].filter(e=>e.offsetParent).map(e=>(e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean));
  console.log('buttons:', JSON.stringify(btns.slice(0,25)));
  let hits=0;
  await p.route('**/rest/v1/**', async route => {
    const r = route.request();
    if (r.method()!=='GET' && !/rpc\/(get|list)_/.test(r.url())) { hits++; console.log('  >> blocked write:', r.method(), r.url().split('/rest/v1/')[1].split('?')[0], (r.postData()||'').slice(0,120));
      await new Promise(x=>setTimeout(x,700));
      return route.fulfill({ status:500, contentType:'application/json', body:'{"message":"injected 500 — schedule write"}' }); }
    return route.continue();
  });
  const amt = p.locator('input[type="number"]:visible, input[inputmode="numeric"]:visible').first();
  const freqSel = p.locator('select:visible').first();
  if (await amt.count()) { console.log('amount before:', await amt.inputValue()); await amt.fill('123456'); }
  else if (await freqSel.count()) { await freqSel.selectOption({ index: 1 }); }
  await p.waitForTimeout(400);
  const save = p.locator('button:visible', { hasText: /save|update|confirm/i }).first();
  if (await save.count()) {
    await save.click();
    const s = await sample(p, 7000, pg => pg.evaluate(()=> { const m=document.body.innerText.replace(/\s+/g,' ').match(/AMOUNT\s+UGX\s+([\d,]+)/i)||document.body.innerText.replace(/\s+/g,' ').match(/FREQUENCY\s+(\w+)/i); return m?m[1]:null; }));
    const c = s.filter((x,i)=>i===0||x.v!==s[i-1].v||JSON.stringify(x.toasts)!==JSON.stringify(s[i-1].toasts));
    console.log('write intercepts:', hits);
    c.forEach(x=>console.log(`  +${x.t}ms shown=${x.v} toasts=${JSON.stringify(x.toasts)}`));
  } else console.log('no save button');
  await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-rollback-2c-final.png' });
  await b.close();
}
process.exit(0);
