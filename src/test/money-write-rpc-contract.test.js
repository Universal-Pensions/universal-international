// CLAUDE.md §5.6 enforcement — "Don't write raw SQL from the frontend.
// Every money write is supposed to go through a SECURITY DEFINER RPC."
//
// STATUS (re-measured 2026-08-27): the MONEY half of this rule is closed.
// Migrations 0118 + 0119 are applied to live — `transactions`, `withdrawals`
// and `nominees` carry zero INSERT/UPDATE/DELETE policies, so they are
// SELECT-only through PostgREST and genuinely RPC-or-nothing. This header
// previously quoted a version of CLAUDE.md §5.6 that predated them ("migration
// 0118 (drafted, not yet applied as of 2026-08-25)") and described the gap as
// still open; it wasn't, and CLAUDE.md had already been corrected.
//
// What REMAINS is not a money leak. src/services/{entities,subscriber}.js still
// write 9 tables directly through PostgREST (5 + 4), but every one of those 9
// lands on a non-money, ownership-scoped table that 0118 deliberately KEPT
// writable: branches/agents/distributors management, the schedule form, the
// free-insurance downgrade, own-profile edits. None of them touches a balance.
//
// So this test is a RATCHET, not a fix. It grandfathers today's 9 known sites in
// exactly these two files and fails on anything beyond that — either a NEW
// direct-write call site in the same two files, or ANY direct-write call site
// appearing in a third services file. Rewriting the 9 to call RPCs would be a
// functional change with real blast radius and no security payoff now that the
// money tables are sealed; the ratchet exists to stop the backlog GROWING, which
// is the part that would matter. Lower KNOWN_OFFENDERS whenever one is retired —
// the ceiling should only ever tighten.

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
    // Skip macOS folder-sync conflict copies ("foo 2.js"). This checkout
    // lives under ~/Desktop and its sync process duplicates files during
    // branch switches; a directory walk otherwise scans the copies, and a
    // contract test then reports its OWN duplicate as a violation. Same
    // exclusion vite.config.js already applies to coverage.
    if (/ \d+\.[A-Za-z0-9]+$/.test(entry)) continue;
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

// 2026-08-25 baseline, re-measured 2026-08-27 (unchanged). Ceiling only —
// lower these as call sites are retired; never raise them.
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
