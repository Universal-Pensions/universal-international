// The contribution-history drill-down only earns the name if its totals are the
// SAME money as the Overview tiles the employer clicked to get here. The tiles
// sum the run headers (Σ runs.employeeTotal / Σ runs.employerTotal); this page
// sums the individual payments those runs posted. If the two ever disagree the
// drill-down is lying, so pin the identity against the real seed.
//
// Pinned on the MOCK path: the identity is a property of the seeded data, which
// employerSeed.js builds legs-and-headers in one pass precisely so the two agree.
// (Without this the suite would reach the real Supabase with an anonymous client
// and be refused by RLS — a network round-trip, not a test.) The live path runs
// the same arithmetic over the same two shapes.

import { vi, describe, it, expect } from 'vitest';

vi.mock('@/services/api', () => ({ IS_SUPABASE_ENABLED: false }));
vi.mock('../../services/api', () => ({ IS_SUPABASE_ENABLED: false }));

const { getEmployerContributions, getContributionRuns } = await import('../../services/employer');
const { EMPLOYER } = await import('../../data/employerSeed');
const { normalizeLeg } = await import('./useContributionHistory');

const sum = (rows) => rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);

describe('contribution history ↔ Overview tiles', () => {
  it('sums to exactly the run headers, leg by leg', async () => {
    const [payments, runs] = await Promise.all([
      getEmployerContributions(EMPLOYER.id),
      getContributionRuns(EMPLOYER.id),
    ]);

    expect(payments.length).toBeGreaterThan(0);

    const employeeTile = runs.reduce((s, r) => s + (r.employeeTotal || 0), 0);
    const employerTile = runs.reduce((s, r) => s + (r.employerTotal || 0), 0);

    expect(sum(payments.filter((p) => p.source !== 'employer'))).toBe(employeeTile);
    expect(sum(payments.filter((p) => p.source === 'employer'))).toBe(employerTile);
    expect(sum(payments)).toBe(employeeTile + employerTile);
  });

  it('excludes insurance premiums and out-of-run top-ups', async () => {
    const payments = await getEmployerContributions(EMPLOYER.id);
    // Premiums are employer money too, but they buy cover rather than fund a
    // pension — counting them here would break the identity above.
    expect(payments.every((p) => p.type === 'contribution')).toBe(true);
    expect(payments.every((p) => !!p.contributionRunId)).toBe(true);
    // Withdrawals are in the same table with a negative amount — never here.
    expect(payments.every((p) => Number(p.amount) > 0)).toBe(true);
  });

  it('names every payment with a member', async () => {
    const payments = await getEmployerContributions(EMPLOYER.id);
    expect(payments.every((p) => !!p.memberName)).toBe(true);
  });

  it('returns newest-first so the history reads top-down', async () => {
    const payments = await getEmployerContributions(EMPLOYER.id);
    const dates = payments.map((p) => String(p.date));
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('returns nothing without an employer in scope', async () => {
    expect(await getEmployerContributions(undefined)).toEqual([]);
  });
});

describe('normalizeLeg', () => {
  it('accepts the three real legs', () => {
    expect(normalizeLeg('employee')).toBe('employee');
    expect(normalizeLeg('employer')).toBe('employer');
    expect(normalizeLeg('all')).toBe('all');
  });

  it('falls back to the unfiltered view for junk in the URL', () => {
    // ?leg=<anything else> must not blank the page out.
    expect(normalizeLeg('EMPLOYEE')).toBe('all');
    expect(normalizeLeg('insurance')).toBe('all');
    expect(normalizeLeg(null)).toBe('all');
    expect(normalizeLeg('')).toBe('all');
  });
});
