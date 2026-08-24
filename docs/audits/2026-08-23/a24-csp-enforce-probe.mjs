// A24 — what would BREAK if the report-only CSP in vercel.json were enforced?
// Fetches the real production site and replays the *same* policy as an
// ENFORCING header, then records every securitypolicyviolation event.
import { chromium } from '@playwright/test';
const URL = 'https://uganda-dashboard.vercel.app/';
const b = await chromium.launch();
const ctx = await b.newContext();
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__CSP = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__CSP.push({ directive: e.effectiveDirective, blocked: String(e.blockedURI).slice(0, 120), sample: (e.sample || '').slice(0, 80) });
  });
});
await page.route('**/*', async (route) => {
  const res = await route.fetch();
  const h = { ...res.headers() };
  const policy = h['content-security-policy-report-only'];
  if (policy) { h['content-security-policy'] = policy; delete h['content-security-policy-report-only']; }
  await route.fulfill({ response: res, headers: h });
});
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
const v = await page.evaluate(() => window.__CSP);
const agg = {};
for (const x of v) { const k = `${x.directive} <- ${x.blocked}`; agg[k] = (agg[k] || 0) + 1; }
console.log('CSP violations under ENFORCEMENT:', v.length);
console.log(JSON.stringify(agg, null, 1));
const fonts = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
console.log('body font-family resolved to:', fonts);
console.log('doc loaded fonts:', await page.evaluate(() => document.fonts ? document.fonts.size : 'n/a'));
await page.screenshot({ path: 'docs/audits/2026-08-23/a24-csp-enforced.png', fullPage: false });
await b.close();
