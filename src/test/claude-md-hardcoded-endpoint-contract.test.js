// CLAUDE.md §4.4 enforcement — "No hardcoded API endpoints. Read config via
// src/config/env.js."
//
// env.js is the sole place allowed to know the shape of the Render API host
// or the local dev ports. Everywhere else is supposed to go through
// API_BASE_URL (or another exported constant) instead of re-deriving it.
// Zero current violations — verified 2026-08-25 (docs/audits/2026-08-23
// A26-005) — so this is a pure regression guard.
//
// Deliberately narrow: it greps for the ACTUAL deployed hosts/ports this
// repo cares about (the Render API domain + the two local dev ports), not a
// generic "no localhost anywhere" rule that would flag legitimate things
// like doc comments or unrelated tooling config.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(__dirname, '../..');

function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
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
  return relative(REPO_ROOT, absPath).split('\\').join('/');
}

const ALLOWED = new Set([
  'src/config/env.js',
  // This file — the pattern list below necessarily contains the literals.
  'src/test/claude-md-hardcoded-endpoint-contract.test.js',
]);

// The Render API host, and the two local dev ports (Vite :5173 / Express
// :3001) that only env.js and the dev tooling (outside src/) should know
// about by literal value.
const ENDPOINT_PATTERNS = [/onrender\.com/, /localhost:3001/, /localhost:5173/, /127\.0\.0\.1:3001/];

describe('hardcoded-endpoint contract (CLAUDE.md §4.4)', () => {
  it('discovers source files to scan', () => {
    expect(allSrcFiles.length).toBeGreaterThan(100);
  });

  for (const file of allSrcFiles) {
    const rel = relPath(file);
    if (ALLOWED.has(rel)) continue;
    it(`${rel} does not hardcode an API host/port`, () => {
      const code = stripJsComments(readFileSync(file, 'utf8'));
      const hit = ENDPOINT_PATTERNS.find((p) => p.test(code));
      expect(
        hit,
        `${rel} hardcodes an API endpoint matching ${hit}. Read it through ` +
          'src/config/env.js (API_BASE_URL etc.) instead (CLAUDE.md §4.4).',
      ).toBeUndefined();
    });
  }
});
