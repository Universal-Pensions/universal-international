import { chromium } from 'playwright';
import { loginAsAgent } from './a11-login.mjs';
const SHOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard/docs/audits/2026-08-23/screenshots/agent';
async function stepAwareness(page) {
  // answer all 5 yes, click continue to kyc
  const yes = page.getByRole('radio', { name: /^yes$/i });
  await yes.first().waitFor({ state: 'visible', timeout: 10000 });
  if ((await yes.count()) >= 5) { for (let i=0;i<5;i++) await yes.nth(i).click(); }
  else { const rows = page.getByRole('button', { name: /^\d\s/ }); const n = await rows.count();
    for (let i=0;i<n;i++){ await rows.nth(i).click(); await yes.first().click(); } }
  await page.getByRole('button', { name: /continue to kyc/i }).click();
}
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await loginAsAgent(page);
  for (const w of [1440, 375]) {
    await page.setViewportSize({ width: w, height: w<500?812:1000 });
    await page.goto('http://localhost:5173/dashboard/onboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOT}/onboard-awareness-${w}.png`, fullPage: true });
    const t1 = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,200));
    console.log(`[onboard awareness ${w}] ${t1}`);
    try {
      await stepAwareness(page);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOT}/onboard-kyc-idupload-${w}.png`, fullPage: true });
      const h = await page.evaluate(()=>{const el=document.querySelector('h1,h2,h3');return el?el.innerText:'?';});
      const step = await page.evaluate(()=>{const m=document.body.innerText.match(/Step \d+ of \d+[^\n]*/);return m?m[0]:'(no step meta)';});
      console.log(`[onboard KYC step1 ${w}] heading="${h}" meta="${step}"`);
    } catch(e){ console.log(`[onboard ${w}] step err: ${String(e).slice(0,120)}`); }
  }
  await b.close();
})();
