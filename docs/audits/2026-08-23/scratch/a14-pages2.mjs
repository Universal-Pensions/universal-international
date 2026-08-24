import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const BASE = 'http://localhost:5173';
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });

  await page.goto(BASE + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.getByText('Pension contribution', { exact: true }).first().click().catch(e=>console.log('tabclick err', e.message));
  await page.waitForTimeout(1200);
  const pt = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  // print only the interesting middle part
  const idx = pt.indexOf('Pension');
  console.log('===== SETTINGS PENSION TAB =====\n' + pt.slice(idx, idx+1200));
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/employer/settings-pension-1440.png', fullPage: true });

  await page.goto(BASE + '/dashboard/runs', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const rt = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  const ri = rt.indexOf('FUNDING');
  console.log('\n===== RUNS =====\n' + rt.slice(ri>=0?ri:0, (ri>=0?ri:0)+1800));

  await page.goto(BASE + '/dashboard/analytics', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const at = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  const ai = at.indexOf('INSIGHTS');
  console.log('\n===== ANALYTICS =====\n' + at.slice(ai>=0?ai:0, (ai>=0?ai:0)+1400));
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
