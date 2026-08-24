// A22 throwaway — force ONE read endpoint to 500 (both attempts) and record what
// the user sees: an error surface, or silently-wrong zeros.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const CASES = [
  ['admin',       '/dashboard',                'rpc/get_platform_overview'],
  ['admin',       '/dashboard',                'rpc/get_admin_attention'],
  ['distributor', '/dashboard',                'rpc/get_entity_metrics_rollup'],
  ['subscriber',  '/dashboard',                'subscribers'],
  ['employer',    '/dashboard',                'rpc/get_employer_metrics'],
  ['agent',       '/dashboard',                'rpc/get_agent_subscriber_list'],
];
const b = await chromium.launch({ headless: true });
for (const [role, path, frag] of CASES) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: `e2e/.auth/${role}.json` });
  const page = await ctx.newPage();
  let hits = 0;
  await page.route('**/rest/v1/**', (route) => {
    const u = route.request().url();
    if (u.includes('/rest/v1/' + frag)) {
      hits++;
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'injected failure' }) });
    }
    return route.continue();
  });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const alerts = await page.locator('[role="alert"], [role="status"]').allInnerTexts().catch(() => []);
  console.log(`\n### ${role} ${path} — forced 500 on ${frag} (intercepted ${hits}x)`);
  console.log('ALERTS:', JSON.stringify(alerts).slice(0, 300));
  console.log('BODY  :', t.slice(0, 620));
  await page.screenshot({ path: `docs/audits/2026-08-23/scratch/a22b-read500-${role}-${frag.replace(/[^a-z_]/gi,'')}.png` });
  await ctx.close();
}
await b.close();
