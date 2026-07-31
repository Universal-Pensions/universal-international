// RTL tests for the v5 HomeDesktop redesign.
//
// The load-bearing invariant: Retirement + Emergency are the two pots that sum
// to net balance, so their two share-of-balance percentages MUST sum to exactly
// 100. Rounding each pot's share independently can yield 101% (when both
// fractional parts are .5); the fix derives the emergency share as the
// complement of the rounded retirement share. This test pins a balance whose
// naive rounding would print 84% + 17% = 101% and asserts the emergency share
// is the complement (16%), not the independently-rounded 17%.
//
// Plus smoke assertions for the rebuilt hero / KPI / cards, and the
// "How your pension is funded" block under the UNIFIED two-leg model (0092).
//
// ── What changed about the funding block, and why these tests look like this ──
// The block used to be gated on `sub.employerId` alone and reverse-engineered the
// employer's money out of the transactions feed — the monthly figure came out of
// the member's OWN leg, which hardcoded the deleted employer-match basis, and a
// missing feed fell through to a hardcoded 1/3 employer share. Both of those are
// gone. The two legs now come from `useMyEmployerFunding()` (the narrow 0092 RPC)
// and are multiplied by the member's compensation through `deriveContributionLegs`.
//
// Three consequences these tests pin, because each one is a state the old code
// could not render correctly:
//   * The block is gated on the CONFIGURED RATE, not on `employerId` and not on
//     the shilling result. `employerId` set + funding null (RPC not loaded, or the
//     member isn't actually sponsored) shows nothing, and a legal 0/0 employer
//     configuration shows nothing — where the old gate printed
//     "Your employer tops up your pension" above "UGX 0 · 0%".
//   * ONE TILE PER NON-ZERO LEG. Either leg may be zero, so a member whose whole
//     pension is employer-paid gets a single tile and no "from your pay" claim.
//   * The header chip and the block tag both read "Employer-sponsored", so the
//     >= 2 count only holds when the block actually renders — with funding null or
//     0/0 the phrase appears exactly ONCE.

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { memberFundingSummary } from '../../utils/contributionModel';

// Reduced motion → useCountUp snaps to the resolved balance (no rAF timing),
// keeping the rendered figures deterministic.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useReducedMotion: () => true };
});

// HomeDesktop calls these React Query hooks directly (employer funding config +
// accumulated own/employer history + activity); stub them so the unit test needs no
// QueryClient / network. Hoisted so each test can set the return value it needs —
// the funding hook drives every branch of the funding surface.
const hookState = vi.hoisted(() => ({ funding: undefined, breakdown: undefined, transactions: [] }));

vi.mock('../../hooks/useSubscriber', () => ({
  useMyEmployerFunding: () => ({ data: hookState.funding }),
  useContributionBreakdown: () => ({ data: hookState.breakdown }),
  useSubscriberTransactions: () => ({ data: hookState.transactions }),
}));

const { default: HomeDesktop } = await import('./HomeDesktop');

// Default: a self-signup member with no employer funding and no history feed.
beforeEach(() => {
  hookState.funding = null;
  hookState.breakdown = undefined;
  hookState.transactions = [];
});

// Scope money assertions to the funding block. A single-leg member's leg figure is
// ALSO printed in the hero caption ("Your pension gets UGX 70,000 each month"), so
// an unscoped getByText on the amount is ambiguous. CSS Modules are identity-mapped
// under Vitest, so the source class name is the rendered one.
const fundingBlock = () => within(document.querySelector('.emp'));

function renderHome(subscriber) {
  return render(
    <MemoryRouter>
      <HomeDesktop subscriber={subscriber} />
    </MemoryRouter>,
  );
}

const SPLIT_FIXTURE = {
  name: 'Mary Aol',
  netBalance: 2_000_000,
  retirementBalance: 1_670_000, // 83.5%
  emergencyBalance: 330_000, //    16.5%
};

