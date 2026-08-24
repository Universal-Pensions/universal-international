import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE='http://localhost:5173';
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
await signIn(page); await page.waitForTimeout(5000);
await page.getByRole('button',{name:/^Commissions$/i}).first().click(); await page.waitForTimeout(4000);
const dlP=page.waitForEvent('download',{timeout:20000}).catch(()=>null);
await page.getByRole('button',{name:/Download template/i}).first().click();
const dl=await dlP;
if(dl){ const p=`docs/audits/2026-08-23/scratch/settle-tmpl-${Date.now()}`; const fn=dl.suggestedFilename(); await dl.saveAs(p+'-'+fn);
  const sz=fs.statSync(p+'-'+fn).size;
  console.log('TEMPLATE DOWNLOAD ok file=',fn,'bytes=',sz);
  const head=fs.readFileSync(p+'-'+fn).slice(0,4).toString('hex'); // xlsx = 504b0304 (PK zip)
  console.log('magic=',head, head==='504b0304'?'(valid XLSX/zip)':'(other)');
  fs.unlinkSync(p+'-'+fn);
} else console.log('NO TEMPLATE DOWNLOAD EVENT');
await b.close();
