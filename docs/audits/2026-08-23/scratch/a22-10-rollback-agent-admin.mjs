// CHECK 2b/2c — optimistic rollback for useEntity (admin distributor status)
// and useAgent (agent edits a subscriber's schedule). Sessions are seeded with
// a minted JWT (same mechanism as e2e/fixtures/auth.ts) for determinism.
import { browser, seed, BASE } from './a22-lib.mjs';
import { chromium } from 'playwright';

async function pollToast(p, ms = 6500) {
  const seen = new Set(); const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    (await p.evaluate(() => [...document.querySelectorAll('[class*="toast" i],[role="status"],[role="alert"]')]
      .map(e => (e.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean))).forEach(x => seen.add(x));
    await p.waitForTimeout(200);
  }
  return [...seen];
}

/* ---- 2c: agent useUpdateSubscriberSchedule ---- */
{
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await seed(ctx, 'agent');
  const p = await ctx.newPage();
  await p.goto(BASE + '/dashboard/subscribers', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(7000);
  const firstHref = await p.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/dashboard/subscribers/"]')].filter(e => e.offsetParent)[0];
    return a ? a.getAttribute('href') : null;
  });
  console.log('\n=== 2c useUpdateSubscriberSchedule (agent) ===');
  console.log('first subscriber href:', firstHref);
  if (firstHref) {
    await p.goto(BASE + firstHref + '/schedule', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(6000);
    const shot = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
    console.log('schedule page:', shot.slice(60, 620));
    const inputs = await p.evaluate(() => [...document.querySelectorAll('input,select')].filter(e=>e.offsetParent).map(e=>({t:e.type,v:e.value,n:e.name||e.id})));
    console.log('inputs:', JSON.stringify(inputs));
    const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e=>e.offsetParent).map(e=>(e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean));
    console.log('buttons:', JSON.stringify(btns.slice(0,20)));
    let hits = 0;
    await p.route('**/rest/v1/**', async (route) => {
      const r = route.request();
      if (['PATCH','POST'].includes(r.method()) && /subscribers|update_contribution_schedule|rpc/.test(r.url()) && !/get_|list_/.test(r.url())) {
        hits++; console.log('  >> intercepted write:', r.method(), r.url().split('/rest/v1/')[1].split('?')[0]);
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected 500"}' });
      }
      return route.continue();
    });
    // change the amount then save
    const amt = p.locator('input[type="number"]:visible, input[inputmode="numeric"]:visible').first();
    if (await amt.count()) { const b4 = await amt.inputValue(); await amt.fill('99999'); console.log('amount before/after edit:', b4, '-> 99999'); }
    const save = p.locator('button:visible', { hasText: /save|update|confirm/i }).first();
    if (await save.count()) {
      await save.click();
      const ts = await pollToast(p, 6500);
      console.log('write intercepts:', hits);
      console.log('toasts:', JSON.stringify(ts));
      console.log('screen after:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(60, 480));
    } else console.log('no save button found');
    await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-rollback-2c.png' });
  }
  await b.close();
}

/* ---- 2b: admin useSetDistributorStatus ---- */
{
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await seed(ctx, 'admin');
  const p = await ctx.newPage();
  let hits = 0;
  await p.route('**/rest/v1/rpc/set_distributor_status**', async (route) => {
    hits++; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected 500"}' });
  });
  await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5000);
  for (const label of [/^Distributor Network$/i, /^Distributors$/i]) {
    await p.evaluate((src) => {
      const re = new RegExp(src.slice(1, src.lastIndexOf('/')), 'i');
      const t = [...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).find(e => re.test((e.innerText||'').trim().split('\n')[0]));
      if (t) t.click();
    }, label.toString());
    await p.waitForTimeout(5000);
  }
  console.log('\n=== 2b useSetDistributorStatus (admin) ===');
  console.log('url:', p.url());
  const t = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  console.log('page:', t.slice(200, 800));
  const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e=>e.offsetParent).map(e=>(e.innerText||'').trim().replace(/\s+/g,' ')).filter(Boolean));
  console.log('buttons:', JSON.stringify(btns.slice(0, 30)));
  await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-rollback-2b.png' });
  await b.close();
}
process.exit(0);
