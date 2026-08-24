import { chromium } from 'playwright';
const BASE='http://localhost:5173', PHONE='+256700000011', SS='docs/audits/2026-08-23/screenshots/branch';
const b=await chromium.launch({headless:true});
const norm=s=>(s||'').replace(/\s+/g,' ').trim();
const lctx=await b.newContext({viewport:{width:1440,height:900}});
const lp=await lctx.newPage();
await lp.goto(BASE+'/distributors',{waitUntil:'domcontentloaded'});await lp.waitForTimeout(1000);
await lp.getByRole('tab',{name:/^Branch$/}).first().click();await lp.waitForTimeout(300);
let tel=lp.locator('input[type="tel"]:visible').first();await tel.waitFor({state:'visible',timeout:10000});await tel.fill(PHONE);
await lp.getByRole('button',{name:/send verification code|send code|continue/i}).first().click();
await lp.locator('input[name="otp-0"]').waitFor({state:'visible',timeout:10000});
for(let i=0;i<6;i++)await lp.locator(`input[name="otp-${i}"]`).fill('123456'[i]);
await lp.getByRole('button',{name:/verify/i}).first().click();await lp.waitForURL(/\/dashboard/,{timeout:20000});
const state=await lctx.storageState();await lctx.close();
for(const w of [1024,768]){
  const ctx=await b.newContext({viewport:{width:w,height:900},storageState:state});
  const p=await ctx.newPage();
  await p.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});await p.waitForTimeout(2600);
  const shell = await p.evaluate(()=>({ hasSideNav: !!document.querySelector('nav a[href="/dashboard/agents"]'), bottomTabs: !!document.querySelector('[class*="BottomTab"],[class*="bottomTab"]'), body: document.body.className }));
  await p.screenshot({path:`${SS}/overview-${w}.png`,fullPage:true});
  console.log(`[${w}px] firstline:`, norm(await p.evaluate(()=>document.body.innerText)).slice(0,90));
  await ctx.close();
}
await b.close();
