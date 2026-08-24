import { chromium } from 'playwright';
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
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
await signIn(page); await page.waitForTimeout(5000);
await page.goto(`${BASE}/dashboard/reports`,{waitUntil:'domcontentloaded'}); await page.waitForTimeout(4000);
const btns=await page.evaluate(()=>Array.from(document.querySelectorAll('button')).map(e=>e.innerText.replace(/\s+/g,' ').trim()).filter(Boolean));
console.log('ALL BUTTONS ('+btns.length+'):',JSON.stringify(btns,null,0));
await b.close();
