// A22-004 regression guard: a failed contribution run must toast plain-
// language copy, never a raw technical error string. Before this fix, the
// catch block was
//   addToast('error', err?.message || 'Could not record the contribution run.')
// and err.message is ALWAYS populated (by both services/api.js and the
// direct-Supabase error paths), so a network drop toasted the literal string
// "TypeError: Failed to fetch" on a real money action instead of the
// friendly copy the page author actually wrote.
//
// NewRunWizard takes `addToast` as a PROP (not via useToast()), so this test
// needs no Router/ToastProvider — just the three data hooks it reads.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const addToast = vi.fn();
const mutateAsync = vi.fn();

vi.mock('../../hooks/useEmployer', () => ({
  useContributionRuns: vi.fn(),
  useContributionRun: vi.fn(),
  useEmployees: () => ({
    data: [{ id: 'e1', name: 'Jane Auma', status: 'active', compensation: 1_000_000 }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useEmployer: () => ({ data: { defaultContributionConfig: { employeePct: 10, employerPct: 5 } } }),
  useRunContribution: () => ({ mutateAsync, isPending: false }),
}));

const { NewRunWizard } = await import('./runViews');

async function driveToConfirm(user) {
  render(
    <NewRunWizard employerId="emp-1" addToast={addToast} onDone={vi.fn()} onCancel={vi.fn()} />,
  );
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(await screen.findByRole('button', { name: /Confirm & record/i }));
}

beforeEach(() => { vi.clearAllMocks(); });

describe('<NewRunWizard /> run-error copy (A22-004)', () => {
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
    mutateAsync.mockRejectedValueOnce({ message: 'unexpected error while executing submit_employer_contribution_run', code: 'XX000' });
    const user = userEvent.setup();

    await driveToConfirm(user);

    expect(addToast).toHaveBeenCalledWith('error', 'Could not record the contribution run.');
    expect(addToast).not.toHaveBeenCalledWith('error', expect.stringContaining('unexpected error'));
  });
});
