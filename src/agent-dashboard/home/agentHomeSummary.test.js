// Unit tests for isInsured — the agent-side "has active cover" predicate shared
// by the Home insurance card counts and the Insured / Uninsured drill-downs.
// Regression guard for the 2026-07-02 audit fix: it must count ANY active
// product (life / health / funeral), not life only, so a member with only
// health/funeral cover isn't mislabelled "Uninsured".
import { describe, it, expect } from 'vitest';
import { isInsured } from './agentHomeSummary';

// Agent-facing policies carry product + status only (buildAgentPolicies), never
// cover amounts — the predicate keys off status alone.
const withPolicies = (policies) => ({ id: 's', policies });

describe('isInsured', () => {
  it('is true for an active life policy', () => {
    expect(isInsured(withPolicies([{ product: 'life', status: 'active' }]))).toBe(true);
  });

  it('is true for a member with only active health/funeral (no life)', () => {
    expect(isInsured(withPolicies([{ product: 'health', status: 'active' }]))).toBe(true);
    expect(isInsured(withPolicies([{ product: 'funeral', status: 'active' }]))).toBe(true);
  });

  it('is false with no active policies', () => {
    expect(isInsured(withPolicies([]))).toBe(false);
    expect(isInsured(withPolicies([{ product: 'life', status: 'expired' }]))).toBe(false);
  });

  it('treats null/absent policies (e.g. RLS-filtered) as uninsured', () => {
    expect(isInsured(null)).toBe(false);
    expect(isInsured({ id: 's' })).toBe(false);
  });
});
