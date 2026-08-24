import { ctx, adminLogin, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(1440, 950);
try {
  await adminLogin(page);
  await page.waitForTimeout(1200);
  const mv = page.getByRole('button',{name:/^Map view$/i}).first();
  if (await mv.count()){ await mv.click(); await page.waitForTimeout(2500); }
  await page.screenshot({path:`${SHOT}/desktop-mapview-1440.png`});
  for (const label of ['All data','Distributors','Employers']){
    const pill = page.getByText(new RegExp('^'+label+'$','i')).first();
    if (await pill.count()){ await pill.click(); await page.waitForTimeout(1500); const t=await bodyText(page); const fum=t.match(/FUNDS UNDER MANAGEMENT[\s\S]{0,70}|Assets Under Management[\s\S]{0,70}|AUM[\s\S]{0,40}/i); console.log(`scope=${label}:`, fum?fum[0].replace(/\s+/g,' '):'(no AUM)'); await page.screenshot({path:`${SHOT}/desktop-mapscope-${label.replace(/\s/g,'')}-1440.png`}); }
    else console.log(`pill ${label} not found`);
  }
  console.log('ERR', JSON.stringify(errors.slice(0,5)));
} catch(e){ console.log('ERR', e.message); }
finally { await b.close(); }
