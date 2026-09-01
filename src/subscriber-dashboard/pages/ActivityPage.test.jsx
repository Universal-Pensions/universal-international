// RTL tests for ActivityPage — specifically the PRICING lifecycle on the mobile
// Activity tab.
//
// Why this file exists: forward dealing (0143-0161) gave a contribution a second
// state. `status` says whether the money moved; `pricingStatus` says whether it
// has bought savings yet. Phase 5 taught the desktop report to show the second
// one (AllTransactions -> transactionState + DealingDateNote) and left the mobile
// Activity tab rendering label / method / reference / amount / date only — so a
// contribution still waiting for a price looked EXACTLY like one already
// invested. On a phone-first product for members in Uganda, Activity is the tab
// people open to ask "where is my money?", and it was the one surface that could
// not answer.
//
// The data was never the problem: services/subscriber.js has selected
// `dealing_date` and `pricing_status` since 0144, and ActivityPage already reads
// the same useSubscriberTransactions hook AllTransactions does. It was purely a
// rendering omission, which is exactly the kind that survives a review — nothing
// is wrong on screen, something is just absent.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useSubscriberTransactions: vi.fn(),
}));

const { useCurrentSubscriber, useSubscriberTransactions } = await import('../../hooks/useSubscriber');
const { default: ActivityPage } = await import('./ActivityPage');

const SETTLED = {
  id: 't-settled',
  type: 'contribution',
  source: 'own',
  amount: 500000,
  date: '2026-08-28',
  status: 'settled',
  pricingStatus: 'priced',
  method: 'MTN Mobile Money',
  reference: 'TXN-100',
};

const WAITING = {
  id: 't-waiting',
  type: 'contribution',
  source: 'own',
  amount: 100000,
  date: '2026-09-01',
  status: 'settled',
  // Paid in after the 14:00 Kampala cutoff on a Friday: the money is ours, it
  // buys savings on Monday.
  pricingStatus: 'pending',
  dealingDate: '2026-09-07',
  method: 'Airtel Money',
  reference: 'TXN-101',
};

function renderPage(transactions) {
  useCurrentSubscriber.mockReturnValue({ data: { id: 'sub-1' }, isLoading: false, isError: false });
  useSubscriberTransactions.mockReturnValue({ data: transactions, isLoading: false });
  return render(
    <MemoryRouter>
      <ActivityPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<ActivityPage /> — money that has not bought savings yet', () => {
  it('says so, in words, on a contribution that is still waiting for a price', () => {
    renderPage([WAITING]);
    expect(screen.getByText('Being put into savings')).toBeInTheDocument();
  });

  it('says WHEN it starts working, not just that it is waiting', () => {
    renderPage([WAITING]);
    // The pill alone tells a member their money is in limbo without saying for
    // how long, which is the question they actually have. The sentence names the
    // weekday deliberately: "07/09" does not tell someone whether that is soon.
    //
    // The comma is optional in the pattern on purpose — en-UG renders
    // "Monday, 7 September 2026", but this test is pinning the PROMISE, not
    // Intl's punctuation, and it should not break if that ever shifts.
    expect(
      screen.getByText(/We have your money\. It goes into your savings on Monday,? 7 September/),
    ).toBeInTheDocument();
  });

  it('uses plain money words — no "unit", "NAV", "dealing date" or "allocation"', () => {
    const { container } = renderPage([WAITING]);
    const text = container.textContent;
    // The language bar for this product (feedback: plain language for Uganda).
    // A member with low literacy reads this screen; a term of art here is a
    // defect, not a style preference.
    for (const jargon of [/\bunit\b/i, /\bNAV\b/, /dealing date/i, /allocat/i, /T\+1/]) {
      expect(text).not.toMatch(jargon);
    }
  });

  it('leaves an ordinary settled row unbadged, so the waiting one stands out', () => {
    renderPage([SETTLED]);
    // Badging all 4,000 settled rows would bury the handful that need noticing.
    expect(screen.queryByText('Being put into savings')).not.toBeInTheDocument();
    expect(screen.queryByText('Settled')).not.toBeInTheDocument();
  });

  it('distinguishes the two in the same list', () => {
    renderPage([WAITING, SETTLED]);
    expect(screen.getAllByText('Being put into savings')).toHaveLength(1);
  });

  it('words an outgoing row as a payment being worked out, not as savings', () => {
    renderPage([{
      ...WAITING,
      id: 't-out',
      type: 'withdrawal',
      amount: -75000,
      dealingDate: '2026-09-07',
    }]);
    expect(screen.getByText('Working out your payment')).toBeInTheDocument();
    // "goes into your savings" would be exactly backwards for money leaving.
    expect(screen.queryByText(/goes into your savings/i)).not.toBeInTheDocument();
  });

  it('surfaces a reversed row, which a member has no other way to notice here', () => {
    renderPage([{ ...SETTLED, id: 't-rev', pricingStatus: 'reversed' }]);
    expect(screen.getByText('Reversed')).toBeInTheDocument();
  });

  it('renders a pre-unitization row exactly as before (null pricingStatus)', () => {
    // Every row written before 0144 has no pricing lifecycle. It must read the
    // way it always did rather than acquiring a badge retroactively.
    renderPage([{ ...SETTLED, id: 't-old', pricingStatus: null }]);
    expect(screen.queryByText('Being put into savings')).not.toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
  });
});
