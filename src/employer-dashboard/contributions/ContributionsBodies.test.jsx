// RTL tests for the two bodies of /dashboard/contributions.
//
// The desktop body was driven in a real browser against live data; this pins
// both bodies against the same fixture so the contract they share can't drift:
// the leg comes from the URL, the totals are the sum of the payments shown, and
// every row leads to the member it was paid for.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../hooks/useEmployer', () => ({
  useEmployerContributions: vi.fn(),
  useContributionRuns: vi.fn(),
}));
vi.mock('../../contexts/EmployerScopeContext', () => ({
  useEmployerScope: () => ({ employerId: 'emp-001' }),
}));

const { useEmployerContributions, useContributionRuns } = await import('../../hooks/useEmployer');
const { default: ContributionsDesktop } = await import('../desktop/ContributionsDesktop');
const { default: ContributionsMobile } = await import('../mobile/ContributionsMobile');

const RUNS = [
  { id: 'run-002', periodLabel: 'April 2026 payroll', runAt: '2026-04-15T12:00:00.000Z' },
  { id: 'run-001', periodLabel: 'March 2026 payroll', runAt: '2026-03-15T12:00:00.000Z' },
];

// Two members × two periods × two legs. Employee legs total 300,000; employer
// legs total 120,000 — deliberately different so a leg mix-up is visible.
const PAYMENTS = [
  { id: 't1', subscriberId: 'empe-001', memberName: 'Mary Auma', source: 'own', amount: 100000, date: '2026-04-15T12:00:00.000Z', method: 'Payroll deduction', contributionRunId: 'run-002' },
  { id: 't2', subscriberId: 'empe-001', memberName: 'Mary Auma', source: 'employer', amount: 50000, date: '2026-04-15T12:00:00.000Z', method: 'Bank transfer', contributionRunId: 'run-002' },
  { id: 't3', subscriberId: 'empe-002', memberName: 'Peter Okot', source: 'own', amount: 120000, date: '2026-04-15T12:00:00.000Z', method: 'Payroll deduction', contributionRunId: 'run-002' },
  { id: 't4', subscriberId: 'empe-002', memberName: 'Peter Okot', source: 'employer', amount: 30000, date: '2026-03-15T12:00:00.000Z', method: 'Bank transfer', contributionRunId: 'run-001' },
  { id: 't5', subscriberId: 'empe-001', memberName: 'Mary Auma', source: 'own', amount: 80000, date: '2026-03-15T12:00:00.000Z', method: 'Payroll deduction', contributionRunId: 'run-001' },
  { id: 't6', subscriberId: 'empe-002', memberName: 'Peter Okot', source: 'employer', amount: 40000, date: '2026-03-15T12:00:00.000Z', method: 'Bank transfer', contributionRunId: 'run-001' },
];

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="loc">{`${loc.pathname}${loc.search}`}</output>;
}

let container;

function renderBody(Body, { leg, payments = PAYMENTS } = {}) {
  useEmployerContributions.mockReturnValue({
    data: payments, isLoading: false, isError: false, error: null, refetch: vi.fn(),
  });
  useContributionRuns.mockReturnValue({ data: RUNS });
  const url = `/dashboard/contributions${leg ? `?leg=${leg}` : ''}`;
  const result = render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/dashboard/contributions" element={<><Body /><LocationProbe /></>} />
        <Route path="/dashboard/employees/:id" element={<LocationProbe />} />
        <Route path="/dashboard/runs" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
  container = result.container;
  return result;
}

/** Money cells only — the tab chips carry compact figures ("UGX 300K").
 *  Queried through the DOM rather than by role: a clickable row carries
 *  role="button" (the RunsDesktop idiom), which shadows the implicit row role. */
function rowAmounts() {
  return [...container.querySelectorAll('tbody tr')].map((r) => r.lastElementChild.textContent);
}

/** The metric tile under a given label, for reading its figure unambiguously.
 *  The label is its own element on both bodies, so the tile is its parent. */
function tile(label) {
  return screen.getByText(label).parentElement;
}

beforeEach(() => vi.clearAllMocks());