const EMPLOYER_MEMBER = { ...SPLIT_FIXTURE, id: 'empe-002', employerId: 'emp-001' };

// The `get_my_employer_funding` payload: the six canonical keys + the member's
// MONTHLY compensation + the employer name. 10% of 1.4M = 140,000 from pay;
// 5% of 1.4M = 70,000 added by the employer. Both legs are independent shares of
// compensation — the 70,000 is NOT derived from the 140,000.
const FUNDING_BOTH_LEGS = {
  employerName: 'Nile Breweries Ltd',
  compensation: 1_400_000,
  employeePct: 10,
  employerPct: 5,
};

describe('<HomeDesktop /> savings split', () => {
  it('retirement + emergency shares sum to exactly 100 (complement rounding)', () => {
    renderHome(SPLIT_FIXTURE);

    // The "Your savings & cover" card prints each pot's share in its sub-line.
    // 83.5 → 84 (direct round); 16.5 → 16 (the COMPLEMENT, not the naive 17).
    expect(screen.getByText(/^84% ·/)).toBeInTheDocument();
    expect(screen.getByText(/^16% ·/)).toBeInTheDocument();
    // Independent rounding of 16.5 would print 17% — the complement rule must not.
    expect(screen.queryByText(/^17% ·/)).not.toBeInTheDocument();
  });
});

describe('<HomeDesktop /> content', () => {
  it('renders the v5 hero, KPI row and savings & cover labels', () => {
    renderHome({
      ...SPLIT_FIXTURE,
      unitsHeld: 2000,
      insurance: { cover: 5_000_000, premiumMonthly: 2_000, status: 'active' },
    });

    expect(screen.getByText('Total balance')).toBeInTheDocument();
    expect(screen.getByText('Amount invested')).toBeInTheDocument();
    expect(screen.getByText('Investment growth')).toBeInTheDocument();
    expect(screen.getByText('Saved this month')).toBeInTheDocument();
    expect(screen.getByText(/Your savings & cover/)).toBeInTheDocument();
    expect(screen.getByText('Retirement fund')).toBeInTheDocument();
    expect(screen.getByText('Emergency fund')).toBeInTheDocument();
    expect(screen.getByText('Insurance cover')).toBeInTheDocument();
  });
});

describe('<HomeDesktop /> funding block — gating', () => {
  it('renders nothing for a self-signup member (no employer, no funding)', () => {
    renderHome(SPLIT_FIXTURE);
    expect(screen.queryByText('How your pension is funded')).not.toBeInTheDocument();
    expect(screen.queryByText('Employer-sponsored')).not.toBeInTheDocument();
    expect(screen.queryByText('From your pay')).not.toBeInTheDocument();
  });

  it('shows the header chip ONCE but no funding block when the funding read is null', () => {
    // `employerId` is set on the subscriber row, but get_my_employer_funding
    // returned null (not sponsored, or the query hasn't resolved). The old gate
    // read `employerId` and would have rendered the block with zeros.
    hookState.funding = null;
    renderHome(EMPLOYER_MEMBER);
    expect(screen.getAllByText('Employer-sponsored')).toHaveLength(1);
    expect(screen.queryByText('How your pension is funded')).not.toBeInTheDocument();
  });

  it('shows no funding block for a legal 0/0 employer configuration', () => {
    // 0/0 saves successfully and funds no pension. There is nothing true to say,
    // so the surface hides rather than claiming "UGX 0 on top of your savings".
    hookState.funding = {
      employerName: 'Nile Breweries Ltd',
      compensation: 1_400_000,
      employeePct: 0,
      employerPct: 0,
    };
    renderHome(EMPLOYER_MEMBER);
    expect(screen.getAllByText('Employer-sponsored')).toHaveLength(1);
    expect(screen.queryByText('How your pension is funded')).not.toBeInTheDocument();
    expect(memberFundingSummary(hookState.funding, 'Nile Breweries Ltd')).toBeNull();
  });

  it('renders the block + both chips when the employer funds a leg', () => {
    hookState.funding = FUNDING_BOTH_LEGS;
    renderHome(EMPLOYER_MEMBER);
    expect(screen.getByText('How your pension is funded')).toBeInTheDocument();
    // The content-top chip AND the block tag both read "Employer-sponsored".
    expect(screen.getAllByText('Employer-sponsored').length).toBeGreaterThanOrEqual(2);
  });

  it('does not resurrect the retired employer-match copy', () => {
    hookState.funding = FUNDING_BOTH_LEGS;
    renderHome(EMPLOYER_MEMBER);
    // "tops up" framed the employer leg as a bonus on the member's own saving —
    // the deleted match basis. Both legs are now independent shares of pay.
    expect(screen.queryByText('Your employer tops up your pension')).not.toBeInTheDocument();
    expect(screen.queryByText(/You’ve contributed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your employer added/)).not.toBeInTheDocument();
    expect(screen.queryByText(/on top of your savings/)).not.toBeInTheDocument();
  });
});

