#!/usr/bin/env node
/**
 * A08 · LIVE PostgREST probe (READ-ONLY, non-mutating).
 *
 * Two probe families, neither of which can write:
 *
 *  A) RPC existence + signature, via a DELIBERATELY BOGUS ARGUMENT.
 *     POST /rest/v1/rpc/<fn> {"__a08_probe__":1} -> PostgREST answers PGRST202
 *     ("Could not find the function ... in the schema cache") and its `hint`
 *     enumerates the signatures it DOES know. The function body never runs, so
 *     write RPCs are safe to probe this way. This proves BOTH that the function
 *     is live AND that PostgREST's schema cache can see it (a stale cache is a
 *     runtime 404 even when pg_proc has the row).
 *
 *  B) SELECT column/embed validity, via GET ...&limit=1. A single bad column
 *     makes PostgREST reject the WHOLE request with 400 (PGRST100/PGRST200),
 *     which is the "one typo blanks a whole screen" failure class.
 *
 * Secrets are read from .env.local and NEVER printed (G2).
 * Usage: node docs/audits/2026-08-23/a08-live-probe.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { SignJWT } from 'jose';

const ROOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const URL_BASE = `${env.VITE_SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SECRET = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);

const PERSONA = {
  subscriber: { id: 's-0001', claim: 'subscriberId', phone: '+256711000001' },
  agent: { id: 'a-001', claim: 'agentId', phone: '+256700000001' },
  branch: { id: 'b-kam-015', claim: 'branchId', phone: '+256700000011' },
  distributor: { id: 'd-001', claim: 'distributorId', phone: '+256700000021' },
  employer: { id: 'emp-001', claim: 'employerId', phone: '+256700000031' },
  admin: { id: 'admin-001', claim: 'adminId', phone: '+256700000041' },
};
const tokens = {};
async function mint(role) {
  if (tokens[role]) return tokens[role];
  const p = PERSONA[role];
  const t = await new SignJWT({
    role: 'authenticated', app_role: role, phone: p.phone, [p.claim]: p.id,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('upensions').setAudience('authenticated').setSubject(p.phone)
    .setIssuedAt().setExpirationTime('1h').sign(SECRET);
  tokens[role] = t;
  return t;
}

async function call(method, url, role, body, extraHeaders = {}) {
  const auth = role === 'anon' ? ANON : await mint(role);
  const res = await fetch(url, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${auth}`,
      'Content-Type': 'application/json', ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let text = '';
  try { text = await res.text(); } catch { /* ignore */ }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text };
}

/* ---------------------------------------------- who calls what (file -> role) */
const ROLE_OF_FILE = (file, fn) => {
  if (/subscriber\.js/.test(file)) {
    if (['create_subscriber_from_signup', 'get_employer_invite', 'create_subscriber_from_employer_invite'].includes(fn)) return 'anon';
    return 'subscriber';
  }
  if (/agent\.js/.test(file)) return 'agent';
  if (/employer\.js/.test(file)) return 'employer';
  if (/nav\.js|accessRequests\.js|adminAttention\.js|nomineeClaims\.js/.test(file)) return 'admin';
  if (/entities\.js|commissions\.js|search\.js|notifications\.js/.test(file)) return 'distributor';
  return 'admin';
};

const report = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/audits/2026-08-23/a08-contract-report.json'), 'utf8'));

/* ------------------------------------------------------- A) RPC probes */
const rpcResults = [];
const seen = new Set();
for (const r of report.rpcAll) {
  if (!r.name || seen.has(r.name)) continue;
  seen.add(r.name);
  const role = ROLE_OF_FILE(r.file, r.name);
  const res = await call('POST', `${URL_BASE}/rpc/${r.name}`, role, { __a08_probe__: 1 });
  let code = '', msg = '', hint = '';
  try { const j = JSON.parse(res.text); code = j.code || ''; msg = j.message || ''; hint = j.hint || ''; } catch { msg = res.text.slice(0, 200); }
  // Extract the signature PostgREST knows about out of the hint.
  const sigs = [...(hint || '').matchAll(/public\.([a-z0-9_]+)\(([^)]*)\)/gi)].map((m) => `${m[1]}(${m[2]})`);
  rpcResults.push({
    fn: r.name, file: r.file, line: r.line, role, status: res.status, code,
    knownSignatures: sigs, passed: r.passed, hint: hint.slice(0, 300), msg: msg.slice(0, 200),
  });
}

/* ------------------------------------------------------- B) SELECT probes */
const selResults = [];
const MEMBER_SELECT = '*, subscriber_balances(*), contribution_schedules(*), insurance_policies(*), nominees(*)';
for (const s of report.selectSites) {
  let sel = s.selectRaw;
  if (sel === null && /employer\.js/.test(s.file)) sel = MEMBER_SELECT;
  if (sel === null || sel.trim() === '') continue;
  const role = ROLE_OF_FILE(s.file, '');
  const url = `${URL_BASE}/${s.table}?select=${encodeURIComponent(sel.replace(/\s+/g, ''))}&limit=1`;
  const res = await call('GET', url, role);
  let code = '', msg = '', details = '';
  try { const j = JSON.parse(res.text); code = j.code || ''; msg = j.message || ''; details = j.details || ''; } catch { /* array body = success */ }
  selResults.push({
    file: s.file, line: s.line, table: s.table, role, status: res.status, code,
    msg: String(msg).slice(0, 220), details: String(details).slice(0, 160),
    select: sel.replace(/\s+/g, ' ').slice(0, 220),
    contentRange: res.headers['content-range'] || '',
  });
}

/* ------------------------------------------ C) PostgREST db-max-rows detection */
const capProbe = {};
for (const [table, role] of [['subscribers', 'admin'], ['transactions', 'admin'], ['commissions', 'distributor']]) {
  const res = await call('GET', `${URL_BASE}/${table}?select=id`, role, undefined, { Prefer: 'count=exact' });
  let n = null;
  try { n = JSON.parse(res.text).length; } catch { /* ignore */ }
  capProbe[table] = { status: res.status, rowsReturned: n, contentRange: res.headers['content-range'] || '' };
}

const out = { rpcResults, selResults, capProbe };
fs.writeFileSync(path.join(ROOT, 'docs/audits/2026-08-23/a08-live-probe.json'), JSON.stringify(out, null, 2));

console.log('=== RPC PROBES (PGRST202 expected; anything else is notable) ===');
for (const r of rpcResults) {
  const ok = r.code === 'PGRST202';
  const sig = r.knownSignatures.join(' | ') || '(none returned)';
  console.log(`${ok ? 'RESOLVED' : 'ATTENTION'}  ${r.fn.padEnd(42)} role=${r.role.padEnd(11)} http=${r.status} code=${r.code}  known=${sig}`);
  if (!ok) console.log(`    msg=${r.msg}`);
}
console.log('\n=== SELECT PROBES ===');
for (const s of selResults) {
  console.log(`${s.status === 200 ? 'OK  ' : 'FAIL'} http=${s.status} ${s.code ? '[' + s.code + '] ' : ''}${s.file}:${s.line} ${s.table} role=${s.role} range=${s.contentRange}`);
  if (s.status !== 200) console.log(`    select=${s.select}\n    msg=${s.msg} ${s.details}`);
}
console.log('\n=== ROW-CAP PROBE ===');
console.log(JSON.stringify(capProbe, null, 2));
