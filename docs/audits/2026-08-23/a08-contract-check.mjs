#!/usr/bin/env node
/**
 * A08 · RPC & PostgREST contract conformance checker  (REPORT-ONLY, read-only)
 *
 * Parses every `.rpc(name, args)` and `.from(t)...select(...)` chain in src/,
 * then cross-checks them against LIVE introspection dumps:
 *   baseline/a08-functions.txt  (proname|ident_args|full_args|result|secdef|anon|auth|svc)
 *   baseline/columns.csv        (table_name,column_name,data_type,is_nullable,column_default)
 *   baseline/a08-fk.txt         (child_table|child_col|parent_table|parent_col|constraint)
 *   baseline/pg_indexes.csv
 *
 * Usage: node docs/audits/2026-08-23/a08-contract-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '/Users/shubhang/Desktop/Projects/uganda-dashboard');
const BASE = path.join(ROOT, 'docs/audits/2026-08-23/baseline');

/* ------------------------------------------------------------------ live truth */
const fnLines = fs.readFileSync(path.join(BASE, 'a08-functions.txt'), 'utf8').trim().split('\n');
const FN = new Map(); // proname -> {identArgs, fullArgs, result, secdef, anon, auth, svc, argNames, argTypes, defaults}
for (const l of fnLines) {
  const [proname, ident, full, result, secdef, anon, auth, svc] = l.split('|');
  const argNames = [];
  const argTypes = [];
  const hasDefault = [];
  if (full && full.trim()) {
    // split top-level commas (types can contain no commas in this schema; jsonb/text/numeric only)
    let depth = 0, cur = '';
    const parts = [];
    for (const ch of full) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    for (const p of parts) {
      const t = p.trim();
      const def = / DEFAULT /i.test(t);
      const noDef = t.replace(/ DEFAULT .*$/i, '').trim();
      const m = noDef.match(/^(?:(?:IN|OUT|INOUT|VARIADIC)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
      if (m) { argNames.push(m[1]); argTypes.push(m[2]); hasDefault.push(def); }
      else { argNames.push(null); argTypes.push(noDef); hasDefault.push(def); }
    }
  }
  FN.set(proname, {
    identArgs: ident, fullArgs: full, result, secdef: secdef === 't',
    anon: anon === 't', auth: auth === 't', svc: svc === 't',
    argNames, argTypes, hasDefault,
  });
}

const colCsv = fs.readFileSync(path.join(BASE, 'columns.csv'), 'utf8').trim().split('\n').slice(1);
const COLS = new Map(); // table -> Set(columns)
for (const l of colCsv) {
  const [t, c] = l.split(',');
  if (!COLS.has(t)) COLS.set(t, new Set());
  COLS.get(t).add(c);
}

let FK = [];
const fkPath = path.join(BASE, 'a08-fk.txt');
if (fs.existsSync(fkPath)) {
  FK = fs.readFileSync(fkPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    const [child, childCol, parent, parentCol, name] = l.split('|');
    return { child, childCol, parent, parentCol, name };
  });
}

const IDX = new Map(); // table -> [{name, def}]
const idxPath = path.join(BASE, 'pg_indexes.csv');
if (fs.existsSync(idxPath)) {
  const raw = fs.readFileSync(idxPath, 'utf8').trim().split('\n');
  const hdr = raw[0].split(',');
  const iTab = hdr.indexOf('tablename');
  const iName = hdr.indexOf('indexname');
  const iDef = hdr.indexOf('indexdef');
  for (const l of raw.slice(1)) {
    // naive CSV: indexdef may be quoted
    const cells = parseCsvLine(l);
    const t = cells[iTab], n = cells[iName], d = cells[iDef];
    if (!t) continue;
    if (!IDX.has(t)) IDX.set(t, []);
    IDX.get(t).push({ name: n, def: d || '' });
  }
}
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

/* ------------------------------------------------------------------ file walk */
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(p, acc); }
    else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const FILES = walk(path.join(ROOT, 'src'));

