// Agent Home insurance-card drill-downs: Insured / Uninsured member lists.
//
// Both pages read the agent's subscriber book via useAgentSubscribers and split
// it with the shared `isInsured` predicate (a member is insured iff their
// derived `policies` list has an entry with status:'active'). We mock the scope
// context, the data hook, and the desktop gate so no network/Supabase is hit and
// we can drive each rendering branch deterministically:
//   - loading (isLoading + no data yet) → skeleton, no crash
//   - populated → the correct half of the book is listed, the other half is not
//   - filtered-empty → the page's own empty-state copy
//
// Mock paths are relative to THIS test file (src/agent-dashboard/pages/__tests__/),
// so they resolve to the same modules the page files import via '../../…'.

import { createElement } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockUseAgentSubscribers = vi.fn();
const mockUseIsDesktop = vi.fn(() => false);

vi.mock('../../../contexts/AgentScopeContext', () => ({
  useAgentScope: () => ({ agentId: 'a-001' }),
}));
vi.mock('../../../hooks/useAgent', () => ({
  useAgentSubscribers: (...args) => mockUseAgentSubscribers(...args),
}));
vi.mock('../../../hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

import InsuredMembersPage from '../InsuredMembersPage';
import UninsuredMembersPage from '../UninsuredMembersPage';

// isInsured → activePolicies(sub).length > 0 → any policy with status:'active'.
const INSURED = {
  id: 's-insured',
  name: 'Ada Insured',
  phone: '701234567',
  gender: 'female',
  policies: [{ product: 'life', status: 'active' }],
};
const UNINSURED = {
  id: 's-uninsured',
  name: 'Ben Uninsured',
  phone: '772345678',
  gender: 'male',
  policies: [],
};

function setSubs({ data = [], isLoading = false, isError = false, error = null } = {}) {
  mockUseAgentSubscribers.mockReturnValue({
    data,
    isLoading,
    isError,
    error,
    refetch: vi.fn(),
  });
}

function renderPage(Component) {
  // createElement (not <Component/>) so the param reads as a value use — the
  // lint config doesn't enable react/jsx-uses-vars.
  return render(
    <MemoryRouter>
      {createElement(Component)}
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseIsDesktop.mockReturnValue(false); // mobile by default
});

describe('InsuredMembersPage', () => {
  it('renders the loading skeleton (isLoading + empty data) without crashing', () => {
    setSubs({ data: [], isLoading: true });
    renderPage(InsuredMembersPage);

    // SkeletonRow announces its busy region with this label on this page.
    expect(screen.getByLabelText('Loading insured subscribers')).toBeInTheDocument();
    // No list rows / empty-state while loading.
    expect(screen.queryByText('No insured members yet')).not.toBeInTheDocument();
  });

  it('lists only insured members, not uninsured ones', () => {
    setSubs({ data: [INSURED, UNINSURED] });
    renderPage(InsuredMembersPage);

    // Mobile hero eyebrow labels the page + the count reflects one insured member.
    expect(screen.getByText('Insured members')).toBeInTheDocument();
    expect(screen.getByText('1 member')).toBeInTheDocument();

    expect(screen.getByText('Ada Insured')).toBeInTheDocument();
    expect(screen.queryByText('Ben Uninsured')).not.toBeInTheDocument();
  });

  it('renders the empty-state when no member is insured', () => {
    setSubs({ data: [UNINSURED] });
    renderPage(InsuredMembersPage);

    expect(screen.getByText('No insured members yet')).toBeInTheDocument();
    expect(screen.queryByText('Ben Uninsured')).not.toBeInTheDocument();
  });

  it('shows the desktop PageHeader heading when useIsDesktop is true', () => {
    mockUseIsDesktop.mockReturnValue(true);
    setSubs({ data: [INSURED] });
    renderPage(InsuredMembersPage);

    // Desktop fork renders the flat PageHeader <h1> (mobile hero suppressed).
    expect(screen.getByRole('heading', { name: 'Insured members' })).toBeInTheDocument();
    expect(screen.getByText('Ada Insured')).toBeInTheDocument();
  });
});

describe('UninsuredMembersPage', () => {
  it('renders the loading skeleton (isLoading + empty data) without crashing', () => {
    setSubs({ data: [], isLoading: true });
    renderPage(UninsuredMembersPage);

    expect(screen.getByLabelText('Loading subscribers')).toBeInTheDocument();
    expect(screen.queryByText("Everyone's covered")).not.toBeInTheDocument();
  });

  it('lists only uninsured members, not insured ones', () => {
    setSubs({ data: [INSURED, UNINSURED] });
    renderPage(UninsuredMembersPage);

    expect(screen.getByText('Uninsured members')).toBeInTheDocument();
    expect(screen.getByText('Ben Uninsured')).toBeInTheDocument();
    expect(screen.queryByText('Ada Insured')).not.toBeInTheDocument();
    // Bulk toolbar appears when there's at least one uninsured member.
    expect(screen.getByText('Select all')).toBeInTheDocument();
  });

  it('renders the empty-state when everyone is insured', () => {
    setSubs({ data: [INSURED] });
    renderPage(UninsuredMembersPage);

    expect(screen.getByText("Everyone's covered")).toBeInTheDocument();
    expect(screen.queryByText('Ada Insured')).not.toBeInTheDocument();
    // No toolbar when the filtered list is empty.
    expect(screen.queryByText('Select all')).not.toBeInTheDocument();
  });
});
