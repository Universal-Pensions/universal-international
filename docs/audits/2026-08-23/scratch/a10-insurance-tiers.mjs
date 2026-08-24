import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  await page.goto(BASE + '/dashboard/settings/insurance', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2500);
  const body = (await page.innerText('body')).replace(/\n+/g,' | ');
  console.log('INSURANCE SETTINGS:', body.slice(0, 700));
  await page.screenshot({ path:'docs/audits/2026-08-23/screenshots/subscriber/a10-insurance-settings-d.png', fullPage:true });
  // Try to open a cover-change picker to see tier options (look for a manage/change button)
  const btns = await page.$$eval('button', els=>els.map(e=>(e.innerText||'').trim().replace(/\n+/g,' ')).filter(Boolean));
  console.log('BUTTONS:', JSON.stringify([...new Set(btns)].slice(0,30)));
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
