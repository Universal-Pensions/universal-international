// A22 throwaway — is the admin overview really zeros? Use the SAME storageState
// the sanctioned e2e suite uses, and log RPC responses.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/admin.json' });
const page = await ctx.newPage();
const seen = [];
page.on('response', async (r) => {
  if (!/rest\/v1\/rpc\//.test(r.url())) return;
  const name = r.url().split('/rest/v1/')[1].split('?')[0];
  let body = '';
  try { body = (await r.text()).slice(0, 300); } catch { body = '<unreadable>'; }
  seen.push(`${r.status()} ${name} :: ${body}`);
});
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200)); });
await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(10000);
const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('--- BODY (first 700) ---');
console.log(t.slice(0, 700));
console.log('--- RPC RESPONSES ---');
console.log(seen.join('\n'));
await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-admin-storagestate.png' });
await b.close();
