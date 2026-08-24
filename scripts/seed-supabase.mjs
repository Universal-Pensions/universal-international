/**
 * Universal Pensions Uganda — Phase 1 Step 3: Supabase seed script.
 *
 * Materializes the full mockData hierarchy (regions → … → commissions →
 * settlement batches + notifications → demo personas) into a Supabase
 * Postgres DB.
 *
 * Usage:
 *   1. Add SUPABASE_DB_URL=postgres://... to .env.local (use the connection
 *      pooler URL for the Singapore project, e.g.
 *      aws-1-ap-southeast-1.pooler.supabase.com:6543).
 *   2. Ensure migrations 0001+ are applied to the project.
 *   3. npm run seed -- --yes-destroy <project-ref>
 *      (or: node scripts/seed-supabase.mjs --yes-destroy <project-ref>)
 *      <project-ref> must exactly match the ref parsed out of
 *      SUPABASE_DB_URL (audit A09-003 guard) — this is a destructive
 *      TRUNCATE + reseed and the script refuses to run without it. The
 *      error message on a bare run echoes the exact ref to pass.
 *
 * The script:
 *   • Wraps everything in a single transaction.
 *   • SET session_replication_role = replica so the first-contribution
 *     trigger (added in 0002) does NOT fire while seeding — otherwise the
 *     ~5,000 seeded contribution transactions would double-insert commissions.
 *   • Upserts on PK so re-runs converge.
 *   • Bulk-inserts via the unnest() pattern (one INSERT per table batch).
 *
 * Idempotent. ~2 min runtime against a pooled Supabase project.
 */

import 'dotenv/config';
import { register } from 'node:module';
import pg from 'pg';
import bcrypt from 'bcryptjs';

// Register an ESM resolution hook BEFORE importing mockData. The hook
// auto-appends `.js` to extension-less relative specifiers so we can read
// the mock files unchanged (they were written for Vite's relaxed resolver).
// We then `await import(...)` mockData so the hook is live for its
// transitive imports (mockGeo / mockBranchDefs).
register('./seed-loader.mjs', import.meta.url);

const mockData = await import('../src/data/mockData.js');
// `distributorIdForDistrict` maps each branch to its owning distributor — the
// ownership edge migration 0081's RLS resolves through. See the branches insert.
const branchDefs = await import('../src/data/mockBranchDefs.js');
const {
  REGIONS,
  BRANCHES,
  AGENTS,
  SUBSCRIBERS,
  COMMISSIONS,
  COMMISSION_CONFIG,
  DISTRICTS,
} = mockData;

// Employer-role demo seed (Phase 0). Same module the offline mock path uses,
// so the Supabase rows and the VITE_USE_SUPABASE=false rows are identical.
const employerSeed = await import('../src/data/employerSeed.js');
const {
  EMPLOYER,
  MEMBERS,
  CONTRIBUTION_RUNS,
  MEMBER_TRANSACTIONS,
  EMPLOYER_DEMO_PHONE,
} = employerSeed;
// Extra employers spread across regions/districts — admin Platform Overview scope
// filter + district "Employers" tab only (no employer-role login). Additive: just
// employer rows + tagged subscribers + balances.
const employerGeoSeed = await import('../src/data/employerGeoSeed.js');
const { EXTRA_EMPLOYERS, EXTRA_MEMBERS } = employerGeoSeed;
// Employer group insurance product normaliser — fans the employer config out to
// its members so a reseed keeps multi-product (Life/Health/Funeral) employer cover.
const groupInsuranceMod = await import('../src/utils/groupInsurance.js');
const { groupInsuranceProducts } = groupInsuranceMod;

// Single demo-clock anchor (audit A06-003/A06-009/A26-003) — the ONE literal
// both mockData.js and this seed read for "now", via the same dynamic
// `import()` this file already uses for the rest of the mock graph. Used
// below by the date re-anchoring block. Previously this file hand-mirrored
// a SECOND, separately-typed `MOCK_NOW` literal here (justified by a comment
// claiming "the seed can't import a live binding without re-evaluating the
// whole mock module") — that premise never actually held (the `mockData`
// import two lines above already IS that live, fully-evaluated binding) and
// the hand-mirror silently drifted 36 days behind mockData.js's real value,
// over-shifting every re-anchored date (a WEEKLY saver's next_due_date landed
// 57 days out — see docs/audits/2026-08-23/06-data-integrity.md §3.2).
const { MOCK_NOW } = await import('../src/constants/demoClock.js');

const { Client } = pg;

// Hardcoded demo unit price — UGX 1,000/unit, matching the live
// `trg_transactions_contribution` constant (CLAUDE.md §10a). Units held are
// derived from the net balance at this price so `units == total_balance / 1000`
// holds for every seeded row (audit §1b.9 / §4b.5).
const UNIT_PRICE = 1000;

/** Derive units from a net balance at the fixed demo unit price (2dp). */
function unitsFromBalance(netBalance) {
  return Math.round(((netBalance ?? 0) / UNIT_PRICE) * 100) / 100;
}

// ─── Connection ─────────────────────────────────────────────────────────────
const DB_URL = process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error(
    'ERROR: SUPABASE_DB_URL is not set. Add it to .env.local (use the Supabase pooler URL on port 6543).'
  );
  process.exit(1);
}

// ─── Destructive-run guard (audit A09-003) ─────────────────────────────────
// This script TRUNCATEs every seeded table with no undo. It has already been
// pointed at a live project by accident once (2026-06-16 destructive live
// reseed). Require the caller to name the exact project the TRUNCATE is
// about to hit, and refuse — before opening any connection — if it doesn't
// match the ref parsed out of SUPABASE_DB_URL.
//
// The project ref lives in a different part of the connection string
// depending on which form is used:
//   • Pooler (this repo's normal path, host like
//     aws-1-ap-southeast-1.pooler.supabase.com): the ref is embedded in the
//     USERNAME as "postgres.<ref>" — NOT in the hostname.
//   • Direct (host db.<ref>.supabase.co): the ref is the hostname's first
//     label.
//
// Parsed with plain regexes against the raw connection string rather than
// `new URL()` — a password containing a character URL() treats specially
// (e.g. "@") could otherwise misparse the userinfo/host split. Only the
// matched ref is ever logged or compared; the password never is.
function parseProjectRef(dbUrl) {
  const pooler = dbUrl.match(
    /:\/\/postgres\.([a-z0-9]+):[^@]*@[^/]*\.pooler\.supabase\.com\b/i
  );
  if (pooler) return pooler[1];

  const direct = dbUrl.match(/:\/\/[^@]*@db\.([a-z0-9]+)\.supabase\.co\b/i);
  if (direct) return direct[1];

  return null;
}

const YES_FLAG = '--yes-destroy';

/**
 * Refuse to proceed unless the caller passed `--yes-destroy <project-ref>`
 * naming the exact project SUPABASE_DB_URL resolves to. Exits the process
 * (non-zero) on any refusal path; only returns on success. Must run before
 * the first DB connection in the file — see the TRUNCATE block in main().
 */
function requireDestroyConfirmation(dbUrl, argv) {
  const projectRef = parseProjectRef(dbUrl);
  if (!projectRef) {
    console.error(
      'ERROR: could not parse a Supabase project ref out of SUPABASE_DB_URL.\n' +
        '  Expected the pooler form (username "postgres.<ref>" on a\n' +
        '  *.pooler.supabase.com host) or the direct form (db.<ref>.supabase.co).\n' +
        '  Refusing to run — the destructive TRUNCATE below must never fire\n' +
        '  against an unrecognised target.'
    );
    process.exit(1);
  }

  const flagIdx = argv.indexOf(YES_FLAG);
  const suppliedRef = flagIdx !== -1 ? argv[flagIdx + 1] : undefined;

  if (!suppliedRef) {
    console.error(
      'ERROR: refusing to run. This script TRUNCATEs every seeded table — ' +
        'destructive and irreversible (audit A09-003; this repo has already ' +
        'suffered one accidental live reseed).\n' +
        `  SUPABASE_DB_URL currently targets project "${projectRef}".\n` +
        '  Re-run naming that exact project to proceed:\n' +
        `    npm run seed -- ${YES_FLAG} ${projectRef}`
    );
    process.exit(1);
  }

  if (suppliedRef !== projectRef) {
    console.error(
      `ERROR: refusing to run. ${YES_FLAG} "${suppliedRef}" does not match ` +
        `the project ref parsed from SUPABASE_DB_URL ("${projectRef}").\n` +
        '  Aborting before opening any connection — fix the flag or the URL.'
    );
    process.exit(1);
  }

  console.log(`• Destructive-run guard passed — confirmed target "${projectRef}".`);
}

requireDestroyConfirmation(DB_URL, process.argv);

// ─── Helpers ────────────────────────────────────────────────────────────────
/**
 * Insert rows in chunks using the unnest() pattern so a single INSERT covers
 * up to CHUNK_SIZE rows at a time (round-trip count ≈ rowCount / CHUNK_SIZE).
 *
 * `columns` is an array of { name, type } objects; the SQL type is required
 * because unnest() can't infer it from an empty array. ON CONFLICT clause
 * forces idempotency.
 *
 * @param {pg.Client} client
 * @param {string} table
 * @param {Array<{name: string, type: string}>} columns
 * @param {Array<Array<any>>} rows  parallel arrays, one per column (column-major)
 * @param {string} conflictTarget  'id' or '(run_id, branch_id)' etc.
 */
async function bulkInsert(client, table, columns, rows, conflictTarget) {
  if (rows[0].length === 0) {
    return;
  }
  const CHUNK_SIZE = 2000;
  const total = rows[0].length;
  const colNames = columns.map((c) => c.name).join(', ');

  // Build the SET clause for ON CONFLICT — every column except the conflict
  // target gets `name = EXCLUDED.name`.
  const conflictCols = conflictTarget.replace(/[()]/g, '').split(',').map((s) => s.trim());
  const updateSet = columns
    .filter((c) => !conflictCols.includes(c.name))
    .map((c) => `${c.name} = EXCLUDED.${c.name}`)
    .join(', ');

  for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const chunk = rows.map((col) => col.slice(offset, end));

    // unnest(...) returns one row per array element across all arrays.
    const unnestArgs = columns
      .map((c, i) => `$${i + 1}::${c.type}[]`)
      .join(', ');
    const selectCols = columns.map((c) => c.name).join(', ');

    const sql =
      `INSERT INTO ${table} (${colNames})
       SELECT ${selectCols}
       FROM unnest(${unnestArgs})
         AS t(${colNames})
       ON CONFLICT (${conflictTarget}) DO UPDATE
         SET ${updateSet}`;

    await client.query(sql, chunk);
  }
}

/** Coerce a JS Date to a YYYY-MM-DD string. Pass-through if already a string. */
function toDateStr(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return null;
}