describe('<HomeDesktop /> funding block — one tile per non-zero leg', () => {
  it('shows both tiles with each leg derived independently from compensation', () => {
    hookState.funding = FUNDING_BOTH_LEGS;
    renderHome(EMPLOYER_MEMBER);

    // 10% of 1,400,000 — deducted from pay and remitted by the employer.
    expect(screen.getByText('From your pay')).toBeInTheDocument();
    expect(screen.getByText('UGX 140,000')).toBeInTheDocument();
    expect(screen.getByText('10% of your pay — every month')).toBeInTheDocument();

    // 5% of 1,400,000 — the employer's own money. REGRESSION GUARD: under the
    // deleted match basis this leg was `employeeLeg × matchPct/100`, so it moved
    // when the member's leg moved. It is now 5% of PAY in its own right.
    expect(screen.getByText('From Nile Breweries Ltd')).toBeInTheDocument();
    expect(screen.getByText('UGX 70,000')).toBeInTheDocument();
    expect(screen.getByText('5% of your pay — every month')).toBeInTheDocument();

    // The plain-language summary sentence under the tiles.
    expect(screen.getByText('10% of your pay, plus 5% of your pay from Nile Breweries Ltd.')).toBeInTheDocument();
  });

  it('shows only the employer tile when the whole pension is employer-paid', () => {
    // Employee leg zero — a state the old mode-switched model called
    // "employer-only" and the old subscriber Home mislabelled as the member's own
    // saving. No "From your pay" tile may appear.
    hookState.funding = {
      ...FUNDING_BOTH_LEGS,
      employeePct: 0,
    };
    renderHome(EMPLOYER_MEMBER);
    expect(screen.getByText('How your pension is funded')).toBeInTheDocument();
    expect(screen.queryByText('From your pay')).not.toBeInTheDocument();
    expect(fundingBlock().getByText('From Nile Breweries Ltd')).toBeInTheDocument();
    expect(fundingBlock().getByText('UGX 70,000')).toBeInTheDocument();
    expect(
      screen.getByText('Nile Breweries Ltd pays your whole pension — 5% of your pay, at no cost to you.'),
    ).toBeInTheDocument();
  });

  it('shows only the pay tile when the employer adds nothing on top', () => {
    hookState.funding = {
      ...FUNDING_BOTH_LEGS,
      employerPct: 0,
    };
    renderHome(EMPLOYER_MEMBER);
    expect(fundingBlock().getByText('From your pay')).toBeInTheDocument();
    expect(fundingBlock().getByText('UGX 140,000')).toBeInTheDocument();
    expect(screen.queryByText('From Nile Breweries Ltd')).not.toBeInTheDocument();
    expect(
      screen.getByText('Nile Breweries Ltd sends 10% of your pay to your pension each month.'),
    ).toBeInTheDocument();
  });

  it('states each leg as a share of pay', () => {
    // Migration 0093 removed the flat-UGX basis: a leg is always a percentage, so
    // both rate lines quote a percentage and neither can restate its own figure.
    hookState.funding = FUNDING_BOTH_LEGS;
    renderHome(EMPLOYER_MEMBER);
    expect(fundingBlock().getByText('UGX 140,000')).toBeInTheDocument(); // 10% of pay
    expect(fundingBlock().getByText('UGX 70,000')).toBeInTheDocument(); // 5% of pay
    expect(fundingBlock().getByText('10% of your pay — every month')).toBeInTheDocument();
    expect(fundingBlock().getByText('5% of your pay — every month')).toBeInTheDocument();
  });
});

