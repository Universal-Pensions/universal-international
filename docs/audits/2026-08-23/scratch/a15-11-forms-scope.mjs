import { ctx, adminLogin, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(1440, 950);
try {
  await adminLogin(page);
  await page.waitForTimeout(1500);
  // ---- SCOPE FILTER (All/Distributors/Employers) ----
  const scopeBtns = await page.evaluate(()=>Array.from(document.querySelectorAll('button,[role=tab],[role=radio]')).map(e=>(e.innerText||'').trim()).filter(t=>/^(All|Distributors?|Employers?|Direct)$/i.test(t)));
  console.log('SCOPE controls found:', JSON.stringify([...new Set(scopeBtns)]));
  for (const label of ['Distributors','Employers','All']) {
    const btn = page.getByRole('button',{name:new RegExp('^'+label+'$','i')}).first();
    if (await btn.count()){ await btn.click(); await page.waitForTimeout(1200); await page.screenshot({path:`${SHOT}/desktop-scope-${label.toLowerCase()}-1440.png`}); const t=await bodyText(page); const fum=t.match(/FUNDS UNDER MANAGEMENT[\s\S]{0,60}/i); console.log(`scope=${label}:`, fum?fum[0].replace(/\s+/g,' '):'(no FUM)'); }
    else console.log(`scope ${label}: button not found`);
  }
  // ---- CREATE DISTRIBUTOR (view only) ----
  await page.getByRole('button',{name:/Distributor Network/i}).first().click(); await page.waitForTimeout(1500);
  let newBtn = page.getByRole('button',{name:/^New$|New distributor|Add distributor/i}).first();
  if (await newBtn.count()){ await newBtn.click(); await page.waitForTimeout(1200); await page.screenshot({path:`${SHOT}/desktop-create-distributor-1440.png`}); const t=await bodyText(page); console.log('CREATE DISTRIBUTOR modal:', /create distributor|new distributor|Region|Contact/i.test(t)?'OPEN':'?', t.slice(0,160).replace(/\s+/g,' ')); 
    // close without submit
    const esc = page.getByRole('button',{name:/Close|Cancel/i}).first(); if(await esc.count()) await esc.click(); await page.keyboard.press('Escape').catch(()=>{});
  } else console.log('New distributor button not found');
  // ---- CREATE EMPLOYER (view only) ----
  await page.getByRole('button',{name:/^Employers$/i}).first().click(); await page.waitForTimeout(1500);
  let newE = page.getByRole('button',{name:/^New$|New employer|Add employer/i}).first();
  if (await newE.count()){ await newE.click(); await page.waitForTimeout(1200); await page.screenshot({path:`${SHOT}/desktop-create-employer-1440.png`}); const t=await bodyText(page); console.log('CREATE EMPLOYER modal:', t.slice(0,160).replace(/\s+/g,' ')); }
  else console.log('New employer button not found');
  console.log('ERR', JSON.stringify(errors.slice(0,6)));
} catch(e){ console.log('ERR', e.message); }
finally { await b.close(); }
