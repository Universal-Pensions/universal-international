// Tests for the backend Sentry PII/secret scrubber (server/sentryScrub.ts).
//
// Written for two audit findings at once:
//   - A07-001: the scrubber had no redaction pattern for a Ugandan NIN
//     (National ID Number). Asserts NIN_RE catches the real mint shape
//     (`C[MF]` + 12 alphanumeric, matching api/kyc/id-ocr.ts /
//     ReviewStep.jsx's own NIN_RE) and that SENSITIVE_KEYS drops
//     nin/nationalId/national_id fields wholesale regardless of casing.
//   - A09-005 / A24-009 ("prove the scrubber runs and actually redacts"):
//     no test exercised `scrubEvent` end to end before this file existed —
//     the audit's byte-equivalence check compared the two scrubber SOURCE
//     files, not their runtime behaviour. The last test below feeds
//     `scrubEvent` a realistic KYC-error-shaped event carrying a phone
//     number, a NIN, AND a name in the same message string, and asserts on
//     the literal output: phone and NIN come out redacted; the name is
//     deliberately left alone (there is no name-detection class — that was
//     never part of A07-001's ask, and free-text name scrubbing would be
//     unreliably implemented as a regex) so nobody mistakes silence on that
//     point for an oversight.

import { describe, it, expect } from 'vitest';
import type { Event } from '@sentry/node';
import { scrubString, scrubValue, scrubEvent, scrubBreadcrumb } from './sentryScrub';

describe('scrubString', () => {
  it('redacts a Ugandan phone number', () => {
    expect(scrubString('call +256701234567 now')).toBe('call [redacted] now');
  });

  it('redacts a NIN matching the real mint shape (C[MF] + 12 alphanumeric)', () => {
    // Same literal shape api/kyc/id-ocr.test.ts and ReviewStep.jsx assert:
    // /^C[MF][A-Z0-9]{12}$/ — 'CF' + 12 chars = 14 total.
    expect(scrubString('nira lookup failed for CF92018AB3CD45')).toBe(
      'nira lookup failed for [redacted]',
    );
    expect(scrubString('subject CM1A2B3C4D5E6F could not be verified')).toBe(
      'subject [redacted] could not be verified',
    );
  });

  it('redacts a NIN even when its suffix happens to contain a phone-shaped digit run', () => {
    // Adversarial case for the NIN-before-phone ordering: a 12-char
    // alphanumeric suffix that itself matches PHONE_RE's `7\d{8}` shape.
    // If PHONE_RE ran first (or NIN_RE were absent), this would come out as
    // 'C' + 'M' + '[redacted]0AB' — a mangled fragment leaking the NIN's
    // prefix. Redacted as one atomic unit instead.
    const nin = 'CM712345678AB'.slice(0, 14).padEnd(14, '0'); // CM + 12 chars, embeds 712345678
    expect(nin).toMatch(/^C[MF][A-Z0-9]{12}$/);
    const out = scrubString(`ref ${nin} rejected`) as string;
    expect(out).toBe('ref [redacted] rejected');
    expect(out).not.toContain('CM');
    expect(out).not.toContain('712345678');
  });

  it('does not touch a plain name — no name-detection class exists, by design', () => {
    expect(scrubString('applicant Nakato Grace')).toBe('applicant Nakato Grace');
  });

  it('still redacts JWTs and Bearer tokens (pre-existing behaviour, unchanged by A07-001)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc123DEF-_ghi';
    expect(scrubString(`token=${jwt}`)).toBe('token=[redacted]');
    expect(scrubString('Authorization: Bearer abc.123-XYZ')).toBe(
      'Authorization: Bearer [redacted]',
    );
  });

  it('leaves ordinary strings untouched', () => {
    expect(scrubString('insurance policy renewed')).toBe('insurance policy renewed');
  });
});

describe('scrubValue / SENSITIVE_KEYS', () => {
  it('drops nin / nationalId / national_id fields wholesale, case-insensitively', () => {
    const out = scrubValue({
      nin: 'CF92018AB3CD45',
      NationalId: 'CM1A2B3C4D5E6F',
      national_id: 'CF00112233AABB',
      otherField: 'kept as-is',
    }) as Record<string, unknown>;
    expect(out.nin).toBe('[redacted]');
    expect(out.NationalId).toBe('[redacted]');
    expect(out.national_id).toBe('[redacted]');
    expect(out.otherField).toBe('kept as-is');
  });

  it('still drops password/token/authorization fields (pre-existing behaviour)', () => {
    const out = scrubValue({ password: 'hunter2', Authorization: 'Bearer xyz' }) as Record<
      string,
      unknown
    >;
    expect(out.password).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
  });

  it('recurses into nested objects and arrays, scrubbing phone/NIN substrings found there', () => {
    const out = scrubValue({
      user: { note: 'phone +256701234567, nin CF92018AB3CD45' },
      history: ['contact 0701234567 about CM1A2B3C4D5E6F'],
    }) as { user: { note: string }; history: string[] };
    expect(out.user.note).toBe('phone [redacted], nin [redacted]');
    expect(out.history[0]).toBe('contact [redacted] about [redacted]');
  });
});

