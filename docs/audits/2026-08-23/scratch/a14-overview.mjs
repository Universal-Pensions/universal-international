import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const BASE = 'http://localhost:5173';
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const t = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  console.log('=== OVERVIEW DESKTOP full ===\n' + t.slice(0, 2000));
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
