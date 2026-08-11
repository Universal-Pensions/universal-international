// Shared validation for the public nominee claim form (`NomineeClaim.jsx`).
//
// The person filling this in has just lost a family member. Two consequences
// run through every decision here:
//
//   * ASK FOR AS LITTLE AS POSSIBLE, and be explicit about why the rest is
//     optional. Only six fields are required. Email in particular is optional —
//     unlike the request-access form, where it is the reply channel — because a
//     bereaved relative in Uganda often does not have one, and phone is the
//     identity key everywhere else in this system.
//   * NEVER BLOCK ON SOMETHING THEY MIGHT NOT KNOW. The deceased's phone and
//     NIN are individually optional; we require ONE of them, because a widow
//     may not know which number was the platform login while the NIN is on the
//     death paperwork in front of her.
//
// Kept as a plain module (no React) so the form and the unit tests share one
// definition — a field added to the form but not here would silently become
// optional again.

import { isValidUGPhone } from '../../utils/phone';

/** Deliberately permissive: reject the obviously-broken, don't police RFC 5322. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A death certificate takes time; only reject the obviously wrong. */
export const MAX_YEARS_AGO = 10;

/**
 * Field order. Drives "focus the first invalid input", so it must match the
 * visual/DOM order on the form.
 */
export const FIELD_ORDER = [
  'product',
  'deceasedName',
  'deceasedNin',
  'deceasedPhone',
  'dateOfDeath',
  'claimantName',
  'relationship',
  'claimantPhone',
  'claimantEmail',
  'district',
  'notes',
];

/** Max lengths, mirroring the caps in api/nominee-claim.ts. */
export const MAX_LEN = {
  deceasedName: 160,
  deceasedNin: 32,
  claimantName: 120,
  claimantNin: 32,
  claimantEmail: 254,
  relationship: 60,
  district: 120,
  notes: 2000,
};

const MSG = {
  product: 'Please choose which cover you are claiming.',
  deceasedName: 'Please enter their full name.',
  deceasedIdentifier: 'Please give us either their National ID number or their phone number, so we can find their record.',
  dateOfDeath: 'Please enter the date they passed away.',
  dateOfDeathFuture: 'That date is in the future.',
  dateOfDeathOld: 'That date seems too long ago. Please call us instead and we will help.',
  claimantName: 'Please enter your full name.',
  relationship: 'Please tell us how you were related.',
  phone: 'Please enter your phone number so we can call you.',
  phoneBad: 'Please enter a Uganda mobile number, like 0771 234 567.',
  emailBad: 'That email address does not look right.',
  tooLong: 'That is too long — please shorten it.',
};

/**
 * @param {Record<string,string>} form
 * @param {Date} [now] — injected so the tests don't depend on the wall clock
 * @returns {Record<string,string>} field -> message; empty object means valid.
 */
