import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const BASE = 'http://localhost:5173';
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  const page = await ctx.newPage();
  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });
  await page.goto(BASE + '/dashboard/employees', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/employer/HEADLINE-employees-roster-1440.png', fullPage: true });
  const t = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  console.log('=== EMPLOYEES ROSTER DESKTOP ===\n' + t.slice(0, 2600));
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
