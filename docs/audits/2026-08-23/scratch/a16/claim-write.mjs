import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const OUT='docs/audits/2026-08-23/screenshots/public';
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const netLog=[];
page.on('response',async r=>{ if(r.url().includes('/nominee-claim')) netLog.push(r.status()+' '+(await r.text().catch(()=>'')).slice(0,200)); });
try{
  await page.goto(BASE+'/claim',{waitUntil:'networkidle'});
  await page.getByRole('radio',{name:/life cover/i}).click();
  await page.locator('#nc-deceasedName').fill('A16AUDIT Deceased DELETEME');
  await page.locator('#nc-deceasedPhone').fill('0771000888');
  await page.locator('#nc-dateOfDeath').fill('2026-08-01');
  await page.locator('#nc-claimantName').fill('A16 Audit Claimant');
  await page.locator('#nc-relationship').selectOption('Child');
  await page.locator('#nc-claimantPhone').fill('0771000777');
  await page.getByRole('button',{name:/start the claim/i}).click();
  await page.getByText(/we have your claim/i).waitFor({timeout:15000});
  const ref=(await page.locator('.reference b, [class*=reference] b').first().textContent().catch(()=>''))||'';
  await page.screenshot({path:`${OUT}/claim-success-1440.png`});
  console.log('CLAIM SUCCESS. ref:',ref.trim(),'| netLog:',netLog.join(' || '));
}catch(e){console.log('ERR',e.message.slice(0,160),'| netLog:',netLog.join(' || '));}
await browser.close();
