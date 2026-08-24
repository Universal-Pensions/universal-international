// Unit test for isInviteAwaiting — the pure classification OverviewDesktop.jsx
// uses to compute "Pending KYC" (A14-003). Mirrors the exact expires_at split
// kyc/usePendingKycNudge.js's splitInvitesByExpiry uses for the Pending KYC
// page (that helper isn't exported, so the rule is duplicated, not imported).
//
// Regression this guards: on live emp-001 data, all 4 pending invites had
// already expired (expires_at 2026-08-09 / 2026-08-14, checked 2026-08-24), yet
// the Overview tile + Needs attention + roster note read raw
// pendingInvites.length and said "4 invited · awaiting sign-up" — while the
// Pending KYC page, using the same expires_at split, correctly said "0 awaiting
// sign-up · 4 lapsed".

import { describe, it, expect } from 'vitest';
import { isInviteAwaiting } from './OverviewDesktop';

describe('isInviteAwaiting', () => {
  const NOW = new Date('2026-08-24T12:00:00.000Z').getTime();

  it('treats an invite with no expiresAt as still awaiting', () => {
    expect(isInviteAwaiting({ expiresAt: null }, NOW)).toBe(true);
    expect(isInviteAwaiting({}, NOW)).toBe(true);
  });

  it('treats an invite expiring in the future as awaiting', () => {
    expect(isInviteAwaiting({ expiresAt: '2026-08-30T00:00:00.000Z' }, NOW)).toBe(true);
  });

  it('treats an invite whose expiry has already passed as lapsed, not awaiting', () => {
    // The exact live emp-001 dates from the audit (A14-003).
    expect(isInviteAwaiting({ expiresAt: '2026-08-14T00:00:00.000Z' }, NOW)).toBe(false);
    expect(isInviteAwaiting({ expiresAt: '2026-08-09T00:00:00.000Z' }, NOW)).toBe(false);
  });

  it('treats an invite expiring at exactly `now` as lapsed (boundary)', () => {
    expect(isInviteAwaiting({ expiresAt: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it('a mixed batch counts only the still-awaiting ones — reproduces "0 awaiting · 4 lapsed"', () => {
    const invites = [
      { token: 'inv-1', expiresAt: '2026-08-14T00:00:00.000Z' },
      { token: 'inv-2', expiresAt: '2026-08-09T00:00:00.000Z' },
      { token: 'inv-3', expiresAt: '2026-08-09T00:00:00.000Z' },
      { token: 'inv-4', expiresAt: '2026-08-09T00:00:00.000Z' },
    ];
    const pendingKyc = invites.filter((inv) => isInviteAwaiting(inv, NOW)).length;
    expect(pendingKyc).toBe(0);
    expect(invites.length).toBe(4); // the raw (pre-fix) count the bug used to show
  });
});
