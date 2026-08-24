// A25 check 1 — aggregate coverage/coverage-summary.json by directory + rank untested modules.
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const root = process.cwd() + '/';
const pct = (o) => (o.total === 0 ? 100 : (o.covered / o.total) * 100);

const files = Object.entries(j).filter(([k]) => k !== 'total')
  .map(([k, v]) => ({ path: k.replace(root, ''), ...v }));

// ---- overall
const t = j.total;
console.log('=== OVERALL ===');
for (const m of ['statements', 'branches', 'functions', 'lines'])
  console.log(`${m.padEnd(11)} ${t[m].pct.toFixed(2).padStart(6)}%  (${t[m].covered}/${t[m].total})`);

// ---- by directory (depth 2 for src/**, depth 1..2 for api)
const agg = {};
for (const f of files) {
  const parts = f.path.split('/');
  const dir = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0];
  agg[dir] ??= { statements: [0, 0], branches: [0, 0], functions: [0, 0], lines: [0, 0], n: 0 };
  agg[dir].n++;
  for (const m of ['statements', 'branches', 'functions', 'lines']) {
    agg[dir][m][0] += f[m].covered; agg[dir][m][1] += f[m].total;
  }
}
console.log('\n=== BY DIRECTORY (sorted by uncovered statements, desc) ===');
console.log('dir'.padEnd(30), 'files', ' stmts%', ' br%', ' fn%', ' lines%', ' uncov-stmts');
const rows = Object.entries(agg).map(([d, a]) => ({
  d, n: a.n,
  s: a.statements[1] ? a.statements[0] / a.statements[1] * 100 : 100,
  b: a.branches[1] ? a.branches[0] / a.branches[1] * 100 : 100,
  f: a.functions[1] ? a.functions[0] / a.functions[1] * 100 : 100,
  l: a.lines[1] ? a.lines[0] / a.lines[1] * 100 : 100,
  u: a.statements[1] - a.statements[0],
})).sort((x, y) => y.u - x.u);
for (const r of rows)
  console.log(r.d.padEnd(30), String(r.n).padStart(5), r.s.toFixed(1).padStart(7), r.b.toFixed(1).padStart(5),
    r.f.toFixed(1).padStart(5), r.l.toFixed(1).padStart(7), String(r.u).padStart(12));

// ---- largest untested modules
console.log('\n=== LARGEST 0%-STATEMENT MODULES (by statement count) ===');
files.filter(f => f.statements.pct === 0 && f.statements.total > 0)
  .sort((a, b) => b.statements.total - a.statements.total).slice(0, 30)
  .forEach(f => console.log(String(f.statements.total).padStart(5), f.path));

console.log('\n=== src/services + src/hooks ranked by uncovered statements ===');
files.filter(f => /^src\/(services|hooks)\//.test(f.path))
  .sort((a, b) => (b.statements.total - b.statements.covered) - (a.statements.total - a.statements.covered))
  .forEach(f => console.log(
    String(f.statements.total - f.statements.covered).padStart(5),
    `${f.statements.pct.toFixed(1)}%s ${f.branches.pct.toFixed(1)}%b ${f.functions.pct.toFixed(1)}%f`.padEnd(26),
    f.path));

console.log('\n=== threshold check ===');
console.log(`configured: statements 23 (vite.config.js). measured: ${t.statements.pct.toFixed(2)}. `
  + `headroom before CI fails: ${(t.statements.pct - 23).toFixed(2)} points. `
  + `branches/functions/lines: NO THRESHOLD CONFIGURED.`);
