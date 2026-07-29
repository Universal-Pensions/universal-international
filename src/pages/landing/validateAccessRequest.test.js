import { describe, it, expect } from 'vitest';
import { validateAccessRequest, FIELD_ORDER, messageForCode } from './validateAccessRequest';

const VALID_EMPLOYER = {
  org: 'Kampala Steel Ltd',
  name: 'Jane Doe',
  email: 'jane@kampalasteel.co.ug',
  phone: '0771234567',
  sector: 'Manufacturing',
  district: 'Kampala',
};

describe('validateAccessRequest', () => {
  it('accepts a fully-filled employer request', () => {
    expect(validateAccessRequest(VALID_EMPLOYER, 'employer')).toEqual({});
  });

  // The drift guard. The original defect was a field being required on one
  // surface and optional on the other; this fails if a field in FIELD_ORDER
  // stops being enforced.
  it.each(FIELD_ORDER.employer)('rejects a blank %s', (field) => {
    const errors = validateAccessRequest({ ...VALID_EMPLOYER, [field]: '' }, 'employer');
    expect(errors[field]).toBeTruthy();
  });

  it.each(FIELD_ORDER.employer)('rejects a whitespace-only %s', (field) => {
    const errors = validateAccessRequest({ ...VALID_EMPLOYER, [field]: '   ' }, 'employer');
    expect(errors[field]).toBeTruthy();
  });

  it('does not require sector or district for a distributor', () => {
    const rest = { ...VALID_EMPLOYER, sector: '', district: '' };
    expect(validateAccessRequest(rest, 'distributor')).toEqual({});
    expect(FIELD_ORDER.distributor).not.toContain('sector');
    expect(FIELD_ORDER.distributor).not.toContain('district');
  });

  // The phone is the sign-in key — the whole reason it became mandatory.
  it.each([
    ['0771234567', true],
    ['+256701234567', true],
    ['256781234567', true],
    ['0771 234 567', true],
    ['0721234567', false],   // not a real UG mobile prefix
    ['077123456', false],    // one digit short
    ['+1 555 0100', false],  // not Uganda
    ['', false],
  ])('phone %s -> valid=%s', (phone, ok) => {
    const errors = validateAccessRequest({ ...VALID_EMPLOYER, phone }, 'employer');
    expect(errors.phone === undefined).toBe(ok);
  });

  // approve_access_request resolves the district NAME to a districts.id, so a
  // free-text value that isn't a real district makes the request un-approvable.
  it.each([
    ['Kampala', true],
    ['kampala', true],       // case-insensitive
    ['  Jinja  ', true],     // trimmed
    ['Kampala District', false],
    ['Nairobi', false],
  ])('district %s -> valid=%s', (district, ok) => {
    const errors = validateAccessRequest({ ...VALID_EMPLOYER, district }, 'employer');
    expect(errors.district === undefined).toBe(ok);
  });

  it.each([
    ['no-at-sign', false],
    ['a@localhost', false],  // no dot in the domain
    ['a@b.co', true],
  ])('email %s -> valid=%s', (email, ok) => {
    const errors = validateAccessRequest({ ...VALID_EMPLOYER, email }, 'employer');
    expect(errors.email === undefined).toBe(ok);
  });

  it('enforces the per-kind org-name cap (distributor 120, employer 160)', () => {
    const long = 'x'.repeat(130);
    expect(validateAccessRequest({ ...VALID_EMPLOYER, org: long }, 'employer').org).toBeUndefined();
    expect(validateAccessRequest({ ...VALID_EMPLOYER, org: long }, 'distributor').org).toBeTruthy();
  });
});

describe('messageForCode', () => {
  it('maps known server codes to plain language', () => {
    expect(messageForCode('invalid_phone')).toMatch(/Uganda mobile number/i);
    expect(messageForCode('invalid_district')).toMatch(/district/i);
  });

  it('falls back for an unknown code', () => {
    expect(messageForCode('something_new')).toMatch(/went wrong/i);
  });
});
