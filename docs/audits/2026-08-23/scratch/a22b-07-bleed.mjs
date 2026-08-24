// A22 throwaway — CROSS-ROLE CACHE BLEED without an intervening logout.
// AuthContext.logout() calls queryClient.clear(); AuthContext.login() does NOT.
// The public landing login cards (LandingLoginCard) render with NO isAuthenticated
// guard, so a live session can sign in as another role in the same tab.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';

async function signInFromLanding(page, path, roleTab, phone) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (roleTab) {
    const tab = page.getByRole('tab', { name: new RegExp(roleTab, 'i') }).first();
    if (await tab.count()) await tab.click();
  }
  const tel = page.locator('input[type="tel"]:visible').first();
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.fill(phone);
  await page.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
  await page.locator('input[name="otp-0"]').waitFor({ state: 'visible', timeout: 25000 });
  for (let i = 0; i < 6; i++) await page.locator(`input[name="otp-${i}"]`).fill('123456'[i]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
}

function head(t) {
  const m = t.match(/(DISTRIBUTOR · NETWORK OVERVIEW|PLATFORM · NATIONAL OVERVIEW)([\s\S]{0,320})/);
  return m ? (m[1] + m[2]).replace(/\s+/g, ' ') : t.slice(0, 320);
}

const b = await chromium.launch({ headless: true });

// ---------- CONTROL: clean distributor d-002 session ----------
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signInFromLanding(page, '/distributors', 'Distributor', '+256700000022');
  await page.waitForTimeout(9000);
  const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('CONTROL (clean d-002 login):\n  ' + head(t) + '\n');
  await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-bleed-control-d002.png' });
  await ctx.close();
}

// ---------- BLEED: admin session, then distributor login with NO logout ----------
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/admin.json' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);
  const admin = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('STEP 1 admin dashboard:\n  ' + head(admin) + '\n');
  await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-bleed-1-admin.png' });

  const rest = [];
  page.on('request', (r) => { if (/rest\/v1\//.test(r.url())) rest.push(r.url().split('/rest/v1/')[1].split('?')[0]); });
  await signInFromLanding(page, '/distributors', 'Distributor', '+256700000022');
  await page.waitForTimeout(9000);
  const dist = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  console.log('STEP 2 distributor d-002 signed in WITHOUT logout:\n  ' + head(dist) + '\n');
  console.log('  rest calls after switch: ' + JSON.stringify([...new Set(rest)]));
  await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22b-bleed-2-distributor.png' });
  await ctx.close();
}
await b.close();
