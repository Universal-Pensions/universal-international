import { chromium } from '@playwright/test';
import { SignJWT } from 'jose';
const BASE='http://localhost:5173';
const now=Math.floor(Date.now()/1000);
const tok=await new SignJWT({sub:'s-0001',role:'authenticated',app_role:'subscriber',phone:'+256711000001',subscriberId:'s-0001'})
  .setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer('upensions').setAudience('authenticated')
  .setIssuedAt(now).setExpirationTime(now+3600).sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:950},storageState:{cookies:[],origins:[{origin:BASE,localStorage:[
 {name:'upensions_token',value:tok},
 {name:'upensions_auth',value:JSON.stringify({role:'subscriber',subscriberId:'s-0001',phone:'+256711000001',name:'Brian Okello'})}]}]}});
const page=await ctx.newPage();
let popups=0; ctx.on('page',()=>{popups++;});
await page.goto(BASE+'/dashboard/policies',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(6000);
console.log('page text sample:', (await page.innerText('body')).replace(/\n+/g,' | ').slice(0,600));
const btns = await page.$$eval('button', els=>els.map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean));
console.log('buttons:', JSON.stringify([...new Set(btns)]));
const cert = page.getByRole('button',{name:/certificate/i}).first();
console.log('certificate buttons found:', await page.getByRole('button',{name:/certificate/i}).count());
if (await page.getByRole('button',{name:/certificate/i}).count()) {
  await cert.click({force:true});
  await page.waitForTimeout(2500);
  console.log('popups opened:', popups);
  const body=await page.innerText('body');
  console.log('toast present:', /allow pop-ups/i.test(body), '->', (body.match(/[^|\n]*allow pop-ups[^|\n]*/i)||[''])[0].trim());
  await page.screenshot({path:'docs/audits/2026-08-23/a24-certificate-broken.png'});
}
await b.close();
