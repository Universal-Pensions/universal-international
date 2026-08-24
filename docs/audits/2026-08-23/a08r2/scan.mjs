#!/usr/bin/env node
/**
 * A08 round-2 · PostgREST / RPC contract scanner (REPORT-ONLY, read-only).
 * Extends round 1 by ALSO scanning api/ and server/ (service-role PostgREST calls)
 * and by verifying WRITE PAYLOAD KEYS, RPC ARG TYPES, and column-level GRANTs.
 *
 * Usage: node docs/audits/2026-08-23/a08r2/scan.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard';
const D = path.join(ROOT, 'docs/audits/2026-08-23/a08r2');

/* ---------- live truth ---------- */
const FN = new Map();
for (const l of fs.readFileSync(path.join(D, 'functions.txt'), 'utf8').trim().split('\n')) {
  const [name, ident, full, result, secdef, vol, anon, auth, svc] = l.split('|');
  const args = [];
  if (full && full.trim()) {
    let depth = 0, cur = '', parts = [];
    for (const ch of full) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    for (const p of parts) {
      const t = p.trim();
      const hasDef = / DEFAULT /i.test(t);
      const nd = t.replace(/ DEFAULT [\s\S]*$/i, '').trim();
      const m = nd.match(/^(?:(?:IN|OUT|INOUT|VARIADIC)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
      args.push(m ? { name: m[1], type: m[2].trim(), hasDef } : { name: null, type: nd, hasDef });
    }
  }
  FN.set(name, { ident, full, result, secdef: secdef === 't', vol, anon: anon === 't', auth: auth === 't', svc: svc === 't', args });
}

const COLS = new Map();   // table -> Map(col -> {type, notnull, hasdefault, isident})
for (const l of fs.readFileSync(path.join(D, 'columns.txt'), 'utf8').trim().split('\n')) {
  const [t, c, ty, nn, hd, ii] = l.split('|');
  if (!COLS.has(t)) COLS.set(t, new Map());
  COLS.get(t).set(c, { type: ty, notnull: nn === 't', hasdefault: hd === 't', isident: ii === 't' });
}

const FK = fs.readFileSync(path.join(D, 'fk.txt'), 'utf8').trim().split('\n').map((l) => {
  const [child, childCol, parent, parentCol, name] = l.split('|');
  return { child, childCol, parent, parentCol, name };
});

const COLGRANT = new Map(); // `${table}|${grantee}|${priv}` -> Set(cols)
for (const l of fs.readFileSync(path.join(D, 'colgrants.txt'), 'utf8').trim().split('\n')) {
  const [t, g, p, c] = l.split('|');
  const k = `${t}|${g}|${p}`;
  if (!COLGRANT.has(k)) COLGRANT.set(k, new Set());
  COLGRANT.get(k).add(c);
}

/* ---------- file walk ---------- */
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules' || e.name === 'dist') continue; walk(p, acc); }
    else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const FILES = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'api')), ...walk(path.join(ROOT, 'server'))];

/* ---------- balanced reader ---------- */
function readBalanced(src, openIdx) {
  let depth = 0, i = openIdx, q = null;
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return [src.slice(openIdx + 1, i), i + 1]; }
  }
  return [src.slice(openIdx + 1), src.length];
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/* strip // and /* *​/ comments but preserve offsets */
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i];
    if (q) { out += c; if (c === q && src[i - 1] !== '\\') q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); const stop = end === -1 ? src.length : end + 2; for (let k = i; k < stop; k++) out += (src[k] === '\n' ? '\n' : ' '); i = stop; continue; }
    out += c; i++;
  }
  return out;
}

/* ---------- top-level object-literal keys ---------- */
function objKeys(text) {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  const inner = t.slice(1, t.lastIndexOf('}'));
  const keys = []; let depth = 0, q = null, cur = '';
  const parts = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i], prev = inner[i - 1];
    if (q) { cur += c; if (c === q && prev !== '\\') q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const s = p.trim();
    if (!s) continue;
    if (s.startsWith('...')) { keys.push({ key: '...SPREAD', spread: true, raw: s }); continue; }
    if (s.startsWith('[')) { keys.push({ key: '...COMPUTED', computed: true, raw: s }); continue; }
    const m = s.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]*)$/);
    if (m) { keys.push({ key: m[1] || m[2] || m[3], value: m[4].trim(), raw: s }); continue; }
    const sh = s.match(/^([A-Za-z_$][\w$]*)$/);
    if (sh) { keys.push({ key: sh[1], value: sh[1], shorthand: true, raw: s }); continue; }
    keys.push({ key: '...UNPARSED', raw: s });
  }
  return keys;
}

const strLit = (t) => { const m = t.trim().match(/^'([^']*)'$|^"([^"]*)"$|^`([^`$]*)`$/); return m ? (m[1] ?? m[2] ?? m[3]) : null; };

