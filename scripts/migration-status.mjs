// Answer "which migrations are on live?" in one command.
//
// WHY THIS EXISTS
// ---------------
// The repo carries 138 up-migrations. On 2026-08-29 only 88 had a row in
// `supabase_migrations.schema_migrations`, because `scripts/apply-migration.mjs`
// applied SQL without recording it (fixed the same day). Establishing what was
// actually live took a 37-way probe of the live catalog — one bespoke assertion
// per migration — to answer a question that should be a lookup. That is finding
// §2.2 of the 2026-08-26 review ("applied-state lives in prose") in its most
// expensive form.
//
// This script reports drift in BOTH directions:
//   * a migration file in the repo with no ledger row — is it live or not?
//   * a ledger row with no migration file — live has something the repo lost.
//     Two did on 2026-08-29, and both were recovered out of the ledger's own
//     `statements` column into 0069b_* and 0102b_*. Today: zero.
//
// WHAT IT DOES NOT DO, DELIBERATELY
// ---------------------------------
// It does not decide whether an unrecorded migration is applied. It cannot: a
// data-only migration (`0135_reanchor_employer_recent_hires` moves five dates)
// leaves no schema footprint, so the only honest check is a bespoke assertion
// per file. This reports the gap and leaves the judgement to a human — an
// unrecorded migration is a question, not a failure.
//
// It also does not write. Backfilling the ledger asserts "this is applied",
// which is a claim that must be verified before it is recorded, never inferred
// by a script. Today's backfill was done once, by hand, against measured
// evidence — see supabase/migrations/README.md.
//
// Usage:  npx dotenv -e .env.local -- node scripts/migration-status.mjs
// Exit:   0 = repo and ledger agree · 1 = drift found (usable as a CI gate)

import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/migrations');

// Applied to live but deliberately NOT expected in the ledger, with the reason.
// `0130` is the only entry: its own header carries a boxed "AUTHORED AND
// VERIFIED, BUT RECOMMENDED NOT TO BE APPLIED" (adjudication EXCLUDE, upheld —
// a cross-tenant PII risk for 6-11ms behind a ~93ms round trip).
const INTENTIONALLY_UNAPPLIED = new Map([
  ['0130_rls_policy_consolidation', 'EXCLUDE upheld — see the file header; do not apply without overruling that'],
]);

// Ledger rows whose migration was later CONSOLIDATED into a differently-named
// repo file. The SQL is on live and in the repo; only the name diverged, so
// these are explained rather than drift. Anything not listed here that has no
// repo file is a real gap — on 2026-08-29 two such rows turned out to be SQL
// that existed ONLY in the database, and were recovered from
// `schema_migrations.statements` into 0069b_* and 0102b_*. One of them
// (0069b) was a security fix: a JWT scope guard on a SECURITY DEFINER RPC.
// Rebuilding the database from the repo would have silently dropped it.
const CONSOLIDATED_INTO = new Map([
  ['0067a_employer_multiproduct_schema_config', '0067_employer_multiproduct_insurance'],
  ['0067b_run_multiproduct_premium', '0067_employer_multiproduct_insurance'],
]);

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL is not set (expected in .env.local).');
  console.error('Run via: npx dotenv -e .env.local -- node scripts/migration-status.mjs');
  process.exit(1);
}

// Repo side: forward migrations only. `.down.sql` files are the reverse of a
// migration, not a migration.
const repo = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  // macOS folder-sync conflict copies ("0001_initial_schema 2.sql") — this
  // checkout lives under ~/Desktop and its sync process duplicates files.
  // Same exclusion vite.config.js and the contract tests already apply.
  .filter((f) => !/ \d+\.[A-Za-z0-9]+$/.test(f))
  .map((f) => f.replace(/\.sql$/, ''))
  .sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(
  'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version',
);
await client.end();

const ledgerNames = new Set(rows.map((r) => r.name));
// A ledger row may predate the NNNN_ prefix convention, so match on the bare
// name too (`distributor_scope_rls` is how `0081_distributor_scope_rls` landed).
const bare = (n) => n.replace(/^\d{4}[a-z]?_/, '');
const ledgerBare = new Map(rows.map((r) => [bare(r.name), r.name]));

const recorded = [];
const legacyName = [];
const unrecorded = [];
for (const m of repo) {
  if (ledgerNames.has(m)) recorded.push(m);
  else if (ledgerBare.has(bare(m))) legacyName.push([m, ledgerBare.get(bare(m))]);
  else unrecorded.push(m);
}
const repoBare = new Set(repo.map(bare));
const orphanAll = rows.filter((r) => !repoBare.has(bare(r.name)));
const consolidated = orphanAll.filter((r) => CONSOLIDATED_INTO.has(r.name));
const orphanLedger = orphanAll.filter((r) => !CONSOLIDATED_INTO.has(r.name));

const pad = (s, n) => String(s).padEnd(n);
console.log(`\nrepo forward migrations : ${repo.length}`);
console.log(`ledger rows             : ${rows.length}`);
console.log(`  exact name match      : ${recorded.length}`);
console.log(`  matched on bare name  : ${legacyName.length}`);
console.log(`  NOT in the ledger     : ${unrecorded.length}`);
console.log(`  consolidated (renamed) : ${consolidated.length}`);
console.log(`  ledger rows w/o a file: ${orphanLedger.length}`);

if (legacyName.length) {
  console.log('\nRecorded under a pre-prefix name (same migration, older naming):');
  for (const [m, l] of legacyName) console.log(`  ${pad(m, 52)} ledger: ${l}`);
}

let drift = false;

if (unrecorded.length) {
  console.log('\nIn the repo, NOT in the ledger — applied or not? Verify before assuming:');
  for (const m of unrecorded) {
    const why = INTENTIONALLY_UNAPPLIED.get(m);
    if (why) console.log(`  ${pad(m, 52)} EXPECTED — ${why}`);
    else { console.log(`  ${pad(m, 52)} UNKNOWN — probe live, then record it`); drift = true; }
  }
}

if (consolidated.length) {
  console.log('\nConsolidated into a differently-named repo file (explained, not drift):');
  for (const r of consolidated) console.log(`  ${pad(r.name, 52)} now ${CONSOLIDATED_INTO.get(r.name)}`);
}

if (orphanLedger.length) {
  console.log('\nIn the ledger, NO file in the repo — live carries something the repo lost:');
  for (const r of orphanLedger) console.log(`  ${pad(r.name, 52)} version ${r.version}`);
  drift = true;
}

if (!drift) {
  console.log('\nOK — every migration is accounted for.');
  const expected = [...INTENTIONALLY_UNAPPLIED.keys()].filter((m) => unrecorded.includes(m));
  if (expected.length) console.log(`     (${expected.length} deliberately unapplied, listed above)`);
}
process.exit(drift ? 1 : 0);
