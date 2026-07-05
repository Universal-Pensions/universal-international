// Tests for the subscriber's two-tab annual-premium + save-to-cover schedule
// editor. Covers: tab structure, annual (not monthly) pricing, held-cover shown
// as locked status rows, and the funding payload the page reads to persist +
// fund newly-added cover (fund_insurance_products).

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubscriberScheduleForm from './SubscriberScheduleForm';

const SCHED = {
  frequency: 'monthly',
  amount: 50000,
  retirementPct: 80,
  emergencyPct: 20,
  includeInsurance: true,
  insuranceFundingMode: 'pay_now',
  insuranceSavingsPct: 100,
  contributionIndexationPct: 0,
};
const HELD_LIFE = [
  { id: 's-1-life', type: 'life', name: 'Life cover', status: 'active', cover: 1_000_000, premiumMonthly: 2_000 },
];

function renderForm(props) {
  return render(<SubscriberScheduleForm initial={SCHED} age={30} onSave={() => {}} {...props} />);
}

describe('<SubscriberScheduleForm />', () => {
  it('renders two tabs and prices cover ANNUALLY (not monthly) on the insurance tab', async () => {
    const user = userEvent.setup();
    renderForm({ heldPolicies: [] });
    expect(screen.getByRole('tab', { name: /Contribution/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Insurance/ }));
    // Health cover priced at its ANNUAL premium (60,000), never "5,000 /mo".
    expect(screen.getByText(/60,000/)).toBeInTheDocument();
    expect(screen.getAllByText('/yr').length).toBeGreaterThan(0);
    expect(screen.queryByText('/mo')).toBeNull();
  });

  it('shows held cover as a locked status row + in the "Your cover" panel', async () => {
    const user = userEvent.setup();
    renderForm({ heldPolicies: HELD_LIFE });
    // The purchased-cover panel is always visible.
    expect(screen.getByText('Your cover')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Insurance/ }));
    const lifeSwitch = screen.getByRole('switch', { name: /Life/ });
    expect(lifeSwitch).toBeChecked();
    expect(lifeSwitch).toHaveAttribute('aria-disabled', 'true'); // can't un-buy held cover
  });

  it('adding new cover (Route A default) emits pay_now + the added product with the TRUE monthly premium', async () => {
    const user = userEvent.setup();
    let saved = null;
    renderForm({ heldPolicies: HELD_LIFE, onSave: (p) => { saved = p; } });
    await user.click(screen.getByRole('tab', { name: /Insurance/ }));
    await user.click(screen.getByRole('switch', { name: /Health/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved).not.toBeNull();
    expect(saved.insuranceFundingMode).toBe('pay_now');
    expect(saved.addedProducts).toEqual([{ product: 'health', cover: 3_000_000, premiumMonthly: 5_000 }]);
    // insuranceTypes = held life + newly-added health (drives include_insurance).
    expect([...saved.insuranceTypes].sort()).toEqual(['health', 'life']);
  });

  it('choosing "Save up for it" emits save_to_cover + the savings split', async () => {
    const user = userEvent.setup();
    let saved = null;
    renderForm({ heldPolicies: [], onSave: (p) => { saved = p; } });
    await user.click(screen.getByRole('tab', { name: /Insurance/ }));
    await user.click(screen.getByRole('switch', { name: /Health/ }));
    await user.click(screen.getByRole('radio', { name: /Save up/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(saved.insuranceFundingMode).toBe('save_to_cover');
    expect(typeof saved.insuranceSavingsPct).toBe('number');
    expect(saved.addedProducts).toEqual([{ product: 'health', cover: 3_000_000, premiumMonthly: 5_000 }]);
  });

  it('reads "No changes to save" (disabled) when a held plan is opened untouched', () => {
    renderForm({ heldPolicies: HELD_LIFE });
    const save = screen.getByRole('button', { name: 'No changes to save' });
    expect(save).toBeDisabled();
  });
});
