// ContributionSettings is shared by TWO hosts: the subscriber's own
// /signup/contribution route (owns the viewport) and the agent onboarding
// wizard's Schedule stage (`embedded`, hosted inside the agent shell). These
// tests pin the two things that differ, since a regression in either is silent:
//
//  - `embedded` must surrender the page chrome. A second <main> is a duplicate
//    landmark (both agent shells already render `<main id="main">`, which is also
//    the skip-link target), SignupTopbar's `<Link to="/">` exits would drop an
//    agent out of their dashboard mid-onboarding, and its document-level Escape
//    handler would step the HOST wizard back a stage on any unrelated Escape.
//  - Copy must switch to third person under OnboardAudienceContext, because the
//    agent is not the data subject.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OnboardAudienceProvider } from '../OnboardAudienceContext';
import ContributionSettings from './ContributionSettings';

const SCHED = {
  frequency: 'monthly',
  amount: 50000,
  retirementPct: 80,
  emergencyPct: 20,
  includeInsurance: true,
  insuranceTypes: ['life'],
  insuranceFundingMode: 'pay_now',
  insuranceSavingsPct: 50,
  contributionIndexationPct: 5,
};

// SignupTopbar renders <Link>, so the un-embedded tree needs a router. The
// embedded tree doesn't, but wrapping both keeps the two paths comparable.
function renderCS({ audience = 'self', ...props } = {}) {
  return render(
    <MemoryRouter>
      <OnboardAudienceProvider value={audience}>
        <ContributionSettings
          initial={SCHED}
          dob="1990-01-01"
          phone="700000001"
          onClose={() => {}}
          onConfirm={() => {}}
          {...props}
        />
      </OnboardAudienceProvider>
    </MemoryRouter>,
  );
}

describe('<ContributionSettings /> — embedded mode', () => {
  it('renders its own <main> landmark and the signup topbar when NOT embedded', () => {
    renderCS();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByLabelText('Exit signup')).toBeInTheDocument();
  });

  it('renders NO <main> landmark and no signup topbar when embedded', () => {
    renderCS({ embedded: true });
    // The host owns the landmark; a second one would be a duplicate.
    expect(screen.queryAllByRole('main')).toHaveLength(0);
    expect(screen.queryByLabelText('Exit signup')).toBeNull();
    // ...but the wizard body itself is fully present.
    expect(screen.getByRole('tablist', { name: /set up steps/i })).toBeInTheDocument();
  });

  it('retargets the close button at the host step when embedded', () => {
    const { unmount } = renderCS();
    expect(screen.getByLabelText('Close contribution setup')).toBeInTheDocument();
    unmount();

    renderCS({ embedded: true });
    expect(screen.getByLabelText('Back to the KYC step')).toBeInTheDocument();
  });

  it('closes on Escape when NOT embedded, but ignores it when embedded', async () => {
    const user = userEvent.setup();

    const selfClose = vi.fn();
    const { unmount } = renderCS({ onClose: selfClose });
    await user.keyboard('{Escape}');
    expect(selfClose).toHaveBeenCalledTimes(1);
    unmount();

    // Embedded, `onClose` steps the host wizard back to KYC — so an Escape aimed
    // at some other agent-dashboard surface must not discard the schedule.
    const agentClose = vi.fn();
    renderCS({ embedded: true, onClose: agentClose });
    await user.keyboard('{Escape}');
    expect(agentClose).not.toHaveBeenCalled();
  });
});

describe('<ContributionSettings /> — audience copy', () => {
  it('uses second-person copy for the subscriber signing themselves up', () => {
    renderCS();
    expect(screen.getByRole('tab', { name: /your savings/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /protect your family/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next: protect your family/i })).toBeInTheDocument();
  });

  it('switches to third-person copy for an agent onboarding someone else', () => {
    renderCS({ audience: 'agent', embedded: true });
    expect(screen.getByRole('tab', { name: /their savings/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /protect their family/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next: protect their family/i })).toBeInTheDocument();
    // No "your" phrasing left on the visible page-1 panel.
    expect(screen.queryByRole('tab', { name: /your savings/i })).toBeNull();
  });

  it('keeps audience and embedding independent (agent copy without embedding)', () => {
    renderCS({ audience: 'agent' });
    expect(screen.getByRole('tab', { name: /their savings/i })).toBeInTheDocument();
    // Still owns the chrome — `embedded` was not passed.
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
});
