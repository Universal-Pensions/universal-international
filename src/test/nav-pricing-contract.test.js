// Cross-cutting migration contract test — the fund NAV is the pricing authority.
//
// Migrations 0103–0105 replaced the hardcoded 1,000 UGX/unit price with a real
// admin-published NAV. Two things must stay true forever after:
//
//   1. Neither money function may reintroduce a unit-price LITERAL. Both are
//      re-emitted with CREATE OR REPLACE, so any later migration that re-emits
//      one from a stale copy would silently un-ship the NAV and quietly restore
//      a frozen price — with no test failing anywhere else in the suite. This is
//      exactly how 0095 silently dropped 0090's login-identity work.
//
//   2. The write path stays admin-gated and the helpers stay DEFINER + pinned.
//      nav_snapshots has FORCE RLS with an admin-only SELECT policy, so a
//      SECURITY INVOKER price lookup would return NULL for every subscriber and
//      every contribution would divide by NULL — crediting zero units, silently.
//
// Like the sibling contract tests, this parses supabase/migrations/*.sql and
// asserts on the NEWEST forward migration that defines each function.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

function stripSqlComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '');
}

/** Forward migrations only, oldest → newest. `.down.sql` files are excluded. */
function forwardMigrations() {
  // `!/ \d+\.sql$/` — macOS folder-sync conflict copies ("0110_purge 2.sql")
  // also end in .sql. Left in, they are scanned as if they were migrations, and
  // because several of these contracts use .sort() to pick the NEWEST definition
  // of a function, a duplicate can change which body is judged.
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !/ \d+\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort();
}

/**
 * The body of the LAST migration that defines `fnName`, comments stripped.
 * Slices from the CREATE … FUNCTION to the terminating `$function$;` / `$$;`.
 */
function newestDefinitionOf(fnName) {
  const files = forwardMigrations();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const raw = readFileSync(join(MIGRATIONS_DIR, files[i]), 'utf8');
    const body = stripSqlComments(raw);
    const re = new RegExp(
      `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`,
      'i',
    );
    const start = body.search(re);
    if (start === -1) continue;
    const rest = body.slice(start);
    const end = rest.search(/\$(?:function)?\$\s*;/);
    return { file: files[i], body: end === -1 ? rest : rest.slice(0, end) };
  }
  return null;
}

const MONEY_FUNCTIONS = ['trg_transactions_contribution', 'request_withdrawal'];

