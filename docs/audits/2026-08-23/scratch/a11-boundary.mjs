import { chromium } from 'playwright';
import { loginAsAgent } from './a11-login.mjs';
const SHOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard/docs/audits/2026-08-23/screenshots/agent';
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await loginAsAgent(page);
  for (const w of [1023, 1024, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('http://localhost:5173/dashboard/onboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    // Desktop chrome renders the PageHeader <h1> "Onboard a new subscriber"; mobile hides it (app bar owns title).
    const h1 = await page.evaluate(()=>{const e=document.querySelector('h1');return e?e.innerText.trim():'(no h1)';});
    const hasDeskShell = await page.evaluate(()=>!!document.querySelector('[class*="OnboardDesktop"], [class*="shell"]'));
    await page.screenshot({ path: `${SHOT}/onboard-boundary-${w}.png` });
    console.log(`[onboard ${w}px] h1="${h1}"`);
  }
  await b.close();
})();
