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
import { render, screen, within } from '@testing-library/react';
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

// ── Per-product cover amounts ───────────────────────────────────────────────
// The cover step sells three products, each with its own 4-tier ladder. The
// picker lives INSIDE the product card, which forced the card to stop being a
// single <button> (a range input can't nest in one) — so these also guard that
// the switch kept its role and its whole-card accessible name.
describe('<ContributionSettings /> — cover amounts', () => {
  /** Walk page 1 → page 2, where the cover products live. */
  async function gotoCoverPage(user, audience = 'self') {
    await user.click(
      screen.getByRole('button', {
        name: new RegExp(`next: protect ${audience === 'agent' ? 'their' : 'your'} family`, 'i'),
      }),
    );
  }

  // The card's accessible name concatenates its spans with NO separators under
  // jsdom's accname implementation ("LifeLump sum for…"), so anchor at the start
  // without a word boundary. (Playwright's accname does insert spaces — that is
  // why e2e/helpers/contribution.ts can use `^life\b` and this cannot.)
  const card = (product) => screen.getByRole('switch', { name: new RegExp(`^${product}`, 'i') });

  /** The "Cost for one year" readout — scoped so card prices can't collide. */
  const annualCost = () => screen.getByText('Cost for one year').parentElement;

  /** Click a tier inside one product's picker. */
  const pickCover = (user, product, cover) => user.click(
    within(screen.getByRole('group', { name: `${product} cover amount` }))
      .getByRole('button', { name: new RegExp(`^UGX ${cover} cover`) }),
  );

  it('keeps each product card a switch named after the product', async () => {
    const user = userEvent.setup();
    renderCS();
    await gotoCoverPage(user);
    for (const product of ['Life', 'Hospital cash', 'Funeral']) {
      expect(card(product)).toBeInTheDocument();
    }
  });

  it('shows a cover picker only for selected products', async () => {
    const user = userEvent.setup();
    renderCS();
    await gotoCoverPage(user);
    // SCHED selects life only.
    expect(screen.getByRole('group', { name: 'Life cover amount' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Hospital cash cover amount' })).toBeNull();

    await user.click(card('Hospital cash'));
    expect(screen.getByRole('group', { name: 'Hospital cash cover amount' })).toBeInTheDocument();
  });

  it('reprices the card and the annual total when a higher tier is picked', async () => {
    const user = userEvent.setup();
    renderCS();
    await gotoCoverPage(user);

    // Life at the entry tier: 1M cover, 24,000/yr.
    expect(card('Life')).toHaveAccessibleName(/UGX 24,000\/year/);
    expect(annualCost()).toHaveTextContent('UGX 24,000');

    await pickCover(user, 'Life', '5,000,000');

    // Card price, card payout, and "Cost for one year" all follow the tier.
    expect(card('Life')).toHaveAccessibleName(/UGX 90,000\/year/);
    expect(card('Life')).toHaveAccessibleName(/Pays UGX 5,000,000/);
    expect(annualCost()).toHaveTextContent('UGX 90,000');
  });

  it('sums the annual cost across products at their chosen tiers', async () => {
    const user = userEvent.setup();
    renderCS();
    await gotoCoverPage(user);

    await user.click(card('Funeral'));
    // Life 1M (24,000) + funeral 2M (18,000) = 42,000.
    expect(annualCost()).toHaveTextContent('UGX 42,000');

    await pickCover(user, 'Funeral', '8,000,000');
    // Life 24,000 + funeral 8M (60,000) = 84,000.
    expect(annualCost()).toHaveTextContent('UGX 84,000');
  });

  it('remembers a product’s chosen tier across a deselect/reselect', async () => {
    const user = userEvent.setup();
    renderCS();
    await gotoCoverPage(user);

    await pickCover(user, 'Life', '3,000,000');
    await user.click(card('Life')); // off
    await user.click(card('Life')); // on again

    expect(card('Life')).toHaveAccessibleName(/Pays UGX 3,000,000/);
  });

  it('restores the cover tiers a saved schedule was built with', async () => {
    const user = userEvent.setup();
    renderCS({
      initial: { ...SCHED, insuranceTypes: ['life', 'health'], insuranceCovers: { life: 2_000_000, health: 12_000_000 } },
    });
    await gotoCoverPage(user);

    expect(card('Life')).toHaveAccessibleName(/Pays UGX 2,000,000/);
    expect(card('Hospital cash')).toHaveAccessibleName(/Pays UGX 12,000,000/);
  });

  it('defaults every product to its entry tier when the schedule predates cover amounts', async () => {
    const user = userEvent.setup();
    renderCS({ initial: { ...SCHED, insuranceTypes: ['life', 'health', 'funeral'] } });
    await gotoCoverPage(user);

    expect(card('Life')).toHaveAccessibleName(/Pays UGX 1,000,000/);
    expect(card('Hospital cash')).toHaveAccessibleName(/Pays UGX 3,000,000/);
    expect(card('Funeral')).toHaveAccessibleName(/Pays UGX 2,000,000/);
  });

  it('keeps the cover picker labels audience-neutral for an agent', async () => {
    const user = userEvent.setup();
    // Not `embedded` — audience and embedding are independent (see above), and
    // the embedded branch scrollIntoViews on page change, which jsdom lacks.
    renderCS({ audience: 'agent' });
    await gotoCoverPage(user, 'agent');
    // The picker names the PRODUCT, not the person — nothing to switch.
    expect(screen.getByRole('group', { name: 'Life cover amount' })).toBeInTheDocument();
  });
});

// The employer-invite completion (`collectSchedule={false}`). This screen used
// to be "Split your savings" — a retirement/liquid slider shown to every member
// their employer onboards. It collected the ONE thing that member could still
// change, and the only money it could act on was their employer's: they state no
// amount at all, so at the maximum liquid setting it diverted 40% of every
// payroll deduction and company top-up into a pot they can empty at any time.
// Employer-funded money now goes wholly to retirement (migration 0102), so the
// question is gone and this screen confirms rather than asks.
describe('<ContributionSettings /> — employer-invite completion', () => {
  const renderInvite = (props) => renderCS({ collectSchedule: false, initial: null, ...props });

  it('asks for no split — no slider, no percentages', () => {
    renderInvite();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByLabelText(/retirement savings percentage/i)).toBeNull();
    // …and nothing on screen quotes a share of their money.
    expect(document.body.textContent).not.toMatch(/\d+\s*%/);
  });

  it('collects nothing else either — no amount, frequency, cover or payment', () => {
    renderInvite();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: /^pay/i })).toBeNull();
  });

  it('tells the member where their employer’s money goes', () => {
    renderInvite();
    expect(screen.getByRole('heading', { name: /finish setting up/i })).toBeInTheDocument();
    expect(screen.getByLabelText('What happens to your money')).toHaveTextContent(/retirement/i);
  });

  it('creates the member’s own schedule at the 80/20 default, ignoring a stale draft', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    // A stale localStorage draft still carrying the old slider's value must not
    // leak through — the RPC reads this payload.
    renderInvite({ initial: { ...SCHED, retirementPct: 60, emergencyPct: 40 }, onConfirm });

    await user.click(screen.getByRole('button', { name: /finish enrolment/i }));
    // 80/20, NOT the employer's 100/0 allocation. This row is the member's own
    // dormant schedule; where their employer's runs land is a separate, fixed
    // thing they never see here. Pinning it to 100/0 would decide their split for
    // them off the back of their employer's arrangement.
    expect(onConfirm).toHaveBeenCalledWith({ retirementPct: 80, emergencyPct: 20 });
  });
});
