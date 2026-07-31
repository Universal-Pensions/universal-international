// Apply a single SQL migration file to the Supabase Postgres over SUPABASE_DB_URL.
//
// Wraps the whole file in ONE transaction, so a failure anywhere leaves the
// database exactly as it was — important when the file replaces money-moving
// RPCs. Uses the same `pg` client + SUPABASE_DB_URL that scripts/seed-supabase.mjs
// already relies on.
//
// Usage:  npx dotenv -e .env.local -- node scripts/apply-migration.mjs <path-to.sql>

import { readFileSync } from 'node:fs';
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
  await client.query('COMMIT');
  console.log('COMMIT — migration applied');
} catch (err) {
  try { await client.query('ROLLBACK'); console.error('ROLLBACK — database unchanged'); } catch { /* connection already gone */ }
  console.error('FAILED:', err.message);
  if (err.position) console.error('  at character position', err.position);
  process.exitCode = 1;
} finally {
  await client.end();
}
