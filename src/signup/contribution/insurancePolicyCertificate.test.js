// buildPolicyCertificateHtml / openPolicyCertificate — the printable policy
// certificate generator.
//
// A24-001: this file used to assert ONLY the produced markup, on the theory
// that "openPolicyCertificate just writes it to a new tab" made the window
// plumbing not worth testing. That is exactly how a `window.open(..., {
// noopener,noreferrer })` call that made the function return `false` on
// EVERY invocation — for three months, in every browser — shipped
// undetected: the markup was always correct, nothing ever asserted that a
// window was actually returned or written into. The
// `openPolicyCertificate — window handle behaviour` block below closes that
// gap with a spec-accurate mock (see the comment there) rather than a grep
// over the source for the string "noopener", which would prove nothing about
// behaviour.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildPolicyCertificateHtml, openPolicyCertificate } from './insurancePolicyCertificate';

const base = {
  holderName: 'Asha Namubiru',
  memberId: 'UPU-000123',
  dob: '1990-01-01',
  cover: 1_000_000,
  premiumPerPeriod: 2000,
  frequency: 'monthly',
  policyStart: '2026-07-01',
  renewalDate: '2027-07-01',
  productLabel: 'Life',
  beneficiaries: [{ name: 'Kato Namubiru', relationship: 'child', share: 100 }],
};

describe('buildPolicyCertificateHtml', () => {
  it('renders the holder, member id, cover and product title', () => {
    const html = buildPolicyCertificateHtml(base);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Asha Namubiru');
    expect(html).toContain('UPU-000123');
    // cover formatted via the central en-UG formatter (grouped, exact).
    expect(html).toContain('1,000,000');
    // productLabel drives the certificate title.
    expect(html).toContain('Certificate of Insurance — Life');
  });

  it('escapes HTML in the holder name (no raw tag injection)', () => {
    const html = buildPolicyCertificateHtml({ ...base, holderName: 'A <script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('reflects the product label in the title for non-life products', () => {
    // The title is "Certificate of Insurance — <product>", not "Certificate of
    // <product> Insurance", so it stays grammatical for a product whose name
    // isn't an adjective ("Hospital cash").
    expect(buildPolicyCertificateHtml({ ...base, productLabel: 'Hospital cash' }))
      .toContain('Certificate of Insurance — Hospital cash');
    expect(buildPolicyCertificateHtml({ ...base, productLabel: 'Funeral' }))
      .toContain('Certificate of Insurance — Funeral');
  });

  it('hides the beneficiaries section when showBeneficiaries is false', () => {
    const withBenef = buildPolicyCertificateHtml({ ...base, showBeneficiaries: true });
    const without = buildPolicyCertificateHtml({ ...base, showBeneficiaries: false });
    expect(withBenef).toContain('Kato Namubiru');
    expect(without).not.toContain('Kato Namubiru');
  });

  it('is defensive about missing data (falls back, does not throw)', () => {
    expect(() => buildPolicyCertificateHtml(undefined)).not.toThrow();
    const html = buildPolicyCertificateHtml({});
    expect(html).toContain('Policy Holder'); // holderName fallback
  });

  it('defaults the premium label to "Premium" and lets callers annualise it', () => {
    // Default (e.g. the subscriber PoliciesPage caller) keeps "Premium".
    expect(buildPolicyCertificateHtml(base)).toContain('>Premium</div>');
    // Onboarding done-step opts into the annual model.
    const annual = buildPolicyCertificateHtml({ ...base, premiumLabel: 'Annual premium' });
    expect(annual).toContain('>Annual premium</div>');
  });

  it('renders the "daily" cadence for daily-frequency premiums', () => {
    expect(buildPolicyCertificateHtml({ ...base, frequency: 'daily' }))
      .toContain('every day');
  });
});

// ── A24-001 — the popup must actually open ─────────────────────────────────
describe('openPolicyCertificate — window handle behaviour (A24-001)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A window.open() stand-in that models the ACTUAL browser rule (HTML
   * Standard §7.4.3.2): a feature string containing "noopener" (or
   * "noreferrer", which implies it) makes window.open() return null,
   * unconditionally — not "when the pop-up blocker fires". Any other call
   * shape returns a fake window whose document we can inspect.
   *
   * This is the load-bearing difference from the old test file: a regression
   * that reintroduces noopener/noreferrer is caught because the MOCK
   * faithfully reproduces spec behaviour and the assertions below check what
   * openPolicyCertificate() actually DID (returned a handle, wrote content
   * into it) — not because a test greps the source for a substring, which
   * proves nothing about runtime behaviour.
   */
  function installSpecAccurateWindowOpen() {
    const state = { html: '', title: '', opened: 0, closed: 0 };
    const fakeWin = {
      document: {
        open: () => { state.opened += 1; },
        write: (html) => { state.html += html; },
        close: () => { state.closed += 1; },
        get title() { return state.title; },
        set title(v) { state.title = v; },
      },
    };
    const openSpy = vi.spyOn(window, 'open').mockImplementation((_url, _target, features) => {
      if (typeof features === 'string' && /noopener|noreferrer/i.test(features)) {
        return null;
      }
      return fakeWin;
    });
    return { openSpy, fakeWin, state };
  }

  it('returns a real window handle and writes the rendered certificate into it', () => {
    const { openSpy, state } = installSpecAccurateWindowOpen();

    const result = openPolicyCertificate({ ...base, holderName: 'Asha Namubiru' });

    // The actual regression: openPolicyCertificate() must return true, i.e. a
    // window handle came back — not false, which is what the noopener bug
    // produced on every single call.
    expect(result).toBe(true);
    // The certificate must actually render into that window: document.write
    // was called, and the written HTML contains real certificate content
    // (not an empty/blank tab).
    expect(state.opened).toBe(1);
    expect(state.closed).toBe(1);
    expect(state.html).toContain('<!DOCTYPE html>');
    expect(state.html).toContain('Certificate of Insurance');
    expect(state.html).toContain('Asha Namubiru');
    expect(state.title).toContain('Asha Namubiru');

    // Secondary corroboration only (the proof above is behavioural): the call
    // must not pass a feature string at all, since our mock — mirroring the
    // real browser — would then have returned null and every assertion above
    // would have failed instead.
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [, , features] = openSpy.mock.calls[0];
    expect(features).toBeUndefined();
  });

  it('still returns false without throwing when the browser genuinely blocks the popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => openPolicyCertificate(base)).not.toThrow();
    expect(openPolicyCertificate(base)).toBe(false);
  });

  it('does not throw if window.document.title assignment fails (cross-origin/permission edge)', () => {
    const fakeWin = {
      document: {
        open: () => {},
        write: () => {},
        close: () => {},
        get title() { return ''; },
        set title(_v) { throw new Error('permission denied'); },
      },
    };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin);
    expect(() => openPolicyCertificate(base)).not.toThrow();
    expect(openPolicyCertificate(base)).toBe(true);
  });
});

