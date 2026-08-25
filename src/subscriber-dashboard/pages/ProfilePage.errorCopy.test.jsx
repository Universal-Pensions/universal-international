// A22-004 regression guard: a failed profile save must toast plain-language
// copy, never a raw technical error string. Before this fix, the catch block
// was `addToast('error', err?.message || 'Could not update profile.')` — and
// err.message is ALWAYS populated (by both services/api.js and the direct-
// Supabase error paths), so a network drop toasted the literal string
// "TypeError: Failed to fetch" instead of the friendly fallback the page
// author actually wrote.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

const addToast = vi.fn();
const mutateAsync = vi.fn();

vi.mock('../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useUpdateProfile: () => ({ mutateAsync }),
}));
vi.mock('../../hooks/useEntity', () => ({
  useAllEntities: () => ({ data: [] }),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast }),
}));

const { useCurrentSubscriber } = await import('../../hooks/useSubscriber');
const { default: ProfilePage } = await import('./ProfilePage');

function renderProfile() {
  useCurrentSubscriber.mockReturnValue({
    data: {
      id: 's1',
      name: 'Carol Obua',
      phone: '+256771000001',
      email: '',
      nin: 'CM12345',
      dob: '1990-01-01',
      gender: 'female',
      occupation: 'trader',
      registeredDate: '2025-01-01',
    },
    isError: false,
    refetch: vi.fn(),
  });
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('<ProfilePage /> save-error copy (A22-004)', () => {
  it('shows plain-language copy for a raw network failure, not the literal "TypeError: Failed to fetch"', async () => {
    // The exact shape postgrest-js returns on a dropped connection.
    mutateAsync.mockRejectedValueOnce({ message: 'TypeError: Failed to fetch', code: '' });
    const user = userEvent.setup();
    renderProfile();

    const nameInput = screen.getByLabelText('Full name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Carol Namono');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(addToast).toHaveBeenCalledWith(
      'error',
      'Could not reach the server. Check your connection and try again.',
    );
    expect(addToast).not.toHaveBeenCalledWith('error', expect.stringContaining('TypeError'));
  });

  it('falls back to the page\'s own plain copy for an opaque server exception', async () => {
    mutateAsync.mockRejectedValueOnce({ message: 'unexpected error while executing update_subscriber_profile', code: 'XX000' });
    const user = userEvent.setup();
    renderProfile();

    const nameInput = screen.getByLabelText('Full name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Carol Namono');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(addToast).toHaveBeenCalledWith('error', 'Could not update profile.');
    expect(addToast).not.toHaveBeenCalledWith('error', expect.stringContaining('unexpected error'));
  });
});
