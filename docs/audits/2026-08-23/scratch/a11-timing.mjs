import { chromium } from 'playwright';
import { loginAsAgent } from './a11-login.mjs';
const SHOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard/docs/audits/2026-08-23/screenshots/agent';
async function probe(page, route, label) {
  await page.goto('http://localhost:5173' + route, { waitUntil: 'domcontentloaded' });
  for (const ms of [300, 800, 1500, 3000, 5000]) {
    await page.waitForTimeout(ms === 300 ? 300 : ms - (ms===800?300:ms===1500?800:ms===3000?1500:3000));
    const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').trim());
    const m = t.match(/(\d+)\s*members?/i) || t.match(/Select all\s*(\d+)/i);
    const loading = /Loading|—/.test(t);
    console.log(`  [${label} +${ms}ms] count=${m?m[1]:'?'} loadingMark=${loading} :: ${t.slice(0,120)}`);
  }
}
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await loginAsAgent(page);
  await page.setViewportSize({ width: 375, height: 812 });
  console.log('=== yet-to-contribute (mobile) ==='); await probe(page, '/dashboard/yet-to-contribute', 'ytc');
  await page.screenshot({ path: `${SHOT}/yet-to-contribute-375-settled.png`, fullPage: true });
  console.log('=== onboarded-this-month (mobile) ==='); await probe(page, '/dashboard/onboarded-this-month', 'otm');
  await page.screenshot({ path: `${SHOT}/onboarded-this-month-375-settled.png`, fullPage: true });
  // Desktop yet-to-contribute for comparison
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('=== yet-to-contribute (desktop) ==='); await probe(page, '/dashboard/yet-to-contribute', 'ytc-d');
  await b.close();
})();
