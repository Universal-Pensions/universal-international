// Regression test for the AFFORDANCE half of AUDIT A12-005 (branch admin
// phone shell): the fix for this finding has two parts — (1) a route,
// `agents/:agentId/subscribers`, added to BranchMobileShell.jsx, and (2) a
// "View subscribers" link on this page so a branch admin can actually reach
// that route from the UI. The audit was explicit that shipping only the route
// does not close the finding: "a route with no way to reach it is still
// unreachable."
//
// BranchMobileShell.test.jsx already proves the ROUTE resolves — but it stubs
// AgentDetailMobile out entirely (`vi.mock('../mobile/AgentDetailMobile', ...)`
// renders a bare div), by design, to keep that test about routing rather than
// page content. That means nothing previously asserted the on-page link
// itself exists, so a future edit could delete the NavLink from this
// component (or point it at the wrong id) and every existing test would still
// pass — the finding would silently reopen. This file closes that gap.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockAgent = {
  id: 'a-087',
  name: 'Namukasa Sarah',
  status: 'active',
  tenureMonths: 14,
  specialties: ['Field agent'],
  phone: '+256700000087',
};
const mockMetrics = {
  totalSubscribers: 11,
  activeRate: 90.9,
  totalContributions: 5300000,
};
const mockCommission = { totalPaid: 120000, totalDue: 40000, settlementRate: 75 };

vi.mock('../../hooks/useEntity', () => ({
  useEntity: vi.fn(() => ({
    data: mockAgent,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  })),
  useEntityMetrics: vi.fn(() => ({ data: mockMetrics })),
}));
vi.mock('../../hooks/useCommission', () => ({
  useEntityCommissionSummary: vi.fn(() => ({ data: mockCommission })),
}));

const { default: AgentDetailMobile } = await import('./AgentDetailMobile');

function renderAt(agentId) {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/agents/${agentId}`]}>
      <Routes>
        <Route path="/dashboard/agents/:agentId" element={<AgentDetailMobile />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('<AgentDetailMobile /> — "View subscribers" affordance (AUDIT A12-005)', () => {
  it('links to the agent-scoped subscriber route that BranchMobileShell now serves', () => {
    renderAt('a-087');
    const link = screen.getByRole('link', { name: /view subscribers for namukasa sarah/i });
    expect(link).toHaveAttribute('href', '/dashboard/agents/a-087/subscribers');
  });

  it('reflects the same subscriber count shown in the metric grid, not a placeholder', () => {
    renderAt('a-087');
    const link = screen.getByRole('link', { name: /view subscribers for namukasa sarah/i });
    expect(link).toHaveTextContent('11 on this agent');
  });

  it('builds the link from the route param, so it still resolves correctly for a different agent', () => {
    renderAt('a-231');
    const link = screen.getByRole('link', { name: /view subscribers for namukasa sarah/i });
    expect(link).toHaveAttribute('href', '/dashboard/agents/a-231/subscribers');
  });
});
