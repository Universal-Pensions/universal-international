import { describe, it, expect } from 'vitest';
import {
  NUDGE_CHANNELS,
  DEFAULT_NUDGE_CHANNELS,
  isReachableBy,
  reachableChannels,
} from './nudge';

const withBoth = { prefill: { fullName: 'Aisha N', phone: '+256700100092', email: 'a@example.com' } };
const phoneOnly = { prefill: { fullName: 'Yasin K', phone: '+256700100091' } };
const emailOnly = { prefill: { fullName: 'Peter W', email: 'p@example.com' } };
const neither = { prefill: { fullName: 'Nobody' } };

describe('nudge channels', () => {
  it('offers exactly email, SMS and WhatsApp', () => {
    expect(NUDGE_CHANNELS.map((c) => c.id)).toEqual(['email', 'sms', 'whatsapp']);
  });

  it('defaults to channels that need only the details an invite always has', () => {
    expect(DEFAULT_NUDGE_CHANNELS).toEqual(['sms', 'email']);
  });
});

describe('isReachableBy', () => {
  it('needs an email for email, and a phone for SMS / WhatsApp', () => {
    expect(isReachableBy(withBoth, 'email')).toBe(true);
    expect(isReachableBy(withBoth, 'sms')).toBe(true);
    expect(isReachableBy(withBoth, 'whatsapp')).toBe(true);

    expect(isReachableBy(phoneOnly, 'email')).toBe(false);
    expect(isReachableBy(phoneOnly, 'sms')).toBe(true);
    expect(isReachableBy(phoneOnly, 'whatsapp')).toBe(true);

    expect(isReachableBy(emailOnly, 'email')).toBe(true);
    expect(isReachableBy(emailOnly, 'sms')).toBe(false);
  });

  it('treats a blank / whitespace contact detail as missing', () => {
    expect(isReachableBy({ prefill: { email: '' } }, 'email')).toBe(false);
    expect(isReachableBy({ prefill: { email: '   ' } }, 'email')).toBe(false);
    expect(isReachableBy({ prefill: {} }, 'email')).toBe(false);
    expect(isReachableBy({}, 'email')).toBe(false);
    expect(isReachableBy(null, 'email')).toBe(false);
  });

  it('is false for an unknown channel rather than throwing', () => {
    expect(isReachableBy(withBoth, 'carrier-pigeon')).toBe(false);
  });
});

describe('reachableChannels', () => {
  it('narrows the chosen channels to the ones that can actually reach someone', () => {
    expect(reachableChannels(withBoth, ['email', 'sms', 'whatsapp']))
      .toEqual(['email', 'sms', 'whatsapp']);
    expect(reachableChannels(phoneOnly, ['email', 'sms', 'whatsapp']))
      .toEqual(['sms', 'whatsapp']);
    expect(reachableChannels(emailOnly, ['sms', 'whatsapp'])).toEqual([]);
    expect(reachableChannels(neither, ['email', 'sms', 'whatsapp'])).toEqual([]);
  });

  it('returns nothing when no channel is chosen', () => {
    expect(reachableChannels(withBoth, [])).toEqual([]);
  });
});
