import { chromium } from 'playwright';
import { loginAsAgent } from './a11-login.mjs';

const SHOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard/docs/audits/2026-08-23/screenshots/agent';

async function grab(page, w, h, tag) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('http://localhost:5173/dashboard/commissions', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT}/commissions-${w}.png`, fullPage: true });
  // Extract key visible text
  const txt = await page.evaluate(() => document.body.innerText);
  console.log(`===== ${tag} (${w}x${h}) =====`);
  console.log(txt.split('\n').filter(l => l.trim()).slice(0, 60).join('\n'));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0,160)); });
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,160)));
  try {
    await loginAsAgent(page);
    console.log('LOGIN OK url=', page.url());
    await grab(page, 1440, 1000, 'agent /dashboard/commissions DESKTOP');
    await grab(page, 375, 812, 'agent /dashboard/commissions MOBILE');
  } catch (e) {
    console.log('ERROR', String(e).slice(0, 400));
  } finally {
    await browser.close();
  }
})();
