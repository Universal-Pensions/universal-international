// A23 — READ-ONLY. Same member, same balance: how many units does each viewport show?
import { chromium } from '@playwright/test';
const STATE = '/Users/shubhang/Desktop/Projects/uganda-dashboard/e2e/.auth/subscriber.json';
const b = await chromium.launch();
for (const [label, vp] of [['desktop 1440', { width: 1440, height: 950 }], ['phone 390', { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ storageState: STATE, timezoneId: 'Africa/Kampala', viewport: vp });
  const p = await ctx.newPage();
  await p.goto('http://localhost:5173/dashboard', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(8000);
  const t = await p.locator('body').innerText();
  const m = t.match(/([\d,]+(?:\.\d+)?)\s*\n?\s*units?/i) || t.match(/UNITS?\s*\n\s*([\d,.]+)/i);
  console.log(label, '-> units shown:', m ? m[1] : '(not found)');
  await ctx.close();
}
await b.close();
