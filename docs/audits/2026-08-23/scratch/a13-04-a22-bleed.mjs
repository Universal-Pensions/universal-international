// A13 verify of A22-001: admin national data bleeding into distributor d-002 after in-SPA role switch (no logout).
import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const SHOT='docs/audits/2026-08-23/screenshots/distributor';
async function otp(page){ await page.locator('input[name="otp-0"]').waitFor({state:'visible',timeout:20000}); for(let k=0;k<6;k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]); await page.getByRole('button',{name:/verify/i}).first().click(); }
const txt=(p)=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').trim());
const b=await chromium.launch({headless:true});
const ctx=await b.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
let rollupB=0, phase='A'; const docLoads={A:0,B:0};
page.on('response',(r)=>{ if(r.request().resourceType()==='document'&&r.url().startsWith(BASE)) docLoads[phase]++; });
page.on('request',(r)=>{ if(phase==='B'&&/rpc\/get_entity_metrics_rollup/.test(r.url())){ const pd=r.postData()||''; if(/"p_level":"country"/.test(pd)&&/"ug"/.test(pd)) rollupB++; }});

// PHASE A: admin
await page.goto(BASE+'/admin',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2500);
let tel=page.locator('input[name="phone"]:visible, input[type="tel"]:visible').first();
if(!(await tel.count())){ const si=page.getByRole('button',{name:/sign in|log in/i}).first(); if(await si.count()){await si.click(); await page.waitForTimeout(1000);} tel=page.locator('input[name="phone"]:visible, input[type="tel"]:visible').first(); }
await tel.waitFor({state:'visible',timeout:15000}); await tel.fill('700000041');
await page.getByRole('button',{name:/send verification code|send code|continue/i}).first().click();
await otp(page);
await page.waitForURL(/\/(admin|dashboard)/,{timeout:40000}); await page.waitForTimeout(9000);
await page.screenshot({path:`${SHOT}/a22-A-admin-1440.png`,fullPage:false});
const aT=await txt(page);
console.log('A) ADMIN url:',page.url());
console.log('A) ADMIN sample:', (aT.match(/FUNDS UNDER MANAGEMENT[^A]*|Assets under management[^A]*|UGX [\d.]+B[^S]*SUBSCRIBERS [\d,]+/i)||[aT.slice(0,220)])[0].slice(0,220));

// PHASE B: switch to distributor d-002 WITHOUT logout (SPA nav)
phase='B';
await page.goto(BASE+'/distributors',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(2500);
tel=page.locator('input[name="phone"]:visible').first(); await tel.waitFor({state:'visible',timeout:15000}); await tel.fill('700000022');
await page.getByRole('button',{name:/send verification code/i}).first().click();
await otp(page);
await page.waitForURL(/\/dashboard/,{timeout:40000}); await page.waitForTimeout(10000);
await page.screenshot({path:`${SHOT}/a22-B-d002-bleed-1440.png`,fullPage:false});
const bT=await txt(page);
const stored=await page.evaluate(()=>localStorage.getItem('upensions_auth'));
console.log('B) d-002 stored session:', stored);
const m=bT.match(/UGX ([\d.]+B)[^0-9]*Across[^0-9]*(\d[\d,]*) branches/i) || bT.match(/FUNDS UNDER MANAGEMENT UGX ([\d.]+B)[^S]*?(\d[\d,]*) branches/i);
console.log('B) d-002 dashboard AUM/branches shown:', m?m.slice(1).join(' / '):'(parse) '+bT.slice(0,260));
console.log('B) rollup(country,[ug]) network calls in phase B:', rollupB, '| doc loads phase B:', docLoads.B);
console.log('   Fresh d-002 truth = 170.1M / 27 branches; admin truth = 2.45B / 321 branches');
await b.close();
