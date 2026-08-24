import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
async function signIn(page){
  await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: /^Log in$/i }).first().click(); await page.waitForTimeout(800);
  await page.getByRole('button', { name: /^Distributor Distribution network/i }).first().click(); await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Distributor Admin/i }).first().click(); await page.waitForTimeout(800);
  const tel = page.locator('input[name="phone"]:visible').first(); await tel.waitFor({ state: 'visible', timeout: 15000 }); await tel.fill('700000021');
  await page.getByRole('button', { name: /send verification code/i }).first().click();
  await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 20000 });
  for (let k=0;k<6;k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
}
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
const metricsCalls=[];
page.on('response',(r)=>{const u=r.url(); if(/entities_metrics|entity_metrics|rollup|batch/i.test(u)) metricsCalls.push(`${r.status()} ${u.split('/rest/v1/')[1]?.split('?')[0]}`);});
await signIn(page);
await page.goto(`${BASE}/dashboard/branches`, { waitUntil: 'domcontentloaded' });
let prev=0;
for(const step of [3000,4000,5000,8000]){ await page.waitForTimeout(step-prev); prev=step;
  const m=(await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).match(/(\d[\d,]*) Branches ([\d,]+) Agents ([\d.]+[KMB]?|0) Funds/);
  const firstRow=(await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).match(/([A-Z][a-z]+ [A-Za-z]+) [A-Za-z]+ · (\d+) subs · (\d+)% active/);
  console.log(`@${step}ms summary=${m?m.slice(1).join('/'):'n/a'} | firstRow=${firstRow?firstRow.slice(1).join('/'):'n/a'}`);
}
await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/distributor/branches-375.png', fullPage: true });
console.log('metrics-ish calls:', metricsCalls.slice(-6));
await b.close();
