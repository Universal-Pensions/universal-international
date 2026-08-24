import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const SHOT='docs/audits/2026-08-23/screenshots/distributor';
async function signIn(page){
  await page.goto(BASE+'/distributors',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2200);
  let tel=page.locator('input[name="phone"]:visible').first();
  if(!(await tel.count())){
    const li=page.getByRole('button',{name:/^Log in$/i}).first(); if(await li.count()){await li.click(); await page.waitForTimeout(900);}
    const d1=page.getByRole('button',{name:/^Distributor Distribution network/i}).first(); if(await d1.count()){await d1.click(); await page.waitForTimeout(800);}
    const d2=page.getByRole('button',{name:/Distributor Admin/i}).first(); if(await d2.count()){await d2.click(); await page.waitForTimeout(800);}
    tel=page.locator('input[name="phone"]:visible').first();
  }
  await tel.waitFor({state:'visible',timeout:15000}); await tel.fill('700000021');
  await page.getByRole('button',{name:/send verification code/i}).first().click();
  await page.locator('input[name="otp-0"]').waitFor({state:'visible',timeout:20000});
  for(let k=0;k<6;k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button',{name:/verify/i}).first().click();
  await page.waitForURL(/\/dashboard/,{timeout:40000});
}
const b=await chromium.launch({headless:true});
for(const w of [768,1024]){
  const ctx=await b.newContext({viewport:{width:w,height:900}});
  const page=await ctx.newPage();
  await signIn(page); await page.waitForTimeout(7000);
  const hasBottomTabs=await page.getByRole('navigation',{name:/Distributor navigation/i}).count();
  const hasMapRail=await page.getByText(/^Map view$/i).count();
  await page.goto(`${BASE}/dashboard/reports`,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3500);
  const reportsUrl=page.url();
  console.log(`W=${w}: bottomTabBar=${hasBottomTabs} mapRail=${hasMapRail} -> shell=${hasBottomTabs?'MOBILE':'DESKTOP'} | /dashboard/reports settles=${reportsUrl}`);
  await page.goto(`${BASE}/dashboard`,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(3000);
  await page.screenshot({path:`${SHOT}/home-${w}.png`,fullPage:false});
  await ctx.close();
}
await b.close();
