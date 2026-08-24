import { chromium } from 'playwright';
import fs from 'node:fs';
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
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,150)));
await signIn(page); await page.waitForTimeout(6000);
await page.goto(`${BASE}/dashboard/reports`,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(4000);

// "More" expands full report list
const more=page.getByRole('button',{name:/^More$/i}).first();
if(await more.count()){ await more.click(); await page.waitForTimeout(1200);
  const afterMore=await page.evaluate(()=>Array.from(document.querySelectorAll('button,a')).map(e=>e.innerText.replace(/\s+/g,' ').trim()).filter(t=>/All Branches|All Agents|All Subscribers|Contributions|Withdrawals|Distribution Summary|Growth|Demographics|KYC|Branch Performance|Agent Performance/i.test(t)));
  console.log('AFTER MORE, report entries:',JSON.stringify([...new Set(afterMore)].slice(0,15)));
  await page.screenshot({path:`${SHOT}/reports-more-1440.png`,fullPage:true});
}

// open subscribers insight card -> report view with Export
const card=page.getByRole('button',{name:/SUBSCRIBERS 43% female|4,602 SUBSCRIBERS/i}).first();
console.log('subscribers card present:',await card.count());
await card.click(); await page.waitForTimeout(4500);
await page.screenshot({path:`${SHOT}/report-subscribers-view-1440.png`,fullPage:false});
console.log('view head:',(await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(0,180));
const exportBtn=page.getByRole('button',{name:/Export report as CSV/i}).first();
console.log('Export present:',await exportBtn.count());
if(await exportBtn.count()){
  const dlP=page.waitForEvent('download',{timeout:20000}).catch(()=>null);
  await exportBtn.click();
  const dl=await dlP;
  if(dl){const p=`docs/audits/2026-08-23/scratch/exp-${Date.now()}.csv`; await dl.saveAs(p);
    const lines=fs.readFileSync(p,'utf8').split('\n').filter(Boolean);
    console.log('CSV DOWNLOAD file=',dl.suggestedFilename(),'dataRows=',lines.length-1);
    fs.unlinkSync(p);
  } else console.log('no download event');
}

// dash<->map toggle
console.log('\n=== dash<->map ===');
await page.goto(`${BASE}/dashboard`,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3000);
await page.getByText(/^Map view$/i).first().click(); await page.waitForTimeout(4500);
await page.screenshot({path:`${SHOT}/map-1440.png`,fullPage:false});
const mapText=(await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(0,120);
console.log('after Map view -> url:',page.url(),'| text:',mapText);
const backCtl=await page.getByText(/Dashboard view|Dash view|Overview view|Exit map/i).count();
console.log('back-to-dash control count:',backCtl,'| any "Map view" still:',await page.getByText(/^Map view$/i).count());
console.log('PAGEERRORS:',JSON.stringify(errs.slice(0,6)));
await b.close();
