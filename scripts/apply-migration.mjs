// Apply a single SQL migration file to the Supabase Postgres over SUPABASE_DB_URL.
//
// Wraps the whole file in ONE transaction, so a failure anywhere leaves the
// database exactly as it was — important when the file replaces money-moving
// RPCs. Uses the same `pg` client + SUPABASE_DB_URL that scripts/seed-supabase.mjs
// already relies on.
//
// RECORDS THE MIGRATION IN `supabase_migrations.schema_migrations` in the SAME
// transaction as the SQL it applies. Before 2026-08-29 it did not, and that one
// omission is why 48 of the repo's 136 migrations had no ledger row: every
// migration applied through this script was invisible to `supabase migration
// list` and to the MCP `list_migrations` tool. Answering "is this on live?" then
// required probing the live catalog for a distinctive object per migration —
// which is exactly the "applied-state lives in prose" finding (§2.2 of the
// 2026-08-26 review). The INSERT below closes it at the source.
//
// Usage:  npx dotenv -e .env.local -- node scripts/apply-migration.mjs <path-to.sql>
// Check:  npx dotenv -e .env.local -- node scripts/migration-status.mjs

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import pg from 'pg';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-migration.mjs <path-to.sql>');
  process.exit(1);
}

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL is not set (expected in .env.local)');
  process.exit(1);
}

const sql = readFileSync(file, 'utf8');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`connected · applying ${file} (${sql.length} bytes) in one transaction`);
  await client.query('BEGIN');
  await client.query(sql);

  // Record it, in the same transaction — so a migration is never applied
  // without a ledger row, and a rollback takes the row with it.
  //
  // `version` is a UTC YYYYMMDDHHMMSS stamp, matching what Supabase's own
  // tooling writes. Keyed on `name` rather than `version` so re-applying a file
  // updates nothing and inserts nothing: one row per migration, forever.
  const name = basename(file).replace(/\.sql$/, '');
  const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const { rowCount } = await client.query(
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     SELECT $1, $2, ARRAY[$3]
      WHERE NOT EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = $2
      )`,
    [version, name, sql],
  );
  await client.query('COMMIT');
  console.log('COMMIT — migration applied');
  console.log(
    rowCount === 1
      ? `  ledger: recorded as ${version} ${name}`
      : `  ledger: ${name} was already recorded — no duplicate row written`,
  );
} catch (err) {
  try { await client.query('ROLLBACK'); console.error('ROLLBACK — database unchanged'); } catch { /* connection already gone */ }
  console.error('FAILED:', err.message);
  if (err.position) console.error('  at character position', err.position);
  process.exitCode = 1;
} finally {
  await client.end();
}