describe('NAV pricing contract across migrations', () => {
  it('discovers migration files', () => {
    expect(forwardMigrations().length).toBeGreaterThan(0);
  });

  for (const fn of MONEY_FUNCTIONS) {
    describe(fn, () => {
      it('is defined by some migration', () => {
        expect(newestDefinitionOf(fn)).not.toBeNull();
      });

      it('does not reintroduce a hardcoded unit price', () => {
        const def = newestDefinitionOf(fn);
        const literals = def.body.match(/v_unit_price\s+\w+\s*:=\s*1000/gi);
        expect(
          literals,
          `${def.file} re-emits ${fn}() with a hardcoded unit price. The fund ` +
            'NAV in nav_snapshots is the pricing authority since 0104 — read it ' +
            'via public.nav_for_date() / public.latest_nav() instead. Re-emitting ' +
            'a money function from a stale copy silently un-ships the NAV.',
        ).toBeNull();
      });

      it('prices from the NAV register', () => {
        const def = newestDefinitionOf(fn);
        expect(
          /public\.(nav_for_date|latest_nav)\s*\(/.test(def.body),
          `${def.file} defines ${fn}() without calling nav_for_date()/latest_nav().`,
        ).toBe(true);
      });

      it('keeps SECURITY DEFINER and a pinned search_path', () => {
        const def = newestDefinitionOf(fn);
        expect(/SECURITY\s+DEFINER/i.test(def.body)).toBe(true);
        expect(/SET\s+search_path\s*(?:TO|=)/i.test(def.body)).toBe(true);
      });
    });
  }

  describe('price lookup helpers', () => {
    for (const fn of ['nav_for_date', 'latest_nav']) {
      it(`${fn}() is STABLE, SECURITY DEFINER and search_path-pinned`, () => {
        const def = newestDefinitionOf(fn);
        expect(def, `${fn}() is not defined by any migration`).not.toBeNull();
        expect(/\bSTABLE\b/i.test(def.body)).toBe(true);
        // DEFINER is load-bearing: nav_snapshots has FORCE RLS + an admin-only
        // SELECT policy, so an INVOKER lookup returns NULL for every subscriber.
        expect(/SECURITY\s+DEFINER/i.test(def.body)).toBe(true);
        expect(/SET\s+search_path\s*(?:TO|=)/i.test(def.body)).toBe(true);
      });
    }
  });

  describe('publish_nav_snapshot', () => {
    it('gates on app_role = admin and raises P0001', () => {
      const def = newestDefinitionOf('publish_nav_snapshot');
      expect(def, 'publish_nav_snapshot() is not defined by any migration').not.toBeNull();
      expect(/->>\s*'app_role'/.test(def.body)).toBe(true);
      expect(/'admin'/.test(def.body)).toBe(true);
      expect(/ERRCODE\s*=\s*'P0001'/i.test(def.body)).toBe(true);
    });

    it('enforces the large-move confirmation server-side', () => {
      const def = newestDefinitionOf('publish_nav_snapshot');
      // The client dialog is a courtesy; the RPC is the gate, so a scripted or
      // replayed call cannot skip it.
      expect(/p_confirm_move/i.test(def.body)).toBe(true);
    });
  });

  // ── 0147: the pricing AUTHORITY moved ──────────────────────────────────
  // The predicates above stay true and stay valuable, but they no longer prove
  // WHERE a price comes from: both money functions keep a synchronous fallback
  // (live while fund_dealing_config.pricing_enabled is false) and so still
  // mention nav_for_date/latest_nav. What prices money now is
  // price_pending_transactions, and it must price from the STRICT
  // nav_price_row lookup.
  describe('price_pending_transactions — the engine', () => {
    it('prices from the strict dealing-date lookup', () => {
      const def = newestDefinitionOf('price_pending_transactions');
      expect(def, 'price_pending_transactions() is not defined by any migration').not.toBeNull();
      expect(
        /public\.nav_price_row\s*\(/.test(def.body),
        `${def.file} defines the pricing engine without nav_price_row(). Pricing from ` +
          'nav_for_date()/latest_nav() would reintroduce a carried-forward price.',
      ).toBe(true);
    });

    it('resyncs bucket units after moving units', () => {
      const def = newestDefinitionOf('price_pending_transactions');
      // subscriber_balances_bucket_units_sum is a DEFERRABLE constraint trigger.
      // Skip this and the whole transaction aborts at COMMIT with 23514.
      expect(/_resync_bucket_units/.test(def.body)).toBe(true);
    });

    it('keeps SECURITY DEFINER and a pinned search_path', () => {
      const def = newestDefinitionOf('price_pending_transactions');
      expect(/SECURITY\s+DEFINER/i.test(def.body)).toBe(true);
      expect(/SET\s+search_path\s*(?:TO|=)/i.test(def.body)).toBe(true);
    });
  });

  describe('nav_for_date is STRICT', () => {
    it('has no backward carry to an earlier day', () => {
      const def = newestDefinitionOf('nav_for_date');
      // `nav_date <= p_date ORDER BY nav_date DESC` is the defect itself: it
      // priced 5,329 weekend contributions at the previous Friday's close, a
      // price struck before the money existed.
      expect(
        /nav_date\s*<=/.test(def.body),
        `${def.file} re-emits nav_for_date() with the backward carry.`,
      ).toBe(false);
    });

    it('has no fallback chain and no 1000 literal', () => {
      const def = newestDefinitionOf('nav_for_date');
      expect(/COALESCE/i.test(def.body)).toBe(false);
      expect(/\b1000\b/.test(def.body)).toBe(false);
    });
  });

  describe('publish_nav_snapshot releases the queue', () => {
    it('calls the pricing engine', () => {
      const def = newestDefinitionOf('publish_nav_snapshot');
      expect(/price_pending_transactions/.test(def.body)).toBe(true);
    });

    it('calls it OUTSIDE the newest-day block', () => {
      const def = newestDefinitionOf('publish_nav_snapshot');
      // Inside `IF v_is_newest`, a BACK-DATED publish — the one event that makes
      // a stalled queue priceable — releases nothing: the price lands, the rows
      // stay pending, and that money never allocates.
      const i = def.body.search(/IF\s+v_is_newest/i);
      const j = def.body.search(/price_pending_transactions/);
      expect(i, 'no v_is_newest block found').toBeGreaterThan(-1);
      expect(j, 'the engine is never called').toBeGreaterThan(-1);
      expect(
        /END\s+IF\s*;/i.test(def.body.slice(i, j)),
        `${def.file} calls the pricing engine inside the newest-day block, so a ` +
          'back-dated publish would release nothing.',
      ).toBe(true);
    });
  });

  describe('grants', () => {
    const NEW_FUNCS = [
      'nav_for_date', 'latest_nav', 'publish_nav_snapshot',
      'get_nav_overview', 'list_nav_snapshots',
      // 0145 — the strict lookup and the honest missing-day detector.
      'nav_price_row', 'nav_missing_days',
      // 0147 — the engine's admin door and its read-only summary. The engine
      // itself is granted to NOBODY: it moves money for arbitrary members and
      // is called only from DEFINER code.
      'run_pending_pricing', 'get_pending_pricing_summary',
    ];

    it('every NAV function is revoked from PUBLIC and anon', () => {
      const all = forwardMigrations()
        .map((f) => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')))
        .join('\n');
      for (const fn of NEW_FUNCS) {
        const re = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, 'i');
        expect(re.test(all), `no REVOKE ALL … FROM PUBLIC, anon for ${fn}()`).toBe(true);
      }
    });

    it('_resync_bucket_units is never granted to authenticated', () => {
      const all = forwardMigrations()
        .map((f) => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')))
        .join('\n');
      // It is called only from DEFINER code; exposing it would let any signed-in
      // user rewrite another member's bucket unit split over PostgREST.
      expect(
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\._resync_bucket_units\s*\([^)]*\)\s+TO\s+authenticated/i
          .test(all),
      ).toBe(false);
    });
  });

  describe('reversibility', () => {
    for (const n of ['0103', '0104', '0105', '0143', '0144', '0145', '0146', '0147', '0148', '0149']) {
      it(`${n} ships a paired .down.sql`, () => {
        const files = readdirSync(MIGRATIONS_DIR);
        const forward = files.find((f) => f.startsWith(n) && f.endsWith('.sql') && !f.endsWith('.down.sql'));
        expect(forward, `no forward migration ${n}`).toBeDefined();
        const down = forward.replace(/\.sql$/, '.down.sql');
        expect(files.includes(down), `${forward} has no ${down}`).toBe(true);
      });
    }

    it('0105 captures a restore snapshot before it rewrites balances', () => {
      const files = readdirSync(MIGRATIONS_DIR);
      const forward = files.find((f) => f.startsWith('0105') && !f.endsWith('.down.sql'));
      const body = readFileSync(join(MIGRATIONS_DIR, forward), 'utf8');
      // The backfill is the one irreversible step; without the snapshot its down
      // migration has nothing to restore from.
      expect(/subscriber_balances_pre_nav/.test(body)).toBe(true);
      expect(/subscribers_unit_value_pre_nav/.test(body)).toBe(true);
    });
  });
});
