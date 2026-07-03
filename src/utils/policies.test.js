// Unit tests for per-product policy derivation (migration 0063 model).
import { describe, it, expect } from 'vitest';
import {
  derivePolicies,
  derivePolicyStatus,
  activePolicies,
  activeCoverTotal,
  activeCoverProductsLabel,
} from './policies';

const NOW = new Date(2026, 4, 26); // 2026-05-26

function sub(insuranceProducts, extra = {}) {
  return { id: 'sub-1', insuranceProducts, ...extra };
}

describe('derivePolicyStatus', () => {
  it('is active while the renewal date is in the future', () => {
    expect(derivePolicyStatus({ renewalDate: '2027-05-01' }, NOW)).toBe('active');
  });
  it('is expired once the renewal date has passed', () => {
    expect(derivePolicyStatus({ renewalDate: '2025-01-01' }, NOW)).toBe('expired');
  });
});

describe('derivePolicies', () => {
  it('returns one policy per active product row', () => {
    const policies = derivePolicies(
      sub([
        { product: 'life', cover: 1_000_000, premiumMonthly: 2000, renewalDate: '2027-05-01' },
        { product: 'health', cover: 3_000_000, premiumMonthly: 5000, renewalDate: '2027-05-01' },
        { product: 'funeral', cover: 2_000_000, premiumMonthly: 1500, renewalDate: '2027-05-01' },
      ]),
      { now: NOW },
    );
    expect(policies.map((p) => p.type)).toEqual(['life', 'health', 'funeral']);
    const funeral = policies.find((p) => p.type === 'funeral');
    expect(funeral.cover).toBe(2_000_000);
    expect(funeral.renewalAmount).toBe(1500 * 12);
    expect(funeral.status).toBe('active');
  });

  it('marks a lapsed row expired and excludes cover<=0 rows', () => {
    const policies = derivePolicies(
      sub([
        { product: 'life', cover: 1_000_000, premiumMonthly: 2000, renewalDate: '2025-01-01' },
        { product: 'health', cover: 0, premiumMonthly: 5000, renewalDate: '2027-05-01' },
      ]),
      { now: NOW },
    );
    expect(policies).toHaveLength(1);
    expect(policies[0].type).toBe('life');
    expect(policies[0].status).toBe('expired');
  });

  it('does not invent a health policy when no health row exists', () => {
    const policies = derivePolicies(
      sub([{ product: 'life', cover: 1_000_000, premiumMonthly: 2000, renewalDate: '2027-05-01' }]),
      { now: NOW },
    );
    expect(policies.some((p) => p.type === 'health')).toBe(false);
  });

  it('falls back to the legacy single life record when insuranceProducts is empty', () => {
    const subscriber = sub([], {
      insurance: { cover: 1_000_000, premiumMonthly: 2000, renewalDate: '2027-05-01', status: 'active' },
    });
    const policies = derivePolicies(subscriber, { now: NOW });
    expect(policies).toHaveLength(1);
    expect(policies[0].type).toBe('life');
    expect(policies[0].cover).toBe(1_000_000);
  });

  it('applies a renewal override to reactivate a product', () => {
    const policies = derivePolicies(
      sub([{ product: 'funeral', cover: 2_000_000, premiumMonthly: 1500, renewalDate: '2025-01-01' }]),
      { now: NOW, renewalOverrides: { funeral: { renewalDate: '2027-06-01' } } },
    );
    expect(policies[0].status).toBe('active');
  });

  it('returns [] without a subscriber or now', () => {
    expect(derivePolicies(null, { now: NOW })).toEqual([]);
    expect(derivePolicies(sub([]), {})).toEqual([]);
  });
});

// These read the already-derived `policies` list (type + cover + status), the
// single source of truth every subscriber cover surface now shares.
describe('active-cover helpers', () => {
  const withPolicies = (policies) => ({ id: 'sub-1', policies });

  it('activePolicies returns only status==="active" rows', () => {
    const s = withPolicies([
      { type: 'life', cover: 1_000_000, status: 'active' },
      { type: 'health', cover: 3_000_000, status: 'expired' },
    ]);
    expect(activePolicies(s).map((p) => p.type)).toEqual(['life']);
  });

  it('activeCoverTotal sums cover across ALL active products, ignoring expired', () => {
    const s = withPolicies([
      { type: 'life', cover: 1_000_000, status: 'active' },
      { type: 'health', cover: 3_000_000, status: 'active' },
      { type: 'funeral', cover: 2_000_000, status: 'expired' },
    ]);
    expect(activeCoverTotal(s)).toBe(4_000_000);
  });

  it('activeCoverTotal is 0 for no policies / null subscriber', () => {
    expect(activeCoverTotal(withPolicies([]))).toBe(0);
    expect(activeCoverTotal(null)).toBe(0);
  });

  it('activeCoverProductsLabel joins active product names', () => {
    expect(activeCoverProductsLabel(withPolicies([
      { type: 'life', cover: 1, status: 'active' },
    ]))).toBe('Life');
    expect(activeCoverProductsLabel(withPolicies([
      { type: 'life', cover: 1, status: 'active' },
      { type: 'health', cover: 1, status: 'active' },
    ]))).toBe('Life & Health');
    expect(activeCoverProductsLabel(withPolicies([
      { type: 'life', cover: 1, status: 'active' },
      { type: 'health', cover: 1, status: 'active' },
      { type: 'funeral', cover: 1, status: 'active' },
    ]))).toBe('Life, Health & Funeral');
  });

  it('activeCoverProductsLabel is empty when nothing is active', () => {
    expect(activeCoverProductsLabel(withPolicies([
      { type: 'life', cover: 1, status: 'expired' },
    ]))).toBe('');
  });
});
