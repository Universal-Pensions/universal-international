// The sentence that tells an admin what Publish is about to do to MEMBERS'
// money — as opposed to what it does to the price register.
//
// It had no coverage at all while it lived inline in AdminNavDesktop, and could
// not have had any: that page's test mocked `../../services/nav` without
// `getPendingPricingSummary`, so the hook's queryFn threw, `pending.data` stayed
// undefined and the whole block was unreachable from a test. Extracting it here
// (so the phone can show the identical sentence) is also what makes it testable.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PendingPricingNote from './PendingPricingNote';

const BASE = {
  fundCode: 'UPU-BAL',
  pendingContributions: 0, pendingContributionValue: 0,
  pendingRedemptions: 0, pendingRedemptionValue: 0,
  releasableNow: 0, oldestPendingBusinessDays: 0, maxPendingDays: 3,
};

describe('<PendingPricingNote />', () => {
  it('renders nothing when no money is waiting', () => {
    const { container } = render(<PendingPricingNote summary={BASE} />);
    // Callers drop this in unguarded; an empty queue must leave no trace.
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the summary has not loaded', () => {
    const { container } = render(<PendingPricingNote summary={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the count and the value of money waiting to go in', () => {
    render(<PendingPricingNote summary={{
      ...BASE, pendingContributions: 3, pendingContributionValue: 450000,
    }} />);
    expect(screen.getByText(/3/)).toBeInTheDocument();
    expect(screen.getByText(/UGX\s*450,000/)).toBeInTheDocument();
  });

  it('says plainly when nothing can be settled yet', () => {
    render(<PendingPricingNote summary={{
      ...BASE, pendingContributions: 2, pendingContributionValue: 100000, releasableNow: 0,
    }} />);
    // The admin needs to know that pressing Publish will NOT clear this queue,
    // because these payments belong to a day that still has no price.
    expect(
      screen.getByText(/None of them can be settled until their own day has a price/),
    ).toBeInTheDocument();
  });

  it('says how many this publish would actually release', () => {
    render(<PendingPricingNote summary={{
      ...BASE, pendingContributions: 5, pendingContributionValue: 100000, releasableNow: 2,
    }} />);
    expect(screen.getByText(/2 of them can be settled now/)).toBeInTheDocument();
  });

  it('handles money going OUT with no money coming in', () => {
    // The inline version this replaced always emitted the "payments in" clause,
    // so a queue of pure redemptions read "0 payments in worth UGX 0, and ...".
    render(<PendingPricingNote summary={{
      ...BASE, pendingRedemptions: 2, pendingRedemptionValue: 75000,
    }} />);
    const text = screen.getByText(/Waiting on a price/).textContent;
    expect(text).toMatch(/2 payments out worth/);
    expect(text).not.toMatch(/0 payments in/);
  });

  it('gets singular and plural right', () => {
    render(<PendingPricingNote summary={{
      ...BASE, pendingContributions: 1, pendingContributionValue: 50000,
    }} />);
    const text = screen.getByText(/Waiting on a price/).textContent;
    expect(text).toMatch(/1 payment in worth/);
    expect(text).not.toMatch(/1 payments in/);
  });

  it('stays quiet about the oldest item until it is genuinely overdue', () => {
    // An ordinary overnight queue is 1 working day old. Warning about that on
    // every publish would train the admin to ignore the line that matters.
    const { rerender } = render(<PendingPricingNote summary={{
      ...BASE, pendingContributions: 1, pendingContributionValue: 1,
      oldestPendingBusinessDays: 3, maxPendingDays: 3,
    }} />);
    expect(screen.queryByText(/has been waiting/)).not.toBeInTheDocument();

    rerender(<PendingPricingNote summary={{
      ...BASE, pendingContributions: 1, pendingContributionValue: 1,
      oldestPendingBusinessDays: 4, maxPendingDays: 3,
    }} />);
    expect(screen.getByText(/oldest has been waiting 4 working days/)).toBeInTheDocument();
  });

  it('does not warn when the fund has no max-pending rule configured', () => {
    // maxPendingDays 0 would make every queue "overdue" against a `>` compare.
    render(<PendingPricingNote summary={{
      ...BASE, pendingContributions: 1, pendingContributionValue: 1,
      oldestPendingBusinessDays: 9, maxPendingDays: 0,
    }} />);
    expect(screen.queryByText(/has been waiting/)).not.toBeInTheDocument();
  });
});