describe('ContributionsDesktop', () => {
  it('shows only the employee leg for ?leg=employee, and totals it', () => {
    renderBody(ContributionsDesktop, { leg: 'employee' });

    expect(screen.getByRole('heading', { name: 'Staff contributions' })).toBeInTheDocument();
    expect(rowAmounts()).toEqual(['UGX 100,000', 'UGX 120,000', 'UGX 80,000']);
    // 100k + 120k + 80k — the figure the Overview tile the employer clicked shows.
    expect(screen.getByText(/3 payments/)).toBeInTheDocument();
    expect(screen.getByText('UGX 300,000')).toBeInTheDocument();
  });

  it('shows only the employer leg for ?leg=employer, and totals it', () => {
    renderBody(ContributionsDesktop, { leg: 'employer' });

    expect(screen.getByRole('heading', { name: 'Your contributions' })).toBeInTheDocument();
    expect(rowAmounts()).toEqual(['UGX 50,000', 'UGX 30,000', 'UGX 40,000']);
    expect(screen.getByText('UGX 120,000')).toBeInTheDocument();
  });

  it('shows both legs unfiltered, and the two leg totals always', () => {
    renderBody(ContributionsDesktop);

    expect(screen.getByRole('heading', { name: 'All contributions' })).toBeInTheDocument();
    expect(rowAmounts()).toHaveLength(6);
    // Twice over: the "All contributions" tile caption and the table footer.
    expect(screen.getAllByText(/6 payments/)).toHaveLength(2);
    // Both leg tiles are on screen whichever leg is filtered — that's the point
    // of landing here from one tile and wanting to check it against the other.
    expect(within(tile('Paid by staff')).getByText('UGX 300K')).toBeInTheDocument();
    expect(within(tile('Paid by you')).getByText('UGX 120K')).toBeInTheDocument();
  });

  it('names each payment with its run period', () => {
    renderBody(ContributionsDesktop, { leg: 'employer' });
    expect(screen.getAllByText('April 2026 payroll')).toHaveLength(1);
    expect(screen.getAllByText('March 2026 payroll')).toHaveLength(2);
  });

  it('puts the leg in the URL when a tab is picked, so the view is shareable', async () => {
    const user = userEvent.setup();
    renderBody(ContributionsDesktop, { leg: 'employee' });

    await user.click(screen.getByRole('tab', { name: /You/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard/contributions?leg=employer');

    // "All" is the default view, so it clears the param rather than spelling it out.
    await user.click(screen.getByRole('tab', { name: /All/ }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard/contributions');
  });

  it('opens the member a payment was made for', async () => {
    const user = userEvent.setup();
    renderBody(ContributionsDesktop, { leg: 'employer' });

    // Peter has two payments in this leg — either row leads to the same member.
    await user.click(screen.getAllByRole('button', { name: "Open Peter Okot's details" })[0]);
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard/employees/empe-002');
  });

  it('points an employer with no runs yet at the page that makes one', async () => {
    const user = userEvent.setup();
    renderBody(ContributionsDesktop, { payments: [] });

    expect(screen.getByText('No contributions yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to contribution runs' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard/runs');
  });

  it('says so when a leg is empty but other money exists', () => {
    renderBody(ContributionsDesktop, {
      leg: 'employer',
      payments: PAYMENTS.filter((p) => p.source === 'own'),
    });
    expect(screen.getByText('Nothing under this filter')).toBeInTheDocument();
  });
});

describe('ContributionsMobile', () => {
  it('lists the same filtered payments as the desktop body', () => {
    renderBody(ContributionsMobile, { leg: 'employee' });

    expect(screen.getByText(/3 payments/)).toBeInTheDocument();
    expect(screen.getAllByText('Mary Auma')).toHaveLength(2);
    expect(screen.getAllByText('Peter Okot')).toHaveLength(1);
  });

  it('carries both leg totals and switches leg through the URL', async () => {
    const user = userEvent.setup();
    renderBody(ContributionsMobile, { leg: 'employee' });

    // Scoped to the tiles: "UGX 120K" is also a row amount in this leg.
    expect(within(tile('Paid by staff')).getByText('UGX 300K')).toBeInTheDocument();
    expect(within(tile('Paid by you')).getByText('UGX 120K')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'You' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard/contributions?leg=employer');
  });

  it('opens the member a payment was made for', async () => {
    const user = userEvent.setup();
    renderBody(ContributionsMobile, { leg: 'employer' });

    await user.click(screen.getAllByText('Peter Okot')[0]);
    expect(screen.getByTestId('loc')).toHaveTextContent('/dashboard/employees/empe-002');
  });
});
