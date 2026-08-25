// Unit tests for isInsured — the agent-side "has active cover" predicate shared
// by the Home insurance card counts and the Insured / Uninsured drill-downs.
// Regression guard for the 2026-07-02 audit fix: it must count ANY active
// product (life / health / funeral), not life only, so a member with only
// health/funeral cover isn't mislabelled "Uninsured".
import { describe, it, expect } from 'vitest';
import { isInsured, deriveMonthAnchors, monthStartMs, sumContributions } from './agentHomeSummary';

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

// Regression guard for A11-007: "this month" used to resolve to two different
// calendar months on the same agent dashboard (onboarding anchored to the
// latest registration date, contributions anchored to the latest contribution
// date — independently, so they could land in different months). Both fields
// must now always agree.
describe('deriveMonthAnchors', () => {
  it('returns the SAME anchor for onboarding and contributions even when the two dimensions latest-activity months differ', () => {
    const subscribers = [
      // Latest registration: August. Latest contribution: June. Before the
      // fix this produced onboardStart=August, contribStart=June — the exact
      // "Contributions=June, Onboarded=August" split the audit flagged.
      { registeredDate: '2026-08-07', lastContributionDate: '2026-06-15' },
      { registeredDate: '2026-01-18', lastContributionDate: '2026-04-02' },
    ];
    const { onboardStart, contribStart } = deriveMonthAnchors(subscribers);
    expect(onboardStart).toBe(contribStart);
    // The shared anchor is the LATER of the two dimensions' latest activity
    // (August), not the earlier one — an honest "most recent thing we've seen
    // in this book", not a silent regression to whichever is smaller.
    expect(onboardStart).toBe(monthStartMs(new Date('2026-08-07').getTime()));
  });

  it('still anchors to the epoch month when the book is empty', () => {
    const { onboardStart, contribStart } = deriveMonthAnchors([]);
    expect(onboardStart).toBe(contribStart);
    // monthStartMs(0) itself (not a literal 0) — the test-runner's local
    // timezone offsets the epoch's *month start* away from ms 0.
    expect(onboardStart).toBe(monthStartMs(0));
  });
});

// Regression guard for A11-003: the agent Home DESKTOP tile showed a
// SCHEDULED figure (computeAgentHomeSummary's `monthly`) captioned "What
// members saved this month" — a projection presented as a completed fact.
// sumContributions is the real, ACTUAL-collected figure (mobile already used
// it inline; desktop now shares this implementation).
describe('sumContributions', () => {
  it('sums the .amount field across contribution transactions', () => {
    const contributions = [{ amount: 50_000 }, { amount: 120_000 }, { amount: 121_000 }];
    expect(sumContributions(contributions)).toBe(291_000);
  });

  it('treats a missing/undefined amount as 0 rather than NaN', () => {
    expect(sumContributions([{ amount: 10_000 }, {}, { amount: undefined }])).toBe(10_000);
  });

  it('is 0 for no contributions (not the scheduled figure, and not NaN)', () => {
    expect(sumContributions([])).toBe(0);
    expect(sumContributions()).toBe(0);
  });
});
