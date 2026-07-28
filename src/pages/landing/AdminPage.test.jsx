import { vi, describe, it, expect, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The hero login card drives the real sign-in flow — stub its two dependencies
// so this stays a render smoke test of the marketing page, not of auth.
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ login: vi.fn() }) }));
vi.mock('../../services/auth', () => ({
  hasDashboard: () => true,
  sendOtp: vi.fn().mockResolvedValue({}),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

import AdminPage from './AdminPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

describe('AdminPage', () => {
  // jsdom ships no IntersectionObserver, and every <Reveal> section mounts
  // framer-motion's `whileInView` observer.
  beforeAll(() => {
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    });
  });

  it('renders the head-office hero', () => {
    renderPage();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('In one console.');
  });

  it('embeds the administrator sign-in card', () => {
    renderPage();
    expect(screen.getByText('Administrator sign-in')).toBeInTheDocument();
    expect(screen.getByText('Enter your phone number')).toBeInTheDocument();
  });

  it('marks the Administrator tab as the current audience', () => {
    renderPage();
    const tabs = screen.getByRole('navigation', { name: 'Platform audiences' });
    expect(within(tabs).getByRole('link', { name: 'Administrator' })).toHaveAttribute('aria-current', 'page');
  });

  it('sends the CTA to Contact us — admin accounts are never self-signup', () => {
    renderPage();
    screen.getAllByRole('link', { name: /Contact us/ }).forEach((link) => {
      expect(link).toHaveAttribute('href', '/contact');
    });
    expect(screen.queryByRole('link', { name: 'Request access' })).not.toBeInTheDocument();
  });
});
