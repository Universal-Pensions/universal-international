// Shared validation for the request-access form (desktop `RequestAccess.jsx`
// and phone `mobile/RequestAccessMobile.jsx`).
//
// EVERY field is required, and that is not arbitrary strictness:
//   phone    — this IS the sign-in key. `verify-otp` resolves a non-subscriber
//              identity through `demo_personas(phone, role) -> entity_id`, and
//              migration 0090 writes that row at approval time from exactly this
//              value. No phone => no account anyone can ever sign in to.
//   email    — the only channel we have to tell a requester they were approved.
//   sector   — employer only; `create_employer` stores it on the account.
//   district — employer only; `approve_access_request` resolves the NAME to a
//              `districts.id`, so a free-text value that isn't a real district
//              provisions an employer with no geography.
//
// Kept as a plain module (no React) so both variants and the unit tests share
// one definition — a field added to a form but not here would silently become
// optional again, which is the exact defect this replaces.
import { isValidUGPhone } from '../../utils/phone';
import { isKnownDistrict } from '../../constants/districts';

/** Deliberately permissive: reject the obviously-broken, don't police RFC 5322. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Field order per variant. Drives "focus the first invalid input", so it must
 * match the visual/DOM order on BOTH variants.
 */
export const FIELD_ORDER = {
  employer: ['org', 'name', 'email', 'phone', 'sector', 'district'],
  distributor: ['org', 'name', 'email', 'phone'],
};

/** Max lengths, matched to the `left(...)` truncation in approve_access_request. */
export const MAX_LEN = {
  org: { employer: 160, distributor: 120 },
  name: 120,
  email: 160,
  phone: 32,
  sector: 80,
  district: 80,
};

const MSG = {
  org: 'Please enter your organisation’s name.',
  name: 'Please enter your name.',
  email: 'Please enter your work email.',
  emailBad: 'That email address does not look right.',
  phone: 'Please enter your phone number.',
  phoneBad: 'Please enter a Uganda mobile number, like 0771 234 567.',
  sector: 'Please tell us what your company does.',
  district: 'Please enter your district.',
  districtBad: 'Please pick a Uganda district from the list.',
  tooLong: 'That is too long — please shorten it.',
};

/**
 * @param {Record<string,string>} form
 * @param {'employer'|'distributor'} type
 * @returns {Record<string,string>} field -> message; empty object means valid.
 */
export function validateAccessRequest(form = {}, type = 'employer') {
  const v = (k) => String(form[k] ?? '').trim();
  const errors = {};
  const fields = FIELD_ORDER[type] ?? FIELD_ORDER.employer;

  if (fields.includes('org')) {
    const org = v('org');
    if (!org) errors.org = MSG.org;
    else if (org.length > (MAX_LEN.org[type] ?? MAX_LEN.org.employer)) errors.org = MSG.tooLong;
  }
  if (fields.includes('name')) {
    const name = v('name');
    if (!name) errors.name = MSG.name;
    else if (name.length > MAX_LEN.name) errors.name = MSG.tooLong;
  }
  if (fields.includes('email')) {
    const email = v('email');
    if (!email) errors.email = MSG.email;
    else if (!EMAIL_PATTERN.test(email)) errors.email = MSG.emailBad;
    else if (email.length > MAX_LEN.email) errors.email = MSG.tooLong;
  }
  if (fields.includes('phone')) {
    const phone = v('phone');
    if (!phone) errors.phone = MSG.phone;
    else if (!isValidUGPhone(phone)) errors.phone = MSG.phoneBad;
  }
  if (fields.includes('sector')) {
    const sector = v('sector');
    if (!sector) errors.sector = MSG.sector;
    else if (sector.length > MAX_LEN.sector) errors.sector = MSG.tooLong;
  }
  if (fields.includes('district')) {
    const district = v('district');
    if (!district) errors.district = MSG.district;
    else if (!isKnownDistrict(district)) errors.district = MSG.districtBad;
  }
  return errors;
}

/** Server error codes -> plain-language copy. `api.js` attaches `err.code`. */
const CODE_MESSAGES = {
  invalid_org_name: MSG.org,
  invalid_contact_name: MSG.name,
  invalid_email: MSG.emailBad,
  invalid_phone: MSG.phoneBad,
  invalid_sector: MSG.sector,
  invalid_district: MSG.districtBad,
  invalid_type: 'That link looks wrong. Please go back and try again.',
  org_name_too_long: MSG.tooLong,
  contact_name_too_long: MSG.tooLong,
  contact_email_too_long: MSG.tooLong,
  contact_phone_too_long: MSG.tooLong,
  sector_too_long: MSG.tooLong,
  district_too_long: MSG.tooLong,
};

export function messageForCode(code) {
  return CODE_MESSAGES[code] ?? 'Something went wrong sending your request. Please try again.';
}
