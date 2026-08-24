import { ctx, adminLogin, BASE, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(375, 812);
try {
  await adminLogin(page);
  await page.goto(BASE+'/dashboard/subscribers',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(5000);
  // Click the first subscriber row
  const before = await bodyText(page);
  console.log('LIST top:', before.slice(0,180).replace(/\s+/g,' '));
  // rows are buttons/links with the subscriber name+amount
  const row = page.getByText(/Brian Okello/i).first();
  await row.click();
  await page.waitForTimeout(800);
  const t1 = await bodyText(page);
  const m1 = t1.match(/BALANCE[\s\S]{0,80}/i);
  console.log('DETAIL @0.8s (first paint via router state):', m1?m1[0].replace(/\s+/g,' '):'(no BALANCE)');
  await page.waitForTimeout(4000);
  const t2 = await bodyText(page);
  const m2 = t2.match(/Balance[\s\S]{0,90}/i);
  console.log('DETAIL @5s (after useEntity refetch):', m2?m2[0].replace(/\s+/g,' '):'(no Balance)');
  console.log('URL:', page.url());
  await page.screenshot({path:`${SHOT}/m-subscriber-detail-fromlist-375.png`, fullPage:true});
  console.log('ERR:', JSON.stringify(errors.slice(0,5)));
} catch(e){ console.log('ERR', e.message); }
finally { await b.close(); }
