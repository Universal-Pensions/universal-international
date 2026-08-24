import { launch, loginSubscriber, BASE } from './a10-login.mjs';
for (const W of [375, 1440]) {
  const { b, page } = await launch(W, W<700?812:950);
  try {
    await loginSubscriber(page, '+256711000001', '123456');
    await page.goto(BASE + '/dashboard/withdraw/claim', { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(5000);
    const body = (await page.innerText('body')).replace(/\n+/g,' | ');
    const noCover = /no active cover|nothing to claim|no active policy/i.test(body);
    const claimable = /claim|nights|hospital/i.test(body);
    console.log(`W=${W} noCover=${noCover} :: ${body.slice(0,220)}`);
    await page.screenshot({path:`docs/audits/2026-08-23/screenshots/subscriber/a10-claim-settled-${W<700?'m':'d'}.png`, fullPage:true});
  } catch(e){ console.log('W='+W+' ERR', e.message.slice(0,150)); }
  finally { await b.close(); }
}
