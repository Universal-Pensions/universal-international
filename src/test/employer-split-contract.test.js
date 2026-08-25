// Cross-cutting contract test — where employer-funded money lands.
//
// Everything an employer's contribution settings fund goes to the member's
// RETIREMENT pot (`EMPLOYER_FUNDED_SPLIT`). Nobody is asked to split it.
//
// This replaced a per-member retirement/liquid slider that the employer-invite
// completion screen ("Split your savings") put in front of every sponsored
// member at the end of KYC. Under the unified two-leg model that member states
// no amount at all — the employer's config sets both legs and their own schedule
// amount is written as 0 — so the only money the slider could act on was their
// employer's, and at the maximum liquid setting it diverted 40% of every payroll
// deduction and company top-up into a pot the member can empty at any time.
//
// WHY A TEST AND NOT JUST THE CODE. The allocation is stated in FOUR places that
// have no compiler between them: the run RPC, the invite RPC, the JS model, and
// the offline mock run. They have drifted before — the parity note at the top of
// utils/contributionModel.js exists because a local copy of the leg math got out
// of step with the SQL. A later migration that rewrites either RPC with
// CREATE OR REPLACE would silently restore the old split (exactly how 0095
// un-shipped 0090's login identity — see login-identity-contract.test.js), and
// nothing would error: runs would keep succeeding, just allocating differently.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPLOYER_FUNDED_SPLIT, splitEmployerLeg } from '../utils/contributionModel';
import { DEFAULT_SCHEDULE_SPLIT } from '../constants/savings';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

// Forward migrations only — a `.down.sql` deliberately restores the older body.
// `!/ \d+\.sql$/` — macOS folder-sync conflict copies ("0110_purge 2.sql")
// also end in .sql. Left in, they are scanned as if they were migrations, and
// because several of these contracts use .sort() to pick the NEWEST definition
// of a function, a duplicate can change which body is judged.
const forwardMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !/ \d+\.sql$/.test(f) && !f.endsWith('.down.sql'))
  .sort();

/**
 * The newest forward migration that (re)defines `fnName`, plus just that
 * definition's text — sliced from its CREATE to the next CREATE FUNCTION, so a
 * later unrelated function in the same file can't answer on its behalf.
 */
function latestDefinitionOf(fnName) {
  const create = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`,
    'i',
  );
  const anyCreate = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s/gi;

  for (const file of [...forwardMigrations].reverse()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    const start = sql.search(create);
    if (start === -1) continue;
    anyCreate.lastIndex = start + 1;
    const next = anyCreate.exec(sql);
    return { file, body: sql.slice(start, next ? next.index : undefined) };
  }
  return null;
}

describe('employer-funded money goes wholly to retirement', () => {
  it('the shared constant is 100 / 0', () => {
    expect(EMPLOYER_FUNDED_SPLIT).toEqual({ retirementPct: 100, emergencyPct: 0 });
  });

  it('splitEmployerLeg sends the whole leg to retirement', () => {
    expect(splitEmployerLeg(140_000)).toEqual({ retirement: 140_000, emergency: 0 });
    // No rounding crumb may fall into the liquid pot — the two must still sum to
    // the leg, which is what keeps Σ(splits) == amount on every transaction row.
    for (const leg of [0, 1, 7, 999, 33_333, 986_000]) {
      const { retirement, emergency } = splitEmployerLeg(leg);
      expect(retirement + emergency).toBe(leg);
      expect(emergency).toBe(0);
    }
  });

  it('the newest submit_employer_contribution_run does not split by the member’s pct', () => {
    const found = latestDefinitionOf('submit_employer_contribution_run');
    expect(found, 'no migration defines submit_employer_contribution_run').not.toBeNull();

    // The read itself is the regression: any reference to a per-member
    // percentage inside this function means employer money is being allocated by
    // a number the member controls.
    expect(
      /ret_pct|retirement_pct/i.test(found.body),
      `${found.file} holds the newest definition of submit_employer_contribution_run, `
        + `and it reads a per-member retirement percentage again.\n\n`
        + `Employer contribution runs must post split_retirement = the full leg and `
        + `split_emergency = 0 (see EMPLOYER_FUNDED_SPLIT). Allocating by the member's `
        + `contribution_schedules.retirement_pct lets them divert their employer's `
        + `pension money into a pot they can withdraw at any time — and nothing errors `
        + `when it happens, the run just succeeds with different numbers.\n\n`
        + `If you rewrote this function with CREATE OR REPLACE, you overwrote 0102 `
        + `rather than merging it.`,
    ).toBe(false);

    // …and it does post the whole leg.
    expect(found.body).toMatch(/v_retirement\s*:=\s*v_employee_leg\s*;/);
    expect(found.body).toMatch(/v_retirement\s*:=\s*v_employer_leg\s*;/);
  });

  it('the newest create_subscriber_from_employer_invite writes the member’s own 80 / 20 default', () => {
    const found = latestDefinitionOf('create_subscriber_from_employer_invite');
    expect(found, 'no migration defines create_subscriber_from_employer_invite').not.toBeNull();

    // It must not take the split from the signup payload — an older client or a
    // replayed localStorage draft can still carry one.
    expect(
      found.body.includes("v_sched ->> 'retirementPct'"),
      `${found.file} holds the newest definition of create_subscriber_from_employer_invite `
        + `and it takes the retirement split from the signup payload again. The invite UI `
        + `no longer collects one, so the value can only come from a stale client.`,
    ).toBe(false);

    // 80/20, NOT the employer allocation. The schedule row is the member's own
    // plan; pinning it to 100/0 would re-couple it to where their employer's
    // money happens to land, which is the coupling 0102 exists to remove.
    expect(found.body).toMatch(/retirement_pct[\s\S]{0,600}?VALUES[^;]*?,\s*80,\s*20,/);
    expect(found.body).not.toMatch(/VALUES[^;]*?,\s*100,\s*0,/);
  });

  it('the schedule default and the employer allocation are different constants', () => {
    // The whole decoupling in one assertion: if these two ever converge, someone
    // has substituted one for the other and the member's own split is once again
    // being decided by where their employer's money goes (or vice versa).
    expect(DEFAULT_SCHEDULE_SPLIT).toEqual({ retirementPct: 80, emergencyPct: 20 });
    expect(DEFAULT_SCHEDULE_SPLIT.retirementPct).not.toBe(EMPLOYER_FUNDED_SPLIT.retirementPct);
  });
});
