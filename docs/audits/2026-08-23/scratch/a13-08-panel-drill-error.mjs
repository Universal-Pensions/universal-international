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
const txt=(p)=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').trim());
const b=await chromium.launch({headless:true});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
await signIn(page); await page.waitForTimeout(6000);

// (1) Panel state vs URL + hard refresh
await page.getByRole('button',{name:/^Commissions$/i}).first().click(); await page.waitForTimeout(3000);
console.log('(1) after opening Commissions panel: url=',page.url(),'| showing=',(await txt(page)).match(/Commissions Settle agent commissions|Reports Network overview|NETWORK OVERVIEW/i)?.[0]);
await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(6000);
console.log('(1) after HARD REFRESH: url=',page.url(),'| showing=',(await txt(page)).match(/Commissions Settle agent commissions|NETWORK OVERVIEW|Now viewing[^A]*/i)?.[0]);
await page.screenshot({path:`${SHOT}/panel-refresh-1440.png`,fullPage:false});

// (2) Geo drill via map
await page.getByText(/^Map view$/i).first().click(); await page.waitForTimeout(3500);
// click a region name in the summary regions list to drill
const region=page.getByText(/^Central$/).first();
if(await region.count()){ await region.click(); await page.waitForTimeout(2500); }
console.log('(2) after region click: url=',page.url(),'| breadcrumb/text=',(await txt(page)).match(/Now viewing[^F]*/i)?.[0]?.slice(0,90));
await page.screenshot({path:`${SHOT}/drill-region-1440.png`,fullPage:false});

// (3) Error state — abort rollup + insurance/entity reads, reload dashboard
await page.route('**/rest/v1/rpc/get_entity_metrics_rollup*', r=>r.abort());
await page.goto(`${BASE}/dashboard`,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(6000);
await page.screenshot({path:`${SHOT}/error-state-1440.png`,fullPage:false});
const et=await txt(page);
console.log('(3) ERROR STATE sample:', et.slice(et.indexOf('NETWORK OVERVIEW')>-1?et.indexOf('NETWORK OVERVIEW'):0, 260));
console.log('(3) has error card/retry?:', /try again|couldn'?t load|something went wrong|error|retry/i.test(et));
await b.close();
