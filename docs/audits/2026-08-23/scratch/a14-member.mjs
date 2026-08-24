import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const BASE = 'http://localhost:5173';
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const page = await ctx.newPage();
  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });
  // member detail via URL
  await page.goto(BASE + '/dashboard/employees/empe-001', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  console.log('member-detail url=', page.url());
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/employer/HEADLINE-member-empe-001-1440.png', fullPage: true });
  const t = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  console.log('=== MEMBER DETAIL empe-001 ===\n' + t.slice(0, 2200));
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