describe('<HomeDesktop /> funding block — accumulated history', () => {
  it('omits the history bar when the contribution feed has nothing to measure', () => {
    // The deleted 1/3 fallback invented an employer share here. deriveEmployerSplit
    // now reports `unknown`, so the bar and the "So far …" sentence don't render —
    // while the CONFIGURED tiles above still do.
    hookState.funding = FUNDING_BOTH_LEGS;
    hookState.breakdown = undefined;
    renderHome(EMPLOYER_MEMBER);
    expect(screen.getByText('From your pay')).toBeInTheDocument();
    expect(screen.queryByText(/^So far/)).not.toBeInTheDocument();
  });

  it('renders the history bar from the member real own:employer feed', () => {
    hookState.funding = FUNDING_BOTH_LEGS;
    hookState.breakdown = { own: 700_000, employer: 350_000 };
    renderHome(EMPLOYER_MEMBER);
    // The bar is re-scaled onto the derived principal, so pin the sentence's SHAPE
    // rather than a figure that moves with deriveInvestmentGrowth.
    expect(screen.getByText(/^So far/).textContent).toMatch(
      /^So far UGX [\d,]+ has come from your pay and UGX [\d,]+ from Nile Breweries Ltd\.$/,
    );
    // The bar itself is a labelled graphic — the two shares must sum to 100.
    const bar = screen.getByRole('img', { name: /from your pay/ });
    const [ownPct, empPct] = bar.getAttribute('aria-label').match(/\d+/g).map(Number);
    expect(ownPct + empPct).toBe(100);
  });
});

describe('<HomeDesktop /> hero for an employer-funded member', () => {
  it('offers only a top-up — never "Set a schedule" for money already arriving', () => {
    // An employer-funded member with no schedule of their own has nothing to set
    // up: both legs are configured by their employer and posted by the payroll run.
    hookState.funding = FUNDING_BOTH_LEGS;
    renderHome(EMPLOYER_MEMBER);
    expect(screen.queryByText('Set a schedule')).not.toBeInTheDocument();
    expect(screen.getByText(/Your pension gets/)).toBeInTheDocument();
    // 140,000 + 70,000 lands every month without the member doing anything.
    expect(screen.getByText('UGX 210,000')).toBeInTheDocument();
  });

  it('still prompts a self-pay member with no schedule to set one up', () => {
    hookState.funding = null;
    renderHome(SPLIT_FIXTURE);
    expect(screen.getByText('Set a schedule')).toBeInTheDocument();
    expect(screen.getByText('Start saving')).toBeInTheDocument();
  });

  it('counts both employer legs into "Saved this month" with one clause per source', () => {
    hookState.funding = FUNDING_BOTH_LEGS;
    renderHome(EMPLOYER_MEMBER);
    // No schedule of their own, so the figure is purely the two employer legs.
    expect(screen.getByText('+UGX 210,000')).toBeInTheDocument();
    expect(
      screen.getByText('UGX 140,000 from your pay + UGX 70,000 from Nile Breweries Ltd.'),
    ).toBeInTheDocument();
  });
});
