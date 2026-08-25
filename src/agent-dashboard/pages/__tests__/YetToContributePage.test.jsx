// A11-006: the page used to gate its skeleton on useAgentSubscribers alone.
// Once subscribers resolved but useAgentContributions was still in flight,
// pendingContributors(subscribers, []) read the empty contributions array as
// "nobody has paid" and flashed the WHOLE roster as pending before settling
// to the real (much smaller) count — a materially wrong, final-looking
// number with no loading affordance. The page must stay on its skeleton
// until BOTH queries have resolved, and only ever render a count once it can
// compute the true pending set.
//
// Mock paths are relative to THIS test file (src/agent-dashboard/pages/__tests__/),
// matching insuredMembersPages.test.jsx's convention in this same directory.

import { createElement } from 'react';
import { vi, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../contexts/AgentScopeContext', () => ({
  useAgentScope: () => ({ agentId: 'a-001' }),
}));
vi.mock('../../../hooks/useAgent', () => ({
  useAgentSubscribers: vi.fn(),
  useAgentContributions: vi.fn(),
}));
vi.mock('../../../hooks/useIsDesktop', () => ({
  useIsDesktop: () => false,
}));

import { useAgentSubscribers, useAgentContributions } from '../../../hooks/useAgent';
import YetToContributePage from '../YetToContributePage';

const SUBS = Array.from({ length: 11 }, (_, i) => ({
  id: `s-${i + 1}`,
  name: `Member ${i + 1}`,
  phone: '701234567',
  contributionSchedule: { amount: 10000, frequency: 'monthly' },
  registeredDate: '2026-06-01',
  lastContributionDate: '2026-07-15',
}));

function renderPage() {
  return render(createElement(YetToContributePage));
}

describe('<YetToContributePage /> — loading gate spans both queries (A11-006)', () => {
  it('stays on the skeleton (not the full 11-member roster) while contributions is still pending, even though subscribers has resolved', () => {
    useAgentSubscribers.mockReturnValue({
      data: SUBS, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    // Contributions hasn't resolved yet — the exact window the bug lived in.
    useAgentContributions.mockReturnValue({ data: [], isPending: true });

    renderPage();

    // The bug: this would render every one of the 11 subscribers as "pending".
    expect(screen.queryByText('Member 1')).toBeNull();
    expect(screen.queryByText('11 members')).toBeNull();
    expect(screen.getByRole('status', { name: /loading subscribers/i })).toBeInTheDocument();
  });

  it('renders the true settled count once both queries resolve', () => {
    useAgentSubscribers.mockReturnValue({
      data: SUBS, isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    // Everyone except Member 1 has a contribution logged this month.
    useAgentContributions.mockReturnValue({
      data: SUBS.slice(1).map((s) => ({ subscriberId: s.id, amount: 10000 })),
      isPending: false,
    });

    renderPage();

    expect(screen.queryByRole('status', { name: /loading subscribers/i })).toBeNull();
    expect(screen.getByText('1 member')).toBeInTheDocument();
    expect(screen.getByText('Member 1')).toBeInTheDocument();
    expect(screen.queryByText('Member 2')).toBeNull();
  });

  it('does not hang on the skeleton forever for an agent with zero subscribers', () => {
    useAgentSubscribers.mockReturnValue({
      data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(),
    });
    useAgentContributions.mockReturnValue({ data: [], isPending: true });

    renderPage();

    expect(screen.queryByRole('status', { name: /loading subscribers/i })).toBeNull();
  });
});
