import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const BASE = 'http://localhost:5173';
const dump = async (page, path, label, n=1600) => {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const t = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  console.log(`\n===== ${label} (${path}) =====\n` + t.slice(0, n));
};
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });
  await dump(page, '/dashboard/settings', 'SETTINGS');
  // click Pension tab
  await page.getByText('Pension', { exact: true }).first().click().catch(()=>{});
  await page.waitForTimeout(1200);
  const pt = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  console.log('\n===== SETTINGS > PENSION TAB =====\n' + pt.slice(0, 1400));
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/employer/settings-pension-1440.png', fullPage: true });
  await dump(page, '/dashboard/insurance', 'INSURANCE');
  await dump(page, '/dashboard/runs', 'RUNS', 2000);
  await dump(page, '/dashboard/analytics', 'ANALYTICS');
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
