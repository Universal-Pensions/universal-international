import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
await page.goto(BASE + '/distributors', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a13-login-probe-375.png', fullPage: true });
// enumerate buttons / links / roles
const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button, a, [role=tab], [role=button]')).map(e => (e.getAttribute('role')||e.tagName)+': '+(e.innerText||e.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,40));
console.log('CONTROLS:', JSON.stringify(buttons, null, 0));
const tel = await page.locator('input[type="tel"]').count();
console.log('tel inputs (any visibility):', tel);
console.log('body text:', (await page.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(0,400));
await b.close();
