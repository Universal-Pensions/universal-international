// Cross-cutting migration contract test — the dealing-date rule has ONE
// implementation and ONE source for the cutoff.
//
// Migration 0143 (Phase 1 of the unitization redesign) introduced forward
// dealing: money received after the 14:00 Kampala cutoff, or on a weekend or
// public holiday, buys units at the NEXT business day's price. Three things
// must stay true forever after:
//
//   1. The cutoff is READ FROM `fund_dealing_config`, never written as a
//      literal. The brief requires it be changeable without a redeploy, and a
//      re-emitted `dealing_date_for()` carrying '14:00' would silently freeze
//      it — with no other test failing. This is the same failure mode
//      nav-pricing-contract.test.js was written for: 0095 re-emitted a
//      function from a stale copy and un-shipped 0090's work.
//
//   2. The derivation reads the TIMEZONE from config too. The whole reason
//      this migration exists is that `NEW.date::date` cast in the session
//      timezone (UTC) dates a 01:00-Kampala receipt to the previous day. A
//      re-emitted body that casts in the session zone reintroduces exactly the
//      defect the migration removed.
//
//   3. The helpers stay SECURITY DEFINER + search_path-pinned, and stay
//      revoked from PUBLIC/anon. `business_holidays` and `fund_dealing_config`
//      both carry FORCE RLS with an admin-only SELECT policy, so a SECURITY
//      INVOKER `is_business_day()` sees an EMPTY calendar for every subscriber
//      — `NOT EXISTS` passes, Christmas Day becomes a business day, and money
//      deals on a date the fund never priced.
//
// Like the sibling contract tests, this parses supabase/migrations/*.sql and
// asserts on the NEWEST forward migration that defines each function. It opens
// no database connection; the behavioural twin that reads the DEPLOYED body
// lives in e2e/specs/db/function-deployment-contract.spec.ts, and the
// generative proof of the rule itself lives in
// e2e/specs/db/dealing-date-property.spec.ts.

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
  // also end in .sql and would change which body is judged newest.
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !/ \d+\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort();
}

/** The body of the LAST migration that defines `fnName`, comments stripped. */
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

const DEALING_FUNCTIONS = [
  'kampala_now',
  'is_business_day',
  'next_business_day',
  'dealing_date_for',
  'set_fund_dealing_config',
  'upsert_business_holiday',
  'delete_business_holiday',
];

