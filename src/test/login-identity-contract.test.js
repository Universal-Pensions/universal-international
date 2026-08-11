// Cross-cutting migration contract test — the sign-in identity.
//
// A non-subscriber sign-in resolves ONLY through `demo_personas(phone, role)
// -> entity_id` (api/auth/_lib/personas.ts). On a miss it does NOT fail; it
// falls back to `ROLE_DEFAULTS` — `emp-001` (Nile Breweries) for employer,
// `d-001` for distributor. So an account provisioned without a persona row
// does not produce a broken login. It produces a login into SOMEBODY ELSE'S
// TENANT, with write access to their roster, and nothing anywhere errors.
//
// That has now shipped to production twice:
//
//   * 0079 provisioned employers/distributors and never wrote the persona.
//     Fixed by 0090.
//   * 0095 needed to thread `registration_no` through
//     `approve_access_request`, and wrote its `CREATE OR REPLACE` from the
//     0079 body instead of the 0090 one. CREATE OR REPLACE overwrites — it
//     does not merge — so the persona write silently vanished again. Observed
//     2026-08-07: "Uniclusion Uganda" approved, employer row created, owner
//     signed in and landed in Nile Breweries. Fixed by 0101.
//
// The failure mode is what makes this worth a test: the regression is INVISIBLE
// at the call site. The approval still returns {status:'approved'} with a real
// provisionedId, and the login still succeeds. Only the tenant is wrong.
//
// 0101 moved the write into `register_login_identity()` so a rewrite of a
// caller cannot delete it. This test asserts the callers keep calling it.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

// Every RPC that brings a new employer/distributor account into existence. Each
// must bind that account to a sign-in, or its owner lands on ROLE_DEFAULTS.
const PROVISIONING_FUNCTIONS = [
  'approve_access_request', // public request-access form, admin-approved
  'create_employer', // admin "+ New Employer" form
  'create_distributor', // admin "+ New Distributor" form
];

// The 0101 helper that writes demo_personas + users. `demo_personas` is also
// accepted so an inlined write (how 0090 did it) still counts.
const IDENTITY_MARKERS = ['register_login_identity', 'demo_personas'];

function stripSqlComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

// Forward migrations only. A `.down.sql` deliberately restores the older body,
// so asserting against one would fail by design.
const forwardMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort();

/**
 * The last forward migration that (re)defines `fnName`, plus just that
 * definition's text — sliced from its CREATE to the next CREATE FUNCTION in
 * the file, so a later unrelated function in the same migration can't satisfy
 * the assertion on its behalf.
 */
function latestDefinitionOf(fnName) {
  const create = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`,
    'i',
  );
  const anyCreate = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s/gi;

  for (const file of [...forwardMigrations].reverse()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    const start = sql.search(create);
    if (start === -1) continue;

    anyCreate.lastIndex = start + 1;
    const next = anyCreate.exec(sql);
    return { file, body: sql.slice(start, next ? next.index : undefined) };
  }
  return null;
}

describe('sign-in identity contract across migrations', () => {
  it('discovers forward migration files', () => {
    expect(forwardMigrations.length).toBeGreaterThan(0);
  });

  for (const fnName of PROVISIONING_FUNCTIONS) {
    it(`the newest ${fnName} binds the account to a sign-in`, () => {
      const found = latestDefinitionOf(fnName);
      expect(found, `no migration defines ${fnName}`).not.toBeNull();

      const binds = IDENTITY_MARKERS.some((m) => found.body.includes(m));
      expect(
        binds,
        `${found.file} holds the newest definition of ${fnName}, and it never ` +
          `writes the sign-in identity (no ${IDENTITY_MARKERS.join(' / ')}).\n\n` +
          `An account it provisions will have no demo_personas row, so its ` +
          `owner signs in and lands on ROLE_DEFAULTS — emp-001 (Nile Breweries) ` +
          `or d-001 — inside another tenant, with no error anywhere.\n\n` +
          `If you rewrote this function with CREATE OR REPLACE, you overwrote ` +
          `the identity write rather than merging it. Call ` +
          `public.register_login_identity(...) before returning. See 0101.`,
      ).toBe(true);
    });
  }

  it('register_login_identity itself writes both demo_personas and users', () => {
    const found = latestDefinitionOf('register_login_identity');
    expect(found, 'register_login_identity is not defined in any migration').not.toBeNull();
    // demo_personas is what auth reads; users carries the password + last_login.
    expect(found.body).toMatch(/INSERT\s+INTO\s+public\.demo_personas/i);
    expect(found.body).toMatch(/INSERT\s+INTO\s+public\.users/i);
  });
});
