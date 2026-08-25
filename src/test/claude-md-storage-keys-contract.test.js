// CLAUDE.md §4.3 / §4.5 enforcement — session and signup storage keys stay
// owned by the modules that manage their lifecycle.
//
// §4.3 ("Auth"): components read the session via `useAuth()` from
// AuthContext, never by touching `localStorage['upensions_auth'/'upensions_token']`
// directly. Those two literal keys are owned by services/supabaseClient.js
// (defines them), services/api.js (JWT injection + the 401 listener that
// clears them) and contexts/AuthContext.jsx (the hook + the storage-event
// listener that mirrors a cross-tab logout). A component reading/writing them
// directly bypasses AuthContext's state and the 401 redirect machinery.
//
// §4.5 ("Signup persistence"): `SignupContext` is the sole owner of the
// `uganda-pensions-signup` localStorage key (exported as
// `SIGNUP_STORAGE_KEY` from `src/signup/signupState.js`, the context's
// companion module). Anything else reading/writing that key directly can
// drift out of sync with what SignupContext believes is persisted.
//
// Both are enforced the same way: strip comments, then assert the literal
// string appears ONLY inside its owning file(s). Zero current violations —
// verified 2026-08-25 (docs/audits/2026-08-23 A26-005) — so this is a pure
// regression guard, not a fix for anything broken today.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..');

function stripJsComments(src) {
  // Good enough for this repo's source: no `/*` or `//` appears inside a
  // string literal anywhere that would trip this up (verified by the zero
  // false-positive run against the current tree below).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function walk(dir, out = []) {
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
      walk(full, out);
    } else if (/\.jsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const allSrcFiles = walk(SRC_DIR);

function relPath(absPath) {
  return relative(resolve(__dirname, '../..'), absPath).split('\\').join('/');
}

describe('storage-key ownership contract (CLAUDE.md §4.3 / §4.5)', () => {
  it('discovers source files to scan', () => {
    expect(allSrcFiles.length).toBeGreaterThan(100);
  });

  describe('§4.3 — upensions_auth / upensions_token stay inside the auth stack', () => {
    const ALLOWED = new Set([
      'src/services/api.js',
      'src/services/auth.js',
      'src/services/supabaseClient.js',
      'src/contexts/AuthContext.jsx',
      // Tests exercising those modules' own storage behaviour.
      'src/services/__tests__/api.test.js',
      'src/services/__tests__/supabaseClient.test.js',
      'src/contexts/AuthContext.test.jsx',
      // This file — its own MARKERS array necessarily contains the literals.
      'src/test/claude-md-storage-keys-contract.test.js',
    ]);
    const MARKERS = ['upensions_auth', 'upensions_token'];

    for (const file of allSrcFiles) {
      const rel = relPath(file);
      if (ALLOWED.has(rel)) continue;
      it(`${rel} does not reference the raw auth storage keys`, () => {
        const code = stripJsComments(readFileSync(file, 'utf8'));
        const hit = MARKERS.find((m) => code.includes(m));
        expect(
          hit,
          `${rel} references the literal '${hit}' outside the auth stack. ` +
            'Use useAuth() from AuthContext instead of touching localStorage directly ' +
            '(CLAUDE.md §4.3) — if this file genuinely needs to own the key, add it to ' +
            'the ALLOWED set in this test with a reason.',
        ).toBeUndefined();
      });
    }
  });

  describe('§4.5 — the signup persistence key stays inside src/signup/', () => {
    const ALLOWED = new Set([
      'src/signup/signupState.js',
      // This file — its own MARKER constant necessarily contains the literal.
      'src/test/claude-md-storage-keys-contract.test.js',
    ]);
    const MARKER = 'uganda-pensions-signup';

    for (const file of allSrcFiles) {
      const rel = relPath(file);
      if (ALLOWED.has(rel)) continue;
      it(`${rel} does not reference the raw signup storage key`, () => {
        const code = stripJsComments(readFileSync(file, 'utf8'));
        expect(
          code.includes(MARKER),
          `${rel} references the literal '${MARKER}' directly. SignupContext (via ` +
            'signupState.js) is the sole owner of this key (CLAUDE.md §4.5) — import ' +
            'SIGNUP_STORAGE_KEY from src/signup/signupState.js instead of hardcoding it.',
        ).toBe(false);
      });
    }
  });
});