// ─── Date re-anchoring (audit §4b.2) ─────────────────────────────────────────
// mockData.js anchors every relative date to a frozen `MOCK_NOW`. As real time
// elapses past a seed run, forward-looking dates (notably `next_due_date`) drift
// into the past relative to wall-clock now → ~40% of schedules render "overdue"
// and the invariants #5 assertion fails on live. Rather than freezing a new
// MOCK_NOW in mockData.js, the seed re-anchors the *forward-looking* dates it
// emits onto today's date while preserving their MOCK_NOW-relative offset, so
// "due in N days" math stays intact and no schedule is born stale.
//
// MOCK_NOW is imported above from src/constants/demoClock.js — see that
// import's comment for why this can no longer drift the way the old
// hand-mirrored local literal did.
const SEED_TODAY = new Date();
SEED_TODAY.setHours(0, 0, 0, 0);
// Whole-day delta from the frozen anchor to today (≥ 0 once wall-clock passes
// MOCK_NOW; clamped at 0 so seeding *before* the anchor never shifts backwards).
const DATE_SHIFT_DAYS = Math.max(
  0,
  Math.round((SEED_TODAY.getTime() - MOCK_NOW.getTime()) / 86400000)
);

/**
 * Re-anchor a MOCK_NOW-relative YYYY-MM-DD date forward to wall-clock today by
 * DATE_SHIFT_DAYS, preserving its offset from MOCK_NOW. Used for forward-looking
 * dates (schedule `next_due_date`) so they are never born in the past. No-op when
 * DATE_SHIFT_DAYS === 0 or the input is null.
 */
function reanchorDateStr(v) {
  const s = toDateStr(v);
  if (!s || DATE_SHIFT_DAYS === 0) return s;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return s;
  const shifted = new Date(y, m - 1, d + DATE_SHIFT_DAYS);
  return toDateStr(shifted);
}

