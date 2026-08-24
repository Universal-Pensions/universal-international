import { chromium } from 'playwright';
import { loginAsAgent } from './a11-login.mjs';

const SHOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard/docs/audits/2026-08-23/screenshots/agent';
const ROUTES = [
  ['home', '/dashboard'],
  ['subscribers', '/dashboard/subscribers'],
  ['subscriber-detail', '/dashboard/subscribers/s-0003'],
  ['subscriber-schedule', '/dashboard/subscribers/s-0003/schedule'],
  ['inbox', '/dashboard/inbox'],
  ['analytics', '/dashboard/analytics'],
  ['commissions-earned', '/dashboard/commissions/earned'],
  ['commissions-owed', '/dashboard/commissions/owed'],
  ['contributions', '/dashboard/contributions'],
  ['onboarded-this-month', '/dashboard/onboarded-this-month'],
  ['yet-to-contribute', '/dashboard/yet-to-contribute'],
  ['insured', '/dashboard/insured'],
  ['uninsured', '/dashboard/uninsured'],
  ['settings', '/dashboard/settings'],
  ['profile', '/dashboard/profile'],
  ['help', '/dashboard/help'],
];

const width = parseInt(process.argv[2] || '1440', 10);
const height = width < 500 ? 812 : 1000;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0,200)); });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0,200)));
  await loginAsAgent(page);
  console.log('LOGIN OK', page.url());
  await page.setViewportSize({ width, height });
  for (const [tag, route] of ROUTES) {
    errors.length = 0;
    let status = 'ok';
    try {
      await page.goto('http://localhost:5173' + route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
    } catch (e) { status = 'NAV-ERR ' + String(e).slice(0,80); }
    const url = page.url();
    const redirected = !url.includes(route) ? ` [REDIRECTED->${url.replace('http://localhost:5173','')}]` : '';
    await page.screenshot({ path: `${SHOT}/${tag}-${width}.png`, fullPage: true });
    const txt = await page.evaluate(() => document.body.innerText);
    const lines = txt.split('\n').map(l=>l.trim()).filter(Boolean);
    console.log(`\n===== ${tag} ${route}${redirected} (${width}) status=${status} =====`);
    console.log(lines.slice(0, 30).join(' | '));
    if (errors.length) console.log('  ERRORS:', errors.slice(0,4).join(' || '));
  }
  await browser.close();
})();
