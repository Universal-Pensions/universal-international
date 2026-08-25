// CLAUDE.md §5.6 enforcement — "Don't write raw SQL from the frontend.
// Every money write is supposed to go through a SECURITY DEFINER RPC."
//
// ⚠️ THIS RULE IS ALREADY VIOLATED IN SHIPPED CODE. CLAUDE.md §5.6 itself
// says so: "This rule is currently BREACHED: src/services/subscriber.js and
// src/services/entities.js still .insert()/.update()/.upsert() tables
// directly through PostgREST ... Treat this rule as the target state, not a
// description of the code, until migration 0118 (drafted, not yet applied
// as of 2026-08-25) closes the gap." Re-verified directly against the tree
// 2026-08-25: 9 real call sites (5 in entities.js, 4 in subscriber.js) —
// not the 11 the original audit finding counted; this test's baseline uses
// the freshly-measured number.
//
// Fixing those 9 sites means rewriting src/services/{entities,subscriber}.js
// to call RPCs instead, which is a functional change to files outside this
// task's write-set (config files + new tests only) — and is exactly what
// migration 0118 is for. So this test is a RATCHET, not a fix: it grandfathers
// today's 9 known sites in exactly these two files, and fails on anything
// beyond that — either a NEW direct-write call site in the same two files,
// or ANY direct-write call site appearing in a third services file. It is
// the mechanical version of the CLAUDE.md §7.3 warning, scoped to catch the
// backlog from growing while migration 0118 is still just drafted.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = resolve(__dirname, '../services');
const REPO_ROOT = resolve(__dirname, '../..');

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function relPath(absPath) {
  return relative(REPO_ROOT, absPath).split('\\').join('/');
}

function walkJs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkJs(full, out);
    } else if (/\.jsx?$/.test(entry) && !entry.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

// A direct PostgREST table write: `.insert(`, `.update(` or `.upsert(` NOT
// preceded by `.rpc(` on the same call chain. `.rpc('fn', {...})` calls
// legitimately contain none of these tokens as a *method name* (they'd
// appear only as argument object keys, e.g. `{ status: 'paid' }`, which
// this word-boundary method-call regex does not match), so no rpc-call
// exclusion is needed beyond matching only `.insert(`/`.update(`/`.upsert(`
// as method calls.
const DIRECT_WRITE = /\.(insert|update|upsert)\s*\(/g;

function countDirectWrites(file) {
  const code = stripJsComments(readFileSync(file, 'utf8'));
  return (code.match(DIRECT_WRITE) || []).length;
}

const allServiceFiles = walkJs(SERVICES_DIR);

// 2026-08-25 measured baseline. Ceiling only — lower these as 0118 lands.
const KNOWN_OFFENDERS = {
  'src/services/entities.js': 5,
  'src/services/subscriber.js': 4,
};

describe('money-write RPC-boundary contract (CLAUDE.md §5.6 — KNOWN VIOLATED)', () => {
  it('discovers service files to scan', () => {
    expect(allServiceFiles.length).toBeGreaterThan(3);
  });

  it('no service file beyond the two known offenders writes a table directly', () => {
    const unexpected = [];
    for (const file of allServiceFiles) {
      const rel = relPath(file);
      if (rel in KNOWN_OFFENDERS) continue;
      const count = countDirectWrites(file);
      if (count > 0) unexpected.push(`${rel} (${count} direct write call site(s))`);
    }
    expect(
      unexpected,
      'A NEW file writes a Supabase table directly via .insert()/.update()/.upsert() ' +
        'instead of a SECURITY DEFINER RPC (CLAUDE.md §5.6):\n' +
        unexpected.join('\n'),
    ).toEqual([]);
  });

  for (const [rel, baseline] of Object.entries(KNOWN_OFFENDERS)) {
    it(`${rel} has not grown past its known ${baseline} direct-write call site(s)`, () => {
      const count = countDirectWrites(resolve(REPO_ROOT, rel));
      expect(
        count,
        `${rel} now has ${count} direct-write call sites, was ${baseline}. If this went ` +
          `UP, a new raw write was added — route it through an RPC (CLAUDE.md §5.6). If it ` +
          'went DOWN (migration 0118 or a partial fix landed), lower the number in ' +
          'KNOWN_OFFENDERS in this test to match — the ratchet should only tighten.',
      ).toBeLessThanOrEqual(baseline);
    });
  }
});
