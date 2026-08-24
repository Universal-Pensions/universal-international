import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const SHOT='docs/audits/2026-08-23/screenshots/distributor';
async function signIn(page){
  await page.goto(BASE+'/distributors',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2200);
  const tel=page.locator('input[name="phone"]:visible').first(); await tel.waitFor({state:'visible',timeout:15000}); await tel.fill('700000021');
  await page.getByRole('button',{name:/send verification code/i}).first().click();
  await page.locator('input[name="otp-0"]').waitFor({state:'visible',timeout:20000});
  for(let k=0;k<6;k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button',{name:/verify/i}).first().click();
  await page.waitForURL(/\/dashboard/,{timeout:40000});
}
const b=await chromium.launch({headless:true});
const ctx=await b.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
const page=await ctx.newPage();
await signIn(page); await page.waitForTimeout(6000);
// open Commissions
await page.getByRole('button',{name:/^Commissions$/i}).first().click().catch(()=>{});
await page.waitForTimeout(4500);
await page.screenshot({path:`${SHOT}/commissions-1440.png`,fullPage:false});
const t=(await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(0,500);
console.log('COMMISSIONS panel:',t);
// look for settlement template download button
const dlBtn=await page.getByRole('button',{name:/download|template|export/i}).allInnerTexts().catch(()=>[]);
console.log('download-ish buttons:',JSON.stringify(dlBtn));
// try drilling an agent to see settlement history
const agentRow=page.getByText(/a-001|Default agent|Kampala/i).first();
console.log('agent row present:',await agentRow.count());
await b.close();
