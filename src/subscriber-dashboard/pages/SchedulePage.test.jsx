// SchedulePage — the member's OWN contribution schedule, for every member.
//
// This page used to serve two masters. For an employer-sponsored member it
// seeded the amount field with the EMPLOYER's employee leg, locked it ("Set by
// your employer"), and then threw the typed figure away on save and stored 0. So
// one row meant "what my employer deducts" when an employer member looked at it
// and "what I chose to save" for everyone else — and a sponsored member could not
// run a voluntary schedule at all.
//
// The two are now separate concerns:
//   • employer legs  → posted by contribution runs, 100% retirement, fixed in the
//                      run engine, shown read-only in the funding panel.
//   • this schedule  → the member's own amount + split (default 80/20), theirs.
//
// The form itself is stubbed: what changed is SchedulePage's own wiring — what it
// hands the editor as `initial` and what it persists on save — so the stub keeps
// the assertions on exactly that and off the editor's internals.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const updateSchedule = vi.fn(() => Promise.resolve({}));
const formProps = { current: null };

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

// Capture what the page hands the editor, and expose its onSave to the test.
vi.mock('../../components/contribution/SubscriberScheduleForm', () => ({
  default: (props) => {
    formProps.current = props;
    return <div data-testid="schedule-form" />;
  },
}));

const state = {
  sub: null,
  funding: null,
};

vi.mock('../../hooks/useSubscriber', () => ({
  useCurrentSubscriber: () => ({ data: state.sub, isError: false, error: null, refetch: vi.fn() }),
  useUpdateSchedule: () => ({ mutateAsync: updateSchedule }),
  useMakeContribution: () => ({ mutateAsync: vi.fn() }),
  useFundInsuranceProducts: () => ({ mutateAsync: vi.fn() }),
  useContributionPaidThisMonth: () => ({ data: 0 }),
  useMyEmployerFunding: () => ({ data: state.funding }),
}));

const { default: SchedulePage } = await import('./SchedulePage');

// 10% of pay comes out of the member's own wages, 20% is added by the company.
// On 1,000,000 that is an employee leg of 100,000 — a number that must never
// appear as the member's own scheduled amount.
const EMPLOYER_FUNDING = {
  employeePct: 10,
  employerPct: 20,
  compensation: 1_000_000,
  employerName: 'Nile Breweries Demo Ltd',
};
const EMPLOYEE_LEG = 100_000;

const OWN_SCHEDULE = {
  frequency: 'monthly',
  amount: 25_000,
  retirementPct: 80,
  emergencyPct: 20,
  includeInsurance: false,
  insuranceTypes: [],
  contributionIndexationPct: 0,
};

function mount({ funding = null, schedule = OWN_SCHEDULE } = {}) {
  state.funding = funding;
  state.sub = { id: 's-0001', age: 32, policies: [], contributionSchedule: schedule };
  return render(<SchedulePage />);
}

beforeEach(() => {
  updateSchedule.mockClear();
  formProps.current = null;
});

describe('SchedulePage — the member’s schedule is their own', () => {
  it('does not pre-fill an employer member’s amount with the employer’s leg', () => {
    mount({ funding: EMPLOYER_FUNDING });
    // The old behaviour handed the editor `{ ...existing, amount: employeeLeg }`.
    expect(formProps.current.initial.amount).toBe(OWN_SCHEDULE.amount);
    expect(formProps.current.initial.amount).not.toBe(EMPLOYEE_LEG);
  });

  it('hands an employer member the same initial values as a self-pay member', () => {
    mount({ funding: EMPLOYER_FUNDING });
    const sponsored = formProps.current.initial;
    mount({ funding: null });
    expect(sponsored).toEqual(formProps.current.initial);
  });

  it('no longer locks the amount field for employer members', () => {
    mount({ funding: EMPLOYER_FUNDING });
    // `amountLock` told the editor to render the amount read-only as the
    // employer's figure. Decoupled, there is nothing for it to lock.
    expect(formProps.current.amountLock).toBeUndefined();
  });

  it('stores an employer member’s typed amount instead of discarding it as 0', async () => {
    mount({ funding: EMPLOYER_FUNDING });
    await formProps.current.onSave({ ...OWN_SCHEDULE, amount: 40_000 });

    expect(updateSchedule).toHaveBeenCalledTimes(1);
    const saved = updateSchedule.mock.calls[0][0];
    // The bug this pins: `amountToStore = employerFunded ? 0 : schedule.amount`
    // meant a sponsored member's own saving could never be scheduled.
    expect(saved.amount).toBe(40_000);
  });

  it('persists whatever split the member chooses, employer-funded or not', async () => {
    mount({ funding: EMPLOYER_FUNDING });
    // 60/40 is theirs to pick. It governs only their own money — where their
    // employer's runs land is fixed at 100% retirement and never comes near this.
    await formProps.current.onSave({ ...OWN_SCHEDULE, retirementPct: 60, emergencyPct: 40 });

    const saved = updateSchedule.mock.calls[0][0];
    expect(saved.retirementPct).toBe(60);
    expect(saved.emergencyPct).toBe(40);
  });

  it('still shows the employer’s legs read-only, outside the editor', () => {
    mount({ funding: EMPLOYER_FUNDING });
    // Decoupling removed the legs from the SCHEDULE, not from the page — the
    // member should still see what arrives from work, and be told where it goes.
    expect(screen.getByText(/what your job puts in/i)).toBeInTheDocument();
    expect(
      screen.getByText(/all of it goes to your retirement savings/i),
    ).toBeInTheDocument();
    // The employer's own top-up leg is still stated (20% of 1,000,000).
    expect(screen.getByText(/200,000/)).toBeInTheDocument();
  });

  it('shows no employer panel at all for a self-pay member', () => {
    mount({ funding: null });
    expect(screen.queryByText(/what your job puts in/i)).toBeNull();
    expect(screen.getByTestId('schedule-form')).toBeInTheDocument();
  });
});
