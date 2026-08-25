// Cross-cutting migration contract test.
//
// The custom HS256 JWT (api/_lib/jwt.ts) emits `role: 'authenticated'` (the
// Postgres role for PostgREST `SET ROLE`) AND `app_role: <JwtRole>` (the
// application role). RLS policies and RPC role gates MUST read `app_role` —
// reading `'role'` silently fails because it always returns `'authenticated'`.
//
// This trap produced the 0018/0019 rollup regression and the 0004 commission
// silent failures. This test asserts no migration after the 0007 rewrite uses
// the wrong claim.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

// 0001–0006 predate the `app_role` convention (introduced by 0007). 0007 is
// the migration that RENAMED `role` → `app_role` and necessarily references
// the old claim. 0018 is the broken historical rollup forward-ported by 0020.
// Shipped migrations are never edited.
const GRANDFATHERED_PREFIXES = [
  '0001', '0002', '0003', '0004', '0005', '0006',
  '0007', // performs the role → app_role rewrite — references old claim by design
  '0018', // historical broken rollup, replaced by 0020
];

function isGrandfathered(filename) {
  return GRANDFATHERED_PREFIXES.some((p) => filename.startsWith(p));
}

// Strip SQL comments so explanatory text mentioning the trap doesn't trigger.
// Removes `-- line comments` and `/* block comments */`.
function stripSqlComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

describe('JWT claim contract across migrations', () => {
  // `!/ \d+\.sql$/` — macOS folder-sync conflict copies ("0110_purge 2.sql")
  // also end in .sql. Left in, they are scanned as if they were migrations, and
  // because several of these contracts use .sort() to pick the NEWEST definition
  // of a function, a duplicate can change which body is judged.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !/ \d+\.sql$/.test(f))
    .sort();

  it('discovers migration files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    if (isGrandfathered(file)) continue;

    it(`${file} reads app_role (not role) for app-level gates`, () => {
      const body = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      const matches = body.match(/auth\.jwt\(\)\s*->>\s*'role'/g);
      expect(
        matches,
        `${file} reads auth.jwt() ->> 'role' — that's the Postgres SET-ROLE ` +
          `value ('authenticated'), not the app role. Read 'app_role' instead. ` +
          `See CLAUDE.md §5 anti-pattern #7 and BACKEND.md §8.`,
      ).toBeNull();
    });
  }
});
