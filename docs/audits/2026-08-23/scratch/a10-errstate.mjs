import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, ctx, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  // Now abort the currentSubscriber read RPC/table fetch and reload Home
  await ctx.route('**/rest/v1/subscribers**', route => route.abort('failed'));
  await page.goto(BASE + '/dashboard', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(4000);
  const body = (await page.innerText('body')).replace(/\n+/g,' | ');
  const errBoundary = await page.getByText(/something went wrong/i).count();
  const errCard = /couldn't load|could not load|try again|retry|unavailable|error/i.test(body);
  console.log('HomePage w/ subscribers read aborted:');
  console.log('  ErrorBoundary crash:', errBoundary, '| graceful error UI present:', errCard);
  console.log('  body:', body.slice(0,200));
  await page.screenshot({path:'docs/audits/2026-08-23/screenshots/subscriber/a10-home-errorstate-d.png', fullPage:true});
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