/* ---------- select() column extraction (handles embeds) ---------- */
function parseSelect(sel) {
  // returns { cols: [names], embeds: [{name, inner}] }
  const cols = [], embeds = [];
  let depth = 0, cur = '', parts = [];
  for (const ch of sel) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  for (const raw of parts) {
    const p = raw.trim().replace(/\s+/g, '');
    if (!p) continue;
    const em = p.match(/^([A-Za-z_][\w:!.]*)\(([\s\S]*)\)$/);
    if (em) {
      let nm = em[1];
      let alias = null, hint = null;
      if (nm.includes(':')) { const [a, b] = nm.split(':'); alias = a; nm = b; }
      if (nm.includes('!')) { const [a, b] = nm.split('!'); nm = a; hint = b; }
      embeds.push({ name: nm, alias, hint, inner: em[2] });
      continue;
    }
    let c = p;
    if (c.includes(':')) c = c.split(':')[1];
    c = c.replace(/::.*$/, '').replace(/\.\.\..*$/, '');
    if (c === '*' || c === '') continue;
    if (c.startsWith('count')) { cols.push(c); continue; }
    cols.push(c.split('->')[0].split('.')[0]);
  }
  return { cols, embeds };
}

/* ---------- scan ---------- */
const FILTER_METHODS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'rangeGt', 'rangeLt', 'overlaps', 'textSearch', 'not', 'filter']);
const rpcSites = [], fromSites = [];
let filesScanned = 0;

for (const f of FILES) {
  if (/__tests__|\.test\.|\.spec\./.test(f)) continue;
  const raw = fs.readFileSync(f, 'utf8');
  const src = stripComments(raw);
  filesScanned++;
  const rel = path.relative(ROOT, f);

  // --- .rpc(
  let idx = 0;
  while ((idx = src.indexOf('.rpc(', idx)) !== -1) {
    const [inner, after] = readBalanced(src, idx + 4);
    // split top-level args
    let depth = 0, q = null, cur = '', parts = [];
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i], prev = inner[i - 1];
      if (q) { cur += c; if (c === q && prev !== '\\') q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) depth--;
      if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) parts.push(cur);
    const nameLit = strLit(parts[0] || '');
    rpcSites.push({ file: rel, line: lineOf(src, idx), name: nameLit, nameRaw: (parts[0] || '').trim(), argsRaw: (parts[1] || '').trim(), keys: parts[1] ? objKeys(parts[1]) : [] });
    idx = after;
  }

  // --- .from( chains
  idx = 0;
  while ((idx = src.indexOf('.from(', idx)) !== -1) {
    const before = src.slice(Math.max(0, idx - 40), idx);
    if (/Array\s*$/.test(before) || /Object\s*$/.test(before) || /Buffer\s*$/.test(before)) { idx += 5; continue; }
    const [inner, after] = readBalanced(src, idx + 5);
    const tableLit = strLit(inner);
    const site = { file: rel, line: lineOf(src, idx), table: tableLit, tableRaw: inner.trim(), chain: [] };
    // walk the chain
    let i = after;
    for (;;) {
      const m = /^[\s\n]*\.[\s\n]*([A-Za-z_$][\w$]*)[\s\n]*\(/.exec(src.slice(i));
      if (!m) break;
      const openRel = m[0].lastIndexOf('(');
      const open = i + m.index + openRel;
      const [argInner, next] = readBalanced(src, open);
      site.chain.push({ m: m[1], arg: argInner });
      i = next;
    }
    fromSites.push(site);
    idx = after;
  }
}

/* ---------- verify ---------- */
const issues = [];
const add = (sev, kind, o) => issues.push({ sev, kind, ...o });

