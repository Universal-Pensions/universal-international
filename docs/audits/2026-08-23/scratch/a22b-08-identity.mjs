// A22 throwaway — is the distributor login identity deterministic?
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
for (let i = 1; i <= 4; i++) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const auth = [];
  page.on('response', async (r) => {
    if (!/\/api\/auth\//.test(r.url())) return;
    let t = ''; try { t = await r.text(); } catch { t = '<x>'; }
    // redact any JWT
    t = t.replace(/eyJ[A-Za-z0-9_.\-]+/g, (m) => `eyJ...<${m.length}>`);
    auth.push(`${r.request().method()} ${r.url().split('/api/')[1]} -> ${r.status()} ${t.slice(0,300)}`);
  });
  await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const tabs = await page.getByRole('tab').allInnerTexts().catch(()=>[]);
  const tab = page.getByRole('tab', { name: /Distributor/i }).first();
  if (await tab.count()) await tab.click();
  const tel = page.locator('input[type="tel"]:visible').first();
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.fill('+256700000022');
  await page.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
  await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 25000 });
  for (let k = 0; k < 6; k++) await page.locator(`input[name="otp-${k}"]`).fill('123456'[k]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
  await page.waitForTimeout(1200);
  const stored = await page.evaluate(() => localStorage.getItem('upensions_auth'));
  console.log(`run ${i}: tabs=${JSON.stringify(tabs)} stored=${stored}`);
  for (const a of auth) console.log('   ' + a);
  await ctx.close();
}
await b.close();
