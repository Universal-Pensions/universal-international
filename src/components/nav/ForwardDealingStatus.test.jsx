// The go/no-go panel for forward dealing.
//
// The assertion that matters most in this file is the error one. Everything else
// is presentation; that one is the difference between "we did not manage to
// check" and "all clear", and an admin who reads the second when the first is
// true will flip a switch that moves every member's money.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ForwardDealingStatus from './ForwardDealingStatus';

const READY = {
  fundCode: 'UPU-BAL', pricingEnabled: true, ready: true,
  blockers: [], warnings: [],
  cutoffLocalTime: '14:00:00', timezone: 'Africa/Kampala',
};

describe('<ForwardDealingStatus />', () => {
  it('says it is checking while the report loads', () => {
    render(<ForwardDealingStatus isLoading />);
    expect(screen.getByText('Checking…')).toBeInTheDocument();
  });

  it('renders nothing before there is anything to report', () => {
    const { container } = render(<ForwardDealingStatus readiness={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports a FAILED check as unchecked — never as all clear', () => {
    render(<ForwardDealingStatus error={new Error('permission denied')} />);
    const alert = screen.getByRole('alert');
    // The wording has to leave no room to read this as a pass. Matching the bare
    // word "safe" would be wrong — the copy asks whether the fund IS safe, which
    // is the question, not an answer. What must be absent is any of the
    // AFFIRMATIVE verdicts this component can otherwise render.
    expect(alert).toHaveTextContent(/not checked/i);
    for (const verdict of [
      /all clear/i,
      /running normally/i,
      /safe to switch on/i,
    ]) {
      expect(alert).not.toHaveTextContent(verdict);
    }
    expect(alert).toHaveAttribute('data-kind', 'blocker');
  });

  it('confirms a healthy running fund, and names the cut-off', () => {
    render(<ForwardDealingStatus readiness={READY} />);
    expect(screen.getByText(/Running normally/)).toBeInTheDocument();
    // Seconds trimmed — "14:00", not "14:00:00".
    expect(screen.getByText(/Cut-off 14:00, Africa\/Kampala/)).toBeInTheDocument();
  });

  it('distinguishes switched-off-and-safe from switched-off-and-not', () => {
    const { rerender } = render(
      <ForwardDealingStatus readiness={{ ...READY, pricingEnabled: false, ready: true }} />,
    );
    expect(screen.getByText(/safe to switch on/)).toBeInTheDocument();

    rerender(
      <ForwardDealingStatus readiness={{
        ...READY, pricingEnabled: false, ready: false,
        blockers: ['4 business day(s) have no published price, oldest 2026-08-20.'],
      }} />,
    );
    expect(screen.getByText(/Fix the points below/)).toBeInTheDocument();
  });

  it('warns when the fund is RUNNING but something is wrong', () => {
    // The most dangerous state: live, and not clean. It must not read as either
    // "all fine" or "switched off".
    render(<ForwardDealingStatus readiness={{
      ...READY, pricingEnabled: true, ready: false,
      blockers: ['2 transaction(s) are already pending.'],
    }} />);
    expect(screen.getByText(/Running, but something below needs attention/)).toBeInTheDocument();
  });

  it('lists blockers and warnings, tagged so they can be told apart', () => {
    render(<ForwardDealingStatus readiness={{
      ...READY, ready: false,
      blockers: ['The register is 4 days behind.'],
      warnings: ['No movable holidays are entered for the next 12 months.'],
    }} />);
    expect(screen.getByText('The register is 4 days behind.'))
      .toHaveAttribute('data-kind', 'blocker');
    expect(screen.getByText('No movable holidays are entered for the next 12 months.'))
      .toHaveAttribute('data-kind', 'warning');
  });

  it('puts blockers above warnings — "not now" before "not for long"', () => {
    render(<ForwardDealingStatus readiness={{
      ...READY, ready: false,
      blockers: ['BLOCKER TEXT'],
      warnings: ['WARNING TEXT'],
    }} />);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['BLOCKER TEXT', 'WARNING TEXT']);
  });

  it('shows no list at all when there is nothing to fix', () => {
    render(<ForwardDealingStatus readiness={READY} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('survives a payload whose arrays are missing', () => {
    // jsonb `[]` should always arrive as an array, but a defensive render beats
    // a crashed admin page on the one panel that reports safety.
    render(<ForwardDealingStatus readiness={{
      ...READY, blockers: undefined, warnings: undefined,
    }} />);
    expect(screen.getByText(/Running normally/)).toBeInTheDocument();
  });
});
