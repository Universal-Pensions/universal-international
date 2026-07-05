// Unit tests for the contribution-schedule "settle this period" math.
import { describe, it, expect } from 'vitest';
import {
  paidThisMonth,
  contributionOwed,
  newlyAddedProducts,
  buildAnnualSettleLineItems,
} from './periodSettlement';
import { INSURANCE_PRODUCTS, annualPremium } from '../constants/savings';

const NOW = new Date(2026, 4, 26); // 2026-05-26 (the demo MOCK_NOW)

describe('paidThisMonth', () => {
  it('sums own contributions in the current month', () => {
    const txns = [
      { type: 'contribution', source: 'own', amount: 5000, date: '2026-05-02' },
      { type: 'contribution', source: 'own', amount: 3000, date: '2026-05-20' },
    ];
    expect(paidThisMonth(txns, NOW)).toBe(8000);
  });

  it('ignores employer-sourced contributions', () => {
    const txns = [
      { type: 'contribution', source: 'own', amount: 5000, date: '2026-05-02' },
      { type: 'contribution', source: 'employer', amount: 9999, date: '2026-05-10' },
    ];
    expect(paidThisMonth(txns, NOW)).toBe(5000);
  });

  it('ignores other transaction types and other months', () => {
    const txns = [
      { type: 'contribution', source: 'own', amount: 5000, date: '2026-05-02' },
      { type: 'premium', source: 'own', amount: 2000, date: '2026-05-03' },
      { type: 'withdrawal', source: 'own', amount: 1000, date: '2026-05-04' },
      { type: 'contribution', source: 'own', amount: 7000, date: '2026-04-30' }, // last month
      { type: 'contribution', source: 'own', amount: 4000, date: '2026-06-01' }, // next month
    ];
    expect(paidThisMonth(txns, NOW)).toBe(5000);
  });

  it('returns 0 for empty / invalid input', () => {
    expect(paidThisMonth([], NOW)).toBe(0);
    expect(paidThisMonth(null, NOW)).toBe(0);
    expect(paidThisMonth([{ type: 'contribution', amount: 5000, date: 'not-a-date' }], NOW)).toBe(0);
  });
});

describe('contributionOwed', () => {
  it('owes the difference when the old amount is already paid (5k → 10k)', () => {
    expect(contributionOwed(10000, 5000)).toBe(5000);
  });

  it('owes the full amount when nothing is paid yet', () => {
    expect(contributionOwed(10000, 0)).toBe(10000);
  });

  it('owes nothing when already covered or over-paid', () => {
    expect(contributionOwed(10000, 10000)).toBe(0);
    expect(contributionOwed(10000, 15000)).toBe(0);
  });
});

describe('newlyAddedProducts', () => {
  it('returns products in next not already held', () => {
    expect(newlyAddedProducts(['life'], ['life', 'health', 'funeral'])).toEqual(['health', 'funeral']);
  });

  it('returns nothing when no new products are added', () => {
    expect(newlyAddedProducts(['life', 'health'], ['life'])).toEqual([]);
    expect(newlyAddedProducts(['life'], ['life'])).toEqual([]);
  });

  it('treats missing prev/next as empty', () => {
    expect(newlyAddedProducts(undefined, ['health'])).toEqual(['health']);
    expect(newlyAddedProducts(['life'], undefined)).toEqual([]);
  });

  it('adds nothing when a fully-held plan is re-saved unchanged (no double-charge)', () => {
    // The form now pre-checks held products from the SAME active-policy set the
    // settle flow diffs against, so an untouched re-save yields no new product.
    expect(newlyAddedProducts(['life', 'health', 'funeral'], ['life', 'health', 'funeral'])).toEqual([]);
  });
});

describe('buildAnnualSettleLineItems (0072/0073 annual model)', () => {
  const HEALTH = INSURANCE_PRODUCTS.find((p) => p.id === 'health');
  const FUNERAL = INSURANCE_PRODUCTS.find((p) => p.id === 'funeral');

  it('Route A (pay now) charges the ANNUAL premium per added product', () => {
    const { lineItems, total, insuranceTotal } = buildAnnualSettleLineItems({
      owed: 5000,
      addedProducts: [HEALTH, FUNERAL],
      payNow: true,
    });
    // contribution + 2 insurance lines
    expect(lineItems).toHaveLength(3);
    const ins = lineItems.filter((li) => li.kind === 'insurance');
    expect(ins[0].amount).toBe(annualPremium(HEALTH)); // 60,000, NOT 5,000/mo
    expect(ins[1].amount).toBe(annualPremium(FUNERAL)); // 18,000
    expect(insuranceTotal).toBe(annualPremium(HEALTH) + annualPremium(FUNERAL));
    expect(total).toBe(5000 + annualPremium(HEALTH) + annualPremium(FUNERAL));
  });

  it('Route B (save up) charges NOTHING for insurance — only the owed contribution', () => {
    const { lineItems, total, insuranceTotal } = buildAnnualSettleLineItems({
      owed: 5000,
      addedProducts: [HEALTH, FUNERAL],
      payNow: false,
    });
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0].kind).toBe('contribution');
    expect(insuranceTotal).toBe(0);
    expect(total).toBe(5000);
  });

  it('Route B with no owed contribution settles to zero (no sheet needed)', () => {
    const { lineItems, total } = buildAnnualSettleLineItems({
      owed: 0,
      addedProducts: [HEALTH],
      payNow: false,
    });
    expect(lineItems).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('Route A insurance-only (no owed) totals the annual premium', () => {
    const { total, insuranceTotal } = buildAnnualSettleLineItems({
      owed: 0,
      addedProducts: [FUNERAL],
      payNow: true,
    });
    expect(total).toBe(annualPremium(FUNERAL));
    expect(insuranceTotal).toBe(annualPremium(FUNERAL));
  });

  it('resolves the human product name for the settle label from a bare {product} config', () => {
    // The page emits added products as { product, cover, premiumMonthly } (no label),
    // so the builder must look up the display name — never render the raw enum id.
    const { lineItems } = buildAnnualSettleLineItems({
      owed: 0,
      addedProducts: [{ product: 'life', cover: 1_000_000, premiumMonthly: 2_000 }],
      payNow: true,
    });
    expect(lineItems[0].label).toBe('Life insurance · one year');
    expect(lineItems[0].label).not.toMatch(/^life ·/); // not the raw id
  });
});
