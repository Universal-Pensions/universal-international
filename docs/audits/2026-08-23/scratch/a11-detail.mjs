import { chromium } from 'playwright';
import { loginAsAgent } from './a11-login.mjs';
const SHOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard/docs/audits/2026-08-23/screenshots/agent';
(async () => {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  await loginAsAgent(page);
  // s-0003 member detail — full innerText and insurance snippet
  await page.goto('http://localhost:5173/dashboard/subscribers/s-0003', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOT}/subscriber-detail-s0003-full-1440.png`, fullPage: true });
  const t = await page.evaluate(() => document.body.innerText);
  console.log('===== s-0003 member detail (insurance region) =====');
  const lines = t.split('\n').map(l=>l.trim()).filter(Boolean);
  const idx = lines.findIndex(l => /insur|cover|policy|policies|life|health|funeral/i.test(l));
  console.log(lines.slice(Math.max(0,idx-2), idx+30).join(' | '));
  // Settings phone
  await page.goto('http://localhost:5173/dashboard/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const phoneNodes = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('*').forEach(el => {
      if (el.children.length === 0 && /\+?256/.test(el.textContent) && el.textContent.length < 40) out.push(el.textContent.trim());
    });
    return [...new Set(out)];
  });
  console.log('\n===== Settings phone-bearing text nodes =====');
  console.log(phoneNodes.join(' || '));
  // Also read the phone input value
  const inputVals = await page.evaluate(() => Array.from(document.querySelectorAll('input')).map(i => `${i.name||i.id||i.type}=${i.value}`));
  console.log('inputs:', inputVals.join(' | '));
  await b.close();
})();