/* --------------------------------------------------- balanced-expression reader */
function readBalanced(src, openIdx) {
  // openIdx points at '('. Returns [innerText, indexAfterClosingParen]
  let depth = 0, i = openIdx, q = null, tmpl = 0;
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) {
      if (c === q && prev !== '\\') q = null;
      continue;
    }
    if (c === '`') { q = '`'; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return [src.slice(openIdx + 1, i), i + 1]; }
  }
  return [src.slice(openIdx + 1), src.length];
}
function readChain(src, startIdx) {
  // from `.from(` position, walk forward until depth goes negative or a ';' at depth 0
  let depth = 0, i = startIdx, q = null;
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (q) { if (c === q && prev !== '\\') q = null; continue; }
    if (c === '`' || c === "'" || c === '"') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth < 0) return src.slice(startIdx, i); }
    else if (c === ';' && depth === 0) return src.slice(startIdx, i);
    else if (c === ',' && depth === 0) return src.slice(startIdx, i);
  }
  return src.slice(startIdx);
}
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/* ------------------------------------------------------------------ RPC parsing */
const rpcSites = [];
const selectSites = [];
const filterSites = [];
const writeSites = [];

/** Blank out // and /* *\/ comments, preserving offsets and newlines. */
function stripComments(src) {
  let out = '', q = null, i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1], prev = src[i - 1];
    if (q) { out += c; if (c === q && prev !== '\\') q = null; i++; continue; }
    if (c === '`' || c === "'" || c === '"') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); const stop = end < 0 ? src.length : end + 2; for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' '; continue; }
    out += c; i++;
  }
  return out;
}
/** Fold `'a' + 'b'` / `'a' +\n 'b'` concatenations of pure string literals into one literal. */
function foldConcat(inner) {
  const s = inner.trim();
  const re = /^\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1\s*/;
  let rest = s, acc = '', any = false;
  for (;;) {
    const m = rest.match(re);
    if (!m) return any ? { ok: true, value: acc, rest: rest.trim() } : null;
    acc += m[2]; any = true;
    rest = rest.slice(m[0].length);
    if (rest.startsWith('+')) { rest = rest.slice(1); continue; }
    return { ok: true, value: acc, rest: rest.trim() };
  }
}

