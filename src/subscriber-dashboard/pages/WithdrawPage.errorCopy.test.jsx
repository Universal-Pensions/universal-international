// A22-004 regression guard: a failed withdrawal must toast plain-language
// copy, never a raw technical error string. Before this fix, the catch block
// was `addToast('error', err?.message || 'Could not request withdrawal.')` —
// and err.message is ALWAYS populated (by both services/api.js and the
// direct-Supabase error paths), so a network drop toasted the literal string
// "TypeError: Failed to fetch" on a money action instead of the friendly copy
// the page author actually wrote.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const addToast = vi.fn();
const mutateAsync = vi.fn();

vi.mock('../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useRequestWithdrawal: () => ({ mutateAsync }),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast }),
}));

const { useCurrentSubscriber } = await import('../../hooks/useSubscriber');
const { default: WithdrawPage } = await import('./WithdrawPage');

function renderWithdraw() {
  useCurrentSubscriber.mockReturnValue({
    data: {
      id: 's1',
      age: 35,
      phone: '+256771000001',
      emergencyBalance: 200_000,
      retirementBalance: 100_000,
    },
    isError: false,
    refetch: vi.fn(),
  });
  // WithdrawPage reads the dealing date (when money taken now is actually
  // struck) via useDealingDate -> react-query, so it needs a QueryClient.
  // `retry: false` keeps a failed fetch from stalling; with no date the
  // pre-confirm copy falls back to the previous "Within 24 hours" wording,
  // which is exactly what these error-copy assertions expect.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WithdrawPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// jsdom has no matchMedia width, so useIsDesktop() is false and this renders
// the MOBILE tree (same convention as SavePage.test.jsx).
async function driveToConfirm(user) {
  renderWithdraw();
  const slider = screen.getByLabelText(/Withdrawal amount from your Savings pot in UGX/i);
  fireEvent.change(slider, { target: { value: '50000' } });

  const withdrawCta = screen.getByRole('button', { name: /^Withdraw UGX/i });
  await user.click(withdrawCta);

  const confirmBtn = await screen.findByRole('button', { name: 'Confirm withdrawal' });
  await user.click(confirmBtn);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('<WithdrawPage /> withdrawal-error copy (A22-004)', () => {
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
    mutateAsync.mockRejectedValueOnce({ message: 'unexpected error while executing request_withdrawal', code: 'XX000' });
    const user = userEvent.setup();

    await driveToConfirm(user);

    expect(addToast).toHaveBeenCalledWith('error', 'Could not request withdrawal.');
    expect(addToast).not.toHaveBeenCalledWith('error', expect.stringContaining('unexpected error'));
  });
});
