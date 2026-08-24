import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, ctx, page } = await launch(1440, 950);
await ctx.route('**/rpc/make_contribution', route => route.abort('failed'));
try {
  await loginSubscriber(page, '+256711000001', '123456');
  await page.goto(BASE + '/dashboard/save', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /^5K$/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Top up UGX/i }).click(); // -> confirm
  await page.waitForTimeout(1200);
  const btns = await page.$$eval('button', els=>els.map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim().replace(/\n+/g,' ')).filter(Boolean));
  console.log('CONFIRM-STEP BUTTONS:', JSON.stringify(btns));
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
