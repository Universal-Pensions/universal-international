// The algebra of a member's balance — migration 0146 (Phase 4 of the
// unitization redesign).
//
// A member's money sits in three states and the UI shows two different sums of
// them. Getting either wrong is a money bug that no other test in this repo
// would catch:
//
//   * overstate WITHDRAWABLE and the member is offered money that is not there
//     — either not yet invested, already on its way out, or already spoken for
//     by a withdrawal waiting for its dealing date;
//   * understate the TOTAL and money appears to vanish for up to three business
//     days between paying in and units being bought.
//
// These properties are asserted on NON-ZERO fixtures. That matters: until
// 0147 flips `pricing_enabled`, every pending column on live is 0 and every
// figure below collapses to the pre-0146 value — so a live smoke test proves
// nothing about this arithmetic. Only fixtures can.

import { describe, it, expect } from 'vitest';
import { deriveBalanceFigures } from '../utils/balanceComponents';
import { deriveInvestmentGrowth } from '../utils/finance';

/** A member mid-cycle: money in, money out, and a redemption on hold. */
const busy = {
  total_balance: 1_000_000,
  retirement_balance: 800_000,
  emergency_balance: 200_000,
  pending_contribution_retirement: 40_000,
  pending_contribution_emergency: 10_000,
  pending_payout_retirement: 30_000,
  pending_payout_emergency: 5_000,
  pending_redemption_retirement: 60_000,
  pending_redemption_emergency: 20_000,
  units: 630.718954,
  invested: 900_000,
};

/** The steady state: nothing in flight. This is every member on live today. */
const quiet = {
  total_balance: 1_000_000,
  retirement_balance: 800_000,
  emergency_balance: 200_000,
  pending_contribution_retirement: 0,
  pending_contribution_emergency: 0,
  pending_payout_retirement: 0,
  pending_payout_emergency: 0,
  pending_redemption_retirement: 0,
  pending_redemption_emergency: 0,
  units: 630.718954,
  invested: 900_000,
};

describe('deriveBalanceFigures', () => {
  it('the two displayed pots sum to the headline, exactly', () => {
    const f = deriveBalanceFigures(busy);
    // This is what makes the two pot cards add up to the hero number on screen.
    expect(f.retirementBalance + f.emergencyBalance).toBe(f.netBalance);
  });

  it('the headline is allocated + money in + money out', () => {
    const f = deriveBalanceFigures(busy);
    expect(f.netBalance).toBe(1_000_000 + 40_000 + 10_000 + 30_000 + 5_000);
  });

  it('withdrawable excludes BOTH kinds of pending money', () => {
    const f = deriveBalanceFigures(busy);
    // Not the 85,000 of contributions-in-flight (bought nothing yet) and not
    // the 35,000 of payouts-in-flight (units already sold).
    expect(f.withdrawableBalance).toBeLessThan(f.netBalance);
    expect(f.withdrawableBalance).toBe(1_000_000 - 60_000 - 20_000);
  });

  it('withdrawable subtracts the redemption hold per bucket', () => {
    const f = deriveBalanceFigures(busy);
    expect(f.withdrawableRetirement).toBe(800_000 - 60_000);
    expect(f.withdrawableEmergency).toBe(200_000 - 20_000);
    expect(f.withdrawableRetirement + f.withdrawableEmergency).toBe(f.withdrawableBalance);
  });

  it('withdrawable never exceeds the headline', () => {
    for (const b of [busy, quiet]) {
      const f = deriveBalanceFigures(b);
      expect(f.withdrawableBalance).toBeLessThanOrEqual(f.netBalance);
    }
  });

  it('the allocated figures are untouched — AUM and the publish guard read these', () => {
    const f = deriveBalanceFigures(busy);
    // assert_book_revaluable() computes sum(total_balance)/sum(units) and
    // refuses to publish on >2% drift. If pending money ever leaked into this
    // figure, every NAV publish would start failing.
    expect(f.allocatedBalance).toBe(1_000_000);
    expect(f.allocatedRetirement).toBe(800_000);
    expect(f.allocatedEmergency).toBe(200_000);
  });

  it('with nothing in flight, every figure collapses to the pre-0146 value', () => {
    const f = deriveBalanceFigures(quiet);
    expect(f.netBalance).toBe(1_000_000);
    expect(f.withdrawableBalance).toBe(1_000_000);
    expect(f.retirementBalance).toBe(800_000);
    expect(f.emergencyBalance).toBe(200_000);
    expect(f.withdrawableRetirement).toBe(800_000);
    expect(f.withdrawableEmergency).toBe(200_000);
  });

  it('a null row reads as an all-zero member rather than throwing', () => {
    const f = deriveBalanceFigures(null);
    expect(f.netBalance).toBe(0);
    expect(f.withdrawableBalance).toBe(0);
  });

  it('NO JUMP: allocating a pending contribution at the book price leaves the total unmoved', () => {
    // The brief's headline property, in arithmetic. A contribution of 50,000
    // sits pending; when it is allocated at the book price it buys units worth
    // 50,000 and moves from (2) into (1). The member's total must not move.
    const before = deriveBalanceFigures({
      ...quiet,
      pending_contribution_retirement: 40_000,
      pending_contribution_emergency: 10_000,
    });
    const after = deriveBalanceFigures({
      ...quiet,
      total_balance: 1_050_000,
      retirement_balance: 840_000,
      emergency_balance: 210_000,
    });
    expect(after.netBalance).toBe(before.netBalance);
    // …and the money becomes withdrawable only at that moment, not before.
    expect(before.withdrawableBalance).toBe(1_000_000);
    expect(after.withdrawableBalance).toBe(1_050_000);
  });

  it('NO JUMP: liquidating a held redemption leaves the total unmoved', () => {
    // 80,000 requested and on hold: units still owned, so the total is
    // unchanged and only withdrawable has fallen.
    const held = deriveBalanceFigures(quiet);
    const onHold = deriveBalanceFigures({
      ...quiet,
      pending_redemption_retirement: 60_000,
      pending_redemption_emergency: 20_000,
    });
    expect(onHold.netBalance).toBe(held.netBalance);
    expect(onHold.withdrawableBalance).toBe(held.withdrawableBalance - 80_000);

    // Struck: units cancelled, value moved into (3) awaiting payment. The total
    // is STILL unchanged — the member has not been paid yet.
    const struck = deriveBalanceFigures({
      ...quiet,
      total_balance: 920_000,
      retirement_balance: 740_000,
      emergency_balance: 180_000,
      pending_payout_retirement: 60_000,
      pending_payout_emergency: 20_000,
    });
    expect(struck.netBalance).toBe(held.netBalance);
    expect(struck.withdrawableBalance).toBe(920_000);
  });
});

