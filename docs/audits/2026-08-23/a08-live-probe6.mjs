#!/usr/bin/env node
/**
 * A08 · execute every STABLE (provably non-writing) read RPC the frontend calls,
 * with the frontend's real argument names, as the role that calls it — and
 * capture the ACTUAL returned key set. This is the ground truth to diff the
 * service mappers and the mock fallbacks against (checks 1 + 6).
 *
 * Only functions with pg_proc.provolatile='s' are invoked: a STABLE function
 * cannot write. No write RPC is ever executed.
 */
import fs from 'node:fs';
import { SignJWT } from 'jose';

const ROOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env = {};
for (const l of fs.readFileSync(`${ROOT}/.env.local`, 'utf8').split('\n')) {
  const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = `${env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SECRET = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const P = {
  subscriber: ['subscriberId', 's-0001', '+256711000001'],
  agent: ['agentId', 'a-001', '+256700000001'],
  branch: ['branchId', 'b-kam-015', '+256700000011'],
  distributor: ['distributorId', 'd-001', '+256700000021'],
  employer: ['employerId', 'emp-001', '+256700000031'],
  admin: ['adminId', 'admin-001', '+256700000041'],
};
const cache = {};
async function tok(r) {
  if (cache[r]) return cache[r];
  const [c, i, p] = P[r];
  cache[r] = await new SignJWT({ role: 'authenticated', app_role: r, phone: p, [c]: i })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('upensions').setAudience('authenticated')
    .setSubject(p).setIssuedAt().setExpirationTime('1h').sign(SECRET);
  return cache[r];
}
async function rpc(name, role, args) {
  const t = await tok(role);
  const r = await fetch(`${BASE}/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}
const keysOf = (v) => {
  if (Array.isArray(v)) return v.length ? ['[]', ...Object.keys(v[0])] : ['[] (empty)'];
  if (v && typeof v === 'object') return Object.keys(v);
  return [`scalar:${typeof v}:${JSON.stringify(v)?.slice(0, 40)}`];
};

// name, role, args — args are exactly what the service passes.
const CALLS = [
  ['get_admin_attention', 'admin', {}],
  ['get_admin_attention_rows', 'admin', { p_type: 'kyc_pending', p_limit: 5 }],
  ['get_commission_rate', 'distributor', {}],
  ['get_commission_summary', 'distributor', { p_branch_id: null }],
  ['get_entity_commission_summary', 'distributor', { p_level: 'branch', p_entity_id: 'b-kam-015' }],
  ['get_agent_commission_list', 'distributor', { p_status_focus: null }],
  ['get_agent_commission_detail', 'distributor', { p_agent_id: 'a-001' }],
  ['get_pending_dues_by_agent', 'distributor', {}],
  ['get_pending_dues_by_branch', 'distributor', {}],
  ['get_employer_metrics', 'employer', {}],
  ['get_all_employers_metrics', 'admin', {}],
  ['get_top_branch', 'distributor', { p_level: 'country', p_parent_id: 'ug' }],
  ['get_breadcrumb', 'distributor', { p_level: 'branch', p_ids: { branch: 'b-kam-015' } }],
  ['get_entity_metrics_rollup', 'distributor', { p_level: 'branch', p_entity_ids: ['b-kam-015'] }],
  ['get_distributor_rollup', 'admin', {}],
  ['get_top_entities', 'distributor', { p_level: 'branch', p_sort_key: 'aum', p_limit: 3 }],
  ['get_branch_pending_contributions', 'branch', { p_branch_id: 'b-kam-015' }],
  ['get_platform_overview', 'admin', {}],
  ['get_employer_geo_rollup', 'admin', {}],
  ['get_employer_activity_rollup', 'admin', {}],
  ['get_nav_overview', 'admin', { p_fund_code: 'UPU-BAL' }],
  ['list_nav_snapshots', 'admin', { p_fund_code: 'UPU-BAL', p_limit: 3, p_offset: 0, p_status: null }],
  ['list_nominee_claims', 'admin', { p_status: null }],
  ['list_access_requests', 'admin', { p_status: null }],
  ['search_entities', 'distributor', { p_q: 'kam' }],
  ['get_my_employer_funding', 'subscriber', {}],
];

const out = [];
for (const [name, role, args] of CALLS) {
  const r = await rpc(name, role, args);
  out.push({ name, role, args, status: r.status, keys: keysOf(r.body), sample: JSON.stringify(r.body).slice(0, 400) });
  console.log(`http=${r.status} ${name.padEnd(34)} role=${role.padEnd(11)} keys=${JSON.stringify(keysOf(r.body))}`);
  if (r.status >= 400) console.log(`    BODY: ${JSON.stringify(r.body).slice(0, 300)}`);
}
fs.writeFileSync(`${ROOT}/docs/audits/2026-08-23/a08-rpc-shapes.json`, JSON.stringify(out, null, 2));
