import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The price field is <input type="number" step="0.01">. userEvent.clear() cannot
// clear a number input under jsdom, so typing APPENDS — producing a value like
// 1565.02158 that violates `step` and makes jsdom's constraint validation block
// the submit silently. Set these fields directly instead.
const setValue = (el, value) => fireEvent.change(el, { target: { value } });
import { describe, it, expect, vi, beforeEach } from 'vitest';

// recharts needs a measured container, which jsdom never provides. Every other
// chart-bearing page test in this repo stubs it; the chart is not what is under
// test here — the money guard-rails are.
vi.mock('recharts', () => {
  const Passthrough = ({ children }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Passthrough,
    AreaChart: Passthrough,
    Area: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
  };
});

// `getPendingPricingSummary` was missing from this mock, which is worse than it
// sounds: usePendingPricingSummary's queryFn then threw a TypeError, `pending.data`
// stayed undefined, and the "money waiting on a price" notice silently never
// rendered — so the block telling an admin what Publish is about to do to
// members' money was covered by exactly nothing.
vi.mock('../../services/nav', () => ({
  DEFAULT_FUND: 'UPU-BAL',
  getNavOverview: vi.fn(),
  listNavSnapshots: vi.fn(),
  publishNavSnapshot: vi.fn(),
  getPendingPricingSummary: vi.fn(),
}));

const nav = await import('../../services/nav');
const { ToastProvider } = await import('../../contexts/ToastContext');
const { default: AdminNavDesktop } = await import('./AdminNavDesktop');

const OVERVIEW = {
  fundCode: 'UPU-BAL',
  currentNav: 1565.02,
  currentNavDate: '2026-08-07',
  previousNav: 1562.7,
  previousNavDate: '2026-08-06',
  changeAbs: 2.32,
  changePct: 0.15,
  unitsInIssue: 1549835,
  aum: 2425500000,
  totalInvested: 2221500000,
  totalGrowth: 204000000,
  growthPct: 9.19,
  avgGrowthPct: 9.38,
  membersPriced: 5060,
  membersUnpriced: 0,
  membersWithBasis: 5059,
  firstNavDate: '2021-11-01',
  publishedCount: 1240,
  pendingDays: 4,
  lastPublishedDaysAgo: 1,
  series: [
    { date: '2026-08-05', unitPrice: 1560.1, aum: null },
    { date: '2026-08-06', unitPrice: 1562.7, aum: null },
    { date: '2026-08-07', unitPrice: 1565.02, aum: 2425500000 },
  ],
};

const ROWS = {
  rows: [
    {
      id: 'nav-1', navDate: '2026-08-07', unitPrice: 1565.02, previousUnitPrice: 1562.7,
      changePct: 0.15, status: 'published', publishedAt: '2026-08-07T18:00:00Z',
      publishedBy: 'Admin', source: 'admin_manual', unitsInIssue: 1549835, aum: 2425500000,
    },
    {
      id: 'nav-2', navDate: '2026-08-08', unitPrice: 1000, previousUnitPrice: null,
      changePct: null, status: 'pending', publishedAt: null, publishedBy: null,
      source: 'fund_admin_feed', unitsInIssue: null, aum: null,
    },
  ],
  total: 2,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        {/* Rendered directly, not via AdminDashboardShell: src/test/setup.js stubs
            matchMedia to matches:false, so the shell would pick the mobile tree. */}
        <AdminNavDesktop fullPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// The empty queue is the DEFAULT because it is the ordinary state — the notice
// must stay invisible until there is genuinely member money waiting.
const EMPTY_PENDING = {
  fundCode: 'UPU-BAL',
  pendingContributions: 0, pendingContributionValue: 0,
  pendingRedemptions: 0, pendingRedemptionValue: 0,
  releasableNow: 0, oldestPendingBusinessDays: 0, maxPendingDays: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  nav.getNavOverview.mockResolvedValue(OVERVIEW);
  nav.listNavSnapshots.mockResolvedValue(ROWS);
  nav.getPendingPricingSummary.mockResolvedValue(EMPTY_PENDING);
  nav.publishNavSnapshot.mockResolvedValue({
    id: 'nav-1', navDate: '2026-08-08', unitPrice: 1600, previousUnitPrice: 1565.02,
    changePct: 2.23, revalued: true, unitsInIssue: 1549835, aum: 2479736000, membersPriced: 5060,
  });
});

