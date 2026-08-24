import { chromium } from '@playwright/test';
const OUT = 'docs/audits/2026-08-23/a18';
const widths = [768, 1023, 1024];
const targets = [
  { role: 'subscriber', url: 'http://localhost:5173/dashboard' },
  { role: 'distributor', url: 'http://localhost:5173/dashboard' },
  { role: 'employer', url: 'http://localhost:5173/dashboard' },
  { role: 'agent', url: 'http://localhost:5173/dashboard' },
];
const browser = await chromium.launch();
for (const t of targets) {
  for (const w of widths) {
    const ctx = await browser.newContext({
      storageState: `e2e/.auth/${t.role}.json`,
      viewport: { width: w, height: 800 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    try {
      await page.goto(t.url, { waitUntil: 'networkidle', timeout: 20000 });
    } catch (e) {
      console.log(`${t.role}@${w}: nav ${e.message.slice(0,60)}`);
    }
    await page.waitForTimeout(1500);
    const f = `${OUT}/${t.role}-${w}.png`;
    await page.screenshot({ path: f });
    // detect horizontal overflow
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return { scrollW: de.scrollWidth, clientW: de.clientWidth, hOverflow: de.scrollWidth > de.clientWidth + 1 };
    });
    console.log(`${t.role}@${w}: ${f} overflowX=${overflow.hOverflow} (scrollW=${overflow.scrollW} clientW=${overflow.clientW})`);
    await ctx.close();
  }
}
await browser.close();