// RPC
let rpcOk = 0;
for (const r of rpcSites) {
  if (!r.name) { add('info', 'rpc-dynamic-name', r); continue; }
  const fn = FN.get(r.name);
  if (!fn) { add('CRIT', 'rpc-missing-live', { file: r.file, line: r.line, name: r.name }); continue; }
  rpcOk++;
  const known = new Set(fn.args.map((a) => a.name));
  const provided = new Set();
  let dynamic = false;
  for (const k of (r.keys || [])) {
    if (k.key.startsWith('...')) { dynamic = true; continue; }
    provided.add(k.key);
    if (!known.has(k.key)) add('CRIT', 'rpc-unknown-arg', { file: r.file, line: r.line, name: r.name, arg: k.key, live: fn.ident });
  }
  if (!dynamic && r.argsRaw && !r.argsRaw.startsWith('{')) dynamic = true;
  for (const a of fn.args) {
    if (a.hasDef) continue;
    if (!provided.has(a.name) && !dynamic) add('CRIT', 'rpc-missing-required-arg', { file: r.file, line: r.line, name: r.name, arg: a.name, live: fn.ident });
  }
  // crude type check: array-typed pg params should get array-looking JS
  for (const k of (r.keys || [])) {
    const a = fn.args.find((x) => x.name === k.key);
    if (!a || !k.value) continue;
    const v = k.value;
    const isArrLit = v.startsWith('[') || /\.map\(|\.filter\(|Array\.from|Object\.keys\(|\.split\(/.test(v);
    const isStrLit = /^['"`]/.test(v);
    const isNumLit = /^-?\d+(\.\d+)?$/.test(v);
    const isObjLit = v.startsWith('{');
    if (a.type.endsWith('[]')) {
      if (isStrLit || isNumLit || isObjLit) add('HIGH', 'rpc-argtype-scalar-for-array', { file: r.file, line: r.line, name: r.name, arg: k.key, pgType: a.type, js: v.slice(0, 60) });
    } else if (/^(text|character varying|uuid)$/.test(a.type)) {
      if (isArrLit && v.startsWith('[')) add('HIGH', 'rpc-argtype-array-for-scalar', { file: r.file, line: r.line, name: r.name, arg: k.key, pgType: a.type, js: v.slice(0, 60) });
      if (isObjLit) add('HIGH', 'rpc-argtype-object-for-text', { file: r.file, line: r.line, name: r.name, arg: k.key, pgType: a.type, js: v.slice(0, 60) });
    } else if (/^(numeric|integer|bigint|double precision|smallint)$/.test(a.type)) {
      if (isObjLit || (isArrLit && v.startsWith('['))) add('HIGH', 'rpc-argtype-nonscalar-for-number', { file: r.file, line: r.line, name: r.name, arg: k.key, pgType: a.type, js: v.slice(0, 60) });
    } else if (a.type === 'jsonb' || a.type === 'json') {
      if (isNumLit) add('MED', 'rpc-argtype-number-for-jsonb', { file: r.file, line: r.line, name: r.name, arg: k.key, pgType: a.type, js: v.slice(0, 60) });
    } else if (a.type === 'boolean') {
      if (isStrLit || isNumLit) add('MED', 'rpc-argtype-nonbool', { file: r.file, line: r.line, name: r.name, arg: k.key, pgType: a.type, js: v.slice(0, 60) });
    }
  }
}

// from() chains
const stats = { selects: 0, selectDynamic: 0, colRefs: 0, embeds: 0, filters: 0, filterDynamic: 0, orders: 0, writes: 0, writeKeys: 0, writeDynamic: 0 };
const CTX = { 'src/services': 'authenticated', 'src/': 'authenticated', 'api/': 'service_role', 'server/': 'service_role' };
function granteeFor(file) { return (file.startsWith('api/') || file.startsWith('server/')) ? 'service_role' : 'authenticated'; }

for (const s of fromSites) {
  if (!s.table) { add('info', 'from-dynamic-table', { file: s.file, line: s.line, raw: s.tableRaw }); }
  const tcols = s.table ? COLS.get(s.table) : null;
  if (s.table && !tcols) { add('CRIT', 'from-unknown-table', { file: s.file, line: s.line, table: s.table }); continue; }

  for (const step of s.chain) {
    const { m, arg } = step;
    if (m === 'select') {
      stats.selects++;
      const lit = strLit(arg.replace(/,\s*\{[\s\S]*$/, ''));
      if (lit === null) { stats.selectDynamic++; add('info', 'select-dynamic', { file: s.file, line: s.line, table: s.table, raw: arg.slice(0, 80) }); continue; }
      const { cols, embeds } = parseSelect(lit);
      for (const c of cols) {
        stats.colRefs++;
        if (tcols && !tcols.has(c) && !/^count$/.test(c)) add('CRIT', 'select-bad-column', { file: s.file, line: s.line, table: s.table, col: c });
      }
      for (const e of embeds) {
        stats.embeds++;
        const target = COLS.get(e.name);
        const viaFk = FK.some((k) => (k.child === s.table && k.parent === e.name) || (k.parent === s.table && k.child === e.name)) || FK.some((k) => k.name === e.name);
        if (!target && !FK.some((k) => k.name === e.name)) { add('CRIT', 'embed-unknown-target', { file: s.file, line: s.line, table: s.table, embed: e.name }); continue; }
        if (target && !viaFk) add('HIGH', 'embed-no-fk', { file: s.file, line: s.line, table: s.table, embed: e.name });
        if (target) {
          const sub = parseSelect(e.inner);
          for (const c of sub.cols) { stats.colRefs++; if (!target.has(c)) add('CRIT', 'embed-bad-column', { file: s.file, line: s.line, table: s.table, embed: e.name, col: c }); }
        }
        // ambiguity: >1 FK between the two tables
        const nFk = FK.filter((k) => (k.child === s.table && k.parent === e.name) || (k.parent === s.table && k.child === e.name)).length;
        if (nFk > 1 && !e.hint) add('HIGH', 'embed-ambiguous', { file: s.file, line: s.line, table: s.table, embed: e.name, fks: nFk });
      }
    } else if (FILTER_METHODS.has(m)) {
      stats.filters++;
      const first = arg.split(',')[0];
      const col = strLit(first);
      if (col === null) { stats.filterDynamic++; add('info', 'filter-dynamic-col', { file: s.file, line: s.line, table: s.table, method: m, raw: first.trim().slice(0, 60) }); continue; }
      const base = col.split('->')[0].split('.')[0].replace(/\(.*/, '');
      if (tcols && !tcols.has(base)) {
        // could be an embedded-resource filter like 'subscriber_balances.total_balance'
        const parts = col.split('.');
        if (parts.length > 1 && COLS.has(parts[0]) && COLS.get(parts[0]).has(parts[1])) { /* ok, embedded filter */ }
        else add('CRIT', 'filter-bad-column', { file: s.file, line: s.line, table: s.table, method: m, col });
      }
    } else if (m === 'order') {
      stats.orders++;
      const col = strLit(arg.split(',')[0]);
      if (col === null) { add('info', 'order-dynamic-col', { file: s.file, line: s.line, table: s.table, raw: arg.slice(0, 60) }); continue; }
      const base = col.split('->')[0].split('.')[0];
      if (tcols && !tcols.has(base)) {
        const parts = col.split('.');
        if (!(parts.length > 1 && COLS.has(parts[0]) && COLS.get(parts[0]).has(parts[1]))) add('CRIT', 'order-bad-column', { file: s.file, line: s.line, table: s.table, col });
      }
    } else if (m === 'insert' || m === 'update' || m === 'upsert') {
      stats.writes++;
      const g = granteeFor(s.file);
      const priv = m === 'update' ? 'UPDATE' : 'INSERT';
      const grantSet = COLGRANT.get(`${s.table}|${g}|${priv}`) || new Set();
      let body = arg;
      // upsert(obj, {onConflict}) -> first arg only
      const keys = objKeys(body);
      if (!keys) {
        // maybe array literal of objects, or a variable
        const arrM = body.trim().match(/^\[([\s\S]*)\]$/);
        if (arrM) { const k2 = objKeys('{' + '}'); }
        stats.writeDynamic++;
        add('info', 'write-dynamic-payload', { file: s.file, line: s.line, table: s.table, method: m, raw: body.trim().slice(0, 80) });
        continue;
      }
      for (const k of keys) {
        if (k.key.startsWith('...')) { stats.writeDynamic++; add('info', 'write-spread-payload', { file: s.file, line: s.line, table: s.table, method: m, raw: k.raw.slice(0, 80) }); continue; }
        stats.writeKeys++;
        if (tcols && !tcols.has(k.key)) { add('CRIT', 'write-bad-column', { file: s.file, line: s.line, table: s.table, method: m, col: k.key }); continue; }
        if (g === 'authenticated' && grantSet.size && !grantSet.has(k.key)) add('HIGH', 'write-col-not-granted', { file: s.file, line: s.line, table: s.table, method: m, col: k.key, grantee: g, priv });
      }
      // NOT NULL, no default, not provided (INSERT only)
      if (m === 'insert' && tcols && keys.every((k) => !k.key.startsWith('...'))) {
        const provided = new Set(keys.map((k) => k.key));
        for (const [c, meta] of tcols) {
          if (meta.notnull && !meta.hasdefault && !meta.isident && !provided.has(c)) add('HIGH', 'insert-missing-notnull', { file: s.file, line: s.line, table: s.table, col: c, type: meta.type });
        }
      }
    }
  }
}

const out = {
  filesScanned,
  rpcSites: rpcSites.length,
  rpcDistinct: new Set(rpcSites.filter((r) => r.name).map((r) => r.name)).size,
  rpcResolved: rpcOk,
  fromSites: fromSites.length,
  ...stats,
  issuesBySeverity: issues.reduce((a, i) => (a[i.sev] = (a[i.sev] || 0) + 1, a), {}),
  issuesByKind: issues.reduce((a, i) => (a[i.kind] = (a[i.kind] || 0) + 1, a), {}),
};
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(D, 'report.json'), JSON.stringify({ summary: out, issues, rpcSites, fromSites }, null, 2));
console.log('\n=== NON-INFO ISSUES ===');
for (const i of issues.filter((x) => x.sev !== 'info')) console.log(`${i.sev} ${i.kind} :: ${JSON.stringify(i)}`);
console.log('\n=== INFO (dynamic / unresolvable — need manual resolution) ===');
for (const i of issues.filter((x) => x.sev === 'info')) console.log(`${i.kind} :: ${i.file}:${i.line} ${i.table || i.name || ''} ${i.raw || i.method || ''}`);
