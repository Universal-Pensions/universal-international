// A13 verify A22-001 via SPA nav (no full reload) — the condition the finding requires.
import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const SHOT='docs/audits/2026-08-23/screenshots/distributor';
async function otp(page){ await page.locator('input[name="otp-0"]').waitFor({state:'visible',timeout:20000}); for(let k=0;k<6;k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]); await page.getByRole('button',{name:/verify/i}).first().click(); }
const txt=(p)=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').trim());
const b=await chromium.launch({headless:true});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
let docLoads=0, phase='A', rollupB=0;
page.on('response',(r)=>{ if(r.request().resourceType()==='document'&&r.url().startsWith(BASE)) docLoads++; });
page.on('request',(r)=>{ if(phase==='B'&&/rpc\/get_entity_metrics_rollup/.test(r.url())){ const pd=r.postData()||''; if(/"p_level":"country"/.test(pd)) rollupB++; }});

// PHASE A: admin login
await page.goto(BASE+'/admin',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2500);
let tel=page.locator('input[name="phone"]:visible, input[type="tel"]:visible').first();
await tel.waitFor({state:'visible',timeout:15000}); await tel.fill('700000041');
await page.getByRole('button',{name:/send verification code|send code|continue/i}).first().click();
await otp(page); await page.waitForURL(/\/(admin|dashboard)/,{timeout:40000}); await page.waitForTimeout(9000);
console.log('A) admin AUM sample:', (await txt(page)).match(/FUNDS UNDER MANAGEMENT UGX [\d.]+B|UGX [\d.]+B/i)?.[0]);
console.log('A) docLoads so far:', docLoads);

// PHASE B: SPA-nav to distributor sign-in (no full reload), sign in d-002 WITHOUT logout
phase='B';
await page.goBack(); await page.waitForTimeout(2000);            // SPA back to /admin landing
console.log('B) after goBack url:',page.url(),'docLoads:',docLoads);
const distLink=page.getByRole('link',{name:/^Distributors?$/i}).first();
if(await distLink.count()){ await distLink.click(); }
else { await page.getByRole('link',{name:/Distributor/i}).first().click(); }
await page.waitForTimeout(2500);
console.log('B) after Distributor link url:',page.url(),'docLoads:',docLoads);
tel=page.locator('input[name="phone"]:visible').first(); await tel.waitFor({state:'visible',timeout:15000}); await tel.fill('700000022');
await page.getByRole('button',{name:/send verification code/i}).first().click();
await otp(page); await page.waitForURL(/\/dashboard/,{timeout:40000}); await page.waitForTimeout(10000);
await page.screenshot({path:`${SHOT}/a22-B-d002-SPA-1440.png`,fullPage:false});
const bT=await txt(page);
console.log('B) d-002 stored:', await page.evaluate(()=>localStorage.getItem('upensions_auth')));
const aum=bT.match(/FUNDS UNDER MANAGEMENT UGX ([\d.]+[MB])[^A]*Across [^·]*· (\d[\d,]*) branches/i);
console.log('B) d-002 dashboard shows:', aum?`${aum[1]} / ${aum[2]} branches`:bT.slice(bT.indexOf('NETWORK OVERVIEW'),bT.indexOf('NETWORK OVERVIEW')+240));
console.log('B) TOTAL docLoads:',docLoads,'| rollup network calls phase B:',rollupB);
console.log('   TRUTH: d-002 = 170.1M/27 ; admin = 2.45B/321. Bleed = d-002 shows 2.45B/321.');
await b.close();