describe('AdminNavDesktop', () => {
  // The tile must report the AVERAGE of each member's own growth, not the pooled
  // total-growth-over-total-basis figure — they are genuinely different numbers
  // (9.38% vs 9.19% here) and only the first is a fact about members.
  it('reports average growth PER MEMBER, with the pooled fund figure alongside', async () => {
    renderPage();
    // Tile labels render during loading, so wait for the data before asserting
    // on values — otherwise this reads the '—' placeholder.
    await screen.findAllByText('UGX 1,565.02');
    expect(screen.getByText('Average growth per member')).toBeInTheDocument();
    expect(screen.getByText('+9.38%')).toBeInTheDocument();
    expect(screen.getByText(/Across 5,059 members · whole fund \+9\.19%/)).toBeInTheDocument();
  });

  it('shows the current price, the fund size and the unpriced-day count', async () => {
    renderPage();
    // The price appears in the hero AND in the history row — assert on both.
    expect(await screen.findAllByText('UGX 1,565.02')).not.toHaveLength(0);
    expect(screen.getByText('Money in the fund')).toBeInTheDocument();
    expect(screen.getByText('Days not priced')).toBeInTheDocument();
    // Sourced from get_nav_overview, NOT get_admin_attention — the page must work
    // whether or not the admin-attention migrations are applied.
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('seeds the price field from the current price so the admin edits from it', async () => {
    renderPage();
    // The form renders during loading, so the field exists before the price does —
    // wait for the data, then assert the seed.
    await screen.findAllByText('UGX 1,565.02');
    const input = screen.getByLabelText(/price of one unit in shillings/i);
    await waitFor(() => expect(input).toHaveValue(1565.02));
  });

  it('publishes a small move without asking for confirmation', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/price of one unit in shillings/i);
    setValue(input, '1580');
    await user.click(screen.getByRole('button', { name: /publish price/i }));

    await waitFor(() => expect(nav.publishNavSnapshot).toHaveBeenCalledTimes(1));
    expect(nav.publishNavSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ unitPrice: 1580, confirmMove: false }),
    );
  });

  // A >10% move revalues every member's savings by >10%. It must not be one click.
  it('demands confirmation for a move over 10% and passes confirmMove through', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText(/price of one unit in shillings/i);
    setValue(input, '2000');                  // +27.8%
    await user.click(screen.getByRole('button', { name: /publish price/i }));

    expect(await screen.findByText(/this is a big change/i)).toBeInTheDocument();
    expect(nav.publishNavSnapshot).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /yes, publish it/i }));
    await waitFor(() => expect(nav.publishNavSnapshot).toHaveBeenCalledTimes(1));
    expect(nav.publishNavSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ unitPrice: 2000, confirmMove: true }),
    );
  });

  // Two independent layers stop a future date: the input's `max` attribute (the
  // browser refuses to submit at all) and the JS guard behind it. A third lives
  // in the RPC. Assert the guarantee — the server is never asked — rather than
  // which layer won, since that differs between jsdom and a real browser.
  it('never sends a future date to the server', async () => {
    const user = userEvent.setup();
    renderPage();
    const date = await screen.findByLabelText(/valuation day/i);
    expect(date).toHaveAttribute('max');
    setValue(date, '2099-01-01');
    await user.click(screen.getByRole('button', { name: /publish price/i }));

    await new Promise((r) => { setTimeout(r, 50); });
    expect(nav.publishNavSnapshot).not.toHaveBeenCalled();
  });

  it('surfaces the RPC message when the server rejects the publish', async () => {
    const user = userEvent.setup();
    const err = new Error('price move of 42% from 1565.02 on 2026-08-07 needs confirmation');
    err.code = 'P0001';
    nav.publishNavSnapshot.mockRejectedValueOnce(err);

    renderPage();
    const input = await screen.findByLabelText(/price of one unit in shillings/i);
    setValue(input, '1580');
    await user.click(screen.getByRole('button', { name: /publish price/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/needs confirmation/i);
  });

  it('renders an unpriced day as "—" rather than inventing a price', async () => {
    renderPage();
    await screen.findAllByText('UGX 1,565.02');
    // "Not priced" is also a filter chip, so scope the assertion to the table.
    const table = screen.getByRole('table');
    expect(within(table).getByText('Not priced')).toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows an error card when the overview cannot load', async () => {
    nav.getNavOverview.mockRejectedValueOnce(new Error('nope'));
    renderPage();
    expect(await screen.findByText(/could not load the unit price/i)).toBeInTheDocument();
  });
});
