// Behavioural twin of the 4 migration-TEXT contract tests (src/test/{jwt-claim,
// employer-split,login-identity,nav-pricing}-contract.test.js) — audit finding
// A25-003 (and A25-005's proposed M12).
//
// The 4 sibling tests in src/test/ grep supabase/migrations/*.sql TEXT and
// never open a database connection — the only occurrence of the string
// "supabase" in any of the four is the MIGRATIONS_DIR filesystem path. They
// pass with the database paused, restored to an older snapshot, or pointed at
// the wrong project entirely. Proven live in
// docs/audits/2026-08-23/a25/proof-text-vs-live.mjs, which fed their own
// `latestDefinitionOf()` resolver 19 function names that exist in migration
// text but have ZERO OIDs live, and got a full "newest definition" back for
// 19/19 of them — the resolver cannot tell a deployed function from a dropped
// one. That is exactly the blind spot that would let a silent CREATE-OR-REPLACE
// regression (0095 un-shipping 0090, the incident these tests' own header
// comments cite) or a hand-edit over psql pass every one of the 25 text
// assertions.
//
// This spec runs the IDENTICAL regex battery — same 10 function names, same 25
// labelled predicates, ported verbatim from a25/proof-text-vs-live.mjs (which
// itself re-implements each contract test's own predicate) — against
// `pg_get_functiondef(p.oid)` for the function AS ACTUALLY DEPLOYED, and
// additionally asserts exactly one live OID per name. A function that is
// missing (never applied, or applied against the wrong project) or
// unexpectedly overloaded fails loudly here; the text-side resolver would
// silently walk back to an old migration file and say nothing is wrong.
//
// The text greps stay in src/test/ — they are a genuinely useful, fast,
// no-DB-required pre-merge lint on the migration a developer is writing. This
// spec is the deployed-behaviour guard the audit found missing, and it
// inherits the §15-M1 executed-not-skipped CI guard for free (test.yml
// re-runs e2e/specs/db with --reporter=json and fails the push-to-main job on
// stats.expected < 1).
//
// Run prereq: SUPABASE_DB_URL in .env.local — a direct Postgres connection.
// pg_get_functiondef/pg_proc/pg_namespace are not exposed over PostgREST, so
// this cannot use supabaseAdmin (the supabase-js client every other e2e/specs/db
// file uses). Same approach as invariants.spec.ts's public._demo_now() test
// and e2e/fixtures/db.ts's findChildTableListDrift — `pg` is already a project
// dependency (used by scripts/seed-supabase.mjs). Without SUPABASE_DB_URL the
// whole file test.skip()s cleanly, same as the rest of e2e/specs/db.

import { test, expect } from '@playwright/test';
import pgDefault from 'pg';

const hasDbUrl = !!process.env.SUPABASE_DB_URL;

// Strip SQL comments so explanatory prose mentioning a trap by name can't
// trigger its own guard — mirrors stripSqlComments() in the 4 text-based
// sibling tests.
function stripSqlComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

type Assertion = {
  suite: string;
  fn: string;
  label: string;
  predicate: (body: string) => boolean;
};

