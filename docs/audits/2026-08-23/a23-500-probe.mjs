import { chromium } from '@playwright/test';
const STATE = '/Users/shubhang/Desktop/Projects/uganda-dashboard/e2e/.auth/subscriber.json';
const b = await chromium.launch();
const ctx = await b.newContext({ storageState: STATE });
const p = await ctx.newPage();
p.on('response', async (r) => {
  if (r.status() >= 400) {
    console.log(r.status(), r.url().slice(0, 160));
    console.log('BODY:', (await r.text().catch(() => '<none>')).slice(0, 400));
  }
});
await p.goto('http://localhost:5173/dashboard/reports/all-transactions', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(15000);
await b.close();