for (const f of FILES) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const rel = path.relative(ROOT, f);

  // ---- .rpc(
  const rpcRe = /\.rpc\s*\(/g;
  let m;
  while ((m = rpcRe.exec(src))) {
    const openIdx = m.index + m[0].length - 1;
    const [inner] = readBalanced(src, openIdx);
    const nm = inner.match(/^\s*(['"`])([A-Za-z0-9_]+)\1/);
    const site = { file: rel, line: lineOf(src, m.index), raw: inner.trim().replace(/\s+/g, ' ').slice(0, 400) };
    if (!nm) { site.name = null; site.dynamic = true; rpcSites.push(site); continue; }
    site.name = nm[2];
    // second arg object literal
    const after = inner.slice(nm[0].length);
    const braceIdx = after.indexOf('{');
    site.args = [];
    site.argsParsed = false;
    if (/^\s*,/.test(after) && braceIdx >= 0) {
      const [obj] = readBalanced(after, braceIdx - 1 >= 0 ? after.indexOf('{') : 0) || [];
      // readBalanced expects the index of the opener char
      const objInner = readBalancedFromBrace(after, after.indexOf('{'));
      site.args = topLevelKeys(objInner);
      site.argsParsed = true;
      void obj;
    } else if (/^\s*,/.test(after)) {
      site.argsSpread = after.replace(/^\s*,\s*/, '').trim().slice(0, 120);
    }
    rpcSites.push(site);
  }

  // ---- .from(
  const fromRe = /\.from\s*\(\s*(['"])([a-zA-Z0-9_]+)\1\s*\)/g;
  while ((m = fromRe.exec(src))) {
    const table = m[2];
    const chain = readChain(src, m.index);
    const line = lineOf(src, m.index);
    // select
    const selRe = /\.select\s*\(/g;
    let s;
    while ((s = selRe.exec(chain))) {
      const [innerSel] = readBalanced(chain, s.index + s[0].length - 1);
      const folded = foldConcat(innerSel);
      const tmpl = innerSel.trim().match(/^`([^`$]*)`\s*(?:,|$)/);
      const value = folded && (folded.rest === '' || folded.rest.startsWith(',')) ? folded.value : (tmpl ? tmpl[1] : null);
      selectSites.push({
        file: rel, line: line + chain.slice(0, s.index).split('\n').length - 1,
        table, selectRaw: value, dynamic: value === null && innerSel.trim() !== '',
        raw: innerSel.trim().replace(/\s+/g, ' ').slice(0, 300),
        empty: innerSel.trim() === '',
      });
    }
    // filters / order / range
    const fRe = /\.(eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|order|range|limit|filter|not|maybeSingle|single|csv|update|insert|upsert|delete)\s*\(/g;
    let ff;
    while ((ff = fRe.exec(chain))) {
      const [innerF] = readBalanced(chain, ff.index + ff[0].length - 1);
      const op = ff[1];
      const fline = line + chain.slice(0, ff.index).split('\n').length - 1;
      if (['update', 'insert', 'upsert', 'delete'].includes(op)) {
        writeSites.push({ file: rel, line: fline, table, op, raw: innerF.trim().replace(/\s+/g, ' ').slice(0, 200) });
        continue;
      }
      const colM = innerF.match(/^\s*(['"])([^'"]*)\1/);
      if (colM) filterSites.push({ file: rel, line: fline, table, op, col: colM[2], raw: innerF.trim().replace(/\s+/g, ' ').slice(0, 160) });
      else if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'order', 'is', 'like', 'ilike', 'filter', 'not'].includes(op)) {
        filterSites.push({ file: rel, line: fline, table, op, col: null, dynamic: true, raw: innerF.trim().replace(/\s+/g, ' ').slice(0, 160) });
      }
    }
  }
}

function readBalancedFromBrace(s, idx) {
  if (idx < 0) return '';
  let depth = 0, q = null;
  for (let i = idx; i < s.length; i++) {
    const c = s[i], prev = s[i - 1];
    if (q) { if (c === q && prev !== '\\') q = null; continue; }
    if (c === '`' || c === "'" || c === '"') { q = c; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) return s.slice(idx + 1, i); }
  }
  return s.slice(idx + 1);
}
function topLevelKeys(objInner) {
  const keys = [];
  let depth = 0, q = null, cur = '';
  const parts = [];
  for (let i = 0; i < objInner.length; i++) {
    const c = objInner[i], prev = objInner[i - 1];
    if (q) { cur += c; if (c === q && prev !== '\\') q = null; continue; }
    if (c === '`' || c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; cur += c; continue; }
    if (c === '}' || c === ')' || c === ']') { depth--; cur += c; continue; }
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (t.startsWith('...')) { keys.push({ key: '...spread', spread: true, raw: t.slice(0, 80) }); continue; }
    const km = t.match(/^(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*:/);
    if (km) { keys.push({ key: km[2] }); continue; }
    const shorthand = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*$/);
    if (shorthand) { keys.push({ key: shorthand[1] }); continue; }
    // computed key or conditional-spread
    keys.push({ key: '?unparsed', raw: t.slice(0, 80) });
  }
  return keys;
}

/* -------------------------------------------------------- select-string parsing */
function splitTop(str) {
  const out = []; let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '(') { depth++; cur += ch; continue; }
    if (ch === ')') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}
const colIssues = [];
const embedIssues = [];
let colRefsVerified = 0;
let embedsVerified = 0;

function resolveEmbed(parentTable, name) {
  // 1. FK from parent -> name (name is parent table of an FK on parentTable)
  const asParent = FK.filter((f) => f.child === parentTable && f.parent === name);
  const asChild = FK.filter((f) => f.parent === parentTable && f.child === name);
  if (asParent.length || asChild.length) return { table: name, ok: true, via: asParent.length ? 'fk-out' : 'fk-in' };
  // named FK / alias
  return { table: name, ok: COLS.has(name), via: COLS.has(name) ? 'table-exists-no-fk' : 'no-table' };
}

function checkSelect(site, table, sel, depthPath) {
  for (const tokRaw of splitTop(sel)) {
    let tok = tokRaw.trim();
    if (!tok) continue;
    if (tok === '*') { colRefsVerified++; continue; }
    // alias:  alias:target
    let alias = null;
    const parenIdx = tok.indexOf('(');
    if (parenIdx >= 0) {
      // embedded resource
      let head = tok.slice(0, parenIdx).trim();
      const inner = tok.slice(parenIdx + 1, tok.lastIndexOf(')'));
      const am = head.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
      if (am) { alias = am[1]; head = am[2].trim(); }
      const hintM = head.match(/^([A-Za-z0-9_]+)(!.*)?$/);
      const embedName = hintM ? hintM[1] : head;
      const res = resolveEmbed(table, embedName);
      if (!res.ok) {
        embedIssues.push({ ...site, path: `${depthPath}${embedName}`, reason: `no table or FK named "${embedName}" relatable to "${table}"` });
      } else {
        embedsVerified++;
        if (res.via === 'table-exists-no-fk') {
          embedIssues.push({ ...site, path: `${depthPath}${embedName}`, reason: `table exists but NO FK relates ${table} <-> ${embedName}; PostgREST cannot embed`, soft: true });
        }
        checkSelect(site, res.table, inner, `${depthPath}${embedName}.`);
      }
      void alias;
      continue;
    }
    const am = tok.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
    if (am) { alias = am[1]; tok = am[2].trim(); }
    tok = tok.replace(/::[A-Za-z0-9_ ]+$/, '');
    const base = tok.split(/->>|->/)[0].trim();
    if (base === '*') { colRefsVerified++; continue; }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) { colRefsVerified++; continue; }
    const set = COLS.get(table);
    if (!set) { colIssues.push({ ...site, path: `${depthPath}${base}`, reason: `unknown table "${table}"` }); continue; }
    if (!set.has(base)) colIssues.push({ ...site, path: `${depthPath}${base}`, reason: `column "${base}" does not exist on "${table}"` });
    else colRefsVerified++;
  }
}

for (const s of selectSites) {
  if (s.selectRaw === null) continue;
  if (s.selectRaw.trim() === '') continue;
  checkSelect(s, s.table, s.selectRaw, '');
}

/* ------------------------------------------------------------------ RPC verdicts */
const rpcReport = [];
for (const s of rpcSites) {
  if (!s.name) { rpcReport.push({ ...s, verdict: 'DYNAMIC' }); continue; }
  const fn = FN.get(s.name);
  if (!fn) { rpcReport.push({ ...s, verdict: 'MISSING-LIVE' }); continue; }
  const live = new Set(fn.argNames.filter(Boolean));
  const passed = (s.args || []).map((a) => a.key);
  const unknown = passed.filter((k) => k !== '...spread' && k !== '?unparsed' && !live.has(k));
  const requiredMissing = fn.argNames
    .map((n, i) => ({ n, req: !fn.hasDefault[i] }))
    .filter((x) => x.n && x.req && !passed.includes(x.n));
  const hasSpread = passed.includes('...spread') || passed.includes('?unparsed') || s.argsSpread;
  rpcReport.push({
    ...s,
    verdict: unknown.length ? 'ARG-MISMATCH' : (requiredMissing.length && !hasSpread ? 'MISSING-REQUIRED-ARG' : 'OK'),
    unknown, requiredMissing: requiredMissing.map((x) => x.n), hasSpread,
    live: fn.identArgs, anon: fn.anon, auth: fn.auth, svc: fn.svc, secdef: fn.secdef,
  });
}

/* ------------------------------------------------------------------ filter check */
const filterIssues = [];
let filtersVerified = 0;
for (const f of filterSites) {
  if (f.col === null) continue;
  if (['limit', 'range', 'maybeSingle', 'single', 'csv'].includes(f.op)) continue;
  const set = COLS.get(f.table);
  if (!set) { filterIssues.push({ ...f, reason: `unknown table` }); continue; }
  const base = f.col.split(/->>|->/)[0].split('.')[0].trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) { filtersVerified++; continue; }
  if (!set.has(base)) {
    // could be an embedded-path filter like 'agents.branch_id'
    filterIssues.push({ ...f, reason: `column "${base}" not on "${f.table}"` });
  } else filtersVerified++;
}

/* --------------------------------------------- ordering on unindexed big tables */
const BIG = { transactions: 29027, subscribers: 5064, commissions: 5001, agents: 2046, nav_snapshots: 1246, subscriber_balances: 5060, branches: 321 };
const orderIssues = [];
for (const f of filterSites) {
  if (f.op !== 'order' || !f.col) continue;
  const rows = BIG[f.table];
  if (!rows || rows < 1000) continue;
  const idxs = IDX.get(f.table) || [];
  const covered = idxs.some((i) => new RegExp(`\\(${f.col}\\b|,\\s*${f.col}\\b`).test(i.def));
  if (!covered) orderIssues.push({ ...f, rows, indexes: idxs.map((i) => i.name) });
}

/* ------------------------------------------------------------------ report out */
const out = {
  counts: {
    filesScanned: FILES.length,
    rpcSites: rpcSites.length,
    rpcOk: rpcReport.filter((r) => r.verdict === 'OK').length,
    rpcMissingLive: rpcReport.filter((r) => r.verdict === 'MISSING-LIVE').length,
    rpcArgMismatch: rpcReport.filter((r) => r.verdict === 'ARG-MISMATCH').length,
    rpcMissingRequired: rpcReport.filter((r) => r.verdict === 'MISSING-REQUIRED-ARG').length,
    selectSites: selectSites.length,
    selectDynamic: selectSites.filter((s) => s.dynamic).length,
    colRefsVerified,
    colIssues: colIssues.length,
    embedsVerified,
    embedIssues: embedIssues.length,
    filterSites: filterSites.length,
    filtersVerified,
    filterIssues: filterIssues.length,
    orderIssues: orderIssues.length,
    writeSites: writeSites.length,
  },
  rpcProblems: rpcReport.filter((r) => r.verdict !== 'OK'),
  rpcAll: rpcReport.map((r) => ({ file: r.file, line: r.line, name: r.name, verdict: r.verdict, passed: (r.args || []).map((a) => a.key), live: r.live, anon: r.anon, auth: r.auth })),
  colIssues, embedIssues, filterIssues, orderIssues,
  selectSites,
  writeSites,
};
fs.writeFileSync(path.join(ROOT, 'docs/audits/2026-08-23/a08-contract-report.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.counts, null, 2));
console.log('\n--- RPC PROBLEMS ---');
for (const r of out.rpcProblems) console.log(`${r.verdict}  ${r.file}:${r.line}  ${r.name}  passed=[${(r.args || []).map((a) => a.key).join(',')}]  live=[${r.live}]`);
console.log('\n--- COLUMN ISSUES ---');
for (const c of colIssues) console.log(`${c.file}:${c.line}  ${c.table}  ${c.path}  ${c.reason}`);
console.log('\n--- EMBED ISSUES ---');
for (const c of embedIssues) console.log(`${c.soft ? 'SOFT ' : 'HARD '}${c.file}:${c.line}  ${c.table}  ${c.path}  ${c.reason}`);
console.log('\n--- FILTER ISSUES ---');
for (const c of filterIssues) console.log(`${c.file}:${c.line}  ${c.table}.${c.op}('${c.col}')  ${c.reason}`);
console.log('\n--- ORDER ON UNINDEXED ---');
for (const c of orderIssues) console.log(`${c.file}:${c.line}  ${c.table}(${c.rows} rows).order('${c.col}')  idx=[${c.indexes.join(',')}]`);
