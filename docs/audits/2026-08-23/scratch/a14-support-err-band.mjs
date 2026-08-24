import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const BASE = 'http://localhost:5173';
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });

  // SUPPORT
  await page.goto(BASE + '/dashboard/support', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const st = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  const si = st.indexOf('HELP'); console.log('===== SUPPORT =====\n' + st.slice(si>=0?si:0,(si>=0?si:0)+700));
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/employer/support-1440.png', fullPage: true });

  // FORCE ERROR STATE on overview: abort the employer metrics RPC
  await page.route('**/rest/v1/rpc/get_employer_metrics', r => r.abort());
  await page.route('**/api/**', r => r.abort());
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const et = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  console.log('\n===== OVERVIEW w/ metrics RPC ABORTED (error/empty state) =====\n' + et.slice(0, 500));
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/employer/overview-error-1440.png', fullPage: true });
  await page.unroute('**/rest/v1/rpc/get_employer_metrics');
  await page.unroute('**/api/**');

  // BAND: 1024 (desktop threshold) and 768 (mobile) — overview + employees
  for (const w of [1024, 768]) {
    await page.setViewportSize({ width: w, height: 1000 });
    for (const [name, path] of [['overview','/dashboard'],['employees','/dashboard/employees']]) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1600);
      // check for horizontal overflow
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      await page.screenshot({ path: `docs/audits/2026-08-23/screenshots/employer/${name}-${w}.png`, fullPage: true });
      console.log(`BAND ${name} ${w}px hOverflow=${overflow}`);
    }
  }
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