// Deterministic demo "overdue contributions" backlog. Branch admins surface
// members past their scheduled payment date as a Needs-attention metric (drills
// to per-agent nudges via get_branch_pending_contributions). Without a backlog
// the metric is structurally 0 (every member is seeded as having paid), so we
// seed ~18% of ACTIVE members with a recent past-due next_due_date. Deterministic
// (hash of the subscriber id) so reseeds are stable.
function hashStr(str) {
  let h = 0;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
const isOverdueSeed = (s) => Boolean(s.isActive) && hashStr(s.id) % 100 < 18;
function pastDueDateStr(id) {
  const days = 1 + (hashStr(id) % 21); // 1..21 days ago
  return toDateStr(new Date(SEED_TODAY.getTime() - days * 86400000));
}

/** Coerce a JS Date / string to a TIMESTAMPTZ-compatible ISO string. */
function toTimestamptz(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

/** Approximate a DOB from age — mid-year on the birth-year boundary. */
function dobFromAge(age) {
  // MOCK_NOW is imported from src/constants/demoClock.js (see above).
  const birthYear = MOCK_NOW.getFullYear() - age;
  return `${birthYear}-06-15`;
}

/** Compute tenure months from joinedDate (YYYY-MM-DD) at the MOCK_NOW anchor. */
function tenureMonthsFromJoined(joinedDate, fallback) {
  if (typeof fallback === 'number') return fallback;
  if (!joinedDate) return null;
  const [y, m] = joinedDate.split('-').map(Number);
  return (MOCK_NOW.getFullYear() - y) * 12 + (MOCK_NOW.getMonth() + 1 - m);
}

// ─── Seed ───────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log('• Materializing mockData…');

  // Touching SUBSCRIBERS triggers the lazy Proxy → generates the rows
  // (~5,000 per the `TARGET_SUBS = 5000` const in src/data/mockData.js).
  const subscriberIds = Object.keys(SUBSCRIBERS);
  const subscribers = subscriberIds.map((id) => SUBSCRIBERS[id]);

  // mockData's random phone generator can collide at scale (~0.5% dupe rate).
  // The partial unique index `subscribers(phone) WHERE NOT is_demo_signup`
  // rejects duplicates. Reassign duplicates to +25671XXXXXXX (non-real UG range)
  // so they stay unique and don't collide with demo personas at +2567000000XX.
  //
  // Idempotency: pre-seed the `seen` set with every phone already on a live
  // (non-demo-signup, non-seeded-id) subscriber row in the DB so a re-run
  // against a populated DB does NOT regenerate a fresh phone that collides
  // with a different existing row's ID-keyed UPSERT. The `subscribers` UPSERT
  // keys off `id`, so phone-row mismatches across re-runs would otherwise
  // trip the partial unique index. We exclude rows whose ID IS in this seed's
  // own ID set — those will be overwritten in place by the UPSERT, so
  // including their old phone in `seen` would force a needless re-roll.
  //
  // The SELECT runs against a separate short-lived connection so the failure
  // mode of "table doesn't exist yet" (extreme first-ever seed before
  // migrations) surfaces as a clear error rather than a half-applied seed.
  const subscriberIdSet = new Set(subscriberIds);
  const preloadClient = new Client({ connectionString: DB_URL });
  await preloadClient.connect();
  let preloadedDupes = new Set();
  try {
    const { rows: existingRows } = await preloadClient.query(
      "SELECT id, phone FROM subscribers WHERE is_demo_signup = false AND phone IS NOT NULL"
    );
    for (const row of existingRows) {
      // Skip rows we own — the upcoming UPSERT will set their phone to the
      // freshly-generated value, freeing the old phone (if it differs) for
      // re-use by another row in this run.
      if (subscriberIdSet.has(row.id)) continue;
      preloadedDupes.add(row.phone);
    }
    if (preloadedDupes.size) {
      console.log(`  → ${preloadedDupes.size} existing phone(s) reserved by live (non-seed) subscribers`);
    }
  } catch (err) {
    // If the subscribers table doesn't exist or any other unexpected error
    // occurs, surface it loudly so a half-applied seed doesn't silently land.
    console.error('ERROR: failed to pre-load existing subscriber phones — has the schema been migrated?');
    await preloadClient.end();
    throw err;
  } finally {
    await preloadClient.end();
  }
  {
    const seen = new Set(preloadedDupes);
    let dupeCount = 0;
    for (const s of subscribers) {
      if (!s.phone) continue;
      if (seen.has(s.phone)) {
        dupeCount += 1;
        // Re-roll into the +25671XXXXXXX synthetic range, padding far enough
        // not to collide with the demo persona block (+2567000000XX) or with
        // the live `+256711…` demo subscribers (`…000001`-`…000005`).
        let attempt = dupeCount;
        let candidate = `+25671${String(attempt).padStart(7, '0')}`;
        while (seen.has(candidate)) {
          attempt += 1;
          candidate = `+25671${String(attempt).padStart(7, '0')}`;
        }
        s.phone = candidate;
        dupeCount = attempt;
      }
      seen.add(s.phone);
    }
    if (dupeCount) console.log(`  → reassigned ${dupeCount} duplicate phones to +25671XXXXXXX range`);
  }
  const branches = Object.values(BRANCHES);
  const agents = Object.values(AGENTS);
  const districts = Object.values(DISTRICTS);
  const regions = Object.values(REGIONS);
  const commissions = Object.values(COMMISSIONS);

  console.log(
    `  regions=${regions.length} districts=${districts.length} branches=${branches.length} ` +
      `agents=${agents.length} subscribers=${subscribers.length} commissions=${commissions.length}`
  );

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    // 1. Disable triggers (commission auto-creation + balance recalc) so the
    //    seed can insert raw rows without double-firing them. CRITICAL.
    await client.query("SET session_replication_role = 'replica'");

    // ═══════════════════════════════════════════════════════════════════════
    //  ⚠️  DESTRUCTIVE RESET — TRUNCATE … RESTART IDENTITY CASCADE  ⚠️
    // ───────────────────────────────────────────────────────────────────────
    //  This wipes EVERY seeded table (and the two upload audit tables) to
    //  empty, resets their identity sequences, and CASCADEs to any dependent
    //  rows. It exists so repeated reseeds do NOT accumulate dead tuples /
    //  disk — the upserts below then repopulate from scratch.
    //
    //  ‼️  ONLY SAFE against the fresh, empty demo project this script is run
    //      against. It is HUMAN-RUN ONLY and will irrecoverably destroy ALL
    //      data in these tables — NEVER point this at a project with data you
    //      care about. There is no undo.
    //
    //  Table list is exhaustive for tables this script INSERTs/upserts into,
    //  EXCEPT `subscriber_insurance_products` — it FKs to subscribers ON DELETE
    //  CASCADE, so naming `subscribers` already empties it (same for 0080's detach
    //  journals, noted below). PLUS the app-written-only audit/idempotency tables
    //  (settlement_uploads, contribution_run_uploads, subscriber_signup_uploads,
    //  and employer_invites)
    //  — none are seeded here, but a demo populates them, so they'd otherwise
    //  grow unbounded across reseeds. (We deliberately do NOT touch the legacy
    //  `employees`/`contribution_run_lines` tables: they are retired by 0045 in
    //  the unified tagged-subscriber model — this seed never writes them, and
    //  once 0045 is applied they no longer exist.)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('• TRUNCATE (destructive reset)…');
    await client.query(`
      TRUNCATE TABLE
        regions,
        districts,
        branches,
        agents,
        subscribers,
        subscriber_balances,
        contribution_schedules,
        insurance_policies,
        nominees,
        transactions,
        claims,
        withdrawals,
        commission_config,
        commissions,
        settlement_batches,
        notifications,
        distributors,
        employers,
        contribution_runs,
        employer_invites,
        demo_personas,
        users,
        settlement_uploads,
        contribution_run_uploads,
        subscriber_signup_uploads,
        -- 0079 added access_requests; the seed was never updated, so a reseed
        -- left approved requests pointing at distributors/employers and users
        -- rows that no longer exist. (0080's two detach journals are NOT listed
        -- because they FK to subscribers and the CASCADE above already clears
        -- them — a reseed has no prior state worth replaying.)
        -- NOTE: no backticks in this block. It lives inside a JS template
        -- literal, so a backtick terminates the string and breaks the file.
        access_requests
      RESTART IDENTITY CASCADE
    `);

    // ── regions ────────────────────────────────────────────────────────────
    console.log('• regions…');
    await bulkInsert(
      client,
      'regions',
      [
        { name: 'id', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'parent_id', type: 'text' },
        { name: 'center_lng', type: 'numeric' },
        { name: 'center_lat', type: 'numeric' },
      ],
      [
        regions.map((r) => r.id),
        regions.map((r) => r.name),
        regions.map((r) => r.parentId ?? 'ug'),
        regions.map((r) => r.center?.[0] ?? null),
        regions.map((r) => r.center?.[1] ?? null),
      ],
      'id'
    );

    // ── districts ──────────────────────────────────────────────────────────
    console.log('• districts…');
    await bulkInsert(
      client,
      'districts',
      [
        { name: 'id', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'region_id', type: 'text' },
        { name: 'center_lng', type: 'numeric' },
        { name: 'center_lat', type: 'numeric' },
        { name: 'active', type: 'boolean' },
      ],
      [
        districts.map((d) => d.id),
        districts.map((d) => d.name),
        districts.map((d) => d.parentId),
        districts.map((d) => d.center?.[0] ?? null),
        districts.map((d) => d.center?.[1] ?? null),
        districts.map((d) => d.active !== false),
      ],
      'id'
    );

    // ── branches ───────────────────────────────────────────────────────────
    console.log('• branches…');
    await bulkInsert(
      client,
      'branches',
      [
        { name: 'id', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'district_id', type: 'text' },
        { name: 'center_lng', type: 'numeric' },
        { name: 'center_lat', type: 'numeric' },
        { name: 'manager_name', type: 'text' },
        { name: 'manager_phone', type: 'text' },
        { name: 'manager_email', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'score', type: 'numeric' },
        { name: 'rank', type: 'integer' },
        { name: 'district_rank', type: 'integer' },
        { name: 'district_branch_count', type: 'integer' },
        { name: 'distributor_id', type: 'text' },
      ],
      [
        branches.map((b) => b.id),
        branches.map((b) => b.name),
        branches.map((b) => b.parentId),
        branches.map((b) => b.center?.[0] ?? null),
        branches.map((b) => b.center?.[1] ?? null),
        branches.map((b) => b.managerName ?? null),
        branches.map((b) => b.managerPhone ?? null),
        branches.map((b) => b.managerEmail ?? null),
        branches.map((b) => b.status ?? 'active'),
        branches.map((b) => b.score ?? null),
        branches.map((b) => b.rank ?? null),
        branches.map((b) => b.districtRank ?? null),
        branches.map((b) => b.districtBranchCount ?? null),
        // Migration 0060 added this column; migration 0081 made it the single
        // ownership edge every distributor-scoped read resolves through. It is
        // NOT optional: a NULL here hides the branch, its agents and their
        // subscribers from their own distributor's dashboard.
        // The Busoga districts belong to the secondary distributor d-002, the
        // rest to the national d-001 — see `D002_DISTRICT_IDS` in mockBranchDefs.
        // NOTE: read the district from `parentId`, NOT `districtId`. mockData's
        // BRANCHES builder maps the def's `districtId` onto `parentId` and does
        // not keep the original key, so `b.districtId` is undefined here — which
        // silently sent every branch to the d-001 fallback and erased the split.
        branches.map((b) => b.distributorId
          ?? branchDefs.distributorIdForDistrict(b.districtId ?? b.parentId)),
      ],
      'id'
    );

    // ── agents ─────────────────────────────────────────────────────────────
    // ux_agents_email forbids duplicate non-null emails, but the small name
    // pool makes the generated 2049-agent emails collide (~1k dupes). The email
    // is display-only (agents authenticate by phone/OTP via demo_personas), so:
    //   (a) suffix any repeated email with the agent's unique id → globally
    //       unique; (b) NULL existing agent emails first so re-setting them to
    //       the new unique values can't transiently collide with an as-yet-
    //       unupdated row's old email mid-statement.
    console.log('• agents…');
    await client.query('UPDATE agents SET email = NULL');
    const _seenAgentEmails = new Set();
    const agentEmails = agents.map((a) => {
      let email = a.email ?? null;
      if (!email) return null;
      if (_seenAgentEmails.has(email)) {
        const [local, domain] = email.split('@');
        email = `${local}.${a.id}@${domain}`;
      }
      _seenAgentEmails.add(email);
      return email;
    });
    await bulkInsert(
      client,
      'agents',
      [
        { name: 'id', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'gender', type: 'text' },
        { name: 'employee_id', type: 'text' },
        { name: 'branch_id', type: 'text' },
        { name: 'center_lng', type: 'numeric' },
        { name: 'center_lat', type: 'numeric' },
        { name: 'phone', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'rating', type: 'numeric' },
        { name: 'performance', type: 'integer' },
        { name: 'status', type: 'text' },
        { name: 'languages', type: 'jsonb' },
        { name: 'specialties', type: 'jsonb' },
        { name: 'tenure_months', type: 'integer' },
        { name: 'joined_date', type: 'date' },
      ],
      [
        agents.map((a) => a.id),
        agents.map((a) => a.name),
        agents.map((a) => a.gender ?? null),
        agents.map((a) => a.employeeId ?? null),
        agents.map((a) => a.parentId),
        agents.map((a) => a.center?.[0] ?? null),
        agents.map((a) => a.center?.[1] ?? null),
        agents.map((a) => a.phone ?? null),
        agentEmails,
        agents.map((a) => a.rating ?? null),
        agents.map((a) => a.performance ?? null),
        agents.map((a) => a.status ?? 'active'),
        agents.map((a) => JSON.stringify(a.languages ?? [])),
        agents.map((a) => JSON.stringify(a.specialties ?? [])),
        agents.map((a) => tenureMonthsFromJoined(a.joinedDate, a.tenureMonths)),
        agents.map((a) => a.joinedDate ?? null),
      ],
      'id'
    );

    // ── subscribers ────────────────────────────────────────────────────────
    console.log('• subscribers…');
    // Build district lookup: agentId → districtId (via branch.parentId)
    const branchById = Object.fromEntries(branches.map((b) => [b.id, b]));
    const agentById = Object.fromEntries(agents.map((a) => [a.id, a]));
    const subscriberDistrict = (s) => {
      const agent = agentById[s.parentId];
      if (!agent) return null;
      const branch = branchById[agent.parentId];
      return branch?.parentId ?? null;
    };

    await bulkInsert(
      client,
      'subscribers',
      [
        { name: 'id', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'gender', type: 'text' },
        { name: 'age', type: 'integer' },
        { name: 'dob', type: 'date' },
        { name: 'nin', type: 'text' },
        { name: 'occupation', type: 'text' },
        { name: 'agent_id', type: 'text' },
        { name: 'district_id', type: 'text' },
        { name: 'kyc_status', type: 'text' },
        { name: 'is_active', type: 'boolean' },
        { name: 'is_demo_signup', type: 'boolean' },
        { name: 'insurance_same_as_pension', type: 'boolean' },
        { name: 'registered_date', type: 'date' },
        { name: 'last_contribution_date', type: 'date' },
        { name: 'contribution_history', type: 'jsonb' },
        { name: 'products_held', type: 'jsonb' },
        { name: 'current_unit_value', type: 'numeric' },
        { name: 'unit_value_as_of', type: 'timestamptz' },
      ],
      [
        subscribers.map((s) => s.id),
        subscribers.map((s) => s.name),
        subscribers.map((s) => s.email ?? null),
        subscribers.map((s) => s.phone),
        subscribers.map((s) => s.gender ?? null),
        subscribers.map((s) => s.age ?? null),
        subscribers.map((s) => (s.age ? dobFromAge(s.age) : null)),
        // mockData doesn't carry a NIN per subscriber — leave null; signup
        // adds it via createFromSignup.
        subscribers.map(() => null),
        subscribers.map(() => null),
        subscribers.map((s) => s.parentId),
        subscribers.map((s) => subscriberDistrict(s)),
        subscribers.map((s) => s.kycStatus ?? 'complete'),
        subscribers.map((s) => Boolean(s.isActive)),
        // Every seeded subscriber is real demo data — `is_demo_signup=false`
        // so the partial unique index treats their phone numbers as owned.
        subscribers.map(() => false),
        // mockData stores `nominees.pension/insurance` separately; the seed
        // can't always tell whether they intentionally match. We mark all as
        // same-as-pension and the signup flow overrides explicitly per row.
        subscribers.map(() => true),
        subscribers.map((s) => s.registeredDate ?? null),
        // Last contribution: pick the most recent contribution date in tx
        // history, else null.
        subscribers.map((s) => {
          const tx = (s.transactions || []).filter((t) => t.type === 'contribution');
          if (!tx.length) return null;
          // transactions are sorted desc by date already; first hit wins.
          return tx[0].date;
        }),
        subscribers.map((s) => JSON.stringify(s.contributionHistory ?? [])),
        subscribers.map((s) => JSON.stringify(s.productsHeld ?? [])),
        subscribers.map((s) => s.currentUnitValue ?? null),
        subscribers.map((s) => toTimestamptz(s.unitValueAsOf)),
      ],
      'id'
    );

    // ── subscriber_balances ────────────────────────────────────────────────
    console.log('• subscriber_balances…');
    await bulkInsert(
      client,
      'subscriber_balances',
      [
        { name: 'subscriber_id', type: 'text' },
        { name: 'retirement_balance', type: 'numeric' },
        { name: 'emergency_balance', type: 'numeric' },
        { name: 'total_balance', type: 'numeric' },
        { name: 'units', type: 'numeric' },
      ],
      [
        subscribers.map((s) => s.id),
        subscribers.map((s) => s.retirementBalance ?? 0),
        subscribers.map((s) => s.emergencyBalance ?? 0),
        subscribers.map((s) => s.netBalance ?? 0),
        // Derive units from the net balance at the fixed unit price so
        // `units == total_balance / 1000` holds (§1b.9) — mockData's
        // independently-generated `unitsHeld` drifts off this identity.
        subscribers.map((s) => unitsFromBalance(s.netBalance ?? 0)),
      ],
      'subscriber_id'
    );

    // ── contribution_schedules ─────────────────────────────────────────────
    console.log('• contribution_schedules…');
    await bulkInsert(
      client,
      'contribution_schedules',
      [
        { name: 'subscriber_id', type: 'text' },
        { name: 'frequency', type: 'text' },
        { name: 'amount', type: 'numeric' },
        { name: 'retirement_pct', type: 'integer' },
        { name: 'emergency_pct', type: 'integer' },
        { name: 'include_insurance', type: 'boolean' },
        { name: 'insurance_choice_made', type: 'boolean' },
        { name: 'next_due_date', type: 'date' },
      ],
      [
        subscribers.map((s) => s.id),
        subscribers.map((s) => s.contributionSchedule?.frequency ?? 'monthly'),
        subscribers.map((s) => s.contributionSchedule?.amount ?? 0),
        subscribers.map((s) => s.contributionSchedule?.retirementPct ?? 80),
        subscribers.map((s) => s.contributionSchedule?.emergencyPct ?? 20),
        subscribers.map((s) => Boolean(s.contributionSchedule?.includeInsurance)),
        // mockData doesn't track this; treat the seed as a definitive choice
        // (true) so the dashboard doesn't badge every seeded subscriber as
        // "decision pending".
        subscribers.map(() => true),
        // Re-anchor the forward-looking due date onto wall-clock today (§4b.2)
        // so no schedule is seeded already-overdue when real time has elapsed
        // past MOCK_NOW. Offset from MOCK_NOW is preserved (no-op at run-time
        // == MOCK_NOW). EXCEPT the deterministic ~18% "overdue" slice of active
        // members (isOverdueSeed), which is seeded a recent past-due date so the
        // branch "Overdue contributions" needs-attention metric is non-zero.
        subscribers.map((s) => (
          isOverdueSeed(s)
            ? pastDueDateStr(s.id)
            : reanchorDateStr(s.contributionSchedule?.nextDueDate ?? null)
        )),
      ],
      'subscriber_id'
    );

    // NOTE — employer group insurance (migration 0067) is NOT fanned out here.
    // `subscribers` is the mockData population: 5,000 agent-channel savers, none of
    // which carries an `employerId` field at all. Mapping the employer configs over
    // this list matched zero rows, so the three "employer-funded" branches that used
    // to live in the two insurance blocks below were dead code — silently dead, with
    // no error to trip over, which is how it survived several audits. The employers'
    // own members are seeded much further down (§ "employer members"), and the
    // fan-out now lives there, next to the rows it actually writes.

    // ── insurance_policies (only for subscribers with cover > 0) ───────────
    // Every subscriber in this population is self-funded (funded_by='self'): they
    // hold individual cover bought at signup, not employer group cover.
    console.log('• insurance_policies…');
    const insureds = subscribers.filter((s) => s.insurance?.cover > 0);
    await bulkInsert(
      client,
      'insurance_policies',
      [
        { name: 'subscriber_id', type: 'text' },
        { name: 'cover', type: 'numeric' },
        { name: 'premium_monthly', type: 'numeric' },
        { name: 'policy_start', type: 'date' },
        { name: 'renewal_date', type: 'date' },
        { name: 'status', type: 'text' },
        { name: 'funded_by', type: 'text' },
      ],
      [
        insureds.map((s) => s.id),
        insureds.map((s) => s.insurance.cover),
        insureds.map((s) => s.insurance.premiumMonthly ?? 0),
        insureds.map((s) => s.insurance.policyStart ?? null),
        insureds.map((s) => s.insurance.renewalDate ?? null),
        insureds.map((s) => s.insurance.status ?? 'active'),
        insureds.map(() => 'self'),
      ],
      'subscriber_id'
    );

    // ── subscriber_insurance_products (health/funeral add-ons) ─────────────
    // mockData has no multi-product insurance, so synthesise health/funeral
    // rows here — otherwise the agent's "active policies" chips have nothing to
    // show. Demo values mirror src/constants/savings.js INSURANCE_PRODUCTS.
    // Attached to a deterministic slice of insured members, and ALWAYS to demo
    // agent a-001's insured members so the agent demo is populated.
    console.log('• subscriber_insurance_products…');
    const EXTRA_PRODUCTS = {
      health: { cover: 3_000_000, premium: 5_000 },
      funeral: { cover: 2_000_000, premium: 1_500 },
    };
    const sipStart = reanchorDateStr('2026-01-01');     // before MOCK_NOW
    const sipRenewal = reanchorDateStr('2027-01-01');   // after  → status active
    const sipSubId = [];
    const sipProduct = [];
    const sipCover = [];
    const sipPremium = [];
    const sipPolicyStart = [];
    const sipRenewalDate = [];
    const sipStatus = [];
    const sipFundedBy = [];
    const seenSip = new Set(); // dedup (subscriber_id, product) — bulkInsert upsert can't hit a row twice
    const pushProduct = (id, product, { cover, premium, fundedBy = 'self' } = {}) => {
      const key = `${id}|${product}`;
      if (seenSip.has(key)) return;
      seenSip.add(key);
      sipSubId.push(id);
      sipProduct.push(product);
      sipCover.push(cover ?? EXTRA_PRODUCTS[product].cover);
      sipPremium.push(premium ?? EXTRA_PRODUCTS[product].premium);
      sipPolicyStart.push(sipStart);
      sipRenewalDate.push(sipRenewal);
      sipStatus.push('active');
      sipFundedBy.push(fundedBy);
    };
    // Self-funded add-ons for a deterministic slice + all of agent a-001's members.
    // (No employer-funded rows here — see the NOTE above the insurance_policies
    // block: nobody in this population has an employer.)
    insureds.forEach((s, i) => {
      const isA001 = s.parentId === 'a-001';
      if (isA001 || i % 3 === 0) pushProduct(s.id, 'health');
      if ((isA001 && i % 2 === 0) || i % 5 === 0) pushProduct(s.id, 'funeral');
    });
    await bulkInsert(
      client,
      'subscriber_insurance_products',
      [
        { name: 'subscriber_id', type: 'text' },
        { name: 'product', type: 'text' },
        { name: 'cover', type: 'numeric' },
        { name: 'premium_monthly', type: 'numeric' },
        { name: 'policy_start', type: 'date' },
        { name: 'renewal_date', type: 'date' },
        { name: 'status', type: 'text' },
        { name: 'funded_by', type: 'text' },
      ],
      [sipSubId, sipProduct, sipCover, sipPremium, sipPolicyStart, sipRenewalDate, sipStatus, sipFundedBy],
      'subscriber_id, product'
    );

    // ── nominees ───────────────────────────────────────────────────────────
    console.log('• nominees…');
    const nomineeIds = [];
    const nomineeSubIds = [];
    const nomineeTypes = [];
    const nomineeNames = [];
    const nomineePhones = [];
    const nomineeRels = [];
    const nomineeNins = [];
    const nomineeShares = [];
    for (const s of subscribers) {
      for (const n of s.nominees?.pension ?? []) {
        nomineeIds.push(n.id);
        nomineeSubIds.push(s.id);
        nomineeTypes.push('pension');
        nomineeNames.push(n.name);
        nomineePhones.push(n.phone ?? null);
        nomineeRels.push(n.relationship ?? null);
        nomineeNins.push(n.nin ?? null);
        nomineeShares.push(n.share);
      }
      for (const n of s.nominees?.insurance ?? []) {
        nomineeIds.push(n.id);
        nomineeSubIds.push(s.id);
        nomineeTypes.push('insurance');
        nomineeNames.push(n.name);
        nomineePhones.push(n.phone ?? null);
        nomineeRels.push(n.relationship ?? null);
        nomineeNins.push(n.nin ?? null);
        nomineeShares.push(n.share);
      }
    }
    await bulkInsert(
      client,
      'nominees',
      [
        { name: 'id', type: 'text' },
        { name: 'subscriber_id', type: 'text' },
        { name: 'type', type: 'nominee_type' },
        { name: 'name', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'relationship', type: 'text' },
        { name: 'nin', type: 'text' },
        { name: 'share', type: 'numeric' },
      ],
      [
        nomineeIds,
        nomineeSubIds,
        nomineeTypes,
        nomineeNames,
        nomineePhones,
        nomineeRels,
        nomineeNins,
        nomineeShares,
      ],
      'id'
    );

    // ── transactions (12-month contribution + premium + withdrawal + claim) ─
    console.log('• transactions…');
    const txIds = [];
    const txSubIds = [];
    const txAgentIds = [];
    const txTypes = [];
    const txAmounts = [];
    const txDates = [];
    const txStatuses = [];
    const txMethods = [];
    const txRefs = [];
    const txBuckets = [];
    for (const s of subscribers) {
      for (const t of s.transactions ?? []) {
        txIds.push(t.id);
        txSubIds.push(s.id);
        txAgentIds.push(s.parentId);
        txTypes.push(t.type);
        // mockData stores withdrawals as negative amounts already; preserve.
        txAmounts.push(t.amount);
        txDates.push(toTimestamptz(t.date));
        txStatuses.push(t.status ?? null);
        txMethods.push(t.method ?? null);
        // The mock field is `reference`; the schema column is `txn_ref`.
        txRefs.push(t.reference ?? null);
        txBuckets.push(t.bucket ?? null);
      }
      // Opening-balance reconciliation (audit 2026-06-16): `netBalance` is an
      // authored snapshot reflecting full tenure, but only a recent window of
      // contributions is seeded — so SUM(transactions) was ≈1/5 of the balance.
      // Add one "brought-forward" contribution dated at registration so the
      // subscriber's ledger sums exactly to total_balance (and, since the rollup
      // sums all contribution rows, platform totalContributions ≈ AUM).
      //
      // A self-paid insurance 'premium' (the annual cover charge) does NOT build
      // the savings balance — the balance trigger fires only WHEN type='contribution',
      // so a premium never touches total_balance. Exclude it from the opening-balance
      // reconciliation, else the ~24,000 annual premium would be baked into the
      // brought-forward contribution and inflate seeded AUM (audit 2026-07-05).
      // (Claims are left in the sum, unchanged, to preserve the approved headline.)
      const _seededSum = (s.transactions ?? [])
        .filter((t) => (t.type ?? 'contribution') !== 'premium')
        .reduce((acc, t) => acc + Number(t.amount || 0), 0);
      const _opening = Math.round(Number(s.netBalance ?? 0) - _seededSum);
      if (_opening !== 0) {
        // A POSITIVE opening is savings brought forward → a contribution. A
        // NEGATIVE opening (seeded recent contributions exceed the authored
        // balance, i.e. net prior withdrawals) is booked as a WITHDRAWAL, not a
        // negative "contribution" — the latter rendered as a confusing money-in
        // row that shows as "Sent" and skewed the Activity year in/out totals
        // (audit 2026-07-02). Either way the ledger still sums to total_balance.
        const _isDraw = _opening < 0;
        txIds.push(`tx-${s.id}-open`);
        txSubIds.push(s.id);
        txAgentIds.push(s.parentId);
        txTypes.push(_isDraw ? 'withdrawal' : 'contribution');
        txAmounts.push(_opening); // withdrawals are stored as negative magnitudes (see above)
        txDates.push(toTimestamptz(s.registeredDate ?? s.transactions?.[s.transactions.length - 1]?.date ?? '2024-01-01'));
        txStatuses.push('settled');
        txMethods.push(_isDraw ? 'Opening adjustment' : 'Opening balance');
        txRefs.push('OPENING');
        txBuckets.push(_isDraw ? 'emergency' : null);
      }
    }
    await bulkInsert(
      client,
      'transactions',
      [
        { name: 'id', type: 'text' },
        { name: 'subscriber_id', type: 'text' },
        { name: 'agent_id', type: 'text' },
        { name: 'type', type: 'text' },
        { name: 'amount', type: 'numeric' },
        { name: 'date', type: 'timestamptz' },
        { name: 'status', type: 'text' },
        { name: 'method', type: 'text' },
        { name: 'txn_ref', type: 'text' },
        { name: 'bucket', type: 'text' },
      ],
      [
        txIds,
        txSubIds,
        txAgentIds,
        txTypes,
        txAmounts,
        txDates,
        txStatuses,
        txMethods,
        txRefs,
        txBuckets,
      ],
      'id'
    );

    // ── claims ─────────────────────────────────────────────────────────────
    console.log('• claims…');
    const claimIds = [];
    const claimSubIds = [];
    const claimTypes = [];
    const claimStatuses = [];
    const claimAmounts = [];
    const claimIncident = [];
    const claimSubmitted = [];
    const claimDescriptions = [];
    for (const s of subscribers) {
      for (const c of s.claims ?? []) {
        claimIds.push(c.id);
        claimSubIds.push(s.id);
        claimTypes.push(c.type);
        claimStatuses.push(c.status);
        claimAmounts.push(c.amount);
        claimIncident.push(c.incidentDate ?? null);
        claimSubmitted.push(c.submittedDate);
        claimDescriptions.push(c.description ?? null);
      }
    }
    await bulkInsert(
      client,
      'claims',
      [
        { name: 'id', type: 'text' },
        { name: 'subscriber_id', type: 'text' },
        { name: 'type', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'amount', type: 'numeric' },
        { name: 'incident_date', type: 'date' },
        { name: 'submitted_date', type: 'date' },
        { name: 'description', type: 'text' },
      ],
      [
        claimIds,
        claimSubIds,
        claimTypes,
        claimStatuses,
        claimAmounts,
        claimIncident,
        claimSubmitted,
        claimDescriptions,
      ],
      'id'
    );

    // ── withdrawals ────────────────────────────────────────────────────────
    console.log('• withdrawals…');
    const wIds = [];
    const wSubIds = [];
    const wAmounts = [];
    const wBuckets = [];
    const wReasons = [];
    const wMethods = [];
    const wStatuses = [];
    const wDates = [];
    const wReferences = [];
    for (const s of subscribers) {
      for (const w of s.withdrawals ?? []) {
        wIds.push(w.id);
        wSubIds.push(s.id);
        wAmounts.push(w.amount);
        wBuckets.push(w.bucket);
        wReasons.push(w.reason ?? null);
        wMethods.push(w.method ?? null);
        wStatuses.push(w.status ?? 'processing');
        wDates.push(w.date);
        // mockData doesn't surface a separate reference on withdrawals; the
        // matching transaction row carries one (`WD-…`). Leave null here.
        wReferences.push(null);
      }
    }
    await bulkInsert(
      client,
      'withdrawals',
      [
        { name: 'id', type: 'text' },
        { name: 'subscriber_id', type: 'text' },
        { name: 'amount', type: 'numeric' },
        { name: 'bucket', type: 'text' },
        { name: 'reason', type: 'text' },
        { name: 'method', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'date', type: 'date' },
        { name: 'reference', type: 'text' },
      ],
      [
        wIds,
        wSubIds,
        wAmounts,
        wBuckets,
        wReasons,
        wMethods,
        wStatuses,
        wDates,
        wReferences,
      ],
      'id'
    );

    // ── commission_config (platform fallback + one row per distributor) ────
    // 0089 made the rate PER-DISTRIBUTOR. The `id='default'` row is retained as
    // the platform fallback; each distributor then gets its own row so a reseed
    // reproduces the shape 0089 created rather than leaving every operator on
    // the fallback. The relaxed CHECK requires `id = 'cfg-' || distributor_id`.
    console.log('• commission_config…');
    await client.query(
      `INSERT INTO commission_config (id, rate, cadence, next_run_date, last_updated_by)
       VALUES ('default', $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET rate = EXCLUDED.rate,
             cadence = EXCLUDED.cadence,
             next_run_date = EXCLUDED.next_run_date,
             last_updated_by = EXCLUDED.last_updated_by,
             updated_at = now()`,
      [
        COMMISSION_CONFIG.ratePerSubscriber,
        // cadence/nextRunDate are vestigial post commission-simplify (the mock
        // dropped them) but the live column is still NOT NULL — keep a sane
        // placeholder so re-seeds satisfy the constraint.
        COMMISSION_CONFIG.cadence ?? 'monthly-first',
        COMMISSION_CONFIG.nextRunDate ?? null,
        'seed',
      ]
    );

    // NOTE: the per-distributor rows (0089) are inserted AFTER the
    // `distributors` block below — `distributors` is seeded later in this
    // script, so selecting from it here silently matches zero rows.

    // ── commissions ────────────────────────────────────────────────────────
    // Phase 1 commission-flow simplification (migration 0029): the run /
    // dispute / hold / confirm state machine is retired. commission_status is
    // now just ('due','paid'). Map every legacy mockData status onto the two
    // surviving states: released/confirmed → paid; everything else → due.
    // `paid_amount` carries the amount for paid lines (NULL for due). run_id
    // and all dispute/hold/confirm columns no longer exist on the table.
    console.log('• commissions…');
    const COMMISSION_PAID_STATUSES = new Set(['released', 'confirmed']);
    const baseCommissionStatus = (c) =>
      COMMISSION_PAID_STATUSES.has(c.status) ? 'paid' : 'due';

    // ── Settlement-batch reconciliation (audit §4b.4) ──────────────────────
    // We seed a couple of historical settlement batches so Supabase-mode demos
    // show a non-empty settlement feed without anyone running apply_settlement
    // first. The PREVIOUS seed hardcoded each batch's paid_amount/line_count but
    // never flipped any commissions to `paid`, so the ledger contradicted itself
    // (140k "settled" across 14 lines vs 0 paid commissions). Here we instead
    // FLIP the matching agent's oldest still-`due` commissions to `paid` (up to
    // a target count), then DERIVE the batch's paid_amount / pending_total /
    // line_count from the lines we actually flipped — so the batch and the paid
    // commissions reconcile exactly by construction, whatever the random seed's
    // per-agent commission distribution turns out to be.
    const settlementSeeds = [
      // A05-008: branchId is DERIVED from the agent, never hardcoded. Hardcoding
      // it stamped both seeded batches with a branch that did not earn them
      // (sb-seed-0001 -> b-kam-015 when a-001 is in b-bui-001; sb-seed-0002 ->
      // b-mba-290 when a-042 is in b-buv-007). settlement_batches RLS scopes by
      // branch_id, so each payout was routed to the wrong branch dashboard and
      // never reached the right one. The live apply_settlement derives it from
      // the agent (0032:174); this now matches.
      { id: 'sb-seed-0001', agentId: 'a-001', txnRef: 'MM-SEED-0001', paidDate: '2026-05-15', targetLines: 9 },
      { id: 'sb-seed-0002', agentId: 'a-042', txnRef: 'MM-SEED-0002', paidDate: '2026-05-22', targetLines: 5 },
    ];
    // Per-commission paid override, keyed by commission id → { paidDate, txnRef }.
    const settlementFlips = new Map();
    const seedBatches = [];
    for (const seed of settlementSeeds) {
      // Candidate lines: this agent's commissions that map to `due` and aren't
      // already claimed by another batch. Oldest-first (by due_date) mirrors the
      // real apply_settlement, which settles the oldest outstanding dues first.
      const candidates = commissions
        .filter(
          (c) =>
            c.agentId === seed.agentId &&
            baseCommissionStatus(c) === 'due' &&
            !settlementFlips.has(c.id)
        )
        .sort((a, b) => String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')));
      const chosen = candidates.slice(0, seed.targetLines);
      // Guard: if this agent has no outstanding `due` lines to settle, skip the
      // batch entirely rather than seed a self-consistent-but-empty "0 paid for
      // 0 lines" record. Keeps the ledger non-trivial and the notification sane.
      if (chosen.length === 0) {
        console.warn(`  ⚠ ${seed.id}: agent ${seed.agentId} had no due commissions to settle — batch skipped.`);
        continue;
      }
      // Re-anchor the batch paid_date forward like every other demo date so the
      // settlement history doesn't read as months stale (§4b.2).
      const paidDate = reanchorDateStr(seed.paidDate);
      let paidAmount = 0;
      for (const c of chosen) {
        settlementFlips.set(c.id, { paidDate, txnRef: seed.txnRef });
        paidAmount += c.amount ?? 0;
      }
      // A05-008: derive the branch from the agent, exactly as the live
      // apply_settlement does (0032:174). Fail loudly rather than seed a
      // mis-stamped batch — a silently wrong branch is what caused the demo
      // persona to be shown a payout its own ledger denied.
      const seedAgent = agents.find((a) => a.id === seed.agentId);
      if (!seedAgent?.branchId) {
        throw new Error(
          `settlementSeeds: agent ${seed.agentId} not found or has no branchId; ` +
          'cannot derive the settlement batch branch (A05-008).'
        );
      }
      seedBatches.push({
        id: seed.id,
        agentId: seed.agentId,
        branchId: seedAgent.branchId,
        // pending_total == paid_amount: the batch settles exactly the lines it
        // flipped (no partial-pay / overpay in the seed).
        pendingTotal: paidAmount,
        paidAmount,
        txnRef: seed.txnRef,
        paidDate,
        lineCount: chosen.length,
      });
    }

    // Final per-commission status now accounts for the settlement flips.
    const commissionStatus = (c) =>
      settlementFlips.has(c.id) ? 'paid' : baseCommissionStatus(c);
    const commissionPaidDate = (c) => {
      if (settlementFlips.has(c.id)) return settlementFlips.get(c.id).paidDate;
      return baseCommissionStatus(c) === 'paid' ? c.paidDate ?? null : null;
    };
    const commissionTxnRef = (c) => {
      if (settlementFlips.has(c.id)) return settlementFlips.get(c.id).txnRef;
      return baseCommissionStatus(c) === 'paid' ? c.txnRef ?? null : null;
    };
    await bulkInsert(
      client,
      'commissions',
      [
        { name: 'id', type: 'text' },
        { name: 'agent_id', type: 'text' },
        { name: 'branch_id', type: 'text' },
        { name: 'subscriber_id', type: 'text' },
        { name: 'subscriber_name', type: 'text' },
        { name: 'amount', type: 'numeric' },
        { name: 'status', type: 'commission_status' },
        { name: 'first_contribution_date', type: 'date' },
        { name: 'due_date', type: 'date' },
        { name: 'paid_date', type: 'date' },
        { name: 'txn_ref', type: 'text' },
        { name: 'paid_amount', type: 'numeric' },
      ],
      [
        commissions.map((c) => c.id),
        commissions.map((c) => c.agentId),
        commissions.map((c) => c.branchId ?? null),
        commissions.map((c) => c.subscriberId),
        commissions.map((c) => c.subscriberName ?? null),
        commissions.map((c) => c.amount),
        commissions.map(commissionStatus),
        commissions.map((c) => c.firstContributionDate ?? null),
        commissions.map((c) => c.dueDate ?? null),
        // Paid lines keep their paid_date; due lines have none.
        commissions.map(commissionPaidDate),
        commissions.map(commissionTxnRef),
        commissions.map((c) => (commissionStatus(c) === 'paid' ? c.amount : null)),
      ],
      'id'
    );

    // ── settlement_batches + notifications (demo feed) ─────────────────────
    // The batch rows (totals derived above from the flipped commissions) plus
    // matching `commission_settled` notifications. Each batch now reconciles
    // with the agent's paid commissions: paid_amount == Σ(flipped line amounts)
    // and line_count == COUNT(flipped lines).
    console.log('• settlement_batches + notifications…');
    await bulkInsert(
      client,
      'settlement_batches',
      [
        { name: 'id', type: 'text' },
        { name: 'agent_id', type: 'text' },
        { name: 'branch_id', type: 'text' },
        { name: 'pending_total', type: 'numeric' },
        { name: 'paid_amount', type: 'numeric' },
        { name: 'txn_ref', type: 'text' },
        { name: 'paid_date', type: 'date' },
        { name: 'line_count', type: 'integer' },
      ],
      [
        seedBatches.map((b) => b.id),
        seedBatches.map((b) => b.agentId),
        seedBatches.map((b) => b.branchId ?? null),
        seedBatches.map((b) => b.pendingTotal),
        seedBatches.map((b) => b.paidAmount),
        seedBatches.map((b) => b.txnRef ?? null),
        seedBatches.map((b) => b.paidDate ?? null),
        seedBatches.map((b) => b.lineCount),
      ],
      'id'
    );

    // One notification per batch for the agent, plus one for its branch.
    const seedNotifications = [];
    for (const b of seedBatches) {
      const body = `UGX ${b.paidAmount} paid for ${b.lineCount} commissions.`;
      seedNotifications.push({
        id: `ntf-seed-${b.id}-a`,
        recipientRole: 'agent',
        recipientId: b.agentId,
        body,
        amount: b.paidAmount,
        refId: b.id,
      });
      if (b.branchId) {
        seedNotifications.push({
          id: `ntf-seed-${b.id}-b`,
          recipientRole: 'branch',
          recipientId: b.branchId,
          body,
          amount: b.paidAmount,
          refId: b.id,
        });
      }
    }
    await bulkInsert(
      client,
      'notifications',
      [
        { name: 'id', type: 'text' },
        { name: 'recipient_role', type: 'text' },
        { name: 'recipient_id', type: 'text' },
        { name: 'type', type: 'text' },
        { name: 'title', type: 'text' },
        { name: 'body', type: 'text' },
        { name: 'amount', type: 'numeric' },
        { name: 'ref_id', type: 'text' },
        { name: 'is_read', type: 'boolean' },
      ],
      [
        seedNotifications.map((n) => n.id),
        seedNotifications.map((n) => n.recipientRole),
        seedNotifications.map((n) => n.recipientId),
        seedNotifications.map(() => 'commission_settled'),
        seedNotifications.map(() => 'Commission settled'),
        seedNotifications.map((n) => n.body),
        seedNotifications.map((n) => n.amount),
        seedNotifications.map((n) => n.refId),
        seedNotifications.map(() => false),
      ],
      'id'
    );

    // ── distributors ───────────────────────────────────────────────────────
    // Singleton-friendly catalogue table (created in migration 0016). The
    // demo seeds `d-001` (the default fallback for distributor logins) and
    // `d-002` (the secondary distributor referenced by the second persona
    // row below). Re-runs upsert on PK so changes to manager_* contact
    // details persist while the table stays converged.
    console.log('• distributors…');
    const distributorRows = [
      {
        id: 'd-001',
        name: 'Universal Pensions Uganda — National',
        manager_name: 'Distributor Lead',
        manager_phone: '+256700000021',
        manager_email: null,
      },
      {
        id: 'd-002',
        name: 'Universal Pensions Uganda — Secondary',
        manager_name: 'Secondary Distributor Lead',
        manager_phone: '+256700000022',
        manager_email: null,
      },
    ];
    await bulkInsert(
      client,
      'distributors',
      [
        { name: 'id', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'parent_id', type: 'text' },
        { name: 'manager_name', type: 'text' },
        { name: 'manager_phone', type: 'text' },
        { name: 'manager_email', type: 'text' },
        { name: 'status', type: 'text' },
      ],
      [
        distributorRows.map((d) => d.id),
        distributorRows.map((d) => d.name),
        distributorRows.map(() => 'ug'),
        distributorRows.map((d) => d.manager_name),
        distributorRows.map((d) => d.manager_phone),
        distributorRows.map((d) => d.manager_email),
        distributorRows.map(() => 'active'),
      ],
      'id'
    );

    // Per-distributor commission_config rows (0089). MUST run here, after the
    // distributors exist — the FK and the relaxed CHECK both require a real
    // distributor id. Every operator starts on the platform rate and can then
    // change its own without affecting the others.
    console.log('• commission_config (per-distributor)…');
    await client.query(
      `INSERT INTO commission_config (id, distributor_id, rate, cadence, next_run_date, last_updated_by)
       SELECT 'cfg-' || d.id, d.id, $1, $2, $3, 'seed'
         FROM distributors d
       ON CONFLICT (id) DO UPDATE
         SET rate = EXCLUDED.rate,
             cadence = EXCLUDED.cadence,
             last_updated_by = EXCLUDED.last_updated_by,
             updated_at = now()`,
      [
        COMMISSION_CONFIG.ratePerSubscriber,
        COMMISSION_CONFIG.cadence ?? 'monthly-first',
        COMMISSION_CONFIG.nextRunDate ?? null,
      ]
    );

    // ── employers ──────────────────────────────────────────────────────────
    // One B2B account (emp-001). Tables landed by migration 0034; RPCs by 0035.
    // Service-role bypasses the employer RLS so these direct inserts succeed.
    console.log('• employers…');
    await client.query(
      `INSERT INTO employers (
         id, name, sector, registration_no, contact_name, contact_phone,
         contact_email, district, payroll_cadence, default_contribution_config
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         sector = EXCLUDED.sector,
         registration_no = EXCLUDED.registration_no,
         contact_name = EXCLUDED.contact_name,
         contact_phone = EXCLUDED.contact_phone,
         contact_email = EXCLUDED.contact_email,
         district = EXCLUDED.district,
         payroll_cadence = EXCLUDED.payroll_cadence,
         default_contribution_config = EXCLUDED.default_contribution_config,
         updated_at = now()`,
      [
        EMPLOYER.id,
        EMPLOYER.name,
        EMPLOYER.sector,
        EMPLOYER.registrationNo,
        EMPLOYER.contactName,
        EMPLOYER.contactPhone,
        EMPLOYER.contactEmail,
        EMPLOYER.district,
        EMPLOYER.payrollCadence,
        JSON.stringify(EMPLOYER.defaultContributionConfig ?? {}),
      ]
    );

    // Extra employers (admin geo spread, emp-002+) — same insert shape. These have
    // no employer-role login; they exist to populate the admin map across regions.
    if (EXTRA_EMPLOYERS.length) {
      console.log(`• employers (extra geo spread: ${EXTRA_EMPLOYERS.length})…`);
      for (const e of EXTRA_EMPLOYERS) {
        await client.query(
          `INSERT INTO employers (
             id, name, sector, registration_no, contact_name, contact_phone,
             contact_email, district, payroll_cadence, default_contribution_config
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name, sector = EXCLUDED.sector,
             registration_no = EXCLUDED.registration_no,
             contact_name = EXCLUDED.contact_name, contact_phone = EXCLUDED.contact_phone,
             contact_email = EXCLUDED.contact_email, district = EXCLUDED.district,
             payroll_cadence = EXCLUDED.payroll_cadence,
             default_contribution_config = EXCLUDED.default_contribution_config,
             updated_at = now()`,
          [e.id, e.name, e.sector, e.registrationNo, e.contactName, e.contactPhone,
            e.contactEmail, e.district, e.payrollCadence, JSON.stringify(e.defaultContributionConfig ?? {})]
        );
      }
    }

    // ── employer members (tagged subscribers) ────────────────────────────────
    // Unified model (0043): the employer's staff are REAL subscribers tagged with
    // employer_id, agent_id NULL (no agent commission). Triggers are off during
    // this seed (session_replication_role='replica'), so we seed balances AND the
    // own/employer transaction history directly without double-counting.
    console.log('• employer members (tagged subscribers)…');
    await bulkInsert(
      client,
      'subscribers',
      [
        { name: 'id', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'gender', type: 'text' },
        { name: 'age', type: 'int' },
        { name: 'dob', type: 'date' },
        { name: 'nin', type: 'text' },
        { name: 'kyc_status', type: 'text' },
        { name: 'occupation', type: 'text' },
        { name: 'agent_id', type: 'text' },
        { name: 'employer_id', type: 'text' },
        { name: 'district_id', type: 'text' },
        { name: 'is_active', type: 'boolean' },
        { name: 'registered_date', type: 'date' },
        // CONTRIBUTION MODEL v2 (migration 0062): monthly compensation (UGX) — the
        // driver field. submit_employer_contribution_run derives both legs from it.
        { name: 'compensation', type: 'numeric' },
      ],
      [
        MEMBERS.map((m) => m.id),
        MEMBERS.map((m) => m.name),
        MEMBERS.map((m) => m.email ?? null),
        MEMBERS.map((m) => m.phone ?? null),
        MEMBERS.map((m) => m.gender ?? null),
        MEMBERS.map((m) => m.age ?? null),
        MEMBERS.map((m) => toDateStr(m.dob)),
        MEMBERS.map((m) => m.nin ?? null),
        MEMBERS.map((m) => m.kycStatus ?? 'complete'), // all complete — real "pending KYC" = pending invites, not members
        MEMBERS.map((m) => m.occupation ?? null),
        MEMBERS.map(() => null),                       // agent_id NULL → no commission
        MEMBERS.map((m) => m.employerId),
        MEMBERS.map((m) => m.districtId ?? 'd-kampala'),
        MEMBERS.map((m) => m.status !== 'suspended'),
        MEMBERS.map((m) => toDateStr(m.joinedDate)),
        MEMBERS.map((m) => m.compensation ?? 0),       // v2 driver field
      ],
      'id'
    );

    await bulkInsert(
      client,
      'subscriber_balances',
      [
        { name: 'subscriber_id', type: 'text' },
        { name: 'retirement_balance', type: 'numeric' },
        { name: 'emergency_balance', type: 'numeric' },
        { name: 'total_balance', type: 'numeric' },
        { name: 'units', type: 'numeric' },
      ],
      [
        MEMBERS.map((m) => m.id),
        MEMBERS.map((m) => m.retirementBalance ?? 0),
        MEMBERS.map((m) => m.emergencyBalance ?? 0),
        MEMBERS.map((m) => m.netBalance ?? 0),
        // Same units==balance/1000 identity as the subscriber balances (§1b.9).
        MEMBERS.map((m) => unitsFromBalance(m.netBalance ?? 0)),
      ],
      'subscriber_id'
    );

    // Extra employer members (tagged subscribers) for the geo spread — subscribers
    // + balances only (no schedules/transactions/insurance: the admin geo rollup and
    // the employer slice of the overview read only headcount + balances).
    if (EXTRA_MEMBERS.length) {
      console.log(`• extra employer members (tagged subscribers: ${EXTRA_MEMBERS.length})…`);
      await bulkInsert(
        client,
        'subscribers',
        [
          { name: 'id', type: 'text' },
          { name: 'name', type: 'text' },
          { name: 'email', type: 'text' },
          { name: 'phone', type: 'text' },
          { name: 'gender', type: 'text' },
          { name: 'age', type: 'int' },
          { name: 'dob', type: 'date' },
          { name: 'nin', type: 'text' },
          { name: 'kyc_status', type: 'text' },
          { name: 'occupation', type: 'text' },
          { name: 'agent_id', type: 'text' },
          { name: 'employer_id', type: 'text' },
          { name: 'district_id', type: 'text' },
          { name: 'is_active', type: 'boolean' },
          { name: 'registered_date', type: 'date' },
          // CONTRIBUTION MODEL v2 (migration 0062): monthly compensation (UGX).
          { name: 'compensation', type: 'numeric' },
        ],
        [
          EXTRA_MEMBERS.map((m) => m.id),
          EXTRA_MEMBERS.map((m) => m.name),
          EXTRA_MEMBERS.map((m) => m.email ?? null),
          EXTRA_MEMBERS.map((m) => m.phone ?? null),
          EXTRA_MEMBERS.map((m) => m.gender ?? null),
          EXTRA_MEMBERS.map((m) => m.age ?? null),
          EXTRA_MEMBERS.map((m) => toDateStr(m.dob)),
          EXTRA_MEMBERS.map((m) => m.nin ?? null),
          EXTRA_MEMBERS.map((m) => m.kycStatus ?? 'complete'),
          EXTRA_MEMBERS.map((m) => m.occupation ?? null),
          EXTRA_MEMBERS.map(() => null),               // agent_id NULL → employer channel
          EXTRA_MEMBERS.map((m) => m.employerId),
          EXTRA_MEMBERS.map((m) => m.districtId),
          EXTRA_MEMBERS.map((m) => m.isActive),
          EXTRA_MEMBERS.map((m) => toDateStr(m.joinedDate)),
          EXTRA_MEMBERS.map((m) => m.compensation ?? 0),  // v2 driver field
        ],
        'id'
      );
      await bulkInsert(
        client,
        'subscriber_balances',
        [
          { name: 'subscriber_id', type: 'text' },
          { name: 'retirement_balance', type: 'numeric' },
          { name: 'emergency_balance', type: 'numeric' },
          { name: 'total_balance', type: 'numeric' },
          { name: 'units', type: 'numeric' },
        ],
        [
          EXTRA_MEMBERS.map((m) => m.id),
          EXTRA_MEMBERS.map((m) => m.retirementBalance ?? 0),
          EXTRA_MEMBERS.map((m) => m.emergencyBalance ?? 0),
          EXTRA_MEMBERS.map((m) => m.netBalance ?? 0),
          EXTRA_MEMBERS.map((m) => unitsFromBalance(m.netBalance ?? 0)),
        ],
        'subscriber_id'
      );
    }

    await bulkInsert(
      client,
      'contribution_schedules',
      [
        { name: 'subscriber_id', type: 'text' },
        { name: 'frequency', type: 'text' },
        { name: 'amount', type: 'numeric' },
        { name: 'retirement_pct', type: 'int' },
        { name: 'emergency_pct', type: 'int' },
      ],
      [
        MEMBERS.map((m) => m.id),
        MEMBERS.map((m) => m.contributionSchedule?.frequency ?? 'monthly'),
        MEMBERS.map((m) => m.contributionSchedule?.amount ?? m.monthlyContribution ?? 0),
        MEMBERS.map((m) => m.contributionSchedule?.retirementPct ?? 80),
        MEMBERS.map((m) => m.contributionSchedule?.emergencyPct ?? 20),
      ],
      'subscriber_id'
    );

    // ── employer group insurance fan-out (migration 0067) ────────────────────
    // Group cover is all-or-nothing COMPANY-WIDE — every member of an employer gets
    // every product that employer has enabled, and there is no per-member choice. So
    // the covered set and the cover amounts are read off the employer's CONFIG (the
    // same authority the contribution run prices its insurance leg from), never off a
    // per-member field that could drift from it.
    //
    // Split across two tables, mirroring update_employer_profile exactly (0064
    // restored insurance_policies to one row per subscriber):
    //   LIFE            → insurance_policies
    //   HEALTH, FUNERAL → subscriber_insurance_products
    // BOTH must be written, because the run charges Σ(premium over enabled products)
    // — 40,000/member for emp-001 (Life 15M → 30,000 + Health 5M → 10,000). Seeding
    // only the life row (the pre-0092 behaviour) implied 30,000, leaving 10,000 of
    // every run's insurance leg unexplainable by any seeded policy row.
    const employerProductMap = new Map();
    for (const emp of [EMPLOYER, ...EXTRA_EMPLOYERS]) {
      employerProductMap.set(emp.id, groupInsuranceProducts(emp.defaultContributionConfig));
    }
    const groupProductsFor = (m) => employerProductMap.get(m.employerId) ?? [];
    const groupProductFor = (m, product) => groupProductsFor(m).find((p) => p.product === product) ?? null;

    const lifeMembers = MEMBERS.filter((m) => groupProductFor(m, 'life') != null);
    if (lifeMembers.length) {
      await bulkInsert(
        client,
        'insurance_policies',
        [
          { name: 'subscriber_id', type: 'text' },
          { name: 'cover', type: 'numeric' },
          { name: 'premium_monthly', type: 'numeric' },
          { name: 'status', type: 'text' },
          { name: 'renewal_date', type: 'date' },
          { name: 'funded_by', type: 'text' },
        ],
        [
          lifeMembers.map((m) => m.id),
          lifeMembers.map((m) => groupProductFor(m, 'life').cover),
          // Employer group cover — the member pays nothing (premium 0, funded_by
          // 'employer'). The employer settles it monthly via the contribution run's
          // insurance leg (type='insurance_premium', source='employer') — the ONLY
          // legitimate monthly premium; a member never self-pays monthly.
          lifeMembers.map(() => 0),
          lifeMembers.map((m) => m.insuranceStatus ?? 'inactive'),
          lifeMembers.map((m) => toDateStr(m.insuranceRenewalDate)),
          lifeMembers.map(() => 'employer'),
        ],
        'subscriber_id'
      );
    }

    // HEALTH / FUNERAL — one row per (member, product). Same premium-0 /
    // funded_by='employer' convention as the life row above.
    const sipMemberIds = [];
    const sipMemberProduct = [];
    const sipMemberCover = [];
    const sipMemberStatus = [];
    const sipMemberRenewal = [];
    for (const m of [...MEMBERS, ...EXTRA_MEMBERS]) {
      for (const p of groupProductsFor(m)) {
        if (p.product === 'life') continue; // lives in insurance_policies
        sipMemberIds.push(m.id);
        sipMemberProduct.push(p.product);
        sipMemberCover.push(p.cover);
        sipMemberStatus.push(m.insuranceStatus ?? 'active');
        sipMemberRenewal.push(toDateStr(m.insuranceRenewalDate));
      }
    }
    if (sipMemberIds.length) {
      console.log(`• employer group insurance products (${sipMemberIds.length} rows)…`);
      await bulkInsert(
        client,
        'subscriber_insurance_products',
        [
          { name: 'subscriber_id', type: 'text' },
          { name: 'product', type: 'text' },
          { name: 'cover', type: 'numeric' },
          { name: 'premium_monthly', type: 'numeric' },
          { name: 'status', type: 'text' },
          { name: 'renewal_date', type: 'date' },
          { name: 'funded_by', type: 'text' },
        ],
        [
          sipMemberIds,
          sipMemberProduct,
          sipMemberCover,
          sipMemberIds.map(() => 0),
          sipMemberStatus,
          sipMemberRenewal,
          sipMemberIds.map(() => 'employer'),
        ],
        'subscriber_id, product'
      );
    }

    // Reconciliation guard: the premium implied by the seeded policy rows must equal
    // the premium the seeded runs actually charged per member. A mismatch means the
    // employer config and the seeded insurance rows have drifted — the exact bug the
    // fan-out above exists to prevent — so say so loudly rather than shipping a
    // ledger whose insurance leg cannot be reconstructed.
    const seededPremiumPerMember = (employerProductMap.get(EMPLOYER.id) ?? [])
      .reduce((sum, p) => sum + p.premiumMonthly, 0);
    const runPremiumPerMember = CONTRIBUTION_RUNS.length && CONTRIBUTION_RUNS[0].insuranceTotal
      ? Math.round(CONTRIBUTION_RUNS[0].insuranceTotal
        / MEMBERS.filter((m) => m.status === 'active' && !m.recentHire).length)
      : 0;
    if (seededPremiumPerMember !== runPremiumPerMember) {
      console.warn(
        `  ⚠ insurance premium mismatch for ${EMPLOYER.id}: policy rows imply `
        + `${seededPremiumPerMember}/member but the seeded runs charge ${runPremiumPerMember}/member`
      );
    }

    // ── contribution_runs ────────────────────────────────────────────────────
    console.log('• contribution_runs…');
    await bulkInsert(
      client,
      'contribution_runs',
      [
        { name: 'id', type: 'text' },
        { name: 'employer_id', type: 'text' },
        { name: 'period_label', type: 'text' },
        { name: 'status', type: 'text' },
        { name: 'employer_total', type: 'numeric' },
        { name: 'employee_total', type: 'numeric' },
        { name: 'insurance_total', type: 'numeric' },
        { name: 'grand_total', type: 'numeric' },
        { name: 'run_at', type: 'timestamptz' },
      ],
      [
        CONTRIBUTION_RUNS.map((r) => r.id),
        CONTRIBUTION_RUNS.map((r) => r.employerId),
        CONTRIBUTION_RUNS.map((r) => r.periodLabel ?? null),
        CONTRIBUTION_RUNS.map((r) => r.status ?? 'completed'),
        CONTRIBUTION_RUNS.map((r) => r.employerTotal ?? 0),
        CONTRIBUTION_RUNS.map((r) => r.employeeTotal ?? 0),
        CONTRIBUTION_RUNS.map((r) => r.insuranceTotal ?? 0),
        CONTRIBUTION_RUNS.map((r) => r.grandTotal ?? 0),
        CONTRIBUTION_RUNS.map((r) => toTimestamptz(r.runAt)),
      ],
      'id'
    );

    // ── member contribution transactions (own + employer, source-tagged) ─────
    // The employer-source rows link to their contribution_runs header via
    // contribution_run_id (seeded above). Triggers are off (replica mode), so
    // these do NOT re-bump the directly-seeded subscriber_balances.
    //
    // Opening-balance reconciliation (audit 2026-06-16): a member's balance is an
    // authored snapshot; only a recent window of run legs (and, for the geo
    // employers, none at all) is seeded. Add one brought-forward own-source
    // contribution per member so SUM(their transactions) == total_balance.
    const _allMembers = [...MEMBERS, ...EXTRA_MEMBERS];
    const memberOpenings = _allMembers.map((m) => {
      // Only balance-affecting flows (contribution / withdrawal) reconcile against
      // the authored total_balance. Insurance premiums are an employer cost and
      // never credit the pension pot, so exclude them from the residual math.
      const sum = MEMBER_TRANSACTIONS
        .filter((t) => t.subscriberId === m.id && (t.type ?? 'contribution') !== 'insurance_premium')
        .reduce((acc, t) => acc + Number(t.amount || 0), 0);
      const residual = Math.round(Number(m.netBalance ?? 0) - sum);
      if (residual === 0) return null;
      const retPct = Number(m.contributionSchedule?.retirementPct ?? 80);
      const ret = Math.round(residual * retPct / 100);
      return {
        id: `t-open-${m.id}`, subscriberId: m.id, type: 'contribution', source: 'own',
        amount: residual, date: m.joinedDate ?? '2024-01-01', method: 'Opening balance',
        retirementAmount: ret, emergencyAmount: residual - ret, contributionRunId: null,
      };
    }).filter(Boolean);
    const MEMBER_TX_ALL = [...MEMBER_TRANSACTIONS, ...memberOpenings];
    console.log('• member transactions…');
    await bulkInsert(
      client,
      'transactions',
      [
        { name: 'id', type: 'text' },
        { name: 'subscriber_id', type: 'text' },
        { name: 'type', type: 'text' },
        { name: 'source', type: 'text' },
        { name: 'amount', type: 'numeric' },
        { name: 'date', type: 'timestamptz' },
        { name: 'status', type: 'text' },
        { name: 'method', type: 'text' },
        { name: 'split_retirement', type: 'numeric' },
        { name: 'split_emergency', type: 'numeric' },
        { name: 'contribution_run_id', type: 'text' },
      ],
      [
        MEMBER_TX_ALL.map((t) => t.id),
        MEMBER_TX_ALL.map((t) => t.subscriberId),
        MEMBER_TX_ALL.map((t) => t.type ?? 'contribution'),
        MEMBER_TX_ALL.map((t) => t.source ?? 'own'),
        MEMBER_TX_ALL.map((t) => t.amount ?? 0),
        MEMBER_TX_ALL.map((t) => toTimestamptz(t.date)),
        MEMBER_TX_ALL.map(() => 'settled'),
        MEMBER_TX_ALL.map((t) => t.method ?? null),
        MEMBER_TX_ALL.map((t) => t.retirementAmount ?? null),
        MEMBER_TX_ALL.map((t) => t.emergencyAmount ?? null),
        MEMBER_TX_ALL.map((t) => t.contributionRunId ?? null),
      ],
      'id'
    );

    // ── demo_personas ──────────────────────────────────────────────────────
    // 3 agents, 2 branches, 2 distributors, 1 employer. Distributor entity IDs
    // (d-001, d-002) now have a backing row in `distributors` (seeded just
    // above, landed by migration 0016). demo_personas keeps doing JWT-mint
    // lookups; the employer row resolves EMPLOYER_DEMO_PHONE → emp-001.
    console.log('• demo_personas…');
    const personas = [
      { id: 'dp-a-001', phone: '+256700000001', role: 'agent', entity_id: 'a-001', label: 'Default agent (Kampala)' },
      { id: 'dp-a-002', phone: '+256700000002', role: 'agent', entity_id: 'a-042', label: 'Northern region agent' },
      { id: 'dp-a-003', phone: '+256700000003', role: 'agent', entity_id: 'a-118', label: 'Western region agent' },
      { id: 'dp-b-001', phone: '+256700000011', role: 'branch', entity_id: 'b-kam-015', label: 'Default branch (Kampala Central)' },
      { id: 'dp-b-002', phone: '+256700000012', role: 'branch', entity_id: 'b-mba-290', label: 'Mbarara branch' },
      { id: 'dp-d-001', phone: '+256700000021', role: 'distributor', entity_id: 'd-001', label: 'Default distributor' },
      { id: 'dp-d-002', phone: '+256700000022', role: 'distributor', entity_id: 'd-002', label: 'Secondary distributor' },
      { id: 'dp-e-001', phone: EMPLOYER_DEMO_PHONE, role: 'employer', entity_id: EMPLOYER.id, label: 'Default employer (Nile Breweries Demo)' },
    ];
    await bulkInsert(
      client,
      'demo_personas',
      [
        { name: 'id', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'role', type: 'text' },
        { name: 'entity_id', type: 'text' },
        { name: 'label', type: 'text' },
      ],
      [
        personas.map((p) => p.id),
        personas.map((p) => p.phone),
        personas.map((p) => p.role),
        personas.map((p) => p.entity_id),
        personas.map((p) => p.label),
      ],
      'id'
    );

    // ── users (auth identities) ────────────────────────────────────────────
    // Seed a `users` row per demo persona, each stamped with the shared demo
    // password hash (`Demo1234`) so PASSWORD login works out-of-the-box for
    // every role. OTP stays available in parallel (any 6-digit code); the
    // change-password route can still rotate a user's hash later.
    // The `id` follows `verify-otp.ts`'s deterministic `${role}:${phone}` shape
    // so re-running the seed is idempotent against an OTP-initiated upsert.
    // We mirror the persona list 1:1 here — the same five phones (agent,
    // branch, distributor) gain a `users` row; the subscriber pseudo-personas
    // (`s-0001`…`s-0005`) are NOT in `demo_personas` because subscriber lookup
    // routes through `users(phone, role='subscriber')` directly, so we also
    // seed those five subscriber rows so the demo phones land authenticated
    // on first OTP without a missing-user fallback. Admin gets a dedicated row
    // (see below) — it has no demo_personas entry.
    console.log('• users…');
    // Shared demo password for every seeded role. Satisfies validatePasswordShape
    // (≥8 chars, ≥1 letter + ≥1 digit) and is published in CLAUDE.md §8. bcrypt
    // cost 10 matches api/auth/_lib/password.ts so bcryptjs.compare verifies it.
    const DEMO_PW_HASH = bcrypt.hashSync('Demo1234', 10);
    const userRows = [
      // Agent / branch / distributor personas — mirror `demo_personas` above.
      ...personas.map((p) => ({
        id: `${p.role}:${p.phone}`,
        phone: p.phone,
        role: p.role,
        // Friendly label as a fallback display name until verify-otp updates.
        name: p.label,
        entity_id: p.entity_id,
      })),
      // Subscriber demo phones (5 seeded subscribers — see CLAUDE.md §8).
      // The entity IDs match the first 5 lazy-generated subscriber rows so
      // the JWT issued by verify-otp carries the same `subscriberId` claim
      // every time. If those IDs drift, verify-otp falls back via
      // `users` lookup → `subscribers` lookup, so the demo still works.
      { id: 'subscriber:+256711000001', phone: '+256711000001', role: 'subscriber', name: 'Demo subscriber 1', entity_id: 's-0001' },
      { id: 'subscriber:+256711000002', phone: '+256711000002', role: 'subscriber', name: 'Demo subscriber 2', entity_id: 's-0002' },
      { id: 'subscriber:+256711000003', phone: '+256711000003', role: 'subscriber', name: 'Demo subscriber 3', entity_id: 's-0003' },
      { id: 'subscriber:+256711000004', phone: '+256711000004', role: 'subscriber', name: 'Demo subscriber 4', entity_id: 's-0004' },
      { id: 'subscriber:+256711000005', phone: '+256711000005', role: 'subscriber', name: 'Demo subscriber 5', entity_id: 's-0005' },
      // Super-admin demo identity. Admin has NO demo_personas row (verify-* fall
      // back to admin-001 via ROLE_DEFAULTS), so this `users` row is what enables
      // admin PASSWORD login from /admin. Admin OTP stays phone-agnostic (any
      // phone → admin-001). Keep this phone distinct from EMPLOYER_DEMO_PHONE.
      { id: 'admin:+256700000099', phone: '+256700000099', role: 'admin', name: 'Demo super-admin', entity_id: 'admin-001' },
    ];
    // De-duplicate on (phone, role) so the `users_phone_role_unique` constraint
    // (UNIQUE(phone, role)) can always apply against seeded data (audit §4b.10).
    // The persona ↔ subscriber lists are distinct today, but this guard keeps
    // the seed correct if a future phone ever overlaps a role — first wins,
    // mirroring a deterministic phone→user resolution.
    const _seenUserKeys = new Set();
    const dedupedUserRows = userRows.filter((u) => {
      const key = `${u.phone}|${u.role}`;
      if (_seenUserKeys.has(key)) {
        console.warn(`  ⚠ users: dropping duplicate (phone, role) seed row ${u.id} (${key}).`);
        return false;
      }
      _seenUserKeys.add(key);
      return true;
    });
    await bulkInsert(
      client,
      'users',
      [
        { name: 'id', type: 'text' },
        { name: 'phone', type: 'text' },
        { name: 'role', type: 'text' },
        { name: 'name', type: 'text' },
        { name: 'entity_id', type: 'text' },
        { name: 'password_hash', type: 'text' },
      ],
      [
        dedupedUserRows.map((u) => u.id),
        dedupedUserRows.map((u) => u.phone),
        dedupedUserRows.map((u) => u.role),
        dedupedUserRows.map((u) => u.name),
        dedupedUserRows.map((u) => u.entity_id),
        // Shared demo password ('Demo1234') on every row so password login works
        // out-of-the-box for all roles. OTP stays available in parallel; the
        // change-password route can still rotate a user's hash later.
        dedupedUserRows.map(() => DEMO_PW_HASH),
      ],
      'id'
    );

    // 5. Re-enable triggers BEFORE commit. Any post-seed write — by the
    //    application — must go through the normal trigger machinery.
    await client.query("SET session_replication_role = 'origin'");
    await client.query('COMMIT');

    // Reclaim disk from the dead tuples left by the TRUNCATE + churn. VACUUM
    // (FULL, …) rewrites each table compactly and ANALYZE refreshes planner
    // stats. VACUUM cannot run inside a transaction, so it goes on a FRESH
    // connection AFTER the COMMIT. Best-effort: if it fails (e.g. lock
    // contention or insufficient privilege on a pooled connection) we warn
    // and carry on — the seed itself already committed successfully.
    console.log('• VACUUM (FULL, ANALYZE) — reclaiming disk…');
    const vacuumClient = new Client({ connectionString: DB_URL });
    try {
      await vacuumClient.connect();
      await vacuumClient.query('VACUUM (FULL, ANALYZE)');
      console.log('  → VACUUM complete.');
    } catch (vacErr) {
      console.warn(
        `  ⚠ VACUUM (FULL, ANALYZE) skipped — ${vacErr.message}. ` +
          'Seed committed successfully; disk reclamation can be run manually.'
      );
    } finally {
      try {
        await vacuumClient.end();
      } catch {}
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n✓ Seed complete in ${elapsed}s.`);
    console.log(
      `Subscribers: ~${subscribers.length}, Agents: ~${agents.length}, ` +
        `Branches: ~${branches.length}, Commissions: ~${commissions.length}, ` +
        `Personas: ${personas.length}`
    );
  } catch (err) {
    console.error('\n✗ Seed failed — rolling back:', err.message);
    try {
      await client.query("SET session_replication_role = 'origin'");
    } catch {}
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
