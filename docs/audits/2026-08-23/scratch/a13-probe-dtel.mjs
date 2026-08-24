import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const b=await chromium.launch({headless:true});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
await page.goto(BASE+'/distributors',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(2500);
const tel=await page.locator('input[name="phone"]:visible').count();
console.log('phone visible immediately:', tel);
// what role tabs exist and their exact accessible names?
const roleBtns=await page.evaluate(()=>Array.from(document.querySelectorAll('button')).map(e=>JSON.stringify({t:e.innerText.replace(/\s+/g,' ').trim(),al:e.getAttribute('aria-label'),pressed:e.getAttribute('aria-pressed')})).filter(s=>/Distributor|Branch|Agent/.test(s)));
console.log('role btns:', JSON.stringify(roleBtns));
await b.close();
