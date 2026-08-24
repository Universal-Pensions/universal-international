// CHECK 2 — optimistic rollback under a forced server failure, for the three
// hook families named in the spec: useSubscriber, useEntity, useAgent.
import { browser, uiSignIn, PHONES, BASE } from './a22-lib.mjs';
const { b, ctx } = await browser();

/* ---------- 2a  useUpdateProfile  (src/hooks/useSubscriber.js:263) ---------- */
{
  const p = await ctx.newPage();
  await uiSignIn(p, { landingPath: '/', phone: PHONES.subscriber });
  await p.waitForTimeout(3000);
  await p.goto(BASE + '/dashboard/settings/profile', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  const emailBox = p.locator('input[type="email"]:visible').first();
  const before = await emailBox.inputValue();
  console.log('\n=== 2a useUpdateProfile ===');
  console.log('email BEFORE:', before);
  let hits = 0;
  await p.route('**/rest/v1/subscribers**', async (route) => {
    if (route.request().method() === 'PATCH') { hits++; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'injected 500' }) }); }
    return route.continue();
  });
  await emailBox.fill('a22-optimistic-probe@example.invalid');
  await p.waitForTimeout(400);
  const optimistic = await emailBox.inputValue();
  const saveBtn = p.locator('button:visible', { hasText: /save/i }).first();
  console.log('save button:', await saveBtn.count() ? (await saveBtn.innerText()).trim() : 'NOT FOUND');
  await saveBtn.click();
  await p.waitForTimeout(3500);
  const after = await emailBox.inputValue();
  const body = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  const toast = (body.match(/(could not|couldn.t|failed|error)[^.]{0,70}/i) || [])[0];
  console.log('PATCH intercepted:', hits);
  console.log('field after failed save:', after);
  console.log('error surfaced to user:', toast ? JSON.stringify(toast) : '*** NONE FOUND ***');
  // did the CACHE roll back? re-mount the page and re-read
  await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500);
  await p.goto(BASE + '/dashboard/settings/profile', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(5000);
  console.log('email after remount (must equal BEFORE):', await p.locator('input[type="email"]:visible').first().inputValue());
  await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-rollback-2a.png' });
  await p.close();
}

/* ---------- 2b  useSetDistributorStatus  (src/hooks/useEntity.js:598) ------- */
{
  const p = await ctx.newPage();
  let hits = 0;
  await p.route('**/rest/v1/rpc/set_distributor_status**', async (route) => {
    hits++; return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'injected 500' }) });
  });
  await uiSignIn(p, { landingPath: '/admin', phone: PHONES.admin });
  await p.waitForTimeout(4000);
  await p.evaluate(() => { const t=[...document.querySelectorAll('button,a')].find(e=>/^Distributor Network$/i.test((e.innerText||'').trim())); if(t)t.click(); });
  await p.waitForTimeout(7000);
  console.log('\n=== 2b useSetDistributorStatus ===');
  const listBefore = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  console.log('list BEFORE (300):', listBefore.slice(200, 620));
  const btns = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e=>e.offsetParent).map(e=>(e.innerText||'').trim()).filter(Boolean));
  console.log('buttons:', JSON.stringify(btns.slice(0, 25)));
  await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-rollback-2b-list.png' });
  await p.close();
}
await b.close(); process.exit(0);
