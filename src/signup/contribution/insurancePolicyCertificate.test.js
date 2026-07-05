// buildPolicyCertificateHtml — the printable policy certificate generator.
// The HTML builder is pure (openPolicyCertificate just writes it to a new tab),
// so we assert the produced markup rather than the window plumbing.

import { describe, it, expect } from 'vitest';
import { buildPolicyCertificateHtml } from './insurancePolicyCertificate';

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
    expect(html).toContain('Certificate of Life Insurance');
  });

  it('escapes HTML in the holder name (no raw tag injection)', () => {
    const html = buildPolicyCertificateHtml({ ...base, holderName: 'A <script>x</script>' });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('reflects the product label in the title for non-life products', () => {
    expect(buildPolicyCertificateHtml({ ...base, productLabel: 'Health' }))
      .toContain('Certificate of Health Insurance');
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
