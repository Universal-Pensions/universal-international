// Drill-down + notify test for the admin Needs-attention detail page.
//
// Covers the two things most likely to break silently: the notification is
// addressed from the row's SERVER-RESOLVED recipient (not guessed in the UI),
// and an unrecognised signal degrades to an error card instead of crashing the
// admin shell.

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const setAttentionType = vi.fn();
const addToast = vi.fn();
const mutate = vi.fn();
const resolveMutate = vi.fn();

let attentionType = 'delayedWithdrawals';
let rowsResult = { data: [], isLoading: false, isError: false, refetch: vi.fn() };

vi.mock('../../../contexts/AdminPanelContext', () => ({
  useAdminPanel: () => ({ attentionType, setAttentionType }),
}));
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../../hooks/useAdminAttention', () => ({
  useAdminAttentionRows: () => rowsResult,
  useResolveAttentionRow: () => ({ mutate: resolveMutate, isPending: false }),
}));
vi.mock('../../../hooks/useNotifications', () => ({
  useSendAdminNotification: () => ({ mutate, isPending: false }),
}));

const { default: AdminAttentionDesktop } = await import('../AdminAttentionDesktop');

const withdrawalRow = {
  id: 'wd-demo-06',
  primary: 'Grace Nakato',
  secondary: 'Emergency payout · MTN MoMo',
  amount: 180000,
  date: '2026-07-24',
  dueBy: '2026-07-29',
  daysLate: 9,
  status: 'processing',
  recipientRole: 'admin',
  recipientId: 'ops-treasury',
  recipientName: 'Treasury Operations',
  href: '/dashboard/subscribers/s-0287',
};

const renderPage = () => render(<MemoryRouter><AdminAttentionDesktop /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  attentionType = 'delayedWithdrawals';
  rowsResult = { data: [withdrawalRow], isLoading: false, isError: false, refetch: vi.fn() };
});

