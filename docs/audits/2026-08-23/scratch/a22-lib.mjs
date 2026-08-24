// A22 shared harness. Throwaway — listed for removal in 22-state-errors.md.
import { chromium } from 'playwright';
import { SignJWT } from 'jose';
import fs from 'node:fs';

export const BASE = 'http://localhost:5173';

// Load .env.local without echoing secrets.
const env = {};
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const PERSONAS = {
  subscriber:  { id: 's-0001',    phone: '+256711000001', name: 'Brian Okello',                    idField: 'subscriberId' },
  agent:       { id: 'a-001',     phone: '+256700000001', name: 'Default agent (Kampala)',         idField: 'agentId' },
  branch:      { id: 'b-kam-015', phone: '+256700000011', name: 'Default branch (Kampala Central)',idField: 'branchId' },
  distributor: { id: 'd-001',     phone: '+256700000021', name: 'Default distributor',             idField: 'distributorId' },
  employer:    { id: 'emp-001',   phone: '+256700000031', name: 'Default employer (Nile Breweries Demo)', idField: 'employerId' },
  admin:       { id: 'admin-001', phone: '+256700000041', name: 'Default admin (head office)',     idField: 'adminId' },
};

export async function mint(role, { ttlSec = 86400, entityId } = {}) {
  const p = PERSONAS[role];
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: entityId || p.id, role: 'authenticated', app_role: role,
    phone: p.phone, [p.idField]: entityId || p.id,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('upensions').setAudience('authenticated')
    .setIssuedAt(now).setExpirationTime(now + ttlSec)
    .sign(new TextEncoder().encode(env.SUPABASE_JWT_SECRET));
}

export function userObj(role) {
  const p = PERSONAS[role];
  return { role, phone: p.phone, name: p.name, [p.idField]: p.id };
}

export async function browser(opts = {}) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
  return { b, ctx };
}

/** Seed a session into localStorage before the app boots. */
export async function seed(ctx, role, tokenOpts) {
  const token = await mint(role, tokenOpts);
  const u = JSON.stringify(userObj(role));
  await ctx.addInitScript(([t, uu]) => {
    localStorage.setItem('upensions_token', t);
    localStorage.setItem('upensions_auth', uu);
  }, [token, u]);
  return token;
}

/** Real UI sign-in via the SignInModal (phone + any 6-digit OTP). */
export async function uiSignIn(page, { landingPath, phone, code = '123456' }) {
  await page.goto(BASE + landingPath, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  let tel = page.locator('input[type="tel"]:visible').first();
  if (!(await tel.count())) {
    await page.getByRole('button', { name: /^Sign in$/i }).first().click();
    await page.waitForTimeout(900);
    tel = page.locator('input[type="tel"]:visible').first();
  }
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.fill(phone);
  await page.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
  const d0 = page.locator('input[name="otp-0"]');
  await d0.waitFor({ state: 'visible', timeout: 20000 });
  for (let i = 0; i < 6; i++) await page.locator(`input[name="otp-${i}"]`).fill(code[i]);
  await page.getByRole('button', { name: /verify/i }).first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 40000 });
}

export const PHONES = Object.fromEntries(
  Object.entries(PERSONAS).map(([r, p]) => [r, p.phone]),
);

export function txt(page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
}
