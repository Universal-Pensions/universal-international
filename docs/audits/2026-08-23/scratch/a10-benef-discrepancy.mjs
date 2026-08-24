import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  // Nominees page
  await page.goto(BASE + '/dashboard/settings/nominees', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3000);
  const nomBody = (await page.innerText('body')).replace(/\n+/g,' | ');
  const insCount = (nomBody.match(/Insurance\s*\|\s*(\d+)/i)||[])[1];
  const insNames = (nomBody.match(/Samuel Babirye/i)||[])[0];
  console.log('NOMINEES page — Insurance count:', insCount, '| has Samuel Babirye:', !!insNames);
  await page.screenshot({path:'docs/audits/2026-08-23/screenshots/subscriber/a10-nominees-d.png', fullPage:true});
  // Insurance page — wait long to rule out timing
  await page.goto(BASE + '/dashboard/settings/insurance', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(5000);
  const insBody = (await page.innerText('body')).replace(/\n+/g,' | ');
  const onFile = (insBody.match(/Insurance beneficiaries\s*\|?\s*(\d+)\s*on file/i)||[])[1];
  console.log('INSURANCE page — beneficiaries "on file":', onFile, '| has Samuel Babirye:', /Samuel Babirye/i.test(insBody));
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
