import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import NeedsAttentionCard, { NeedsAttentionPill } from '../NeedsAttentionCard';
import { ATTENTION_TYPES, computeAdminAttention } from '../adminAttentionDerive';

const payload = {
  dormantSubscribers: 1096,
  delayedEmployerTransfers: 3,
  delayedNav: 4,
  pendingAccessRequests: 4,
  underperformingDistributors: 1,
  delayedInsurancePayouts: 11,
  delayedWithdrawals: { total: 14, retirement: 5, emergency: 9 },
  delayedCustodyTransfers: 4,
  reconciliation: { total: 10, userWise: 7, transactionWise: 3 },
  thresholds: { withdrawalSlaDays: 5, claimSlaDays: 10, underperformActiveRatePct: 60 },
};

const renderCard = (props = {}, items = computeAdminAttention(payload, { openComplaints: 6 })) =>
  render(
    <MemoryRouter>
      <NeedsAttentionCard items={items} {...props} />
    </MemoryRouter>,
  );

describe('NeedsAttentionCard', () => {
  it('renders all ten signals as one flat, interactive level', () => {
    renderCard();
    expect(screen.getAllByRole('button')).toHaveLength(10);

    for (const label of [
      'Dormant subscribers', 'Delayed employer transfers', 'Delayed NAV updation',
      'Pending complaints', 'Pending access requests', 'Underperforming distributors',
      'Delayed insurance payouts', 'Delayed withdrawal payouts',
      'Delayed transfers to custody bank', 'Reconciliation issues',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('does not nest retirement / emergency rows under the withdrawals row', () => {
    renderCard();
    expect(screen.queryByText('Retirement payout')).not.toBeInTheDocument();
    expect(screen.queryByText('Emergency payout')).not.toBeInTheDocument();
    // The backlog is still reported in full, as one number.
    expect(screen.getByLabelText(/Delayed withdrawal payouts: 14/i)).toBeInTheDocument();
  });

  it('keeps a zero-valued signal visible with a Clear pill rather than hiding it', () => {
    renderCard({}, computeAdminAttention({ ...payload, delayedNav: 0 }, { openComplaints: 6 }));
    expect(screen.getByText('Delayed NAV updation')).toBeInTheDocument();
    expect(screen.getByLabelText(/Delayed NAV updation: clear/i)).toBeInTheDocument();
  });

  it('formats large counts with a thousands separator', () => {
    renderCard();
    expect(screen.getByText('1,096')).toBeInTheDocument();
  });

  it('renders a button and calls onSelect when hrefFor gives no URL', async () => {
    const onSelect = vi.fn();
    renderCard({ onSelect, hrefFor: () => null });

    await userEvent.click(screen.getByLabelText(/Delayed NAV updation/i));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].type).toBe(ATTENTION_TYPES.NAV);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders a link when hrefFor gives a URL', () => {
    renderCard({ hrefFor: (i) => `/dashboard/attention/${i.type}` });

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(10);
    expect(screen.getByLabelText(/Delayed NAV updation/i))
      .toHaveAttribute('href', '/dashboard/attention/delayedNav');
    expect(screen.getByLabelText(/Delayed withdrawal payouts/i))
      .toHaveAttribute('href', '/dashboard/attention/delayedWithdrawals');
  });

  it('lets hrefFor mix links and buttons per row', () => {
    // The real callers do exactly this: the two signals with a purpose-built
    // panel go one way, the rest go the other.
    const onSelect = vi.fn();
    renderCard({
      onSelect,
      hrefFor: (i) => (i.type === ATTENTION_TYPES.ACCESS_REQUESTS ? '/dashboard/access-requests' : null),
    });

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getAllByRole('button')).toHaveLength(9);
  });

  it('drills the whole withdrawal backlog from its single row', async () => {
    const onSelect = vi.fn();
    renderCard({ onSelect, hrefFor: () => null });

    await userEvent.click(screen.getByLabelText(/Delayed withdrawal payouts/i));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].type).toBe(ATTENTION_TYPES.WITHDRAWALS);
  });

  it('renders nothing but the group when given no items', () => {
    renderCard({}, []);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('group')).toBeInTheDocument();
  });
});

describe('NeedsAttentionPill', () => {
  it('counts the non-clear signals', () => {
    // Only withdrawals are non-zero: 1 to action.
    render(<NeedsAttentionPill items={computeAdminAttention({
      delayedWithdrawals: { total: 14, retirement: 5, emergency: 9 },
    })} />);
    expect(screen.getByText('1 to action')).toBeInTheDocument();
  });

  it('reads "All clear" when every signal is clear', () => {
    render(<NeedsAttentionPill items={computeAdminAttention()} />);
    expect(screen.getByText('All clear')).toBeInTheDocument();
  });

  it('reports the full count when everything is firing', () => {
    render(<NeedsAttentionPill items={computeAdminAttention(payload, { openComplaints: 6 })} />);
    expect(screen.getByText('10 to action')).toBeInTheDocument();
  });
});
