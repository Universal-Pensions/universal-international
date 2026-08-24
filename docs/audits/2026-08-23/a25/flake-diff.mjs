// A25 check 4 — diff the A00 baseline Playwright run against the A25 re-run.
import { readFileSync } from 'node:fs';
const norm = (f) =>
  readFileSync(f, 'utf8').split('\n')
    .filter(l => /^\s+[✘]\s+\d+\s+\[/.test(l))
    .map(l => l.replace(/^\s+✘\s+\d+\s+/, '').replace(/\s+\(\d+(\.\d+)?m?s\)\s*$/, '').trim());

const A = new Set(norm(process.argv[2]));   // baseline
const B = new Set(norm(process.argv[3]));   // rerun
const both = [...A].filter(x => B.has(x)).sort();
const onlyA = [...A].filter(x => !B.has(x)).sort();
const onlyB = [...B].filter(x => !A.has(x)).sort();

const key = (s) => {
  const m = s.match(/^\[([a-z-]+)\] › (e2e\/specs\/[^ ]+\.spec\.ts:\d+:\d+)/);
  return m ? { project: m[1], id: m[2] } : { project: '?', id: s };
};
const show = (title, arr) => {
  console.log(`\n### ${title} (${arr.length})`);
  for (const s of arr) { const k = key(s); console.log(`  ${k.project.padEnd(16)} ${k.id}`); }
};
console.log(`baseline failures: ${A.size}   rerun failures: ${B.size}`);
show('REPRODUCED in both runs  → deterministic defect', both);
show('BASELINE ONLY (passed on re-run) → flaky', onlyA);
show('RE-RUN ONLY (passed in baseline) → flaky', onlyB);

// per-spec rollup
const rollup = {};
for (const [label, arr] of [['both', both], ['onlyA', onlyA], ['onlyB', onlyB]]) {
  for (const s of arr) {
    const k = key(s); const spec = k.id.split(':')[0];
    rollup[spec] ??= { both: 0, onlyA: 0, onlyB: 0 };
    rollup[spec][label]++;
  }
}
console.log('\n### per-spec rollup');
console.log('spec'.padEnd(52), 'repro', 'base-only', 'rerun-only');
for (const [s, v] of Object.entries(rollup).sort())
  console.log(s.padEnd(52), String(v.both).padEnd(5), String(v.onlyA).padEnd(9), v.onlyB);
