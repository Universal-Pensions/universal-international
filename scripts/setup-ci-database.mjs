// Build a CI database from nothing: apply every migration in order, in sequence,
// against whatever SUPABASE_DB_URL points at.
//
// WHY THIS EXISTS
// ---------------
// CI's Supabase secrets pointed at project `zengmiugieqjqzaccbqe` — "Uganda
// dashboard (inactive)", the Tokyo project abandoned in the 2026-06-05 cutover.
// Its last migration is 20260603173045. Every Playwright E2E run for roughly
// three months therefore executed against a database with none of the distributor
// scoping, none of the NAV pricing and none of forward dealing, which is why the
// job failed on `transactions.source does not exist` and
// `branches.distributor_id ... in the schema cache` — columns that exist on live.
//
// The 43-entry allowlist at docs/audits/2026-08-23/a25/baseline-failures.txt is
// therefore mostly an artefact of the wrong database, not a record of real bugs.
// Regenerate it once this has run, or the gate keeps forgiving the wrong things.
//
// CI must NOT hold production credentials. This session watched the E2E suite
// leak real money into the live database twice (30,000 and 50,000 UGX), which is
// the whole argument for a separate database rather than pointing CI at live.
//
// USAGE
//   SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
//     node scripts/setup-ci-database.mjs
//
//   # then seed it, against the SAME url:
//   SUPABASE_DB_URL='...' node scripts/seed-supabase.mjs
//
// Deliberately takes the URL from the environment rather than reading
// .env.local: that file is the owner's live-dev config and must not be edited or
// consulted for this.
//
// Flags:
//   --dry-run   list what would be applied, connect to nothing
//   --from=NNNN start at migration NNNN (resume a partial run)
//   --force     apply even if the target looks like production (see the guard)

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = 'supabase/migrations';

// The live project. Named here so the guard below is a fact, not a convention.
const PRODUCTION_REF = 'ilkhfnoyxlxwqadebnkp';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const fromArg = args.find((a) => a.startsWith('--from='));
const from = fromArg ? fromArg.split('=')[1] : null;

/** Up-migrations only, in filename order — which is numeric order here. */
function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort()
    .filter((f) => (from ? f >= from : true));
}

const files = migrationFiles();

if (dryRun) {
  console.log(`${files.length} migration(s) would be applied, in this order:`);
  for (const f of files) console.log(`  ${f}`);
  process.exit(0);
}

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('SUPABASE_DB_URL is not set.');
  console.error('Pass it explicitly — do NOT source .env.local, which points at live.');
  process.exit(1);
}

// THE GUARD. This script drops nothing, but it applies 160+ migrations in
// sequence and is meant for a throwaway database; running it against production
// is never what anyone wanted. Refuse by default and say so loudly.
if (url.includes(PRODUCTION_REF) && !force) {
  console.error(`REFUSING: SUPABASE_DB_URL points at ${PRODUCTION_REF}, which is PRODUCTION.`);
  console.error('This script builds a CI database. If you genuinely mean it, pass --force.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
let applied = 0;
let skipped = 0;

try {
  await client.connect();

  const { rows: [{ current_database: db }] } = await client.query('SELECT current_database()');
  console.log(`connected to ${db} · ${files.length} migration(s) to consider\n`);

  await client.query('CREATE SCHEMA IF NOT EXISTS supabase_migrations');
  await client.query(`
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
      version text PRIMARY KEY,
      name    text,
      statements text[]
    )`);

  for (const file of files) {
    const name = basename(file).replace(/\.sql$/, '');
    const { rows } = await client.query(
      'SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = $1', [name],
    );
    if (rows.length) {
      skipped += 1;
      console.log(`  ·  ${name} — already recorded, skipping`);
      continue;
    }

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // One transaction PER MIGRATION, not one for the whole run: a failure at
    // 0147 must leave 0001-0146 applied and recorded, so --from can resume
    // rather than starting the whole sequence again.
    await client.query('BEGIN');
    try {
      await client.query(sql);
      const version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      await client.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
         VALUES ($1, $2, ARRAY[$3])`,
        [version, name, sql],
      );
      await client.query('COMMIT');
      applied += 1;
      console.log(`  ok ${name}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`\nFAILED at ${name}: ${err.message}`);
      console.error(`Nothing from this migration was applied. Fix it, then resume with:`);
      console.error(`  node scripts/setup-ci-database.mjs --from=${file}`);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`\n${applied} applied · ${skipped} already present`);
  if (!process.exitCode) {
    console.log('\nNext:');
    console.log('  1. SUPABASE_DB_URL=<same url> node scripts/seed-supabase.mjs');
    console.log('  2. Point the four GitHub secrets at this project:');
    console.log('     VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,');
    console.log('     SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET');
    console.log('  3. Run the E2E suite and REGENERATE baseline-failures.txt —');
    console.log('     the current 43 entries were recorded against the wrong database.');
  }
} catch (err) {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
