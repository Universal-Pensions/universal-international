import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, ctx, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  await ctx.route('**/rest/v1/subscribers**', route => route.abort('failed'));
  await page.goto(BASE + '/dashboard', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(5000);
  // main region text
  const main = await page.locator('#main, main, [role=main]').first().innerText().catch(()=> '(no main)');
  console.log('MAIN region text:', JSON.stringify(main.replace(/\n+/g,' | ').slice(0,400)));
  // spinner / skeleton present?
  const spinner = await page.locator('[class*=spin],[class*=skeleton],[class*=Skeleton],[aria-busy=true]').count();
  console.log('spinner/skeleton/aria-busy elements:', spinner);
  // Check HomePage source handling
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
