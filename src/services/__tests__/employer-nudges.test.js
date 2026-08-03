// sendInviteNudges — the employer's "finish your sign-up" reminder for pending
// KYC invites (the /dashboard/pending-kyc page).
//
// DEMO SCOPE: no email / SMS / WhatsApp provider is wired up, so what these
// tests pin is the REACHABILITY contract, which is the part that can actually
// go wrong: a channel only counts for someone who has the contact detail it
// needs, and anyone no chosen channel can reach is REPORTED rather than
// silently dropped. Both onboarding paths currently mandate an email, so the
// unreachable case is defensive — `employer_invites.prefill` is JSONB and rows
// can arrive without one (direct RPC, legacy rows, a future bulk relaxation).

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeSupabaseMock } from '../../test/supabaseMock';

const supabaseMock = makeSupabaseMock();

vi.mock('@/services/supabaseClient', () => ({
  supabase: supabaseMock, default: supabaseMock,
  getToken: vi.fn(), setToken: vi.fn(), clearToken: vi.fn(),
}));
vi.mock('../supabaseClient', () => ({
  supabase: supabaseMock, default: supabaseMock,
  getToken: vi.fn(), setToken: vi.fn(), clearToken: vi.fn(),
}));

const { sendInviteNudges, getInviteNudgeLog } = await import('../employer');

const withBoth = { token: 't-both', prefill: { fullName: 'Aisha Nabirye', phone: '+256700100092', email: 'a@example.com' } };
const phoneOnly = { token: 't-phone', prefill: { fullName: 'Yasin Kizza', phone: '+256700100091' } };
const emailOnly = { token: 't-email', prefill: { fullName: 'Peter Wanyama', email: 'p@example.com' } };
const neither = { token: 't-none', prefill: { fullName: 'Nobody At All' } };

beforeEach(() => { vi.clearAllMocks(); });

describe('sendInviteNudges', () => {
  it('counts one send per person per reachable channel', async () => {
    const res = await sendInviteNudges({
      invites: [withBoth, phoneOnly],
      channels: ['email', 'sms', 'whatsapp'],
    });

    expect(res.sent).toBe(2);
    expect(res.unreachable).toEqual([]);
    // Only `withBoth` has an email; both have a phone.
    expect(res.perChannel).toEqual({ email: 1, sms: 2, whatsapp: 2 });
  });

  it('reports — never silently drops — anyone no chosen channel can reach', async () => {
    const res = await sendInviteNudges({
      invites: [withBoth, emailOnly],
      channels: ['sms', 'whatsapp'],
    });

    expect(res.sent).toBe(1);
    expect(res.unreachable).toEqual([{ token: 't-email', name: 'Peter Wanyama' }]);
    expect(res.perChannel).toEqual({ sms: 1, whatsapp: 1 });
  });

  it('reports someone with no contact details at all', async () => {
    const res = await sendInviteNudges({
      invites: [neither],
      channels: ['email', 'sms', 'whatsapp'],
    });

    expect(res.sent).toBe(0);
    expect(res.unreachable).toEqual([{ token: 't-none', name: 'Nobody At All' }]);
    expect(res.perChannel).toEqual({ email: 0, sms: 0, whatsapp: 0 });
  });

  it('sends nothing when no channel is chosen', async () => {
    const res = await sendInviteNudges({ invites: [withBoth], channels: [] });
    expect(res.sent).toBe(0);
    expect(res.unreachable).toEqual([{ token: 't-both', name: 'Aisha Nabirye' }]);
  });

  it('is a no-op on empty input rather than throwing', async () => {
    await expect(sendInviteNudges()).resolves.toEqual({ sent: 0, unreachable: [], perChannel: {} });
    await expect(sendInviteNudges({ invites: [], channels: ['sms'] }))
      .resolves.toEqual({ sent: 0, unreachable: [], perChannel: { sms: 0 } });
  });

  it('logs only the channels that actually reached each person', async () => {
    await sendInviteNudges({ invites: [phoneOnly], channels: ['email', 'sms'] });

    const log = getInviteNudgeLog();
    expect(log['t-phone'].channels).toEqual(['sms']); // email skipped — no address
    expect(Date.parse(log['t-phone'].at)).not.toBeNaN();
  });

  it('stamps the log with the REAL clock, not MOCK_NOW', async () => {
    // The row renders through formatRelativeTime, which compares against the
    // real `new Date()`. Stamping with mockData's currentTime() (MOCK_NOW,
    // 2026-07-01) made a just-sent reminder read as "Reminded 1 Jul".
    const before = Date.now();
    await sendInviteNudges({ invites: [withBoth], channels: ['sms'] });
    const after = Date.now();

    const at = Date.parse(getInviteNudgeLog()['t-both'].at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
  });

  it('does not log anyone it could not reach', async () => {
    await sendInviteNudges({ invites: [neither], channels: ['sms'] });
    expect(getInviteNudgeLog()['t-none']).toBeUndefined();
  });
});
