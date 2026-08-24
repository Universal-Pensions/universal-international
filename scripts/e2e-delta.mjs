#!/usr/bin/env node
// e2e-delta — the DELTA gate for the Playwright E2E suite (A09-002 / A25-011,
// docs/audits/2026-08-23/findings.json, notes in docs/audits/2026-08-23/a25/ci-guard.md).
//
// Why this exists: `docs/audits/2026-08-23/a25/baseline-failures.txt` freezes the
// 30 tests that were ALREADY failing (deterministically, not flakily — see
// docs/audits/2026-08-23/00-baseline.md §10) when the audit was taken. Until
// Phase 7 fixes them one by one, `npx playwright test` will keep exiting 1 on
// every run — that is BY DESIGN, not a broken pipeline. Gating CI on the raw
// `playwright test` exit code therefore can never go green; that is the trap
// this script exists to avoid. Instead:
//
//   PASS (exit 0)  iff the set of tests that FAILED this run is a SUBSET of
//                  the frozen allowlist (only known, pre-existing failures).
//   FAIL (exit 1)  iff at least one test failed that is NOT in the allowlist
//                  (a real regression) — every such test is printed.
//
// It also reports (informationally, does not affect the exit code) which
// allowlisted tests now PASS — those are candidates a later phase removes
// from baseline-failures.txt as they're fixed for real. This script never
// writes to baseline-failures.txt itself; the allowlist's lifecycle is a
// separate, human/agent-reviewed process (see A25 Phase 7 notes).
//
// ---------------------------------------------------------------------------
// Usage
//   node scripts/e2e-delta.mjs [json-report-path] [--baseline=path]
//
//   json-report-path   Path to an EXISTING Playwright JSON-reporter output
//                       file (JSONReport shape — see node_modules/playwright/
//                       types/testReporter.d.ts). If given and the file
//                       exists, it is consumed as-is (this is how CI calls
//                       it — see .github/workflows/test.yml, which runs
//                       Playwright itself with --reporter=json and hands the
//                       output file to this script as a separate step, so a
//                       baseline-only run does not abort before the gate
//                       even runs).
//
//                       If omitted, this script runs the full suite itself
//                       (`npx playwright test --workers=1 --reporter=json`)
//                       and gates on that. Convenience for local use; CI uses
//                       the two-step form above so the raw suite's exit code
//                       can be soft-failed (continue-on-error) without losing
//                       the JSON artifact.
//
//   --baseline=path    Override the frozen-allowlist path. Defaults to
//                       docs/audits/2026-08-23/a25/baseline-failures.txt
//                       resolved from THIS script's location, not cwd.
//
// Exit codes
//   0   delta check passed — every failure (if any) is already allowlisted.
//   1   the gate itself failed — at least one NEW failure was found. This is
//       the only code that should ever fail a CI job.
//   2   this script could not run the check at all (bad/missing input,
//       corrupt or empty JSON report, missing baseline file). Distinguished
//       from 1 so "the gate correctly caught a regression" is never confused
//       with "the gate itself is broken."
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// Must mirror playwright.config.ts `testDir`. Verified empirically (see below)
// that JSONReportSpec.file is relative to this directory, not to REPO_ROOT and
// not absolute — so this constant is load-bearing for turning JSON-reporter
// file paths back into the "e2e/specs/…" form baseline-failures.txt uses.
const TEST_DIR_REL = 'e2e/specs';

const DEFAULT_BASELINE = path.join(REPO_ROOT, 'docs/audits/2026-08-23/a25/baseline-failures.txt');

function usageAndExit(code) {
  console.error(
    'Usage: node scripts/e2e-delta.mjs [json-report-path] [--baseline=path]\n' +
      'See the header comment in this file for the full contract and exit codes.'
  );
  process.exit(code);
}

function parseArgs(argv) {
  let jsonPath = null;
  let baselinePath = DEFAULT_BASELINE;
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') usageAndExit(0);
    else if (arg.startsWith('--baseline=')) baselinePath = path.resolve(process.cwd(), arg.slice('--baseline='.length));
    else if (arg.startsWith('--')) usageAndExit(2);
    else if (jsonPath === null) jsonPath = arg;
    else usageAndExit(2);
  }
  return { jsonPath, baselinePath };
}