// Ported verbatim (same function names, same predicates) from
// docs/audits/2026-08-23/a25/proof-text-vs-live.mjs's `check(...)` calls,
// which themselves re-implement each src/test/*contract*.test.js assertion.
const ASSERTIONS: Assertion[] = [
  // ── nav-pricing-contract.test.js (17) ──────────────────────────────────
  ...['trg_transactions_contribution', 'request_withdrawal'].flatMap((fn) => [
    {
      suite: 'nav-pricing', fn, label: 'no hardcoded 1000 unit price',
      predicate: (b: string) => b.match(/v_unit_price\s+\w+\s*:=\s*1000/gi) === null,
    },
    {
      suite: 'nav-pricing', fn, label: 'prices from NAV register',
      predicate: (b: string) => /public\.(nav_for_date|latest_nav)\s*\(/.test(b),
    },
    {
      suite: 'nav-pricing', fn, label: 'SECURITY DEFINER',
      predicate: (b: string) => /SECURITY\s+DEFINER/i.test(b),
    },
    {
      suite: 'nav-pricing', fn, label: 'pinned search_path',
      predicate: (b: string) => /SET\s+search_path\s*(?:TO|=)/i.test(b),
    },
  ]),
  ...['nav_for_date', 'latest_nav'].flatMap((fn) => [
    { suite: 'nav-pricing', fn, label: 'STABLE', predicate: (b: string) => /\bSTABLE\b/i.test(b) },
    {
      suite: 'nav-pricing', fn, label: 'SECURITY DEFINER',
      predicate: (b: string) => /SECURITY\s+DEFINER/i.test(b),
    },
    {
      suite: 'nav-pricing', fn, label: 'pinned search_path',
      predicate: (b: string) => /SET\s+search_path\s*(?:TO|=)/i.test(b),
    },
  ]),
  {
    suite: 'nav-pricing', fn: 'publish_nav_snapshot', label: 'gates on app_role',
    predicate: (b: string) => /->>\s*'app_role'/.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'publish_nav_snapshot', label: 'raises P0001',
    predicate: (b: string) => /ERRCODE\s*=\s*'P0001'/i.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'publish_nav_snapshot', label: 'p_confirm_move server gate',
    predicate: (b: string) => /p_confirm_move/i.test(b),
  },

  // ── 0147: the pricing AUTHORITY moved ─────────────────────────────────
  // The predicates above stay true and stay valuable, but they no longer
  // prove where a price comes from: both money functions keep a synchronous
  // fallback (live while fund_dealing_config.pricing_enabled is false) and so
  // still mention nav_for_date/latest_nav. What prices money now is
  // price_pending_transactions, and it must price from the STRICT
  // nav_price_row lookup — never from a carried-forward or guessed price.
  {
    suite: 'nav-pricing', fn: 'price_pending_transactions',
    label: 'prices from the strict dealing-date lookup',
    predicate: (b: string) => /public\.nav_price_row\s*\(/.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'price_pending_transactions',
    label: 'resyncs bucket units after moving units',
    // subscriber_balances_bucket_units_sum is a DEFERRABLE constraint trigger:
    // skip this and the whole transaction fails at COMMIT with 23514.
    predicate: (b: string) => /_resync_bucket_units/.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'price_pending_transactions', label: 'SECURITY DEFINER',
    predicate: (b: string) => /SECURITY\s+DEFINER/i.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'price_pending_transactions', label: 'pinned search_path',
    predicate: (b: string) => /SET\s+search_path\s*(?:TO|=)/i.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'nav_for_date', label: 'no backward carry to an earlier day',
    // `nav_date <= p_date ORDER BY nav_date DESC` is the defect that priced
    // 5,329 weekend contributions at the previous Friday's close.
    predicate: (b: string) => !/nav_date\s*<=/.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'nav_for_date', label: 'no fallback chain and no 1000 literal',
    predicate: (b: string) => !/COALESCE/i.test(b) && !/\b1000\b/.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'publish_nav_snapshot', label: 'releases the pricing queue',
    predicate: (b: string) => /price_pending_transactions/.test(b),
  },
  {
    suite: 'nav-pricing', fn: 'publish_nav_snapshot',
    label: 'releases the queue OUTSIDE the newest-day block',
    predicate: (b: string) => {
      // Calling the engine INSIDE `IF v_is_newest` means a BACK-DATED publish —
      // the one event that makes a stalled queue priceable — releases nothing.
      // The price lands, the rows stay pending, the money never allocates.
      const i = b.search(/IF\s+v_is_newest/i);
      const j = b.search(/price_pending_transactions/);
      if (i === -1 || j === -1) return false;
      // Depth-aware, not "is there an END IF somewhere in between". The naive
      // version is satisfied by any nested IF closing INSIDE the newest-day
      // block, so a mutant with the engine genuinely inside still passed. Walk
      // the tokens and require the block to be closed at the call site.
      const seg = b.slice(i, j);
      // 0 because the slice STARTS at the opening `IF v_is_newest`, so that
      // token is counted by the walk itself.
      let depth = 0;
      const tok = seg.match(/\bIF\b|\bEND\s+IF\b|\bCASE\b|\bEND\s+CASE\b/gi) || [];
      for (const t of tok) {
        if (/^END\s+IF$/i.test(t)) depth -= 1;
        else if (/^IF$/i.test(t)) depth += 1;
      }
      return depth <= 0;
    },
  },

  // ── employer-split-contract.test.js (5) ────────────────────────────────
  {
    suite: 'employer-split', fn: 'submit_employer_contribution_run',
    label: 'does NOT read a member retirement pct',
    predicate: (b: string) => !/ret_pct|retirement_pct/i.test(b),
  },
  {
    suite: 'employer-split', fn: 'submit_employer_contribution_run',
    label: 'v_retirement := v_employee_leg',
    predicate: (b: string) => /v_retirement\s*:=\s*v_employee_leg\s*;/.test(b),
  },
  {
    suite: 'employer-split', fn: 'submit_employer_contribution_run',
    label: 'v_retirement := v_employer_leg',
    predicate: (b: string) => /v_retirement\s*:=\s*v_employer_leg\s*;/.test(b),
  },
  {
    suite: 'employer-split', fn: 'create_subscriber_from_employer_invite',
    label: 'ignores payload retirementPct',
    predicate: (b: string) => !b.includes("v_sched ->> 'retirementPct'"),
  },
  {
    suite: 'employer-split', fn: 'create_subscriber_from_employer_invite',
    label: 'writes 80/20 default',
    predicate: (b: string) => /retirement_pct[\s\S]{0,600}?VALUES[^;]*?,\s*80,\s*20,/.test(b),
  },

  // ── login-identity-contract.test.js (3) ────────────────────────────────
  ...['approve_access_request', 'create_employer', 'create_distributor'].map((fn) => ({
    suite: 'login-identity', fn, label: 'binds a login identity',
    predicate: (b: string) => /register_login_identity|demo_personas/.test(b),
  })),
];

const FUNCTION_NAMES = [...new Set(ASSERTIONS.map((a) => a.fn))];

test.describe('function-deployment contract (live pg_get_functiondef, not migration text)', () => {
  test.skip(!hasDbUrl, 'requires SUPABASE_DB_URL in env (.env.local) for a direct Postgres connection');

  // Populated once in beforeAll; read by every test below. Name -> array of
  // (stripped) live function bodies, one per OID found for that name.
  let liveDefs: Map<string, string[]> = new Map();

  test.beforeAll(async () => {
    const { Client } = pgDefault as unknown as {
      Client: new (config: { connectionString: string }) => {
        connect(): Promise<void>;
        query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
        end(): Promise<void>;
      };
    };
    const client = new Client({ connectionString: process.env.SUPABASE_DB_URL as string });
    await client.connect();
    try {
      const { rows } = await client.query<{ name: string; oid: string; def: string }>(
        `select p.proname as name, p.oid::text as oid, pg_get_functiondef(p.oid) as def
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = ANY($1)`,
        [FUNCTION_NAMES],
      );
      const defs = new Map<string, string[]>();
      for (const r of rows) {
        const bodies = defs.get(r.name) ?? [];
        bodies.push(stripSqlComments(r.def));
        defs.set(r.name, bodies);
      }
      liveDefs = defs;
    } finally {
      await client.end();
    }
  });

  // M12 (audit A25-005's proposal, same twin as A25-003): exactly one live
  // OID per name. A count of 0 means the migration that creates this function
  // was never applied (or was applied against the wrong project) — the exact
  // 0095-un-ships-0090 failure mode. A count > 1 is an unexpected overload
  // none of the 25 text-based assertions below would ever notice, because
  // they read migration files, not pg_proc.
  for (const fn of FUNCTION_NAMES) {
    test(`${fn} is deployed exactly once`, () => {
      const bodies = liveDefs.get(fn) ?? [];
      expect(
        bodies.length,
        `${fn}: expected exactly one live OID in pg_proc (public schema); found ${bodies.length}. ` +
          `See this file's header comment — a missing function means a migration was never applied ` +
          `(or was applied against the wrong project); src/test/*contract*.test.js's migration-text ` +
          `greps cannot detect either case.`,
      ).toBe(1);
    });
  }

  for (const { suite, fn, label, predicate } of ASSERTIONS) {
    test(`[${suite}] ${fn}: ${label} (live)`, () => {
      const bodies = liveDefs.get(fn) ?? [];
      test.skip(
        bodies.length !== 1,
        `${fn} is not deployed exactly once — see "${fn} is deployed exactly once" above`,
      );
      expect(
        predicate(bodies[0]),
        `${fn} (LIVE pg_get_functiondef): "${label}" failed against the DEPLOYED function body. ` +
          `The matching src/test/*contract*.test.js assertion only proves this of the migration ` +
          `FILE, which can silently diverge from what is actually live (audit A25-003) — e.g. a ` +
          `CREATE OR REPLACE that was written but never applied, or a hand-edit over psql.`,
      ).toBe(true);
    });
  }
});
