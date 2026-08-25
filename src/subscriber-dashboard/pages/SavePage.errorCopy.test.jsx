// A22-004 regression guard: a failed top-up must toast plain-language copy,
// never a raw technical error string. Before this fix, the catch block was
// `addToast('error', err?.message || 'Could not complete the top-up.')` — and
// err.message is ALWAYS populated (by both services/api.js and the direct-
// Supabase error paths), so a network drop toasted the literal string
// "TypeError: Failed to fetch" on a money action instead of the friendly copy
// the page author actually wrote.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

const addToast = vi.fn();
const mutateAsync = vi.fn();

vi.mock('../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useMakeContribution: () => ({ mutateAsync }),
  useMyEmployerFunding: vi.fn(() => ({ data: null })),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast }),
}));

const { useCurrentSubscriber } = await import('../../hooks/useSubscriber');
const { default: SavePage } = await import('./SavePage');

// jsdom has no matchMedia width, so useIsDesktop() is false and this renders
// the MOBILE tree (same convention as SavePage.test.jsx). No location.state —
// the ad-hoc "Top up" flow, which opens on DEFAULT_AMOUNT (25,000, already
// above MIN_CONTRIBUTION) and the default payment method (MTN MoMo, kind
// "momo") so `hasAmount` and `pay.ready` are both true with zero interaction.
async function driveToConfirm(user) {
  useCurrentSubscriber.mockReturnValue({
    data: { id: 's1', netBalance: 200_000, age: 35, contributionSchedule: null },
  });
  render(
    <MemoryRouter>
      <SavePage />
    </MemoryRouter>,
  );

  await user.click(screen.getByRole('button', { name: /top up/i }));
  const confirmBtn = await screen.findByRole('button', { name: 'Confirm & pay' });
  await user.click(confirmBtn);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('<SavePage /> top-up error copy (A22-004)', () => {
  it('shows plain-language copy for a raw network failure, not the literal "TypeError: Failed to fetch"', async () => {
    mutateAsync.mockRejectedValueOnce({ message: 'TypeError: Failed to fetch', code: '' });
    const user = userEvent.setup();

    await driveToConfirm(user);

    expect(addToast).toHaveBeenCalledWith(
      'error',
      'Could not reach the server. Check your connection and try again.',
    );
    expect(addToast).not.toHaveBeenCalledWith('error', expect.stringContaining('TypeError'));
  });

  it('falls back to the page\'s own plain copy for an opaque server exception', async () => {
    mutateAsync.mockRejectedValueOnce({ message: 'unexpected error while executing make_contribution', code: 'XX000' });
    const user = userEvent.setup();

    await driveToConfirm(user);

    expect(addToast).toHaveBeenCalledWith('error', 'Could not complete the top-up.');
    expect(addToast).not.toHaveBeenCalledWith('error', expect.stringContaining('unexpected error'));
  });
});
