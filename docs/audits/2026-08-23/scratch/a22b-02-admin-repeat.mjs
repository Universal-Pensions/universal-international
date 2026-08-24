// A22 throwaway — how often does the admin national overview render zeros?
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
for (let i = 1; i <= 6; i++) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/admin.json' });
  const page = await ctx.newPage();
  const fails = [];
  page.on('response', async (r) => {
    if (!/rest\/v1\//.test(r.url())) return;
    if (r.status() < 400) return;
    const name = r.url().split('/rest/v1/')[1].split('?')[0];
    let body = ''; try { body = (await r.text()).slice(0, 160); } catch { body = '<x>'; }
    fails.push(`${r.status()} ${name} :: ${body}`);
  });
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  const marks = [];
  for (const ms of [3000, 3000, 4000]) {
    await page.waitForTimeout(ms);
    const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    const m = t.match(/Universal Pensions — Uganda · ([^F]*?)FUNDS UNDER MANAGEMENT ([^S]*?)SUBSCRIBERS ([\d,]+)/);
    marks.push(m ? `hdr="${m[1].trim()}" fum="${m[2].trim().slice(0,40)}" subs=${m[3]}` : 'NO-MATCH');
  }
  console.log(`run ${i}: ${marks.join('  |  ')}`);
  if (fails.length) console.log(`   FAILS: ${fails.join(' ;; ')}`);
  await ctx.close();
}
await b.close();
