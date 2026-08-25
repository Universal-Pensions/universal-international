#!/usr/bin/env node
// Preflight check for A24-011: `xlsx` resolves from cdn.sheetjs.com, not the
// npm registry (SheetJS stopped publishing new releases to npmjs.org after
// 0.18.5 — the registry copy is abandoned and carries two unpatched CVEs;
// cdn.sheetjs.com is the correct, deliberate pin). That means every
// `npm ci` — Vercel, Render's render.yaml buildCommand, and both `npm ci`
// steps in .github/workflows/test.yml — depends on that CDN being reachable.
// When it isn't, npm's real error (verified empirically; see
// docs/audits/2026-08-23/a24/supply-chain.md) is a generic network/proxy
// message that never says "xlsx" or "SheetJS" anywhere but the URL itself,
// buried in the log. This script names the failure mode instead.
//
// This is a STANDALONE diagnostic — it is not wired into `npm ci`/`build`/CI.
// Doing that would mean editing package.json, render.yaml, vercel's build
// settings, or .github/workflows/test.yml, none of which are this agent's
// write-set (and package.json dependency/script edits are out of bounds for
// this remediation programme — see the costed recommendation in the evidence
// doc for the exact wiring diff, offered but not applied).
//
// Run manually:  node scripts/check-xlsx-cdn.mjs
// Useful when:   a Vercel/Render/CI build fails at `npm ci` for no obvious
//                reason — run this first to confirm or rule out the CDN.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.join(__dirname, '..', 'package.json');

const TIMEOUT_MS = 10_000;

function readXlsxSpec() {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.dependencies?.xlsx ?? pkg.devDependencies?.xlsx ?? null;
}

async function checkReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

const spec = readXlsxSpec();

if (!spec) {
  console.log('… no `xlsx` dependency found in package.json — nothing to check.');
  process.exit(0);
}

if (!spec.startsWith('https://cdn.sheetjs.com/')) {
  // The whole point of this check is the CDN dependency. If `xlsx` has since
  // moved to a normal registry spec (Option 1/2 of A24-011's recommendation
  // was taken), this script's job is done — say so and get out of the way
  // rather than reporting a false failure.
  console.log(
    `… xlsx is pinned to "${spec}", not a cdn.sheetjs.com URL — this check ` +
      'is no longer relevant. Safe to remove scripts/check-xlsx-cdn.mjs.'
  );
  process.exit(0);
}

console.log(`Checking xlsx's CDN dependency is reachable:\n  ${spec}\n`);

try {
  const { ok, status } = await checkReachable(spec);
  if (ok) {
    console.log(`✓ cdn.sheetjs.com is reachable (HTTP ${status}). \`npm ci\` should resolve xlsx fine.`);
    process.exit(0);
  }
  console.error(
    `✗ cdn.sheetjs.com responded HTTP ${status} for the pinned xlsx tarball.\n` +
      '  This is a known single point of failure (finding A24-011) — xlsx is ' +
      'deliberately pinned to SheetJS\'s own CDN instead of the abandoned, ' +
      'CVE-carrying npm registry copy, so `npm ci` cannot fall back to npm ' +
      'for this one package.\n' +
      '  See docs/audits/2026-08-23/a24/supply-chain.md for the full writeup ' +
      'and docs/render-operational.md ("npm ci deploy failure") for recovery.'
  );
  process.exit(1);
} catch (err) {
  const reason = err?.cause?.code ?? err?.name ?? String(err);
  console.error(
    `✗ Could not reach cdn.sheetjs.com: ${reason}\n` +
      '  This is a known single point of failure (finding A24-011) — xlsx is ' +
      'deliberately pinned to SheetJS\'s own CDN instead of the abandoned, ' +
      'CVE-carrying npm registry copy, so `npm ci` cannot fall back to npm ' +
      'for this one package. A raw npm error for this looks like generic ' +
      '"network connectivity" / "behind a proxy" noise and will NOT mention ' +
      'xlsx or SheetJS by name.\n' +
      '  See docs/audits/2026-08-23/a24/supply-chain.md for the full writeup ' +
      'and docs/render-operational.md ("npm ci deploy failure") for recovery.'
  );
  process.exit(1);
}
