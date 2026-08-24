#!/usr/bin/env node
/**
 * A08 · check 6 — mock-vs-live SHAPE parity for every service function that
 * branches on `IS_SUPABASE_ENABLED`.
 *
 * For each exported service function containing `if (!IS_SUPABASE_ENABLED)`, it
 * extracts the set of object keys each branch can return and diffs them.
 * Return expressions are resolved through one level of mapper indirection
 * (`mapFoo(row)`, `rows.map(mapFoo)`, `{...spread, extra}`).
 *
 * Output: docs/audits/2026-08-23/a08-mock-parity.json
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard';
const SVC = path.join(ROOT, 'src/services');

function stripComments(src) {
  let out = '', q = null, i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1], prev = src[i - 1];
    if (q) { out += c; if (c === q && prev !== '\\') q = null; i++; continue; }
    if (c === '`' || c === "'" || c === '"') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const stop = e < 0 ? src.length : e + 2; for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' '; continue; }
    out += c; i++;
  }
  return out;
}
function matchBlock(src, openIdx) { // openIdx at '{' or '('
  let d = 0, q = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '`' || c === "'" || c === '"') { q = c; continue; }
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) { d--; if (d === 0) return i; }
  }
  return src.length - 1;
}
function topKeys(objInner) {
  const keys = []; let d = 0, q = null, cur = ''; const parts = [];
  for (let i = 0; i < objInner.length; i++) {
    const c = objInner[i], p = objInner[i - 1];
    if (q) { cur += c; if (c === q && p !== '\\') q = null; continue; }
    if (c === '`' || c === "'" || c === '"') { q = c; cur += c; continue; }
    if ('([{'.includes(c)) { d++; cur += c; continue; }
    if (')]}'.includes(c)) { d--; cur += c; continue; }
    if (c === ',' && d === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  for (const p of parts) {
    const t = p.trim(); if (!t) continue;
    if (t.startsWith('...')) { keys.push({ spread: t.slice(3).trim() }); continue; }
    let m = t.match(/^(['"]?)([A-Za-z_$][A-Za-z0-9_$]*)\1\s*:/);
    if (m) { keys.push({ key: m[2] }); continue; }
    m = t.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*$/);
    if (m) { keys.push({ key: m[1] }); continue; }
    m = t.match(/^\[[^\]]+\]\s*:/);
    if (m) { keys.push({ key: '[computed]' }); continue; }
    keys.push({ key: '?' + t.slice(0, 30) });
  }
  return keys;
}

const files = fs.readdirSync(SVC).filter((f) => f.endsWith('.js'));
const results = [];
const perFileMappers = {};

for (const f of files) {
  const raw = fs.readFileSync(path.join(SVC, f), 'utf8');
  const src = stripComments(raw);

  // ---- index every `function name(...) { ... }` so mapper returns can be resolved
  const fnRe = /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  const fns = [];
  let m;
  while ((m = fnRe.exec(src))) {
    const nameEnd = m.index + m[0].length - 1;
    const parEnd = matchBlock(src, nameEnd);
    const braceIdx = src.indexOf('{', parEnd);
    if (braceIdx < 0) continue;
    const end = matchBlock(src, braceIdx);
    fns.push({ name: m[1], start: m.index, bodyStart: braceIdx, end, body: src.slice(braceIdx + 1, end), exported: /export\s+(?:async\s+)?function\s*$/.test(src.slice(Math.max(0, m.index), nameEnd - m[1].length)) || /export\s/.test(m[0]) });
  }
  perFileMappers[f] = fns;

  const byName = new Map(fns.map((x) => [x.name, x]));

  /** Return-key set for one return expression, resolving one level of mappers. */
  function keysOf(expr, depth = 0) {
    const e = expr.trim().replace(/;$/, '');
    if (!e) return { kind: 'void', keys: [] };
    if (/^null$/.test(e)) return { kind: 'null', keys: [] };
    if (/^\[\s*\]$/.test(e)) return { kind: 'array-empty', keys: [] };
    if (e.startsWith('{')) return { kind: 'object', keys: topKeys(e.slice(1, matchBlock(e, 0))) };
    // rows.map(mapX)  /  (x ?? []).map(mapX)
    let mm = e.match(/\.map\(\s*([A-Za-z_$][\w$]*)\s*\)\s*$/);
    if (mm && byName.has(mm[1]) && depth < 3) {
      const r = returnsOf(byName.get(mm[1]), depth + 1);
      return { kind: 'array-of', of: mm[1], keys: r.flatMap((x) => x.keys) };
    }
    // rows.map((r) => ({...}))
    mm = e.match(/\.map\(\s*\([^)]*\)\s*=>\s*\(\s*\{/);
    if (mm) { const i = e.indexOf('{', e.indexOf('=>')); return { kind: 'array-of-literal', keys: topKeys(e.slice(i + 1, matchBlock(e, i))) }; }
    // mapX(y)
    mm = e.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (mm && byName.has(mm[1]) && depth < 3) {
      const r = returnsOf(byName.get(mm[1]), depth + 1);
      return { kind: 'call:' + mm[1], keys: r.flatMap((x) => x.keys) };
    }
    return { kind: 'opaque', expr: e.slice(0, 90), keys: [] };
  }
  function returnsOf(fn, depth = 0) {
    const out = [];
    const rRe = /\breturn\b/g; let r;
    while ((r = rRe.exec(fn.body))) {
      const rest = fn.body.slice(r.index + 6);
      // take up to the matching end of the expression (balanced, stop at ';' or newline at depth 0)
      let d = 0, q = null, i = 0;
      for (; i < rest.length; i++) {
        const c = rest[i], p = rest[i - 1];
        if (q) { if (c === q && p !== '\\') q = null; continue; }
        if (c === '`' || c === "'" || c === '"') { q = c; continue; }
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) { if (d === 0) break; d--; }
        else if (c === ';' && d === 0) break;
        else if (c === '\n' && d === 0 && rest.slice(0, i).trim()) break;
      }
      out.push(keysOf(rest.slice(0, i), depth));
    }
    return out;
  }

  // ---- functions with the mock guard
  for (const fn of fns) {
    const gi = fn.body.indexOf('if (!IS_SUPABASE_ENABLED)');
    if (gi < 0) continue;
    const after = fn.body.slice(gi);
    let mockBody, liveBody;
    const braceRel = after.indexOf('{');
    const oneLine = after.slice(0, braceRel < 0 ? 200 : braceRel).includes('return');
    if (oneLine || braceRel < 0 || braceRel > after.indexOf('\n')) {
      // `if (!IS_SUPABASE_ENABLED) return X;`
      const semi = after.indexOf(';');
      mockBody = after.slice(after.indexOf(')') + 1, semi + 1);
      liveBody = fn.body.slice(0, gi) + after.slice(semi + 1);
    } else {
      const close = matchBlock(after, braceRel);
      mockBody = after.slice(braceRel + 1, close);
      liveBody = fn.body.slice(0, gi) + after.slice(close + 1);
    }
    const mockRet = returnsOf({ body: mockBody });
    const liveRet = returnsOf({ body: liveBody });
    const norm = (rs) => {
      const s = new Set();
      for (const r of rs) for (const k of r.keys) { if (k.key) s.add(k.key); else if (k.spread) s.add('...' + k.spread); }
      return s;
    };
    const mk = norm(mockRet), lk = norm(liveRet);
    const onlyMock = [...mk].filter((k) => !lk.has(k) && !k.startsWith('...'));
    const onlyLive = [...lk].filter((k) => !mk.has(k) && !k.startsWith('...'));
    const resolvable = mockRet.some((r) => r.keys.length) && liveRet.some((r) => r.keys.length);
    results.push({
      file: `src/services/${f}`, fn: fn.name,
      mockKinds: mockRet.map((r) => r.kind), liveKinds: liveRet.map((r) => r.kind),
      mockKeys: [...mk], liveKeys: [...lk], onlyMock, onlyLive,
      resolvable, verdict: !resolvable ? 'UNRESOLVED' : (onlyMock.length || onlyLive.length ? 'SHAPE-DIFF' : 'MATCH'),
    });
  }
}

fs.writeFileSync(path.join(ROOT, 'docs/audits/2026-08-23/a08-mock-parity.json'), JSON.stringify(results, null, 2));
const c = { MATCH: 0, 'SHAPE-DIFF': 0, UNRESOLVED: 0 };
for (const r of results) c[r.verdict]++;
console.log('guarded functions:', results.length, JSON.stringify(c));
console.log('\n=== SHAPE-DIFF ===');
for (const r of results.filter((x) => x.verdict === 'SHAPE-DIFF')) {
  console.log(`${r.file} :: ${r.fn}\n   onlyMock=[${r.onlyMock.join(', ')}]\n   onlyLive=[${r.onlyLive.join(', ')}]`);
}
console.log('\n=== UNRESOLVED (needs manual read) ===');
for (const r of results.filter((x) => x.verdict === 'UNRESOLVED')) console.log(`${r.file} :: ${r.fn}  mock=${r.mockKinds.join('/')}  live=${r.liveKinds.join('/')}`);
