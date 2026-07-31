// RTL tests for SavePage's scheduled-payment lock.
//
// When a subscriber pays their *scheduled* contribution (reached via
// TopUpWidget's "Pay", which sets location.state.scheduled), the amount must be
// LOCKED to the configured schedule amount — no preset chips, no editable input.
// The ad-hoc "Top up extra" flow (no scheduled flag) must stay fully editable.
// A schedule amount below MIN_CONTRIBUTION must NOT lock (that would render a
// card whose Pay button is disabled with no way to edit) — it degrades to the
// editable view with the standard raise-to-minimum flow.
//
// A THIRD case exists under the unified two-leg contribution model (0092): an
// employer-funded member must NEVER be offered "pay the scheduled amount". Their
// pension money is deducted from their pay and remitted by the employer's payroll
// run, so billing the same figure again through mobile money would take it twice.
// The guard reads `useMyEmployerFunding()` — the CONFIGURED legs — not the schedule
// row's value, so it holds however that row drifts. A 0/0 employer config is
// deliberately NOT employer-funded (nothing arrives from payroll, so that member's
// own schedule really is theirs) — memberFundingSummary() returning null is the
// app-wide "hide the funding surface" signal.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: vi.fn(),
  useMakeContribution: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useMyEmployerFunding: vi.fn(),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

const { useCurrentSubscriber, useMyEmployerFunding } = await import('../../hooks/useSubscriber');
const { default: SavePage } = await import('./SavePage');

/**
 * @param state    location.state (the `scheduled` flag + prefillAmount)
 * @param schedule the member's contribution_schedules row
 * @param funding  the get_my_employer_funding payload; null = a self-pay member,
 *                 which is every case except the employer-funded ones.
 */
function renderSave(state, schedule, funding = null) {
  useCurrentSubscriber.mockReturnValue({
    data: { id: 's1', netBalance: 200000, age: 35, contributionSchedule: schedule },
  });
  useMyEmployerFunding.mockReturnValue({ data: funding });
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/dashboard/save', state }]}>
      <SavePage />
    </MemoryRouter>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('<SavePage /> scheduled-payment lock', () => {
  const monthly = { amount: 39000, frequency: 'monthly', retirementPct: 90, emergencyPct: 10 };

  it('locks the amount to the schedule amount (no input, no preset chips)', () => {
    renderSave({ scheduled: true, prefillAmount: 39000 }, monthly);

    // Read-only: no editable amount input and no preset chips exist.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('100K')).toBeNull(); // a preset chip in the editable view

    // The locked, fixed amount is shown with its accessible label.
    expect(screen.getByText('Scheduled monthly contribution')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Scheduled contribution: UGX 39,000\. Amount is fixed\./ }),
    ).toBeInTheDocument();

    // Scheduled affordances: "Pay" verb (not "Top up") + a change-in-schedule link.
    expect(screen.getByText('Pay')).toBeInTheDocument();
    expect(screen.queryByText('Top up')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('keeps the amount editable for an ad-hoc top-up (no scheduled flag)', () => {
    renderSave(null, monthly);

    expect(screen.getByLabelText('Contribution amount in UGX')).toBeInTheDocument();
    expect(screen.getByText('Enter an amount')).toBeInTheDocument();
    expect(screen.getByText('Top up')).toBeInTheDocument();
    expect(screen.queryByText(/Scheduled .* contribution/)).toBeNull();
  });

  it('does NOT lock when the schedule amount is below the minimum — falls back to editable', () => {
    // A legacy weekly schedule below MIN_CONTRIBUTION (5,000). Locking it would
    // strand the user on a disabled Pay button; instead it must be editable.
    renderSave({ scheduled: true, prefillAmount: 1000 }, { amount: 1000, frequency: 'weekly', retirementPct: 90 });

    expect(screen.queryByText('Scheduled amount')).toBeNull();
    expect(screen.getByLabelText('Contribution amount in UGX')).toBeInTheDocument();
    // The pre-filled sub-minimum amount surfaces the raise-to-minimum error.
    expect(screen.getByRole('alert')).toHaveTextContent(/Minimum/);
  });
});

describe('<SavePage /> employer-funded member', () => {
  const monthly = { amount: 39000, frequency: 'monthly', retirementPct: 90, emergencyPct: 10 };

  // 10% of pay from the member's payroll, 5% of pay added by the company. Two
  // INDEPENDENT legs — the employer leg is not a multiple of the member's.
  const FUNDING = {
    employerName: 'Nile Breweries Ltd',
    compensation: 1_400_000,
    employeeBasis: 'percent', employeePct: 10, employeeAmount: 0,
    employerBasis: 'percent', employerPct: 5, employerAmount: 0,
  };

  it('never locks to the schedule amount — that money is already taken from their pay', () => {
    // Arriving WITH state.scheduled (the home widgets can still push it) must not
    // produce a "Pay UGX 39,000" card: the payroll run already posted that leg.
    renderSave({ scheduled: true, prefillAmount: 39000 }, monthly, FUNDING);

    expect(screen.queryByText('Scheduled monthly contribution')).toBeNull();
    expect(screen.getByLabelText('Contribution amount in UGX')).toBeInTheDocument();
    expect(screen.getByText('Top up')).toBeInTheDocument();
    expect(screen.queryByText('Pay')).toBeNull();
  });

  it('explains that the workplace money arrives on its own and this is EXTRA saving', () => {
    // jsdom has no matchMedia width, so useIsDesktop() is false and this renders
    // the MOBILE tree: the explanation is the lede above the amount hero. (The
    // desktop twin carries the same sentence as the page subtitle, plus a
    // "How much extra?" field label — both behind useIsDesktop, so not asserted
    // here.) Before this, an employer-funded member landed on a bare "Top up"
    // form with no hint that their workplace pension was arriving separately.
    renderSave(null, monthly, FUNDING);

    const lede = screen.getByText(/arrives on its own every month/);
    expect(lede).toHaveTextContent('Nile Breweries Ltd');
    expect(lede).toHaveTextContent('This page is for extra saving on top.');
  });

  it('treats a 0/0 employer config as a normal self-pay member', () => {
    // Nothing arrives from payroll, so the schedule really is the member's own and
    // the standard lock must still work. memberFundingSummary() is null here.
    renderSave({ scheduled: true, prefillAmount: 39000 }, monthly, {
      ...FUNDING,
      employeePct: 0,
      employerPct: 0,
    });

    expect(screen.getByText('Scheduled monthly contribution')).toBeInTheDocument();
    expect(screen.getByText('Pay')).toBeInTheDocument();
    expect(screen.queryByText(/arrives on its own every month/)).toBeNull();
  });
});
