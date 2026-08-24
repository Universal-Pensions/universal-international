import { ctx, adminLogin, BASE, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(375, 812);
async function go(name, path, wait=4000){ errors.length=0; await page.goto(BASE+path,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(wait); await page.screenshot({path:`${SHOT}/m-${name}-375.png`,fullPage:true}); const t=await bodyText(page); console.log(`\n## ${name} [${path}] -> ${page.url()}`); console.log('ERR',JSON.stringify(errors.slice(0,4))); console.log('TXT',t.slice(0,260).replace(/\s+/g,' ')); return t; }
try {
  await adminLogin(page);
  // reports list -> click a report to learn a reportId
  await page.goto(BASE+'/dashboard/reports',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(3500);
  const rlink = page.getByText(/Distribution Summary/i).first();
  if (await rlink.count()){ await rlink.click(); await page.waitForTimeout(3500); }
  console.log('REPORT URL after click:', page.url());
  await page.screenshot({path:`${SHOT}/m-report-view-375.png`,fullPage:true});
  const rt = await bodyText(page); console.log('REPORT TXT', rt.slice(0,240).replace(/\s+/g,' '));
  // support ticket
  await page.goto(BASE+'/dashboard/support',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(3500);
  const tlink = page.locator('a[href*="/support/"], button').filter({hasText:/invoice|billing|urgent|run/i}).first();
  if (await tlink.count()){ await tlink.click(); await page.waitForTimeout(2500); }
  console.log('SUPPORT URL after click:', page.url());
  await page.screenshot({path:`${SHOT}/m-support-thread-375.png`,fullPage:true});
  const st = await bodyText(page); console.log('THREAD TXT', st.slice(0,240).replace(/\s+/g,' '));
  // distributor + employer detail money
  await go('distributor-detail2','/dashboard/distributors/d-001');
  await go('employer-detail2','/dashboard/employers/emp-001');
} catch(e){ console.log('ERR', e.message); }
finally { await b.close(); }
