// Data-render test for AdminOverview — the rich admin dash-mode national landing.
// The shell test stubs this component out, so the audit flagged that no test proves
// it reads the PLATFORM-WIDE totals (usePlatformOverview: subscribers incl. the
// employer channel) rather than the agent-tree country rollup. This renders the REAL
// component with fixtures where ONLY usePlatformOverview carries the subscriber/agent
// counts, so the assertions prove the platform hook is the source.
//
// Also covers the Needs-attention rebuild: the ten platform signals replaced the
// four ad-hoc rows, and the "Today's snapshot" + "Top agents" cards were removed.

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatNumber } from '../../utils/currency';

const setAttentionType = vi.fn();
const setViewAccessRequestsOpen = vi.fn();
const setViewTicketsOpen = vi.fn();

vi.mock('../../contexts/DashboardContext', () => ({
  useDashboard: () => ({
    drillDown: vi.fn(),
    setViewSubscribersOpen: vi.fn(),
    setViewAgentsOpen: vi.fn(),
    setViewBranchesOpen: vi.fn(),
    setDrillTargetBranchId: vi.fn(),
    setDrillTargetAgentId: vi.fn(),
    setViewTicketsOpen,
  }),
}));
vi.mock('../../contexts/AdminPanelContext', () => ({
  useAdminPanel: () => ({
    setViewDistributorsOpen: vi.fn(),
    setViewEmployersOpen: vi.fn(),
    setViewAccessRequestsOpen,
    setAttentionType,
  }),
}));
vi.mock('../../hooks/useEntity', () => ({
  // Platform totals — the only source of subscriber/agent/channel counts.
  // A vi.fn() (not a plain arrow) so the A22-002 isLoading/isError/retry
  // suite below can override the return value per test; the DEFAULT (reset
  // in beforeEach) is the same fixture the pre-existing tests above rely on.
  usePlatformOverview: vi.fn(),
  // Country rollup — only the time-series fields are read from here.
  useEntityMetrics: () => ({
    data: {
      monthlyContributions: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120].map((n) => n * 1_000_000),
    },
  }),
  useChildren: () => ({ data: [] }),
  useChildrenMetrics: () => ({ data: {} }),
  // Employer-channel geo rollup — folded into `emptyRegions` so a region served
  // only by employers is not reported as having no members.
  useEmployerGeoRollup: () => ({ data: { byRegion: {}, byDistrict: {} } }),
  // Bounded server-side top-N (0077). Rows are display-ready incl. parentName.
  // Only branches are requested now — the Top agents table was removed.
  useTopEntities: () => ({
    data: [{ id: 'b1', name: 'Top Branch', parentId: 'd1', parentName: 'Kampala', managerName: 'Jane Doe', status: 'active', m: { totalSubscribers: 55, activeRate: 90, aum: 22_000_000, totalContributions: 20_000_000 } }],
  }),
}));
vi.mock('../../hooks/useAdminAttention', () => ({
  useAdminAttention: () => ({
    data: {
      dormantSubscribers: 1096,
      delayedEmployerTransfers: 3,
      delayedNav: 4,
      pendingAccessRequests: 4,
      underperformingDistributors: 1,
      delayedInsurancePayouts: 11,
      delayedWithdrawals: { total: 14, retirement: 5, emergency: 9 },
      delayedCustodyTransfers: 4,
      reconciliation: { total: 10, userWise: 7, transactionWise: 3 },
      inactiveBranches: 31,
      thresholds: { withdrawalSlaDays: 5, claimSlaDays: 10, underperformActiveRatePct: 60 },
    },
  }),
}));
vi.mock('../../hooks/useTickets', () => ({
  usePlatformTicketMetrics: () => ({ data: { openCount: 6, urgentOpenCount: 2 } }),
}));
vi.mock('../../dashboard/shared/MiniChart', () => ({ default: () => <div data-testid="mini-chart" /> }));

const { usePlatformOverview } = await import('../../hooks/useEntity');
const { default: AdminOverview } = await import('./AdminOverview');

const PLATFORM_FIXTURE = {
  totalSubscribers: 5060,
  activeSubscribers: 3959,
  inactiveSubscribers: 1101,
  aum: 1_889_000_000,
  totalContributions: 1_889_000_000,
  agents: 2043,
  branches: 318,
  distributors: 3,
  employers: 7,
  subscribersViaDistributor: 4500,
  subscribersViaEmployer: 500,
  subscribersDirect: 60,
};

const refetchPlatform = vi.fn();

// Reset to the successful-read baseline before every test — the A22-002 suite
// below overrides this per test via mockReturnValueOnce.
beforeEach(() => {
  refetchPlatform.mockClear();
  usePlatformOverview.mockReturnValue({
    data: PLATFORM_FIXTURE,
    isLoading: false,
    isError: false,
    error: null,
    refetch: refetchPlatform,
  });
});

