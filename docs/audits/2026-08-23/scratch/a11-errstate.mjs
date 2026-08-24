import { chromium } from 'playwright';
import { loginAsAgent } from './a11-login.mjs';
const SHOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard/docs/audits/2026-08-23/screenshots/agent';
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await loginAsAgent(page);
  // Abort agent commission/subscriber data calls to force error state
  await page.route('**/rest/v1/rpc/get_agent_commission_detail**', r => r.abort());
  await page.route('**/rest/v1/commissions**', r => r.abort());
  await page.goto('http://localhost:5173/dashboard/commissions', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const t = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,300));
  await page.screenshot({ path: `${SHOT}/commissions-error-1440.png`, fullPage: true });
  console.log('[commissions error-forced]', t);
  // Empty-state: subscribers list — abort to see loading/empty; use a non-existent detail route
  await page.unroute('**/rest/v1/rpc/get_agent_commission_detail**');
  await page.goto('http://localhost:5173/dashboard/subscribers/does-not-exist-xyz', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const t2 = await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' ').slice(0,220));
  await page.screenshot({ path: `${SHOT}/subscriber-detail-missing-1440.png`, fullPage: true });
  console.log('[subscriber missing]', t2);
  await b.close();
})();
