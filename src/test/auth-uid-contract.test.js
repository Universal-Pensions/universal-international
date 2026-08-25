// CLAUDE.md §5.7 enforcement — "Don't trust auth.uid() inside RLS
// policies — it's NULL for our custom HS256 JWTs. Read
// auth.jwt() ->> 'app_role'/'subscriberId'/... instead."
//
// This is the other half of the trap src/test/jwt-claim-contract.test.js
// already guards: that test asserts no migration (after the 0007 rewrite)
// reads the claim `'role'` instead of `'app_role'`. It explicitly does NOT
// check the auth.uid() half of the same anti-pattern (confirmed by reading
// it — its only assertion is the `auth.jwt() ->> 'role'` regex). This test
// fills that gap, following the exact same shape: strip SQL comments, then
// assert no FORWARD migration contains a real `auth.uid(` call.
//
// Unlike jwt-claim-contract.test.js, no GRANDFATHERED_PREFIXES list is
// needed here — verified 2026-08-25 that zero migrations, at any point in
// this repo's history (0001 through the current HEAD), ever used auth.uid()
// as real SQL. Every one of the 7 files that mention the string at all
// (0004, 0021, 0030, 0036, 0039, 0048, 0056) does so only in a comment
// explaining why they deliberately DON'T use it — this repo never used
// Supabase Auth, so the custom-JWT / auth.jwt() convention was there from
// the start. This test is a pure regression guard against that ever
// changing, not a fix for anything broken today.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

// Strip SQL comments so explanatory text mentioning the trap (which every
// current hit is) doesn't trigger the check meant to catch real usage.
function stripSqlComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

describe('auth.uid() trap contract across migrations', () => {
  // Forward migrations only — a `.down.sql` deliberately restores an older
  // body (same reasoning as login-identity-contract.test.js), so asserting
  // against one would fail by design if an old body ever legitimately used
  // a now-forbidden pattern.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();

  it('discovers forward migration files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} does not read auth.uid() (NULL for our custom HS256 JWTs)`, () => {
      const body = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      const matches = body.match(/auth\.uid\s*\(/g);
      expect(
        matches,
        `${file} calls auth.uid() — it is NULL for this repo's custom HS256 JWTs ` +
          "(we never use Supabase Auth). Read auth.jwt() ->> 'app_role' / " +
          "'subscriberId' / 'agentId' / 'branchId' / 'distributorId' / 'employerId' " +
          'instead. See CLAUDE.md §5 anti-pattern #7 and BACKEND.md §8.',
      ).toBeNull();
    });
  }
});