// ---------------------------------------------------------------------------
// Baseline allowlist parsing.
//
// Format (one test-id per line, verified against the real file):
//   [project] › relative/path/to/spec.ts:line:col › describe › … › test title
// Tolerates:
//   - blank lines
//   - `#`-prefixed comment lines (another agent freezes the file with a
//     header block using these — do NOT assume one-test-per-line-with-no-
//     header; strip both before comparing)
// ---------------------------------------------------------------------------
function parseBaseline(baselinePath) {
  if (!existsSync(baselinePath)) {
    console.error(`e2e-delta: baseline allowlist not found at ${baselinePath}`);
    process.exit(2);
  }
  const text = readFileSync(baselinePath, 'utf8');
  const ids = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue; // blank line
    if (line.startsWith('#')) continue; // comment / FROZEN header line
    ids.add(line);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Playwright JSON report parsing.
//
// Schema per node_modules/playwright/types/testReporter.d.ts (JSONReport /
// JSONReportSuite / JSONReportSpec / JSONReportTest), CROSS-CHECKED empirically
// against this repo's installed Playwright by running:
//   PLAYWRIGHT_JSON_OUTPUT_NAME=out.json npx playwright test e2e/specs/db \
//     --list --reporter=json --project=chromium --project=webkit
// Findings that are NOT obvious from the .d.ts alone:
//   1. report.suites[] is one entry PER FILE (title/file = the file's path
//      relative to config.rootDir, e.g. "db/deactivate-entities.spec.ts"),
//      NOT one entry per project and NOT prefixed with "e2e/specs/". Nested
//      `test.describe(...)` blocks are nested JSONReportSuite entries below
//      that; the file-level suite's own `title` must NOT be treated as a
//      describe segment (it's the filename, not a describe title) or every
//      reconstructed id would have a spurious extra segment.
//   2. spec.file is relative to config.rootDir (== playwright.config.ts
//      `testDir`, "e2e/specs"), NOT relative to the repo root and NOT
//      absolute. baseline-failures.txt's ids embed the repo-root-relative
//      form ("e2e/specs/db/…"), so this script re-relativizes. Handles an
//      absolute spec.file too (some Playwright versions/configs emit that)
//      so a future Playwright bump degrades gracefully instead of silently
//      mis-tagging every id.
//   3. spec.line / spec.column are the location of the `test(...)` call
//      itself — exactly what baseline-failures.txt's ":line:col" is.
//   4. IMPORTANT — the JSON reporter writes to stdout by default, and this
//      repo's dotenv setup ALSO prints "injected env …" tip banners to
//      stdout before Playwright's own output. Redirecting stdout to a file
//      therefore produces a corrupt (non-JSON-prefixed) file. Always set
//      PLAYWRIGHT_JSON_OUTPUT_NAME to a real file path (as the existing
//      §15-M1 workflow step already does) rather than capturing stdout —
//      this script's own self-run mode below does exactly that, and
//      .github/workflows/test.yml's Playwright steps must too.
function specRelPath(specFile) {
  const abs = path.isAbsolute(specFile) ? specFile : path.resolve(REPO_ROOT, TEST_DIR_REL, specFile);
  return path.relative(REPO_ROOT, abs).split(path.sep).join('/');
}

// Walks the suite tree, yielding { id, status } for every (spec × project)
// test entry. `id` is built to match baseline-failures.txt's format exactly.
function collectTests(report) {
  const out = [];

  function visitSpec(spec, titlePath) {
    const relFile = specRelPath(spec.file);
    const fullTitlePath = [...titlePath, spec.title];
    for (const test of spec.tests || []) {
      const id = `[${test.projectName}] › ${relFile}:${spec.line}:${spec.column} › ${fullTitlePath.join(' › ')}`;
      out.push({ id, status: test.status });
    }
  }

  function visitSuite(suite, titlePath, isFileLevel) {
    // The file-level suite's `title` is the file path, not a describe block —
    // never fold it into the title path (see note 1 above).
    const nextPath = isFileLevel ? titlePath : [...titlePath, suite.title];
    for (const spec of suite.specs || []) visitSpec(spec, nextPath);
    for (const sub of suite.suites || []) visitSuite(sub, nextPath, false);
  }

  for (const fileSuite of report.suites || []) visitSuite(fileSuite, [], true);
  return out;
}

// ---------------------------------------------------------------------------
// Self-run mode: no JSON path given, so run the suite ourselves.
// ---------------------------------------------------------------------------
function runPlaywrightAndGetJsonPath() {
  const outDir = path.join(REPO_ROOT, 'test-results');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'e2e-delta-selfrun.json');

  console.log('e2e-delta: no report path given — running the full suite myself (this takes a while).');
  // NOT checked for a zero exit code: the suite is expected to exit 1 at
  // baseline (see header comment). The JSON file is the only thing that
  // matters here; the delta check below is the real gate.
  spawnSync('npx', ['playwright', 'test', '--workers=1', '--reporter=json'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outPath },
  });

  if (!existsSync(outPath)) {
    console.error(`e2e-delta: Playwright did not produce a JSON report at ${outPath}. See output above.`);
    process.exit(2);
  }
  return outPath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const { jsonPath: jsonPathArg, baselinePath } = parseArgs(process.argv.slice(2));

  // An explicit path must exist — that's the "consume an existing result"
  // contract CI relies on (see the two-step wiring in test.yml). Only the
  // fully-omitted-argument case triggers self-run; a typo'd path is a real
  // error, not a signal to silently fall back to running the whole suite.
  let resolvedJsonPath = jsonPathArg;
  if (!resolvedJsonPath) {
    resolvedJsonPath = runPlaywrightAndGetJsonPath();
  } else if (!existsSync(resolvedJsonPath)) {
    console.error(`e2e-delta: JSON report not found at ${resolvedJsonPath}`);
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(readFileSync(resolvedJsonPath, 'utf8'));
  } catch (err) {
    console.error(`e2e-delta: could not parse ${resolvedJsonPath} as JSON (${err.message}).`);
    console.error(
      'If this came from `npx playwright test`, make sure the run used --reporter=json ' +
        'with PLAYWRIGHT_JSON_OUTPUT_NAME pointed at a file — writing JSON to stdout gets ' +
        'corrupted by dotenv/webServer banner lines mixed into the same stream (see note 4 above).'
    );
    process.exit(2);
  }

  if (Array.isArray(report.errors) && report.errors.length > 0 && !Array.isArray(report.suites)) {
    console.error(`e2e-delta: Playwright reported global error(s) before any suite ran: ${JSON.stringify(report.errors)}`);
    process.exit(2);
  }

  const allTests = collectTests(report);
  if (allTests.length === 0) {
    console.error(
      `e2e-delta: 0 tests discovered in ${resolvedJsonPath}. Treating this as a broken run, not a ` +
        `clean pass (report.errors: ${JSON.stringify(report.errors || [])}).`
    );
    process.exit(2);
  }

  const failedNow = new Set(allTests.filter((t) => t.status === 'unexpected').map((t) => t.id));
  const flakyNow = allTests.filter((t) => t.status === 'flaky').map((t) => t.id);

  // Sanity cross-check against Playwright's own stats block — a mismatch
  // means this script's tree-walk has a bug, not that the suite is broken.
  // Warn only; the delta check below is still the authoritative gate.
  const statsUnexpected = report.stats?.unexpected;
  if (typeof statsUnexpected === 'number' && statsUnexpected !== failedNow.size) {
    console.warn(
      `e2e-delta: WARNING — report.stats.unexpected (${statsUnexpected}) does not match the ` +
        `${failedNow.size} 'unexpected' tests this script found while walking suites[]. ` +
        'The id-reconstruction logic may be missing some tests (e.g. an unexpected schema change).'
    );
  }

  const baseline = parseBaseline(baselinePath);
  const newFailures = [...failedNow].filter((id) => !baseline.has(id));
  const nowPassing = [...baseline].filter((id) => !failedNow.has(id));

  console.log(`e2e-delta: ${allTests.length} test result(s) read from ${resolvedJsonPath}`);
  console.log(`e2e-delta: ${failedNow.size} failing now · ${baseline.size} in frozen allowlist (${baselinePath})`);

  if (flakyNow.length > 0) {
    console.log(
      `e2e-delta: ${flakyNow.length} flaky test(s) — failed at least once, passed on retry. ` +
        'Informational only: Playwright itself does not count flaky as a run failure, so this ' +
        'gate does not either. Not required to be in the allowlist.'
    );
    for (const id of flakyNow) console.log(`  ~ ${id}`);
  }

  if (nowPassing.length > 0) {
    console.log(
      `\ne2e-delta: ${nowPassing.length} allowlist entr(y/ies) now PASS — remove from ` +
        `${path.relative(REPO_ROOT, baselinePath)} as Phase 7 fixes land:`
    );
    for (const id of nowPassing) console.log(`  + ${id}`);
  }

  if (newFailures.length > 0) {
    console.error(`\ne2e-delta: ${newFailures.length} NEW failure(s) not covered by the frozen allowlist:`);
    for (const id of newFailures) console.error(`  ! ${id}`);
    console.error('\ne2e-delta: FAIL — regression(s) detected outside the known baseline.');
    process.exit(1);
  }

  console.log('\ne2e-delta: PASS — every failure this run is already in the frozen allowlist.');
  process.exit(0);
}

main();
