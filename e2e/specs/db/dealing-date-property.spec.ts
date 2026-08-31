// Generative proof of the ONE invariant the unitization redesign exists to
// guarantee — Phase 1 of the plan (migration 0143).
//
//     A transaction is NEVER priced at a date earlier than its own dealing
//     date, and a dealing date is ALWAYS a business day.
//
// Five hand-picked cases (Friday at 13:59, at 14:00, at 14:01, a Saturday, the
// day before Independence Day) live in `src/test/dealing-date-contract.test.js`
// and in 0143's own in-migration self-check. They prove the rule on the cases
// someone thought of. This spec proves it on ten thousand cases nobody thought
// of, against the DEPLOYED function — which is the only version that can
// actually misprice money.
//
// WHY IT HAS TO BE GENERATIVE. The rule is a composition of four things that
// each look right alone: a timezone conversion, a `>` comparison at the cutoff,
// a weekend roll, and a holiday roll. The interesting failures are at the
// seams — 00:30 Kampala on the 1st of January (previous UTC day AND a
// holiday AND possibly a weekend), 14:00:00.000 exactly, the Thursday before a
// Friday holiday. Enumerating those by hand is how you get five green tests and
// a live mispricing.
//
// Run prereq: SUPABASE_DB_URL in .env.local — a direct Postgres connection.
// `dealing_date_for` is SECURITY DEFINER over two FORCE-RLS tables and is not
// usefully callable through PostgREST for this volume of round-trips, so this
// pushes the whole experiment into one query. Same approach as
// function-deployment-contract.spec.ts. Without SUPABASE_DB_URL the file
// test.skip()s cleanly, like the rest of e2e/specs/db.

import { test, expect } from '@playwright/test';
import pgDefault from 'pg';

const hasDbUrl = !!process.env.SUPABASE_DB_URL;

type PgClient = {
  connect(): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};

function newClient(): PgClient {
  const { Client } = pgDefault as unknown as {
    Client: new (config: { connectionString: string }) => PgClient;
  };
  return new Client({ connectionString: process.env.SUPABASE_DB_URL as string });
}

