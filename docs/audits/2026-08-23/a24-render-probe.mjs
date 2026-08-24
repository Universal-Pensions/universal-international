// A24 — RENDER-side XSS confirmation + third-party network capture.
// Logs in as admin-001 (minted HS256 JWT, same shape as api/_lib/jwt.ts),
// opens the two admin surfaces that render public-write rows, and checks
// whether any planted payload EXECUTES. Also records every request the page
// makes, tagged same-origin vs third-party.
import { chromium, devices } from '@playwright/test';
import { SignJWT } from 'jose';
import fs from 'node:fs';

const BASE = 'http://localhost:5173';
const SECRET = process.env.SUPABASE_JWT_SECRET;
if (!SECRET) { console.error('missing SUPABASE_JWT_SECRET'); process.exit(1); }

async function mint(role, entityId, phone, idField) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: entityId, role: 'authenticated', app_role: role, phone, [idField]: entityId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('upensions').setAudience('authenticated')
    .setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(SECRET));
}

const SENTINEL_INIT = () => {
  window.__A24_EXEC = [];
  const mark = (k) => { window.__A24_EXEC.push(k); };
  window.__A24_mark = mark;
  // Any of the payload globals being set means HTML/JS injection succeeded.
  ['__A24_XSS_ORG','__A24_XSS_ORG2','__A24_XSS_REG','__A24_XSS_NAME','__A24_XSS_NAME2',
   '__A24_XSS_EMAIL','__A24_XSS_SECTOR','__A24_XSS_DISTRICT','__A24_XSS_MSG',
   '__A24_XSS_DEC','__A24_XSS_DEC2','__A24_XSS_CLM','__A24_XSS_CLM2','__A24_XSS_REL',
   '__A24_XSS_DIS','__A24_XSS_NOTES'].forEach((k) => {
    Object.defineProperty(window, k, {
      configurable: true,
      set() { mark(k); },
      get() { return undefined; },
    });
  });
  window.alert = () => mark('alert');
  window.__A24_DOM = () => ({
    scripts: [...document.querySelectorAll('script')].filter((s) => (s.textContent||'').includes('__A24_XSS')).length,
    imgs: [...document.querySelectorAll('img')].filter((i) => (i.getAttribute('src')||'') === 'x' || (i.getAttribute('src')||'') === '1').length,
    svgOnload: [...document.querySelectorAll('svg[onload]')].length,
    iframes: [...document.querySelectorAll('iframe')].length,
    probeText: (document.body.innerText.match(/A24XSSPROBE/g) || []).length,
    rawPayloadInHtml: (document.documentElement.innerHTML.match(/&lt;img src=x onerror=/g) || []).length,
  });
};

const requests = [];

const run = async (label, contextOpts, steps) => {
  const browser = await chromium.launch();
  const token = await mint('admin', 'admin-001', '+256700000041', 'adminId');
  const ctx = await browser.newContext({
    ...contextOpts,
    storageState: {
      cookies: [],
      origins: [{ origin: BASE, localStorage: [
        { name: 'upensions_token', value: token },
        { name: 'upensions_auth', value: JSON.stringify({ role: 'admin', phone: '+256700000041', name: 'Default admin (head office)', adminId: 'admin-001' }) },
      ] }],
    },
  });
  await ctx.addInitScript(SENTINEL_INIT);
  const page = await ctx.newPage();
  page.on('request', (r) => {
    let host = '';
    try { host = new URL(r.url()).host; } catch { /* data: */ }
    requests.push({ label, method: r.method(), host, url: r.url().slice(0, 300), type: r.resourceType() });
  });
  page.on('dialog', async (d) => { requests.push({ label, dialog: d.message() }); await d.dismiss(); });
  const consoleErrs = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 200)); });
  const out = await steps(page);
  const exec = await page.evaluate(() => window.__A24_EXEC);
  const dom = await page.evaluate(() => window.__A24_DOM());
  console.log(`\n===== ${label} =====`);
  console.log('executed payload globals:', JSON.stringify(exec));
  console.log('dom probe:', JSON.stringify(dom));
  console.log('console errors:', consoleErrs.length, consoleErrs.slice(0, 3));
  console.log('steps:', JSON.stringify(out, null, 1));
  await browser.close();
};

// 1. DESKTOP admin — sidebar → Access requests, then Nominee claims
await run('desktop-admin', { viewport: { width: 1440, height: 900 } }, async (page) => {
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const out = {};
  for (const label of ['Access requests', 'Nominee claims']) {
    const item = page.getByRole('button', { name: label }).or(page.getByText(label, { exact: true })).first();
    try { await item.click({ timeout: 8000 }); } catch (e) { out[label] = 'click failed: ' + String(e).slice(0, 120); continue; }
    await page.waitForTimeout(3000);
    out[label] = {
      probeVisible: await page.getByText('A24XSSPROBE', { exact: false }).count(),
      bodyHas: (await page.innerText('body')).includes('A24XSSPROBE'),
    };
  }
  await page.screenshot({ path: 'docs/audits/2026-08-23/a24-desktop-admin.png', fullPage: false });
  return out;
});

// 2. MOBILE admin — direct routes
await run('mobile-admin', { ...devices['Pixel 7'] }, async (page) => {
  const out = {};
  for (const path of ['/dashboard/access-requests', '/dashboard/nominee-claims']) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    out[path] = {
      probeCount: await page.getByText('A24XSSPROBE', { exact: false }).count(),
      bodyHas: (await page.innerText('body')).includes('A24XSSPROBE'),
    };
  }
  await page.screenshot({ path: 'docs/audits/2026-08-23/a24-mobile-admin.png', fullPage: false });
  return out;
});

fs.writeFileSync('docs/audits/2026-08-23/a24-network.json', JSON.stringify(requests, null, 1));
const byHost = {};
for (const r of requests) { if (!r.host) continue; byHost[r.host] = (byHost[r.host] || 0) + 1; }
console.log('\n===== requests by host =====');
console.log(JSON.stringify(byHost, null, 1));