describe('deriveInvestmentGrowth reads ALLOCATED value, never the headline', () => {
  it('does not count money in flight as growth', () => {
    const f = deriveBalanceFigures(busy);
    const g = deriveInvestmentGrowth({ ...f, invested: 900_000 });
    // Allocated 1,000,000 against a 900,000 basis = 100,000 of real growth.
    // Reading the 1,085,000 headline instead would report 185,000 — an 85%
    // overstatement, on money that has never been in the market.
    expect(g.growth).toBe(100_000);
    expect(g.invested).toBe(900_000);
  });

  it('falls back to netBalance for a pre-0146 shape', () => {
    const g = deriveInvestmentGrowth({ netBalance: 1_000_000, invested: 900_000 });
    expect(g.growth).toBe(100_000);
  });
});

// ── The balance-growth series must not double-count money in flight ──────────
//
// deriveSubscriberAnalytics anchors its chart as `opening = balance − Σdeltas`
// and walks forward, so the anchor and the deltas have to describe the SAME
// money. Forward dealing breaks that in exactly one direction:
//
//   a pending CONTRIBUTION is in the anchor AND in the deltas → they cancel;
//   a pending WITHDRAWAL is in the deltas but its value has NOT left the
//   member's total → the opening balance is inflated by the amount, and every
//   month of the member's history shifts upward until the payout settles.
//
// A member would open their chart after asking for money and find that their
// past had changed. Guarded here because nothing else would catch it: the live
// figures are identical while the kill switch is off.

describe('deriveSubscriberAnalytics — money in flight', () => {
  const SUB = {
    netBalance: 1_085_000,       // allocated + in-flight
    allocatedBalance: 1_000_000, // units actually held
    retirementBalance: 800_000,
    emergencyBalance: 200_000,
    unitsHeld: 630.718954,
    invested: 900_000,
  };

  it('a withdrawal still waiting for its price does not move the historical curve', async () => {
    const { deriveSubscriberAnalytics } = await import(
      '../subscriber-dashboard/reports/deriveSubscriberAnalytics'
    );
    const settled = [
      { type: 'contribution', amount: 400_000, date: '2026-06-10', pricingStatus: 'priced' },
      { type: 'contribution', amount: 600_000, date: '2026-07-10', pricingStatus: 'priced' },
    ];
    const withHold = [
      ...settled,
      // Requested, not yet dealt. The units are still owned.
      { type: 'withdrawal', amount: -300_000, date: '2026-07-20', pricingStatus: 'pending' },
    ];

    const a = deriveSubscriberAnalytics(SUB, settled);
    const b = deriveSubscriberAnalytics(SUB, withHold);

    // Same months, same values: asking for money must not rewrite the past.
    expect(b.balanceSeries.map((p) => p.value)).toEqual(a.balanceSeries.map((p) => p.value));
  });

  it('the series is anchored on ALLOCATED money, not on the headline total', async () => {
    const { deriveSubscriberAnalytics } = await import(
      '../subscriber-dashboard/reports/deriveSubscriberAnalytics'
    );
    const feed = [
      { type: 'contribution', amount: 400_000, date: '2026-06-10', pricingStatus: 'priced' },
      { type: 'contribution', amount: 600_000, date: '2026-07-10', pricingStatus: 'priced' },
    ];
    const series = deriveSubscriberAnalytics(SUB, feed).balanceSeries;
    // Final point closes on the allocated figure — the money actually invested —
    // not on the 1,085,000 headline that still contains cash in transit.
    expect(series.at(-1).value).toBe(1_000_000);
  });

  it('falls back to netBalance for a pre-0146 subscriber shape', async () => {
    const { deriveSubscriberAnalytics } = await import(
      '../subscriber-dashboard/reports/deriveSubscriberAnalytics'
    );
    const legacy = { netBalance: 1_000_000, retirementBalance: 800_000, emergencyBalance: 200_000 };
    const feed = [{ type: 'contribution', amount: 400_000, date: '2026-06-10' }];
    expect(deriveSubscriberAnalytics(legacy, feed).balanceSeries.at(-1).value).toBe(1_000_000);
  });
});