describe('dealing-date contract across migrations', () => {
  it('discovers migration files', () => {
    expect(forwardMigrations().length).toBeGreaterThan(0);
  });

  for (const fn of DEALING_FUNCTIONS) {
    describe(fn, () => {
      it('is defined by some migration', () => {
        expect(
          newestDefinitionOf(fn),
          `${fn}() is not defined by any forward migration — 0143 missing or renamed?`,
        ).not.toBeNull();
      });

      it('keeps SECURITY DEFINER and a pinned search_path', () => {
        const def = newestDefinitionOf(fn);
        // DEFINER is load-bearing: both new tables have FORCE RLS with an
        // admin-only SELECT policy. An INVOKER lookup sees an empty calendar.
        expect(
          /SECURITY\s+DEFINER/i.test(def.body),
          `${def.file} re-emits ${fn}() without SECURITY DEFINER.`,
        ).toBe(true);
        expect(
          /SET\s+search_path\s*(?:TO|=)/i.test(def.body),
          `${def.file} re-emits ${fn}() without a pinned search_path.`,
        ).toBe(true);
      });
    });
  }

  describe('dealing_date_for — the single derivation', () => {
    it('reads the cutoff from fund_dealing_config', () => {
      const def = newestDefinitionOf('dealing_date_for');
      expect(
        /fund_dealing_config/.test(def.body),
        `${def.file} defines dealing_date_for() without reading fund_dealing_config. ` +
          'The cutoff must be configurable without a redeploy.',
      ).toBe(true);
      expect(/cutoff_local_time/.test(def.body)).toBe(true);
    });

    it('contains no hardcoded cutoff time', () => {
      const def = newestDefinitionOf('dealing_date_for');
      const literals = def.body.match(/'\s*1[0-9]\s*:\s*[0-9]{2}(:\s*[0-9]{2})?\s*'/g);
      expect(
        literals,
        `${def.file} re-emits dealing_date_for() with a hardcoded cutoff time ` +
          `(${literals && literals.join(', ')}). The cutoff lives in ` +
          'fund_dealing_config.cutoff_local_time and nowhere else.',
      ).toBeNull();
    });

    it('derives the local date from the configured timezone, not the session zone', () => {
      const def = newestDefinitionOf('dealing_date_for');
      // The defect this migration exists to fix: `NEW.date::date` casts in the
      // session timezone (UTC), dating a 01:00 Kampala receipt to yesterday.
      expect(
        /AT\s+TIME\s+ZONE\s+\w*\.?timezone/i.test(def.body),
        `${def.file} defines dealing_date_for() without "AT TIME ZONE <config>.timezone". ` +
          'Casting in the session timezone is the UTC/Kampala defect, not the fix.',
      ).toBe(true);
      expect(
        /'Africa\/Kampala'/.test(def.body),
        `${def.file} hardcodes the timezone in dealing_date_for(); it belongs in config.`,
      ).toBe(false);
    });

    it('uses > (at-or-before the cutoff deals the same day), never >=', () => {
      const def = newestDefinitionOf('dealing_date_for');
      expect(
        />\s*v_cfg\.cutoff_local_time|>\s*\w+\.cutoff_local_time/.test(def.body),
        `${def.file} does not compare the receipt time with "> cutoff". A receipt at ` +
          'exactly 14:00:00 must deal the SAME day.',
      ).toBe(true);
      expect(
        />=\s*\w+\.cutoff_local_time/.test(def.body),
        `${def.file} uses ">= cutoff", which pushes an at-the-cutoff receipt to the next day.`,
      ).toBe(false);
    });

    it('bounds the roll-forward loop so a broken calendar fails loudly', () => {
      const def = newestDefinitionOf('dealing_date_for');
      expect(
        /ERRCODE\s*=\s*'P0001'/i.test(def.body),
        `${def.file} defines dealing_date_for() with no P0001 escape. An unbounded ` +
          'roll over a misconfigured calendar would price money years into the future.',
      ).toBe(true);
    });
  });

  describe('grants', () => {
    it('every dealing function is revoked from PUBLIC and anon', () => {
      const all = forwardMigrations()
        .map((f) => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')))
        .join('\n');
      for (const fn of DEALING_FUNCTIONS) {
        const re = new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, 'i');
        expect(re.test(all), `no REVOKE ALL … FROM PUBLIC, anon for ${fn}()`).toBe(true);
      }
    });

    it('the calendar and config tables are revoked from anon', () => {
      const all = forwardMigrations()
        .map((f) => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')))
        .join('\n');
      for (const tbl of ['business_holidays', 'fund_dealing_config']) {
        expect(
          new RegExp(`REVOKE\\s+ALL\\s+ON\\s+public\\.${tbl}\\s+FROM\\s+PUBLIC,\\s*anon`, 'i').test(all),
          `no REVOKE ALL ON public.${tbl} FROM PUBLIC, anon`,
        ).toBe(true);
      }
    });
  });

  describe('reversibility', () => {
    it('0143 ships a paired .down.sql', () => {
      const files = readdirSync(MIGRATIONS_DIR);
      const forward = files.find(
        (f) => f.startsWith('0143') && f.endsWith('.sql') && !f.endsWith('.down.sql'),
      );
      expect(forward, 'no forward migration 0143').toBeDefined();
      expect(files.includes(forward.replace(/\.sql$/, '.down.sql'))).toBe(true);
    });
  });

  describe('the calendar seed does not invent movable holidays', () => {
    it('seeds no Easter or Eid dates', () => {
      const raw = readFileSync(
        join(MIGRATIONS_DIR, '0143_dealing_calendar.sql'),
        'utf8',
      );
      const body = stripSqlComments(raw);
      // Scoped to the seed's VALUES list, NOT the whole file: the table comment
      // deliberately NAMES the movable holidays in order to warn that they must
      // be gazette-entered, and a whole-file grep would fire on that warning.
      const seed = body.match(/CROSS\s+JOIN\s*\(VALUES([\s\S]*?)\)\s*AS\s+h\s*\(/i);
      expect(seed, '0143 no longer has a recognisable fixed-date holiday seed').not.toBeNull();
      // Eid dates are moon-sighted and declared by the Uganda Muslim Supreme
      // Council; Easter moves. Neither can be correct in advance, so 0143 must
      // seed only fixed-date holidays and leave the rest to gazette entry.
      expect(/Easter|Good\s+Friday|Eid/i.test(seed[1])).toBe(false);
    });
  });
});
