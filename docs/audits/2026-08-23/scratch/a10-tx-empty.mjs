import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  // All Transactions
  await page.goto(BASE + '/dashboard/reports/all-transactions', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(4000);
  let body = (await page.innerText('body')).replace(/\n+/g,' | ');
  console.log('ALL-TX screen:', (body.match(/EVERY MOVEMENT[\s\S]{0,120}/i)||[''])[0].replace(/\n+/g,' '));
  console.log('  "0 of" present:', /\b0 of\b/i.test(body), '| "No transactions"/"no data":', /no transactions|nothing|no data|empty/i.test(body));
  await page.screenshot({path:'docs/audits/2026-08-23/screenshots/subscriber/a10-alltx-empty-d.png', fullPage:true});
  // Annual statement
  await page.goto(BASE + '/dashboard/reports/annual-statement', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(4000);
  body = (await page.innerText('body')).replace(/\n+/g,' | ');
  console.log('ANNUAL screen:', (body.match(/ANNUAL TAX STATEMENT[\s\S]{0,220}/i)||[''])[0].replace(/\n+/g,' '));
  await page.screenshot({path:'docs/audits/2026-08-23/screenshots/subscriber/a10-annual-zeros-d.png', fullPage:true});
  // Activity (control — uses dedicated hook, should show data)
  await page.goto(BASE + '/dashboard/activity', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(4000);
  body = (await page.innerText('body')).replace(/\n+/g,' | ');
  console.log('ACTIVITY screen (control):', (body.match(/NET THIS YEAR[\s\S]{0,80}|THIS YEAR[\s\S]{0,80}/i)||[''])[0].replace(/\n+/g,' '));
  const rowsA = await page.locator('text=/contribution|withdrawal|premium/i').count();
  console.log('  activity list mentions tx types count:', rowsA);
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
