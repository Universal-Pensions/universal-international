// The gate in front of `npm run seed`, which TRUNCATEs every seeded table with
// no undo.
//
// Extracted from seed-supabase.mjs so it can be TESTED. That script executes on
// import — it runs the guard and then the seed — so nothing in it could ever be
// unit-tested without wiping a database. A safety check with no tests is a
// safety check nobody can prove.
//
// WHAT CHANGED AND WHY (2026-09-01)
// ---------------------------------
// The original guard required the caller to name the exact project ref parsed
// out of SUPABASE_DB_URL. That stops accidents-by-OMISSION: a bare `npm run
// seed`, or a stale URL you have forgotten about.
//
// It did not stop accidents-by-COMPLIANCE, and it actively helped them along:
// on refusal it printed
//
//     npm run seed -- --yes-destroy ilkhfnoyxlxwqadebnkp
//
// which is a copy-pasteable production wipe, offered to someone who has just
// been told they are doing something dangerous. Naming the target proves you
// read the error message; it does not prove you meant production.
//
// So production refs are now named here, and destroying one needs a SECOND,
// differently-worded flag that no refusal message ever prints for you. You have
// to know it exists and type it deliberately.
//
// This is not hypothetical. `2026-06-16` is recorded in this repo as an
// accidental live reseed.

/** Refs that must never be wiped on a copy-pasted command. */
export const PRODUCTION_REFS = Object.freeze([
  'ilkhfnoyxlxwqadebnkp', // Singapore — the live platform
]);

export const YES_FLAG = '--yes-destroy';
export const PRODUCTION_FLAG = '--i-know-this-is-production';

/**
 * Pull the Supabase project ref out of a connection string.
 *
 * The ref lives in a different place depending on the URL form:
 *   • Pooler (this repo's normal path): embedded in the USERNAME as
 *     "postgres.<ref>" — NOT in the hostname.
 *   • Direct: the first label of host db.<ref>.supabase.co.
 *
 * Parsed with plain regexes rather than `new URL()` — a password containing a
 * character URL() treats specially (e.g. "@") could misparse the userinfo/host
 * split. Only the matched ref is ever returned; the password never is.
 */
export function parseProjectRef(dbUrl) {
  if (typeof dbUrl !== 'string' || dbUrl === '') return null;

  const pooler = dbUrl.match(
    /:\/\/postgres\.([a-z0-9]+):[^@]*@[^/]*\.pooler\.supabase\.com\b/i
  );
  if (pooler) return pooler[1];

  const direct = dbUrl.match(/:\/\/[^@]*@db\.([a-z0-9]+)\.supabase\.co\b/i);
  if (direct) return direct[1];

  return null;
}

export function isProductionRef(ref) {
  return PRODUCTION_REFS.includes(ref);
}

/**
 * Decide whether this destructive run may proceed. PURE — it exits nothing,
 * connects to nothing and prints nothing, so it can be tested.
 *
 * @returns {{ok: true, projectRef: string, production: boolean}
 *          |{ok: false, reason: string, message: string}}
 */
export function evaluateDestroyRequest(dbUrl, argv = []) {
  const projectRef = parseProjectRef(dbUrl);

  if (!projectRef) {
    return {
      ok: false,
      reason: 'unparseable-url',
      message:
        'ERROR: could not parse a Supabase project ref out of SUPABASE_DB_URL.\n' +
        '  Expected the pooler form (username "postgres.<ref>" on a\n' +
        '  *.pooler.supabase.com host) or the direct form (db.<ref>.supabase.co).\n' +
        '  Refusing to run — the destructive TRUNCATE must never fire against an\n' +
        '  unrecognised target.',
    };
  }

  const flagIdx = argv.indexOf(YES_FLAG);
  const suppliedRef = flagIdx !== -1 ? argv[flagIdx + 1] : undefined;
  const production = isProductionRef(projectRef);

  if (!suppliedRef) {
    // For a production target this deliberately does NOT print the command that
    // would proceed. That printout is what turned a refusal into a recipe.
    return {
      ok: false,
      reason: 'no-confirmation',
      message: production
        ? 'ERROR: refusing to run. This script TRUNCATEs every seeded table — ' +
          'destructive and irreversible.\n' +
          `  SUPABASE_DB_URL targets "${projectRef}", which is PRODUCTION.\n` +
          '  No ready-to-paste command is offered here on purpose. If you genuinely\n' +
          '  intend to wipe the live platform, read scripts/seed-guard.mjs and pass\n' +
          '  both required flags deliberately — and take a backup first.'
        : 'ERROR: refusing to run. This script TRUNCATEs every seeded table — ' +
          'destructive and irreversible (audit A09-003; this repo has already ' +
          'suffered one accidental live reseed).\n' +
          `  SUPABASE_DB_URL currently targets project "${projectRef}".\n` +
          '  Re-run naming that exact project to proceed:\n' +
          `    npm run seed -- ${YES_FLAG} ${projectRef}`,
    };
  }

  if (suppliedRef !== projectRef) {
    return {
      ok: false,
      reason: 'ref-mismatch',
      message:
        `ERROR: refusing to run. ${YES_FLAG} "${suppliedRef}" does not match ` +
        `the project ref parsed from SUPABASE_DB_URL ("${projectRef}").\n` +
        '  Aborting before opening any connection — fix the flag or the URL.',
    };
  }

  // Naming the target proves you read the message. It does not prove you meant
  // production, so production needs a second, differently-worded flag.
  if (production && !argv.includes(PRODUCTION_FLAG)) {
    return {
      ok: false,
      reason: 'production-not-acknowledged',
      message:
        `ERROR: refusing to run. "${projectRef}" is PRODUCTION — the live platform,\n` +
        '  carrying real member balances, transaction history and the unit-price book.\n' +
        `  ${YES_FLAG} alone is not enough for a production target: it only proves the\n` +
        '  ref was copied correctly, which is exactly what a pasted command does.\n' +
        `  Add ${PRODUCTION_FLAG} if that is truly what you want,\n` +
        '  and take a pg_dump first — there is no PITR on this plan.',
    };
  }

  return { ok: true, projectRef, production };
}
