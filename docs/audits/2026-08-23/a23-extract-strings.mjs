// A23 — extract candidate user-visible strings from JSX. Read-only.
// Emits TSV: file:line \t kind \t text
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/shubhang/Desktop/Projects/uganda-dashboard/src';
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === '__tests__' || e === 'test') continue;
      walk(p);
    } else if (/\.jsx$/.test(p) && !/\.test\./.test(p)) files.push(p);
  }
})(ROOT);

const out = [];
const TEXT_PROPS = /\b(title|label|heading|subtext|subtitle|placeholder|aria-label|alt|caption|helper|hint|description|tag|cta|body|note|blurb|lede|eyebrow|emptyText|message|submitLabel|confirmLabel|cancelLabel)\s*=\s*(["'])([^"'{}]{3,})\2/g;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const loc = `${f.replace(ROOT + '/', 'src/')}:${i + 1}`;
    for (const m of line.matchAll(/>([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)</g)) {
      const t = m[1].trim();
      if (!t || t.length < 3) continue;
      if (/^[\s.,;:•·—–-]+$/.test(t)) continue;
      out.push([loc, 'text', t]);
    }
    for (const m of line.matchAll(TEXT_PROPS)) {
      out.push([loc, `prop:${m[1]}`, m[3].trim()]);
    }
  });
}
const seen = new Set();
const rows = out.filter(([l, k, t]) => {
  const key = `${l} ${t}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
for (const r of rows) console.log(r.join('\t'));
console.error(`files=${files.length} strings=${rows.length}`);