describe('scrubBreadcrumb', () => {
  it('scrubs message and data of a single breadcrumb', () => {
    const out = scrubBreadcrumb({
      message: 'nira-verify failed for CF92018AB3CD45',
      data: { phone: '+256701234567' },
    });
    expect(out?.message).toBe('nira-verify failed for [redacted]');
    expect(out?.data?.phone).toBe('[redacted]');
  });
});

describe('scrubEvent — end-to-end proof the scrubber actually redacts (A09-005 / A24-009)', () => {
  it('redacts phone + NIN from a realistic KYC-error event that also carries a name', () => {
    // Shaped like a real nira-verify failure forwarded to Sentry: the
    // exception value, a breadcrumb, and request.data all carry the same
    // trio a live KYC error could plausibly embed — a name, a phone, a NIN.
    const event: Event = {
      message: 'NIRA lookup failed for Nakato Grace, phone +256701234567, nin CF92018AB3CD45',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'verification error for subscriber:+256701234567 (nin CM1A2B3C4D5E6F)',
          },
        ],
      },
      breadcrumbs: [
        {
          message: 'submitting KYC for Nakato Grace',
          data: { phone: '+256701234567', nin: 'CF92018AB3CD45' },
        },
      ],
      request: {
        data: { fullName: 'Nakato Grace', phone: '0701234567', nin: 'CF92018AB3CD45' },
        headers: { authorization: 'Bearer secret-token', 'x-forwarded-for': '10.0.0.1' },
      },
      user: { id: 'subscriber:+256701234567' },
    };

    const scrubbed = scrubEvent(event);

    // Phone: redacted everywhere it appears.
    expect(scrubbed.message).not.toMatch(/256701234567|0701234567/);
    expect(scrubbed.exception?.values?.[0]?.value).not.toMatch(/256701234567/);
    expect(scrubbed.breadcrumbs?.[0]?.data?.phone).toBe('[redacted]');
    expect((scrubbed.request?.data as Record<string, unknown>)?.phone).toBe('[redacted]');
    // user.id is `subscriber:+256701234567` — a ROLE PREFIX plus a phone. The
    // scrubber redacts the phone substring and keeps the prefix, yielding
    // `subscriber:[redacted]`. That is the better behaviour, not a miss: the
    // role is not PII and is genuinely useful when triaging a crash, while the
    // phone is gone. So assert the property that matters — no phone survives —
    // rather than exact equality with '[redacted]', which would over-specify an
    // implementation detail and forbid a strictly more useful result.
    const scrubbedUserId = (scrubbed.user as Record<string, unknown>)?.id as string;
    expect(scrubbedUserId).not.toMatch(/256701234567|0701234567/);
    expect(scrubbedUserId).toContain('[redacted]');

    // NIN: redacted everywhere it appears (A07-001 — this is the fix under test).
    expect(scrubbed.message).not.toMatch(/CF92018AB3CD45|CM1A2B3C4D5E6F/);
    expect(scrubbed.exception?.values?.[0]?.value).not.toMatch(/CM1A2B3C4D5E6F/);
    expect(scrubbed.breadcrumbs?.[0]?.data?.nin).toBe('[redacted]');
    expect((scrubbed.request?.data as Record<string, unknown>)?.nin).toBe('[redacted]');

    // Authorization header: dropped wholesale (pre-existing SENSITIVE_KEYS behaviour).
    expect((scrubbed.request?.headers as Record<string, unknown>)?.authorization).toBe(
      '[redacted]',
    );

    // Name: explicitly NOT redacted — no name-detection class exists. Asserted
    // so this stays a documented decision, not a silent gap someone re-derives.
    expect(scrubbed.message).toContain('Nakato Grace');
    expect((scrubbed.request?.data as Record<string, unknown>)?.fullName).toBe('Nakato Grace');

    // Print the actual before/after for the verification record (mandatory
    // per the P6-observability task — this is the literal proof, not a
    // paraphrase of it).
    // eslint-disable-next-line no-console
    console.log('[scrubEvent proof] message before: NIRA lookup failed for Nakato Grace, phone +256701234567, nin CF92018AB3CD45');
    // eslint-disable-next-line no-console
    console.log(`[scrubEvent proof] message after:  ${scrubbed.message}`);
  });

  it('is a no-op-safe passthrough for an event with no PII-bearing fields', () => {
    const event: Event = { message: 'chunk load error' };
    expect(scrubEvent(event)).toEqual({ message: 'chunk load error' });
  });

  it('handles a null/non-object event without throwing (defensive)', () => {
    // Sentry's own types don't allow null, but beforeSend is a runtime
    // boundary — a hostile or malformed event must not crash the process.
    expect(scrubEvent(null as unknown as Event)).toBeNull();
  });
});
