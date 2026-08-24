import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const BASE = 'http://localhost:5173';
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });

  // Contributions desktop full text
  await page.goto(BASE + '/dashboard/contributions', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const t = (await page.locator('main, [role=main], body').first().innerText()).replace(/\n{2,}/g,'\n');
  console.log('=== CONTRIB DESKTOP ===\n' + t.slice(0, 1500));

  // leg=employee
  await page.goto(BASE + '/dashboard/contributions?leg=employee', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const te = (await page.locator('body').innerText()).replace(/\s+/g,' ');
  console.log('\n=== leg=employee (first 400) ===\n' + te.slice(0, 400));
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
