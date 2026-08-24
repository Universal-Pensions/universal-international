import { seed, BASE } from './a22-lib.mjs';
import { chromium } from 'playwright';
async function pollToast(p, ms = 6500) {
  const seen = new Set(); const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    (await p.evaluate(() => [...document.querySelectorAll('[class*="toast" i],[role="status"],[role="alert"]')]
      .map(e => (e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean))).forEach(x=>seen.add(x));
    await p.waitForTimeout(180);
  }
  return [...seen];
}
/* 2b admin useSetDistributorStatus — click Deactivate on the 0-subscriber tenant */
{
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await seed(ctx, 'admin');
  const p = await ctx.newPage();
  let hits = 0;
  await p.route('**/rest/v1/rpc/set_distributor_status**', r => { hits++; return r.fulfill({ status: 500, contentType:'application/json', body:'{"message":"injected 500"}' }); });
  await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4500);
  await p.evaluate(()=>{const t=[...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).find(e=>/^Distributor Network$/i.test((e.innerText||'').trim().split('\n')[0]));if(t)t.click();});
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{const t=[...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).find(e=>/^Distributors$/i.test((e.innerText||'').trim().split('\n')[0]));if(t)t.click();});
  await p.waitForTimeout(5000);
  const pillOf = () => p.evaluate(() => {
    const s = document.body.innerText.replace(/\s+/g,' ');
    const m = s.match(/Karamoja Pilot Network[^]{0,120}?(ACTIVE|INACTIVE)/);
    return m ? m[1] : null;
  });
  console.log('\n=== 2b useSetDistributorStatus ===');
  console.log('Karamoja pill BEFORE:', await pillOf());
  const dbtns = p.locator('button:visible', { hasText: /^Deactivate$/ });
  console.log('deactivate buttons:', await dbtns.count());
  await dbtns.last().click();
  await p.waitForTimeout(1200);
  const dlg = await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(-600));
  console.log('confirm dialog tail:', dlg);
  const confirm = p.locator('button:visible', { hasText: /deactivate|confirm|yes/i }).last();
  await confirm.click().catch(e=>console.log('confirm click:', e.message.slice(0,80)));
  // sample the pill fast to catch the OPTIMISTIC value before rollback
  const samples = []; const t0 = Date.now();
  while (Date.now() - t0 < 6500) { samples.push(`+${Date.now()-t0}ms ${await pillOf()}`); await p.waitForTimeout(200); }
  console.log('rpc intercepts:', hits);
  console.log('pill samples:', JSON.stringify(samples.filter((v,i,a)=>i===0||v.split(' ')[1]!==a[i-1].split(' ')[1])));
  console.log('toasts:', JSON.stringify(await pollToast(p, 1500)));
  console.log('pill AFTER:', await pillOf());
  await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-rollback-2b-final.png' });
  await b.close();
}
/* 2c agent schedule */
{
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await seed(ctx, 'agent');
  const p = await ctx.newPage();
  await p.goto(BASE + '/dashboard/subscribers', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(7000);
  console.log('\n=== 2c useUpdateSubscriberSchedule ===');
  console.log('subscribers page:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(60,520));
  const clicked = await p.evaluate(() => {
    const rows=[...document.querySelectorAll('button,[role="button"],li,tr')].filter(e=>e.offsetParent && /\+256/.test(e.innerText||''));
    if(rows[0]){rows[0].click();return (rows[0].innerText||'').replace(/\s+/g,' ').slice(0,80);} return null;
  });
  console.log('clicked row:', clicked);
  await p.waitForTimeout(5000);
  console.log('url now:', p.url());
  console.log('detail:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(60,560));
  await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-agent-subscriber-detail.png' });
  await b.close();
}
process.exit(0);