const renderOverview = () => render(<MemoryRouter><AdminOverview /></MemoryRouter>);

describe('<AdminOverview />', () => {
  it('renders platform-wide totals (from usePlatformOverview), not the agent-tree rollup', () => {
    renderOverview();
    expect(screen.getByText('National Platform')).toBeInTheDocument();
    expect(screen.getByText('Platform Admin')).toBeInTheDocument();
    expect(screen.getByText('Platform network')).toBeInTheDocument();
    // Agents tile reads platform.agents (unique on the page).
    expect(screen.getByText(formatNumber(2043))).toBeInTheDocument();
    // Subscribers count reads platform.totalSubscribers (5,060 exists ONLY in the
    // platform mock, so this proves the platform hook is the source, not the country rollup).
    expect(screen.getAllByText(formatNumber(5060)).length).toBeGreaterThan(0);
    // Top-N table renders the RPC's display-ready rows incl. parentName.
    expect(screen.getByText('Top Branch')).toBeInTheDocument();
    expect(screen.getByText('Kampala')).toBeInTheDocument();
  });

  it('no longer renders the Today’s snapshot or Top agents cards', () => {
    renderOverview();
    expect(screen.queryByText(/Today’s snapshot/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Top agents')).not.toBeInTheDocument();
    expect(screen.queryByText(/Updated just now/i)).not.toBeInTheDocument();
  });

  it('renders all ten Needs-attention signals as one flat level', () => {
    renderOverview();
    for (const label of [
      'Dormant subscribers', 'Delayed employer transfers', 'Delayed NAV updation',
      'Pending complaints', 'Pending access requests', 'Underperforming distributors',
      'Delayed insurance payouts', 'Delayed withdrawal payouts',
      'Delayed transfers to custody bank', 'Reconciliation issues',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('10 to action')).toBeInTheDocument();
    // The retirement / emergency bifurcation was removed — one row, one drill.
    expect(screen.queryByText('Retirement payout')).not.toBeInTheDocument();
    expect(screen.queryByText('Emergency payout')).not.toBeInTheDocument();
  });

  it('opens the second column with Needs attention, level with the health score', () => {
    // Needs attention used to sit BELOW Platform network in the right-hand
    // column, which buried the one card asking the admin to act. Platform
    // network moved under the health score so that column can start with it.
    renderOverview();

    const cardOf = (text) => screen.getByText(text).closest('section');
    const health = cardOf('Platform Health Score');
    const network = cardOf('Platform network');
    const attention = cardOf('Needs attention');

    // Same column, network directly after the score.
    expect(network.parentElement).toBe(health.parentElement);
    expect(health.nextElementSibling).toBe(network);

    // Attention is the other column's first card, so it starts level with the
    // score rather than after three cards of shortcuts.
    expect(attention.parentElement).not.toBe(health.parentElement);
    expect(attention.parentElement.firstElementChild).toBe(attention);
  });

  it('accents the Needs-attention card while signals are firing', () => {
    // Ten signals fire in the fixture, so the card carries the accent class on
    // top of the shared card class every other card gets on its own.
    renderOverview();
    const attention = screen.getByText('Needs attention').closest('section');
    const plain = screen.getByText('Platform network').closest('section');
    expect(attention.className).not.toBe(plain.className);
  });

  it('merges the ticket count into the complaints row', () => {
    renderOverview();
    expect(screen.getByLabelText(/Pending complaints: 6/i)).toBeInTheDocument();
    expect(screen.getByText(/2 urgent/)).toBeInTheDocument();
  });

  it('captions the Platform-network branches row with the inactive count', () => {
    // Sourced from get_admin_attention rather than a whole-collection
    // useAllEntities('branch') fetch.
    renderOverview();
    expect(screen.getByText(/2,043 agents in the field · 31 inactive/)).toBeInTheDocument();
  });

  it('opens the generic drill-down panel for a normal signal', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    renderOverview();

    await userEvent.click(screen.getByLabelText(/Delayed NAV updation/i));

    expect(setAttentionType).toHaveBeenCalledWith('delayedNav');
    expect(setViewAccessRequestsOpen).not.toHaveBeenCalled();
  });

  it('hands the two signals that own a panel to that panel, not the drill-down', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    renderOverview();

    await userEvent.click(screen.getByLabelText(/Pending access requests/i));
    expect(setViewAccessRequestsOpen).toHaveBeenCalledWith(true);

    await userEvent.click(screen.getByLabelText(/Pending complaints/i));
    expect(setViewTicketsOpen).toHaveBeenCalledWith(true);

    // Neither should have gone through the generic attention panel.
    expect(setAttentionType).not.toHaveBeenCalledWith('pendingAccessRequests');
    expect(setAttentionType).not.toHaveBeenCalledWith('pendingComplaints');
  });
});
