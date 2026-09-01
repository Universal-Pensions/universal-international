// What a member is told when their money moves — pinned.
//
// Phase 5 of the unitization redesign made the MOBILE success sheets
// lifecycle-aware and left the desktop ones alone. Every viewport >= 769px
// (useIsDesktop, lowered from 1024 by A18-002, so tablets in portrait too) kept
// reading two sentences that go false the moment forward dealing is switched
// on — and they are word-for-word the two the Phase 5 commit claimed to have
// removed:
//
//     "UGX 500,000 is now working for you"   — not on a Saturday it isn't
//     "will arrive … within 24 hours"        — not for a Friday-afternoon request
//
// Nothing caught it: no test referenced pricingStatus, and the kill switch is
// off so nobody would see it until the day it was flipped. Hence these.

import { describe, it, expect } from 'vitest';
import {
  contributionReceipt,
  withdrawalReceipt,
  payoutEtaPhrase,
  dealingSentence,
} from '../utils/receiptCopy';

const PENDING_IN = { pricingStatus: 'pending', dealingDate: '2026-09-07' };
const PENDING_OUT = { pricingStatus: 'pending', dealingDate: '2026-09-07' };
const PRICED = { pricingStatus: 'priced', dealingDate: '2026-09-01' };

describe('contributionReceipt', () => {
  it('never claims the money is working while it is still waiting for a price', () => {
    const r = contributionReceipt({ result: PENDING_IN, amount: 500_000, newBalance: 7_384_659 });
    expect(r.subtitle).not.toMatch(/now working for you/i);
    expect(r.subtitle).toMatch(/Monday, 7 September/);
    // The money is still theirs, so the balance is still shown.
    expect(r.subtitle).toMatch(/7,384,659/);
  });

  it('keeps the original wording when the money bought units immediately', () => {
    const r = contributionReceipt({ result: PRICED, amount: 500_000, newBalance: 7_384_659 });
    expect(r.title).toBe('Contribution added');
    expect(r.subtitle).toMatch(/is now working for you/);
  });

  it('degrades to the original wording for a pre-0147 result shape', () => {
    const r = contributionReceipt({ result: { reference: 'CT-1' }, amount: 1, newBalance: 2 });
    expect(r.subtitle).toMatch(/is now working for you/);
  });

  it('never leaves a pending member with a bare title and no explanation', () => {
    // A missing dealing date must not produce an empty panel.
    const r = contributionReceipt({
      result: { pricingStatus: 'pending', dealingDate: null }, amount: 1, newBalance: 2,
    });
    expect(r.subtitle.length).toBeGreaterThan(20);
    expect(r.subtitle).toMatch(/next working day/i);
  });
});

describe('withdrawalReceipt', () => {
  it('never promises 24 hours while the amount has not even been struck', () => {
    const r = withdrawalReceipt({ result: PENDING_OUT, amount: 300_000, methodLabel: 'MoMo' });
    expect(r.subtitle).not.toMatch(/24 hours/i);
    expect(r.subtitle).toMatch(/Monday, 7 September/);
    expect(r.subtitle).toMatch(/MoMo/);
  });

  it('keeps the 24-hour wording when the redemption settled immediately', () => {
    const r = withdrawalReceipt({ result: PRICED, amount: 300_000, methodLabel: 'MoMo' });
    expect(r.subtitle).toMatch(/within 24 hours/);
  });
});

describe('payoutEtaPhrase — shown BEFORE the member confirms', () => {
  it('names the day the amount is set once forward dealing is on', () => {
    expect(payoutEtaPhrase('2026-09-07')).toMatch(/Monday, 7 September/);
    expect(payoutEtaPhrase('2026-09-07')).not.toMatch(/24 hours/i);
  });

  it('falls back to the previous promise when there is no dealing date', () => {
    // Kill switch off, or the calendar unreachable (anonymous, offline).
    expect(payoutEtaPhrase(null)).toBe('Within 24 hours');
    expect(payoutEtaPhrase(undefined)).toBe('Within 24 hours');
  });
});

describe('dealingSentence — one wording for every surface', () => {
  it('uses a weekday name, because "07/09" is not actionable', () => {
    expect(dealingSentence({ dealingDate: '2026-09-07', direction: 'in', received: true }))
      .toBe('We have your money. It goes into your savings on Monday, 7 September 2026.');
  });

  it('clears the plain-language bar: no unit, NAV, dealing-date or allocation jargon', () => {
    for (const direction of ['in', 'out']) {
      for (const received of [true, false]) {
        const t = dealingSentence({ dealingDate: '2026-09-07', direction, received });
        expect(t).not.toMatch(/\bunits?\b|\bNAV\b|dealing date|allocat/i);
      }
    }
  });

  it('renders nothing when there is no date to speak about', () => {
    expect(dealingSentence({ dealingDate: null })).toBeNull();
    expect(dealingSentence({})).toBeNull();
  });
});
