import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const SHOT = 'docs/audits/2026-08-23/screenshots/distributor';
const consoleErrors = [];
async function signIn(page){
  await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  // Distributor is the default role tab on /distributors; phone input already visible.
  const tel = page.locator('input[name="phone"]:visible').first(); await tel.waitFor({ state: 'visible', timeout: 15000 }); await tel.fill('700000021');
  await page.getByRole('button', { name: /send verification code/i }).first().click();
  await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 20000 });
  for (let k=0;k<6;k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
}
const txt=(p)=>p.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').trim());
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console',(m)=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,180));});
page.on('pageerror',(e)=>consoleErrors.push('PAGEERROR: '+String(e).slice(0,180)));
await signIn(page);
await page.waitForTimeout(8000);
console.log('LOGIN url:', page.url());
await page.screenshot({ path: `${SHOT}/home-1440.png`, fullPage: false });
console.log('HOME:', (await txt(page)).slice(0,450));

console.log('\n=== REPORTS at DESKTOP (bounce + panel) ===');
await page.goto(`${BASE}/dashboard/reports`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4500);
console.log('Nav /dashboard/reports -> settled url:', page.url());
await page.screenshot({ path: `${SHOT}/reports-panel-1440.png`, fullPage: false });
const opts = await page.evaluate(()=>Array.from(document.querySelectorAll('button,a,[role=button],li,h3,h4')).map(e=>e.innerText.replace(/\s+/g,' ').trim()).filter(t=>/Summary|All Branches|All Agents|All Subscribers|Contributions|Withdrawals|Branch Performance|Agent Performance|Growth|Demographics|KYC/i.test(t)));
console.log('REPORT OPTIONS visible:', JSON.stringify([...new Set(opts)].slice(0,20)));
console.log('Panel text sample:', (await txt(page)).slice(0,260));

console.log('\nCONSOLE ERRORS:', JSON.stringify([...new Set(consoleErrors)].slice(0,12)));
await b.close();
