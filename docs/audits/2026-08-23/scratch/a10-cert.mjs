import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, ctx, page } = await launch(1440, 950);
const popups = [];
ctx.on('page', p => popups.push(p));
try {
  await loginSubscriber(page, '+256711000001', '123456');
  await page.goto(BASE + '/dashboard/policies', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const certBtns = page.getByRole('button', { name: /download certificate/i });
  const n = await certBtns.count();
  console.log('Download certificate buttons:', n);
  // Click the first
  await certBtns.first().click();
  await page.waitForTimeout(2500);
  console.log('New tabs/popups opened:', popups.length);
  for (const p of popups) {
    try {
      console.log('  popup url:', p.url(), '| body chars:', (await p.evaluate(()=>document.body?document.body.innerText.length:'-')));
      await p.screenshot({ path: 'docs/audits/2026-08-23/screenshots/subscriber/a10-cert-blank-tab.png' });
    } catch(e){ console.log('  popup read err', e.message.slice(0,80)); }
  }
  const body = await page.innerText('body');
  const toast = (body.match(/[^\n|]*allow pop-ups[^\n|]*/i) || [''])[0].trim();
  console.log('Toast on policies page:', JSON.stringify(toast));
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/subscriber/a10-cert-toast.png' });
} catch (e) { console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