export function validateNomineeClaim(form = {}, now = new Date()) {
  const v = (k) => String(form[k] ?? '').trim();
  const errors = {};

  const product = v('product');
  // Hospital cash is claimed by the member in-app — it never reaches this form.
  if (product !== 'life' && product !== 'funeral') errors.product = MSG.product;

  const deceasedName = v('deceasedName');
  if (!deceasedName) errors.deceasedName = MSG.deceasedName;
  else if (deceasedName.length > MAX_LEN.deceasedName) errors.deceasedName = MSG.tooLong;

  // Either identifier will do — the error is attached to the NIN field because
  // it is the one printed on the paperwork they are most likely holding.
  const deceasedNin = v('deceasedNin');
  const deceasedPhone = v('deceasedPhone');
  if (!deceasedNin && !deceasedPhone) errors.deceasedNin = MSG.deceasedIdentifier;
  else if (deceasedNin.length > MAX_LEN.deceasedNin) errors.deceasedNin = MSG.tooLong;

  const dateOfDeath = v('dateOfDeath');
  if (!dateOfDeath) {
    errors.dateOfDeath = MSG.dateOfDeath;
  } else {
    const dod = new Date(`${dateOfDeath}T00:00:00`);
    if (Number.isNaN(dod.getTime())) {
      errors.dateOfDeath = MSG.dateOfDeath;
    } else if (dod > now) {
      errors.dateOfDeath = MSG.dateOfDeathFuture;
    } else {
      const earliest = new Date(now);
      earliest.setFullYear(earliest.getFullYear() - MAX_YEARS_AGO);
      if (dod < earliest) errors.dateOfDeath = MSG.dateOfDeathOld;
    }
  }

  const claimantName = v('claimantName');
  if (!claimantName) errors.claimantName = MSG.claimantName;
  else if (claimantName.length > MAX_LEN.claimantName) errors.claimantName = MSG.tooLong;

  const relationship = v('relationship');
  if (!relationship) errors.relationship = MSG.relationship;
  else if (relationship.length > MAX_LEN.relationship) errors.relationship = MSG.tooLong;

  // The claimant's own number is the ONLY channel we rely on to call them back.
  const claimantPhone = v('claimantPhone');
  if (!claimantPhone) errors.claimantPhone = MSG.phone;
  else if (!isValidUGPhone(claimantPhone)) errors.claimantPhone = MSG.phoneBad;

  const claimantEmail = v('claimantEmail');
  if (claimantEmail) {
    if (!EMAIL_PATTERN.test(claimantEmail)) errors.claimantEmail = MSG.emailBad;
    else if (claimantEmail.length > MAX_LEN.claimantEmail) errors.claimantEmail = MSG.tooLong;
  }

  const district = v('district');
  if (district && district.length > MAX_LEN.district) errors.district = MSG.tooLong;

  const notes = v('notes');
  if (notes && notes.length > MAX_LEN.notes) errors.notes = MSG.tooLong;

  return errors;
}

/** Server error codes -> plain-language copy. `api.js` attaches `err.code`. */
const CODE_MESSAGES = {
  invalid_product: MSG.product,
  invalid_deceased_name: MSG.deceasedName,
  invalid_deceased_identifier: MSG.deceasedIdentifier,
  invalid_date_of_death: MSG.dateOfDeath,
  invalid_claimant_name: MSG.claimantName,
  invalid_relationship: MSG.relationship,
  invalid_phone: MSG.phoneBad,
  invalid_email: MSG.emailBad,
  deceased_name_too_long: MSG.tooLong,
  deceased_nin_too_long: MSG.tooLong,
  claimant_name_too_long: MSG.tooLong,
  claimant_nin_too_long: MSG.tooLong,
  claimant_email_too_long: MSG.tooLong,
  relationship_too_long: MSG.tooLong,
  district_too_long: MSG.tooLong,
  notes_too_long: MSG.tooLong,
};

/** Which field a server error code belongs to, for focus + inline display. */
const CODE_FIELDS = {
  invalid_product: 'product',
  invalid_deceased_name: 'deceasedName',
  invalid_deceased_identifier: 'deceasedNin',
  invalid_date_of_death: 'dateOfDeath',
  invalid_claimant_name: 'claimantName',
  invalid_relationship: 'relationship',
  invalid_phone: 'claimantPhone',
  invalid_email: 'claimantEmail',
  deceased_name_too_long: 'deceasedName',
  deceased_nin_too_long: 'deceasedNin',
  claimant_name_too_long: 'claimantName',
  claimant_nin_too_long: 'claimantNin',
  claimant_email_too_long: 'claimantEmail',
  relationship_too_long: 'relationship',
  district_too_long: 'district',
  notes_too_long: 'notes',
};

/** @returns {string|null} plain-language copy for a server error code. */
export function messageForCode(code) {
  return CODE_MESSAGES[code] ?? null;
}

/** @returns {string|null} the form field a server error code maps to. */
export function fieldForCode(code) {
  return CODE_FIELDS[code] ?? null;
}