describe('<AdminAttentionDesktop />', () => {
  it('renders the signal’s title, lead and rows', () => {
    renderPage();
    // Title appears twice — the page head and the card's section head.
    expect(screen.getAllByText('Delayed withdrawal payouts')).toHaveLength(2);
    expect(screen.getByText(/Escalate to treasury to release the payments/i)).toBeInTheDocument();
    expect(screen.getByText('Grace Nakato')).toBeInTheDocument();
    expect(screen.getByText('Emergency payout · MTN MoMo')).toBeInTheDocument();
    // daysLate straight off the row — the client never computes it.
    expect(screen.getByText('9')).toBeInTheDocument();
  });

  it('links the identity cell to the member when the row carries an href', () => {
    renderPage();
    expect(screen.getByRole('link', { name: /Grace Nakato/ }))
      .toHaveAttribute('href', '/dashboard/subscribers/s-0287');
  });

  it('shows an unknown attention type as an error card instead of crashing', () => {
    attentionType = 'notASignal';
    renderPage();
    expect(screen.getByText('Unknown attention type')).toBeInTheDocument();
    expect(screen.queryByText('Grace Nakato')).not.toBeInTheDocument();
  });

  it('shows the signal’s all-clear copy when there is nothing to action', () => {
    rowsResult = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText(/every withdrawal is within its payout SLA/i)).toBeInTheDocument();
  });

  it('offers a retry when the list fails to load', () => {
    const refetch = vi.fn();
    rowsResult = { data: [], isLoading: false, isError: true, refetch };
    renderPage();
    expect(screen.getByText(/We couldn't load this list/i)).toBeInTheDocument();
  });

  it('opens the composer prefilled from the row', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Escalate Treasury Operations/i }));

    const textarea = await screen.findByLabelText('Message');
    expect(textarea.value).toContain('Grace Nakato');
    expect(textarea.value).toContain('9 days past due');
    // Recipient chip shows who it actually goes to.
    expect(screen.getAllByText('Treasury Operations').length).toBeGreaterThan(0);
    expect(screen.getByText('internal queue')).toBeInTheDocument();
  });

  it('sends to the row’s server-resolved recipient, not a UI guess', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /Escalate Treasury Operations/i }));
    await screen.findByLabelText('Message');
    await userEvent.click(screen.getByRole('button', { name: 'Escalate' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const [payload] = mutate.mock.calls[0];
    expect(payload).toMatchObject({
      recipientRole: 'admin',
      recipientId: 'ops-treasury',
      type: 'delayedWithdrawals',
      refId: 'wd-demo-06',
      amount: 180000,
    });
    expect(payload.body).toContain('Grace Nakato');
    expect(payload.title).toBe('Withdrawal payout past SLA');
  });

  it('addresses an entity signal to that entity rather than an ops queue', async () => {
    attentionType = 'delayedEmployerTransfers';
    rowsResult = {
      data: [{
        id: 'emp-003', primary: 'Kigo Tea Estates', secondary: 'Monthly payroll · no run recorded',
        amount: null, date: null, dueBy: null, daysLate: null, status: 'active',
        recipientRole: 'employer', recipientId: 'emp-003', recipientName: 'Kigo Tea Estates', href: null,
      }],
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /Notify Kigo Tea Estates/i }));
    await screen.findByLabelText('Message');
    await userEvent.click(screen.getByRole('button', { name: 'Notify' }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0]).toMatchObject({
      recipientRole: 'employer',
      recipientId: 'emp-003',
      type: 'delayedEmployerTransfers',
    });
  });

  it('renders an em dash, not a zero, when a row has no due date', () => {
    attentionType = 'delayedEmployerTransfers';
    rowsResult = {
      data: [{
        id: 'emp-003', primary: 'Kigo Tea Estates', secondary: 'Monthly payroll · no run recorded',
        amount: null, date: null, dueBy: null, daysLate: null, status: 'active',
        recipientRole: 'employer', recipientId: 'emp-003', recipientName: 'Kigo Tea Estates', href: null,
      }],
      isLoading: false, isError: false, refetch: vi.fn(),
    };
    renderPage();
    // An employer that has NEVER posted a run has no due date; "0 days late"
    // would be a lie.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  // ── Never-run employers (0163) ────────────────────────────────────────────
  describe('an employer that has never posted a run', () => {
    const neverRunRow = {
      id: 'emp-004',
      primary: 'Jinja Steel Mills',
      secondary: 'Monthly payroll · never run',
      amount: null,
      // No raised date — 0163 leaves it NULL rather than inventing one …
      date: null,
      neverRun: true,
      // … but due-by and days-late ARE known, anchored on first member enrolment.
      dueBy: '2023-12-19',
      daysLate: 989,
      status: 'active',
      recipientRole: 'employer',
      recipientId: 'emp-004',
      recipientName: 'Jinja Steel Mills',
      href: null,
    };

    beforeEach(() => {
      attentionType = 'delayedEmployerTransfers';
      rowsResult = { data: [neverRunRow], isLoading: false, isError: false, refetch: vi.fn() };
    });

    it('says "No run" instead of an em dash it cannot explain', () => {
      renderPage();
      expect(screen.getByText('No run')).toBeInTheDocument();
    });

    it('still shows a real due date and days late', () => {
      // The whole defect was three empty columns on the most overdue rows.
      renderPage();
      expect(screen.getByText('19 Dec 2023')).toBeInTheDocument();
      expect(screen.getByText('989')).toBeInTheDocument();
    });

    it('drafts an escalation with the real lateness, not "now due"', async () => {
      // daysLate was null before 0163, so attentionMeta's days() fell through to
      // "now due" — the softest possible wording for the worst case.
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: /Notify Jinja Steel Mills/i }));
      const textarea = await screen.findByLabelText('Message');
      expect(textarea.value).toContain('989 days past due');
      expect(textarea.value).not.toContain('now due');
    });
  });

  // ── Resolve (0162) ────────────────────────────────────────────────────────
  describe('resolving a missed NAV day', () => {
    const navRow = (over = {}) => ({
      id: 'nav-unpriced-20260902',
      primary: '02 Sep 2026',
      secondary: 'UPU-BAL · no price received',
      amount: null,
      date: '2026-09-02',
      dueBy: '2026-09-02',
      daysLate: 1,
      status: 'unpriced',
      resolved: false,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      recipientRole: 'admin',
      recipientId: 'ops-fund-admin',
      recipientName: 'Fund Administration',
      href: null,
      ...over,
    });

    const showNav = (rows) => {
      attentionType = 'delayedNav';
      rowsResult = { data: rows, isLoading: false, isError: false, refetch: vi.fn() };
    };

    it('offers Resolve beside Escalate on an unresolved day', () => {
      showNav([navRow()]);
      renderPage();
      expect(screen.getByRole('button', { name: /Escalate Fund Administration/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Resolve 02 Sep 2026/i })).toBeInTheDocument();
    });

    it('never offers Resolve on a signal that has not opted in', () => {
      // Resolving is opt-in per signal (meta.resolvable). Every other signal
      // clears only by doing the real work, and must stay that way.
      renderPage(); // default fixture is delayedWithdrawals
      expect(screen.getByRole('button', { name: /Escalate Treasury Operations/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Resolve/i })).not.toBeInTheDocument();
    });

    it('resolves the row with the ISO date, not the display string', async () => {
      showNav([navRow()]);
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: /Resolve 02 Sep 2026/i }));

      const note = await screen.findByLabelText(/Why is this resolved/i);
      await userEvent.type(note, 'Fund admin confirmed no dealing.');
      await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));

      await waitFor(() => expect(resolveMutate).toHaveBeenCalledTimes(1));
      const [payload] = resolveMutate.mock.calls[0];
      expect(payload.note).toBe('Fund admin confirmed no dealing.');
      // The hook maps row.date (ISO) to the RPC; row.primary is display copy.
      expect(payload.row.date).toBe('2026-09-02');
    });

    it('resolves with no note, because the reason is optional', async () => {
      showNav([navRow()]);
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: /Resolve 02 Sep 2026/i }));
      await screen.findByLabelText(/Why is this resolved/i);

      const submit = screen.getByRole('button', { name: 'Resolve' });
      expect(submit).toBeEnabled();
      await userEvent.click(submit);

      await waitFor(() => expect(resolveMutate).toHaveBeenCalledTimes(1));
      expect(resolveMutate.mock.calls[0][0].note).toBeNull();
    });

    it('warns that resolving does not set a price', async () => {
      showNav([navRow()]);
      renderPage();
      await userEvent.click(screen.getByRole('button', { name: /Resolve 02 Sep 2026/i }));
      // The one sentence stopping an admin reading Resolve as a fix.
      expect(await screen.findByText(/does not set a price/i)).toBeInTheDocument();
      expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    });

    it('keeps a resolved day on the page as a record, with no actions left', () => {
      showNav([navRow({
        resolved: true, resolvedBy: 'admin', resolvedAt: '2026-09-03T09:00:00+00:00',
      })]);
      renderPage();
      // The record of WHICH day was missed is the point of the feature.
      expect(screen.getByText('02 Sep 2026')).toBeInTheDocument();
      expect(screen.getByText('Resolved')).toBeInTheDocument();
      expect(screen.getByText(/Resolved by admin/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Resolve/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Escalate/i })).not.toBeInTheDocument();
    });

    it('does not count a resolved day in the tiles', () => {
      // The badge on the admin home already skips resolved days server-side, so
      // counting them here would put a different number on the tile than on the
      // card that opened it — the badge-vs-list drift A04-007 raised.
      showNav([
        navRow(),
        navRow({
          id: 'nav-unpriced-20260828', primary: '28 Aug 2026', date: '2026-08-28',
          resolved: true, resolvedBy: 'admin', resolvedAt: '2026-09-03T09:00:00+00:00',
        }),
      ]);
      renderPage();
      // Two rows listed, but only one is outstanding.
      expect(screen.getByText('02 Sep 2026')).toBeInTheDocument();
      expect(screen.getByText('28 Aug 2026')).toBeInTheDocument();
      expect(screen.queryByText('2')).not.toBeInTheDocument();
      expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    });
  });
});
