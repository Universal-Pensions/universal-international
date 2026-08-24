import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const OUT='docs/audits/2026-08-23/screenshots/public';
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
const netLog=[];
page.on('response',async r=>{ if(r.url().includes('/access-request')) netLog.push(r.status()+' '+(await r.text().catch(()=>''))); });
const TAG='A16AUDIT DELETEME';
try{
  await page.goto(BASE+'/request-access',{waitUntil:'networkidle'});
  await page.locator('#ra-org').fill(TAG+' Ltd');
  await page.locator('#ra-registrationNo').fill('80020009999999');
  await page.locator('#ra-name').fill('A16 Audit Bot');
  await page.locator('#ra-email').fill('a16-audit-delete@example.com');
  await page.locator('#ra-phone').fill('0771000999');
  await page.locator('#ra-sector').fill('Testing');
  await page.locator('#ra-district').fill('Kampala');
  await page.screenshot({path:`${OUT}/request-access-filled-1440.png`});
  await page.getByRole('button',{name:/request access/i}).click();
  await page.getByText(/request received/i).waitFor({timeout:15000});
  await page.screenshot({path:`${OUT}/request-access-success-1440.png`});
  console.log('SUCCESS screen shown. netLog:',netLog.join(' || '));
}catch(e){console.log('ERR',e.message.slice(0,160),'netLog:',netLog.join(' || '));}
await browser.close();