// ── A24-007 — every interpolated field is inert against hostile input ─────
// The popup opened by openPolicyCertificate() is same-origin with the app
// (proved in the audit) and can read localStorage['upensions_token'], so a
// single field written into the document without escaping is a direct token
// exfiltration path, not a cosmetic bug. These tests plant the exact payload
// shapes the audit used against `access_requests`/`nominee_claims`
// (docs/audits/2026-08-23/24-frontend-security.md §2.2) into every
// user-controlled field the template interpolates, not just holderName.
describe('buildPolicyCertificateHtml — XSS hardening (A24-007)', () => {
  const IMG_PAYLOAD = '<img src=x onerror="window.__A24_PWNED=1">';
  const SCRIPT_PAYLOAD = '"><script>window.__A24_PWNED=1</script>';

  function expectInert(html) {
    // Never present as live markup that a browser would parse as an element
    // or execute as script...
    expect(html).not.toMatch(/<img[^>]*onerror=/i);
    expect(html).not.toContain('<script>window.__A24_PWNED');
    expect(html).not.toContain('onerror="window.__A24_PWNED');
    // ...and never simply dropped either — asserting absence alone would
    // also pass for a field that got silently stripped rather than escaped.
  }

  it('renders a hostile holder name as inert, escaped text', () => {
    const html = buildPolicyCertificateHtml({ ...base, holderName: IMG_PAYLOAD });
    expectInert(html);
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__A24_PWNED=1&quot;&gt;');
  });

  it('renders a hostile member id as inert, escaped text', () => {
    const html = buildPolicyCertificateHtml({ ...base, memberId: SCRIPT_PAYLOAD });
    expectInert(html);
    expect(html).toContain('&lt;script&gt;window.__A24_PWNED=1&lt;/script&gt;');
  });

  it('renders a hostile product label and premium label as inert, escaped text', () => {
    const html = buildPolicyCertificateHtml({
      ...base,
      productLabel: IMG_PAYLOAD,
      premiumLabel: SCRIPT_PAYLOAD,
    });
    expectInert(html);
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__A24_PWNED=1&quot;&gt;');
    expect(html).toContain('&lt;script&gt;window.__A24_PWNED=1&lt;/script&gt;');
  });

  it('renders a hostile beneficiary name AND a non-cataloged hostile relationship as inert, escaped text', () => {
    // relationship falls through to the raw value when it isn't one of the
    // fixed spouse/child/parent/sibling/other keys (RELATIONSHIP_LABEL) — the
    // realistic path for freeform/tampered data, not just the name field.
    const html = buildPolicyCertificateHtml({
      ...base,
      beneficiaries: [{ name: IMG_PAYLOAD, relationship: SCRIPT_PAYLOAD, share: 50 }],
    });
    expectInert(html);
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__A24_PWNED=1&quot;&gt;');
    expect(html).toContain('&lt;script&gt;window.__A24_PWNED=1&lt;/script&gt;');
  });

  it('renders a hostile cadence value as inert, escaped text', () => {
    // frequency outside the fixed FREQ_CADENCE map falls through to the raw
    // value, same shape as relationship above.
    const html = buildPolicyCertificateHtml({ ...base, frequency: IMG_PAYLOAD });
    expectInert(html);
    expect(html).toContain('&lt;img src=x onerror=&quot;window.__A24_PWNED=1&quot;&gt;');
  });

  it('end to end: openPolicyCertificate() writes a hostile name into the popup document inertly', () => {
    const fakeWin = {
      document: {
        _html: '',
        open() {},
        write(html) { this.written = (this.written || '') + html; },
        close() {},
        title: '',
      },
    };
    vi.spyOn(window, 'open').mockReturnValue(fakeWin);

    openPolicyCertificate({ ...base, holderName: IMG_PAYLOAD });

    expectInert(fakeWin.document.written);
    expect(fakeWin.document.written).toContain('&lt;img src=x onerror=&quot;window.__A24_PWNED=1&quot;&gt;');
    vi.restoreAllMocks();
  });
});