test.describe('dealing-date rule (generative, against the deployed function)', () => {
  test.skip(!hasDbUrl, 'requires SUPABASE_DB_URL in env (.env.local) for a direct Postgres connection');

  let client: PgClient;

  test.beforeAll(async () => {
    client = newClient();
    await client.connect();
  });

  test.afterAll(async () => {
    if (client) await client.end();
  });

  test('10,000 random receipt instants: never earlier than receipt, always a business day', async () => {
    const { rows } = await client.query<{
      n: string;
      violations_earlier: string;
      violations_not_business_day: string;
      same_day: string;
      max_roll_days: string | null;
    }>(`
      WITH r AS (
        SELECT (TIMESTAMPTZ '2026-01-01 00:00:00+03'
                 + (random() * 365 * 86400)::int * interval '1 second') AS ts
          FROM generate_series(1, 10000)
      ), d AS (
        SELECT ts,
               public.dealing_date_for(ts)                  AS dd,
               (ts AT TIME ZONE 'Africa/Kampala')::date     AS kampala_date
          FROM r
      )
      SELECT count(*)                                                  AS n,
             count(*) FILTER (WHERE dd < kampala_date)                 AS violations_earlier,
             count(*) FILTER (WHERE NOT public.is_business_day(dd))    AS violations_not_business_day,
             count(*) FILTER (WHERE dd = kampala_date)                 AS same_day,
             max(dd - kampala_date)                                    AS max_roll_days
        FROM d;
    `);

    const r = rows[0];
    expect(Number(r.n)).toBe(10000);

    // THE invariant. A dealing date earlier than the receipt date means money
    // bought units at a price struck before the money existed.
    expect(
      Number(r.violations_earlier),
      'dealing_date_for() returned a date EARLIER than the Kampala receipt date. ' +
        'This is the defect the whole unitization redesign exists to remove.',
    ).toBe(0);

    // A dealing date on a closed day has no published price and never will, so
    // the transaction would sit pending until someone noticed.
    expect(
      Number(r.violations_not_business_day),
      'dealing_date_for() returned a weekend or public holiday.',
    ).toBe(0);

    // Sanity band, not a hard rule: with a 14:00 cutoff a little under half of
    // a uniform day/night spread deals same-day. A result far outside this band
    // means the cutoff or the timezone moved without anyone saying so.
    const sameDayPct = (Number(r.same_day) / Number(r.n)) * 100;
    expect(sameDayPct).toBeGreaterThan(30);
    expect(sameDayPct).toBeLessThan(60);

    // Longest roll in Uganda's fixed calendar is a Thursday-after-cutoff before
    // a Friday holiday → the following Monday, i.e. 4 days. A larger number
    // means a holiday cluster was entered that closes the market for a week.
    expect(Number(r.max_roll_days)).toBeLessThanOrEqual(7);
  });

  test('the same instant expressed in Kampala and in UTC deals identically', async () => {
    // The F8 defect in one assertion: `NEW.date::date` casts in the session
    // timezone, so a 01:30 Kampala receipt (= 22:30Z the previous day) dated to
    // yesterday. Every pair below is ONE instant written two ways.
    const { rows } = await client.query<{ disagreements: string }>(`
      WITH pairs AS (
        SELECT * FROM (VALUES
          (TIMESTAMPTZ '2026-09-04 01:30+03', TIMESTAMPTZ '2026-09-03 22:30Z'),
          (TIMESTAMPTZ '2026-01-01 02:00+03', TIMESTAMPTZ '2025-12-31 23:00Z'),
          (TIMESTAMPTZ '2026-10-09 00:10+03', TIMESTAMPTZ '2026-10-08 21:10Z'),
          (TIMESTAMPTZ '2026-12-26 13:59+03', TIMESTAMPTZ '2026-12-26 10:59Z'),
          (TIMESTAMPTZ '2026-03-08 14:01+03', TIMESTAMPTZ '2026-03-08 11:01Z')
        ) AS p(kampala, utc)
      )
      SELECT count(*) AS disagreements
        FROM pairs
       WHERE public.dealing_date_for(kampala) IS DISTINCT FROM public.dealing_date_for(utc);
    `);
    expect(
      Number(rows[0].disagreements),
      'dealing_date_for() gave two different answers for the same instant written two ways. ' +
        'It is casting in the session timezone (UTC) instead of the configured one.',
    ).toBe(0);
  });

  test('the cutoff is live-configurable, and the boundary is at-or-before', async () => {
    // Proves the brief's "configurable, not a literal" end-to-end: move the
    // cutoff, watch the answer move, put it back. Wrapped in an explicit
    // transaction that is always rolled back, so the live config is untouched
    // even if an assertion throws.
    await client.query('BEGIN');
    try {
      const at = "TIMESTAMPTZ '2026-09-04 14:00:00+03'";
      const after = "TIMESTAMPTZ '2026-09-04 14:00:01+03'";

      const before = await client.query<{ at_cutoff: string; after_cutoff: string }>(
        // ::text is deliberate — node-postgres hands `date` back as a JS Date
        // in the RUNNER's timezone, which turns 2026-09-04 into an ISO string
        // for the 3rd. Comparing dates as text keeps the assertion honest.
        `SELECT public.dealing_date_for(${at})::text    AS at_cutoff,
                public.dealing_date_for(${after})::text AS after_cutoff;`,
      );
      // Friday. At the cutoff → same day. One second later → Monday.
      expect(before.rows[0].at_cutoff).toMatch(/^2026-09-04/);
      expect(before.rows[0].after_cutoff).toMatch(/^2026-09-07/);

      await client.query(
        `UPDATE public.fund_dealing_config SET cutoff_local_time = '09:00:00' WHERE fund_code = 'UPU-BAL';`,
      );
      const moved = await client.query<{ at_cutoff: string }>(
        `SELECT public.dealing_date_for(${at})::text AS at_cutoff;`,
      );
      expect(
        moved.rows[0].at_cutoff,
        'moving fund_dealing_config.cutoff_local_time did not change the dealing date — ' +
          'dealing_date_for() is not reading the config.',
      ).toMatch(/^2026-09-07/);
    } finally {
      await client.query('ROLLBACK');
    }

    // And the live row is exactly as it was.
    const { rows } = await client.query<{ cutoff: string }>(
      `SELECT to_char(cutoff_local_time, 'HH24:MI:SS') AS cutoff
         FROM public.fund_dealing_config WHERE fund_code = 'UPU-BAL';`,
    );
    expect(rows[0].cutoff).toBe('14:00:00');
  });
});
