// Guardrail: the insurance-premium invariant in the seed/mock generator.
//
// THE RULE (see docs + audit 2026-07-05): a self-funded subscriber pays for
// insurance ONLY as a single ANNUAL premium (pay_now → one type='premium' row =
// premium_monthly * 12) or via save_to_cover accrual — NEVER a recurring monthly
// out-of-pocket premium. A recurring monthly 'premium' stream (the old model,
// method='Auto-debit') must never be generated again. Monthly premiums are
// legitimate ONLY when the EMPLOYER funds them (type='insurance_premium'), which
// this per-subscriber generator never emits.

import { describe, it, expect } from 'vitest';
import { SUBSCRIBERS } from '../mockData';

const subs = Object.values(SUBSCRIBERS);
const ANNUAL_PREMIUM = 2000 * 12; // the seed's single self-pay premium rate × 12

describe('mockData insurance-premium invariant (self-pay is annual, never monthly)', () => {
  it('generates a demo population', () => {
    expect(subs.length).toBeGreaterThan(0);
  });

  it('no subscriber has more than ONE self-paid premium row (no monthly stream)', () => {
    const offenders = subs
      .map((s) => ({ id: s.id, n: (s.transactions ?? []).filter((t) => t.type === 'premium').length }))
      .filter((x) => x.n > 1);
    expect(offenders).toEqual([]);
  });

  it("no premium row uses the deprecated monthly 'Auto-debit' method", () => {
    const autoDebit = subs.flatMap((s) =>
      (s.transactions ?? []).filter((t) => t.type === 'premium' && t.method === 'Auto-debit'),
    );
    expect(autoDebit).toEqual([]);
  });

  it('every self-paid premium row is the ANNUAL amount (premium_monthly × 12), not a monthly figure', () => {
    const wrong = subs.flatMap((s) =>
      (s.transactions ?? [])
        .filter((t) => t.type === 'premium')
        .filter((t) => Number(t.amount) !== ANNUAL_PREMIUM)
        .map((t) => ({ id: s.id, amount: t.amount })),
    );
    expect(wrong).toEqual([]);
  });

  it('the save-to-cover demo (s-0002) has NO upfront premium row', () => {
    const demo = SUBSCRIBERS['s-0002'];
    expect(demo).toBeTruthy();
    expect((demo.transactions ?? []).filter((t) => t.type === 'premium')).toEqual([]);
  });
});
