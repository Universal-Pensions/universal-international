// A24 — third-party network surface + anon PostgREST reads.
// Captures EVERY request (url, method, status, referer, cookie-presence) for:
//   (a) the public landing page, logged OUT
//   (b) an AUTHENTICATED distributor session on the map page (Leaflet tiles)
//   (c) an AUTHENTICATED subscriber dashboard session
import { chromium } from '@playwright/test';
import { SignJWT } from 'jose';
import fs from 'node:fs';

const BASE = 'http://localhost:5173';
const SECRET = process.env.SUPABASE_JWT_SECRET;
const now = Math.floor(Date.now() / 1000);
const mint = (role, id, field, phone) => new SignJWT({ sub: id, role: 'authenticated', app_role: role, phone, [field]: id })
  .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('upensions').setAudience('authenticated')
  .setIssuedAt(now).setExpirationTime(now + 3600).sign(new TextEncoder().encode(SECRET));

const all = [];
async function capture(label, storage, steps) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: storage });
  const page = await ctx.newPage();
  page.on('requestfinished', async (r) => {
    let host = ''; try { host = new URL(r.url()).host; } catch { return; }
    const hdr = r.headers();
    let status = null; try { status = (await r.response())?.status() ?? null; } catch { /* noop */ }
    all.push({ label, host, method: r.method(), status, type: r.resourceType(),
      url: r.url().slice(0, 260), referer: hdr.referer || null,
      hasCookie: !!hdr.cookie, hasAuth: !!hdr.authorization, hasApikey: !!hdr.apikey });
  });
  page.on('requestfailed', async (r) => {
    let host = ''; try { host = new URL(r.url()).host; } catch { return; }
    all.push({ label, host, method: r.method(), status: 'FAILED', type: r.resourceType(), url: r.url().slice(0, 260) });
  });
  await steps(page);
  await browser.close();
}

const empty = { cookies: [], origins: [] };
const withTok = (tok, user) => ({ cookies: [], origins: [{ origin: BASE, localStorage: [
  { name: 'upensions_token', value: tok }, { name: 'upensions_auth', value: JSON.stringify(user) }] }] });

await capture('anon-landing', empty, async (page) => {
  for (const p of ['/', '/subscribers', '/about', '/contact', '/claim', '/request-access']) {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);
  }
});

const dTok = await mint('distributor', 'd-001', 'distributorId', '+256700000021');
await capture('auth-distributor-map', withTok(dTok, { role: 'distributor', distributorId: 'd-001', phone: '+256700000021', name: 'Default distributor' }), async (page) => {
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  // try to force map mode
  const mapBtn = page.locator('button[aria-label="Map view"]').first();
  if (await mapBtn.count()) { await mapBtn.click({ force: true }).catch(() => {}); await page.waitForTimeout(6000); }
});

const sTok = await mint('subscriber', 's-0001', 'subscriberId', '+256711000001');
await capture('auth-subscriber', withTok(sTok, { role: 'subscriber', subscriberId: 's-0001', phone: '+256711000001', name: 'Brian Okello' }), async (page) => {
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
});

fs.writeFileSync('docs/audits/2026-08-23/a24-thirdparty.json', JSON.stringify(all, null, 1));

const summary = {};
for (const r of all) {
  const k = `${r.label} | ${r.host}`;
  summary[k] = summary[k] || { n: 0, statuses: {}, referers: new Set(), types: new Set(), auth: 0, cookie: 0 };
  summary[k].n++;
  summary[k].statuses[r.status] = (summary[k].statuses[r.status] || 0) + 1;
  if (r.referer) summary[k].referers.add(r.referer);
  summary[k].types.add(r.type);
  if (r.hasAuth) summary[k].auth++;
  if (r.hasCookie) summary[k].cookie++;
}
for (const [k, v] of Object.entries(summary)) {
  console.log(`${k}  n=${v.n} statuses=${JSON.stringify(v.statuses)} types=${[...v.types].join(',')} authHdr=${v.auth} cookieHdr=${v.cookie} referers=${JSON.stringify([...v.referers])}`);
}
console.log('\n--- non-2xx to supabase ---');
for (const r of all) if (r.host.includes('supabase') && r.status !== 200 && r.status !== 206) console.log(r.label, r.status, r.method, r.url.slice(0, 160), 'auth=' + r.hasAuth);
