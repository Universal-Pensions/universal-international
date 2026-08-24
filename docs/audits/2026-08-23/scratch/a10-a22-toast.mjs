import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, ctx, page } = await launch(1440, 950);
let aborted = 0;
await ctx.route('**/rpc/make_contribution', route => { aborted++; route.abort('failed'); });
try {
  await loginSubscriber(page, '+256711000001', '123456');
  await page.goto(BASE + '/dashboard/save', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: /^5K$/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Top up UGX/i }).click();   // -> confirm
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Confirm & pay$/i }).click(); // -> write (aborted)
  await page.waitForTimeout(3500);
  console.log('make_contribution aborted count:', aborted);
  const body = await page.innerText('body');
  const lines = body.split('\n').map(s=>s.trim()).filter(Boolean);
  const errLine = lines.find(l => /failed to fetch|could not|unexpected|reach server|typeerror|error/i.test(l));
  console.log('ERROR TOAST LINE:', JSON.stringify(errLine || '(none)'));
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/subscriber/a10-a22-topup-neterror.png' });
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
