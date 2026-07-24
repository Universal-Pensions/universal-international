import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mutable per-test — the modal reads isOpen/initialRole from the context, and
// the landing "Sign in" CTAs are exactly what set initialRole.
const { signInState, closeSpy } = vi.hoisted(() => ({
  signInState: { isOpen: true, initialRole: null },
  closeSpy: vi.fn(),
}));

vi.mock('../contexts/SignInContext', () => ({
  useSignIn: () => ({ ...signInState, close: closeSpy }),
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ login: vi.fn() }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../services/auth', () => ({
  hasDashboard: () => true,
  sendOtp: vi.fn().mockResolvedValue({}),
  verifyOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

import SignInModal from './SignInModal';

const PICKER = 'Select your role to sign in.';

function renderModal({ initialRole = null } = {}) {
  signInState.isOpen = true;
  signInState.initialRole = initialRole;
  return render(
    <MemoryRouter>
      <SignInModal />
    </MemoryRouter>,
  );
}

describe('SignInModal — Back never surfaces a step the user skipped', () => {
  beforeEach(() => closeSpy.mockClear());

  it('closes instead of showing the role picker when opened preset to a role', () => {
    // The PWA action bar calls open('employer'), so the modal starts on the
    // phone step and the picker was never on screen.
    renderModal({ initialRole: 'employer' });
    expect(screen.getByText('Enter your phone number')).toBeInTheDocument();
    expect(screen.queryByText(PICKER)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(closeSpy).toHaveBeenCalled();
    expect(screen.queryByText(PICKER)).not.toBeInTheDocument();
  });

  it('closes from the distributor sub-select when opened preset to distributor', () => {
    renderModal({ initialRole: 'distributor' });
    expect(screen.getByText('Distributor login')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(closeSpy).toHaveBeenCalled();
    expect(screen.queryByText(PICKER)).not.toBeInTheDocument();
  });

  it('still walks back to the sub-select the user did pass through', () => {
    renderModal({ initialRole: 'distributor' });
    fireEvent.click(screen.getByText('Branch Admin'));

    // The sub-select is still mounted mid-exit-animation, so scope to the phone
    // step rather than matching its lingering Back button too.
    const phoneStep = screen.getByText('Enter your phone number').closest('div');
    fireEvent.click(within(phoneStep).getByRole('button', { name: 'Back' }));

    expect(screen.getByText('Distributor login')).toBeInTheDocument();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('still walks back to the picker when the picker is where the user started', () => {
    // Desktop Navbar calls open() with no role → the picker is step one.
    renderModal();
    fireEvent.click(screen.getByText('Employer'));
    expect(screen.getByText('Enter your phone number')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByText(PICKER)).toBeInTheDocument();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('lets a preset subscriber deliberately switch role without closing', () => {
    renderModal({ initialRole: 'subscriber' });

    fireEvent.click(screen.getByText('Not a subscriber? Choose a different role'));

    expect(screen.getByText(PICKER)).toBeInTheDocument();
    expect(closeSpy).not.toHaveBeenCalled();
  });
});
