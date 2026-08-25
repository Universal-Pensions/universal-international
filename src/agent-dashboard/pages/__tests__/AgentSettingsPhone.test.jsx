// A11-004: SettingsDesktop.jsx and SettingsPage.jsx each defined a local
// formatPhone(raw) that grouped the full stored phone (which may already
// carry the '256' country code, e.g. the seeded '256711443975') and then the
// JSX prepended a literal '+256 ' on top — double-counting the country code
// ('+256 256 711 443975'). Both now render through the shared formatUGPhone()
// (utils/phone.js), which strips a leading '256'/'0' before formatting, so
// the header reads the correct '+256 711 443 975'.
//
// The editable phone INPUT had the same double-count, one DOM node over:
// formatPhone(phone) was placed inside the input next to a separate static
// "+256" prefix chip, so the rendered pair read "+256" + "256 711 443975".
// The input must show ONLY the local grouped digits now.
//
// Mock paths are relative to THIS test file (src/agent-dashboard/pages/__tests__/),
// matching insuredMembersPages.test.jsx's convention in this same directory.

import { createElement } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseIsDesktop = vi.fn(() => false);

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../../../contexts/DashboardContext', () => ({
  useDashboard: () => ({ setSettingsOpen: vi.fn() }),
}));
vi.mock('../../../hooks/useEntity', () => ({
  useEntity: vi.fn(),
}));
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));
vi.mock('../../../hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

import { useAuth } from '../../../contexts/AuthContext';
import { useEntity } from '../../../hooks/useEntity';
import SettingsPage from '../SettingsPage';
import SettingsDesktop from '../SettingsDesktop';

// The exact stored shape from the finding's repro: 12 digits, country code
// already embedded, no '+', no spaces.
const STORED_PHONE = '256711443975';

function setAgent() {
  useAuth.mockReturnValue({
    user: { name: 'Dorothy Kiiza', phone: STORED_PHONE, agentId: 'a-001', hasPassword: true },
    updateUser: vi.fn(),
  });
  useEntity.mockReturnValue({
    data: { name: 'Dorothy Kiiza', phone: STORED_PHONE, email: '' },
  });
}

function renderPage(Component) {
  return render(createElement(Component));
}

describe('Agent Settings phone rendering (A11-004)', () => {
  beforeEach(() => {
    setAgent();
    mockUseIsDesktop.mockReturnValue(false);
  });

  it('SettingsPage (mobile) renders one correct country code, not a doubled one', () => {
    renderPage(SettingsPage);
    expect(screen.queryByText('+256 256 711 443975')).toBeNull();
    expect(screen.getByText('+256 711 443 975')).toBeInTheDocument();
  });

  it('SettingsDesktop renders one correct country code, not a doubled one', () => {
    renderPage(SettingsDesktop);
    expect(screen.queryByText('+256 256 711 443975')).toBeNull();
    expect(screen.getByText('+256 711 443 975')).toBeInTheDocument();
  });

  it('SettingsPage forks to SettingsDesktop on desktop and still renders the correct phone', () => {
    mockUseIsDesktop.mockReturnValue(true);
    renderPage(SettingsPage);
    expect(screen.queryByText('+256 256 711 443975')).toBeNull();
    expect(screen.getByText('+256 711 443 975')).toBeInTheDocument();
  });

  it('the editable phone input holds only the local grouped digits — no second country code beside the "+256" chip', () => {
    renderPage(SettingsDesktop);
    // Old bug: the input itself held "256 711 443975" beside a static "+256".
    expect(screen.queryByDisplayValue('256 711 443975')).toBeNull();
    expect(screen.getByDisplayValue('711 443 975')).toBeInTheDocument();
  });
});
