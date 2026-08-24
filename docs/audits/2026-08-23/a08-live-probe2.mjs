#!/usr/bin/env node
/**
 * A08 · supplementary LIVE probe for the VARIABLE / constant-indirected selects
 * my static parser could not resolve inline (LEVEL_LIST_COLUMNS, MEMBER_SELECT),
 * plus every `.order()` column used on a list path.
 * READ-ONLY: every request is a GET with limit=1 (or a HEAD count).
 */
import fs from 'node:fs';
import { SignJWT } from 'jose';

const ROOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env = {};
for (const line of fs.readFileSync(`${ROOT}/.env.local`, 'utf8').split('\n')) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = `${env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SECRET = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const PERSONA = {
  subscriber: ['subscriberId', 's-0001', '+256711000001'],
  agent: ['agentId', 'a-001', '+256700000001'],
  branch: ['branchId', 'b-kam-015', '+256700000011'],
  distributor: ['distributorId', 'd-001', '+256700000021'],
  employer: ['employerId', 'emp-001', '+256700000031'],
  admin: ['adminId', 'admin-001', '+256700000041'],
};
const cache = {};
async function tok(role) {
  if (cache[role]) return cache[role];
  const [claim, id, phone] = PERSONA[role];
  cache[role] = await new SignJWT({ role: 'authenticated', app_role: role, phone, [claim]: id })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('upensions').setAudience('authenticated')
    .setSubject(phone).setIssuedAt().setExpirationTime('1h').sign(SECRET);
  return cache[role];
}
async function get(url, role, extra = {}) {
  const t = role === 'anon' ? ANON : await tok(role);
  const r = await fetch(url, { headers: { apikey: ANON, Authorization: `Bearer ${t}`, ...extra } });
  const text = await r.text();
  let code = '', msg = '';
  try { const j = JSON.parse(text); if (!Array.isArray(j)) { code = j.code || ''; msg = j.message || ''; } } catch { /* */ }
  return { status: r.status, code, msg, cr: r.headers.get('content-range') || '', body: text.slice(0, 200) };
}

const LEVEL_LIST_COLUMNS = {
  regions: 'id, name, parent_id, center_lng, center_lat',
  districts: 'id, name, region_id, center_lng, center_lat, active',
  subscribers:
    'id, name, phone, email, gender, age, dob, nin, occupation, agent_id, '
    + 'district_id, kyc_status, is_active, registered_date, products_held, '
    + 'contribution_history, current_unit_value, unit_value_as_of, '
    + 'subscriber_balances(total_balance)',
  distributors: 'id, name, parent_id, manager_name, manager_phone, manager_email, status, created_at',
  branches: '*',
  agents: '*',
};
const MEMBER_SELECT = '*, subscriber_balances(*), contribution_schedules(*), insurance_policies(*), nominees(*)';

const results = [];
for (const role of ['admin', 'distributor', 'branch']) {
  for (const [table, cols] of Object.entries(LEVEL_LIST_COLUMNS)) {
    const r = await get(`${BASE}/${table}?select=${encodeURIComponent(cols.replace(/\s+/g, ''))}&limit=1`, role);
    results.push({ probe: 'LEVEL_LIST_COLUMNS', role, table, ...r });
  }
}
results.push({ probe: 'MEMBER_SELECT', role: 'employer', table: 'subscribers', ...(await get(`${BASE}/subscribers?select=${encodeURIComponent(MEMBER_SELECT.replace(/\s+/g, ''))}&limit=1`, 'employer')) });

// .order() columns used on list paths (entities.js SUBSCRIBER_SORT_ORDER + friends)
const ORDERS = [
  ['subscribers', 'registered_date', 'admin'], ['subscribers', 'name', 'admin'],
  ['subscribers', 'kyc_status', 'admin'], ['subscribers', 'is_active', 'admin'],
  ['transactions', 'date', 'subscriber'], ['transactions', 'date', 'employer'],
  ['claims', 'submitted_date', 'subscriber'], ['withdrawals', 'date', 'subscriber'],
  ['nominees', 'created_at', 'subscriber'], ['contribution_runs', 'run_at', 'employer'],
  ['notifications', 'created_at', 'distributor'], ['settlement_batches', 'created_at', 'distributor'],
  ['employer_invites', 'created_at', 'employer'], ['commissions', 'first_contribution_date', 'distributor'],
];
for (const [t, c, role] of ORDERS) {
  const r = await get(`${BASE}/${t}?select=*&order=${c}.desc&limit=1`, role);
  results.push({ probe: 'ORDER', role, table: `${t}.${c}`, ...r });
}

// Row-cap confirmation, per role, on the biggest unbounded reads.
const caps = [];
for (const [label, url, role] of [
  ['employer run contributions (getEmployerContributions)',
    `${BASE}/transactions?select=*,subscribers(name)&type=eq.contribution&contribution_run_id=not.is.null`, 'employer'],
  ['distributor commissions (unbounded .from(commissions))',
    `${BASE}/commissions?select=subscriber_id,subscriber_name,status,first_contribution_date`, 'distributor'],
  ['agent subscriber list', `${BASE}/subscribers?select=id`, 'agent'],
  ['subscriber transactions', `${BASE}/transactions?select=id`, 'subscriber'],
]) {
  const r = await get(url, role, { Prefer: 'count=exact' });
  let n = null; try { n = JSON.parse(r.body.startsWith('[') ? r.body : '[]').length; } catch { /* */ }
  caps.push({ label, role, status: r.status, contentRange: r.cr, note: n });
}

fs.writeFileSync(`${ROOT}/docs/audits/2026-08-23/a08-live-probe2.json`, JSON.stringify({ results, caps }, null, 2));
for (const r of results) {
  console.log(`${r.status === 200 ? 'OK  ' : 'FAIL'} http=${r.status} ${r.code ? '[' + r.code + '] ' : ''}${r.probe} ${r.table} role=${r.role} ${r.msg}`);
}
console.log('\n=== unbounded-read caps ===');
for (const c of caps) console.log(`${c.label} role=${c.role} http=${c.status} Content-Range=${c.contentRange}`);
