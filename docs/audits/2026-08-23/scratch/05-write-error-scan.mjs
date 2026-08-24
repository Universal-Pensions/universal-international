import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const hits = execSync(`grep -rn "\\.mutate(\\|\\.mutateAsync(" src/ | grep -v "__tests__\\|\\.test\\." | cut -d: -f1,2`, { encoding: 'utf8' })
  .trim().split('\n');
const rows = [];
for (const h of hits) {
  const [file, lineStr] = h.split(':');
  const line = Number(lineStr);
  const src = readFileSync(file, 'utf8').split('\n');
  const win = src.slice(Math.max(0, line - 30), Math.min(src.length, line + 30)).join('\n');
  const hasCatch = /catch\s*[({]/.test(win);
  const hasOnError = /onError\s*:/.test(win);
  const hasIsError = /isError|\.error\b|error &&/.test(win);
  const call = src[line - 1].trim().slice(0, 60);
  rows.push({ file, line, call, hasCatch, hasOnError, hasIsError });
}
const bad = rows.filter((r) => !r.hasCatch && !r.hasOnError);
console.log(`total call sites: ${rows.length}; without try/catch AND without onError: ${bad.length}`);
for (const r of bad) console.log(`  ${r.file}:${r.line}  isErrorNearby=${r.hasIsError}  ${r.call}`);
