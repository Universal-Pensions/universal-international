import { chromium, devices } from 'playwright';
const BASE='http://localhost:5173';
const OUT='docs/audits/2026-08-23/screenshots/public';
const browser=await chromium.launch();
const ctx=await browser.newContext({ viewport:{width:375,height:812}, userAgent:devices['iPhone 12'].userAgent, isMobile:true, hasTouch:true });
const page=await ctx.newPage();
await page.goto(BASE+'/',{waitUntil:'networkidle'});
await page.waitForTimeout(600);
const banner=page.locator('[aria-label="Install app"]');
const v1=await banner.isVisible().catch(()=>false);
const ls1=await page.evaluate(()=>{try{return localStorage.getItem('up-landing-install-dismissed')}catch{return 'ERR'}});
console.log('initial banner visible:',v1,'| dismissed LS:',ls1);
await page.screenshot({path:`${OUT}/install-banner-375.png`});
if(v1){
  await banner.getByRole('button',{name:/dismiss/i}).click();
  await page.waitForTimeout(300);
  const v2=await banner.isVisible().catch(()=>false);
  const ls2=await page.evaluate(()=>{try{return localStorage.getItem('up-landing-install-dismissed')}catch{return 'ERR'}});
  console.log('after dismiss visible:',v2,'| LS:',ls2);
  // reload -> persistence
  await page.reload({waitUntil:'networkidle'});
  await page.waitForTimeout(600);
  const v3=await banner.isVisible().catch(()=>false);
  console.log('after reload visible (should be false=persisted):',v3);
}
// also open the menu sheet to confirm install entry reachable
await page.locator('button[aria-label="Menu"]').click().catch(()=>{});
await page.waitForTimeout(400);
await page.screenshot({path:`${OUT}/mobile-menu-sheet-375.png`});
const menuTxt=(await page.locator('body').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,200);
console.log('menu sheet text:',menuTxt);
await browser.close();
