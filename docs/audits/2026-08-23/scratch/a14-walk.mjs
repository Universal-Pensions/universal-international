import { chromium } from 'playwright';
import { signIn } from './lib.mjs';

const BASE = 'http://localhost:5173';
const SHOT = 'docs/audits/2026-08-23/screenshots/employer';
const ROUTES = [
  ['index', '/dashboard'],
  ['employees', '/dashboard/employees'],
  ['runs', '/dashboard/runs'],
  ['contributions', '/dashboard/contributions'],
  ['insurance', '/dashboard/insurance'],
  ['analytics', '/dashboard/analytics'],
  ['support', '/dashboard/support'],
  ['settings', '/dashboard/settings'],
  ['onboard', '/dashboard/onboard'],
  ['pending-kyc', '/dashboard/pending-kyc'],
  ['profile', '/dashboard/profile'],
];

const VIEWPORTS = [[1440, 900], [375, 812]];

const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));

  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });
  console.log('LOGIN_OK url=', page.url());

  for (const [w, h] of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    for (const [name, path] of ROUTES) {
      errors.length = 0;
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1800);
      // for employees/:id we handle separately below
      const file = `${SHOT}/${name}-${w}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
      console.log(`ROUTE ${name} ${w} url=${page.url()} errs=${errors.length} :: ${bodyText.slice(0,180)}`);
      if (errors.length) console.log('   ERR:', errors.slice(0, 3).join(' | ').slice(0, 300));
    }
  }
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
