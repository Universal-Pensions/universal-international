import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
for (const frag of ['rpc/get_platform_overview', 'rpc/get_admin_attention']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/admin.json' });
  const page = await ctx.newPage();
  await page.route('**/rest/v1/**', (r) => r.request().url().includes('/rest/v1/' + frag)
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"XX000","message":"injected"}' })
    : r.continue());
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log(`\n##### forced 500: ${frag}`);
  console.log('has "Metrics unavailable":', /Metrics unavailable/i.test(t));
  console.log('has "unavailable"       :', /unavailable/i.test(t));
  console.log("has \"couldn't load\"     :", /couldn.t load/i.test(t));
  console.log('has "Try again"         :', /Try again/i.test(t));
  console.log('role=status texts:', JSON.stringify(await page.locator('[role="status"]').allInnerTexts()));
  console.log('role=alert  texts:', JSON.stringify(await page.locator('[role="alert"]').allInnerTexts()));
  console.log('FULL BODY:', t.slice(0, 2600));
  await ctx.close();
}
await b.close();
