// Validation for the public nominee claim form.
//
// The rules here encode judgement calls about a bereaved person's situation, so
// the assertions double as the record of WHY each field is or isn't required —
// see the module header. The two that matter most:
//   * either the deceased's NIN or their phone will do (a widow may not know
//     which number was the login; the NIN is on the paperwork);
//   * email is optional (many claimants in Uganda have none), phone is not.

import { describe, it, expect } from 'vitest';
import {
  validateNomineeClaim, FIELD_ORDER, MAX_LEN, messageForCode, fieldForCode, MAX_YEARS_AGO,
} from './validateNomineeClaim';

const NOW = new Date('2026-08-07T12:00:00Z');

const VALID = {
  product: 'life',
  deceasedName: 'Grace Nakato',
  deceasedNin: 'CF89012345678X',
  deceasedPhone: '',
  dateOfDeath: '2026-07-02',
  claimantName: 'Samuel Nakato',
  claimantNin: '',
  claimantPhone: '0771234567',
  claimantEmail: '',
  relationship: 'Spouse',
  district: 'Kampala',
  notes: '',
};

const errs = (over = {}) => validateNomineeClaim({ ...VALID, ...over }, NOW);

describe('validateNomineeClaim', () => {
  it('accepts a complete claim with only the required fields', () => {
    expect(errs()).toEqual({});
    // Optional fields genuinely optional.
    expect(errs({ district: '', notes: '', claimantNin: '', claimantEmail: '' })).toEqual({});
  });

  it('only accepts death benefits — hospital cash is claimed in-app by the member', () => {
    expect(errs({ product: 'health' })).toHaveProperty('product');
    expect(errs({ product: '' })).toHaveProperty('product');
    expect(errs({ product: 'funeral' })).toEqual({});
  });

  it('requires the deceased’s name', () => {
    expect(errs({ deceasedName: '   ' })).toHaveProperty('deceasedName');
  });

  describe('identifying the deceased', () => {
    it('accepts either the NIN or the phone', () => {
      expect(errs({ deceasedNin: 'CF123', deceasedPhone: '' })).toEqual({});
      expect(errs({ deceasedNin: '', deceasedPhone: '0771234567' })).toEqual({});
    });

    it('requires at least one of them', () => {
      // Attached to the NIN field because that is the document most likely in
      // the claimant's hand.
      expect(errs({ deceasedNin: '', deceasedPhone: '' })).toHaveProperty('deceasedNin');
    });
  });

  describe('date of death', () => {
    it('is required', () => {
      expect(errs({ dateOfDeath: '' })).toHaveProperty('dateOfDeath');
    });

    it('rejects a future date', () => {
      expect(errs({ dateOfDeath: '2026-12-31' })).toHaveProperty('dateOfDeath');
    });

    it('accepts a date within the window — a certificate can take months', () => {
      expect(errs({ dateOfDeath: '2025-01-15' })).toEqual({});
    });

    it('rejects something implausibly long ago', () => {
      const tooOld = new Date(NOW);
      tooOld.setFullYear(tooOld.getFullYear() - MAX_YEARS_AGO - 1);
      expect(errs({ dateOfDeath: tooOld.toISOString().slice(0, 10) }))
        .toHaveProperty('dateOfDeath');
    });
  });

  describe('the claimant', () => {
    it('requires a name and a relationship', () => {
      expect(errs({ claimantName: '' })).toHaveProperty('claimantName');
      expect(errs({ relationship: '' })).toHaveProperty('relationship');
    });

    it('requires a reachable Uganda mobile number — it is the only channel', () => {
      expect(errs({ claimantPhone: '' })).toHaveProperty('claimantPhone');
      expect(errs({ claimantPhone: '0721234567' })).toHaveProperty('claimantPhone'); // bad prefix
      expect(errs({ claimantPhone: '0771234567' })).toEqual({});
    });

    it('leaves email optional, but validates it when given', () => {
      // Deliberately unlike the request-access form, where email IS the channel.
      expect(errs({ claimantEmail: '' })).toEqual({});
      expect(errs({ claimantEmail: 'not-an-email' })).toHaveProperty('claimantEmail');
      expect(errs({ claimantEmail: 'sam@example.com' })).toEqual({});
    });
  });

  it('enforces the same length caps the API does', () => {
    expect(errs({ deceasedName: 'x'.repeat(MAX_LEN.deceasedName + 1) })).toHaveProperty('deceasedName');
    expect(errs({ claimantName: 'x'.repeat(MAX_LEN.claimantName + 1) })).toHaveProperty('claimantName');
    expect(errs({ relationship: 'x'.repeat(MAX_LEN.relationship + 1) })).toHaveProperty('relationship');
    expect(errs({ district: 'x'.repeat(MAX_LEN.district + 1) })).toHaveProperty('district');
    expect(errs({ notes: 'x'.repeat(MAX_LEN.notes + 1) })).toHaveProperty('notes');
  });

  it('orders every validated field so focus-first lands somewhere real', () => {
    // A field that can error but isn't in FIELD_ORDER would silently never get
    // focused — the defect this ordering exists to prevent.
    const everyErrorKey = new Set(Object.keys(validateNomineeClaim({}, NOW)));
    for (const key of everyErrorKey) {
      expect(FIELD_ORDER, `${key} is missing from FIELD_ORDER`).toContain(key);
    }
  });
});

describe('server error codes', () => {
  it('maps each code to copy and to the field it belongs to', () => {
    for (const code of [
      'invalid_product', 'invalid_deceased_name', 'invalid_deceased_identifier',
      'invalid_date_of_death', 'invalid_claimant_name', 'invalid_relationship',
      'invalid_phone', 'invalid_email',
    ]) {
      expect(messageForCode(code), code).toBeTruthy();
      expect(fieldForCode(code), code).toBeTruthy();
      expect(FIELD_ORDER).toContain(fieldForCode(code));
    }
  });

  it('returns null for an unknown code so the caller can fall back', () => {
    expect(messageForCode('something_new')).toBeNull();
    expect(fieldForCode('something_new')).toBeNull();
  });
});
