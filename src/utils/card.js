// Card helpers for the demo card gateway (see `src/constants/payment.js` and
// `src/components/payment/PaymentMethodPicker.jsx`). Pure string/date functions
// only — no React, no network — so they're cheap to unit-test.
//
// DEMO SCOPE (CLAUDE.md §10a): there is no card processor behind this. We
// deliberately do NOT run a Luhn checksum: a sales rep typing an arbitrary
// 16-digit number mid-pitch must not hit "invalid card". Validation is
// format-only (right number of digits, a real un-expired month, right CVC
// length, a name), which is enough to demo the failure copy without ever
// blocking a live demo. Card details are held in component state for the
// duration of the flow and never persisted or sent anywhere — only the derived
// `"Visa •••• 4242"` label reaches the database, as `transactions.method`.

const BRANDS = [
  { id: 'visa',       label: 'Visa',       pattern: /^4/,             length: 16, cvcLength: 3, gaps: [4, 8, 12] },
  { id: 'mastercard', label: 'Mastercard', pattern: /^(5[1-5]|2[2-7])/, length: 16, cvcLength: 3, gaps: [4, 8, 12] },
  { id: 'amex',       label: 'Amex',       pattern: /^3[47]/,         length: 15, cvcLength: 4, gaps: [4, 10] },
];

// What an unrecognised (or not-yet-typed) prefix falls back to — 16 digits in
// 4-4-4-4 with a 3-digit CVC, which covers the rest of the common estate.
export const UNKNOWN_BRAND = {
  id: 'unknown', label: 'Card', pattern: null, length: 16, cvcLength: 3, gaps: [4, 8, 12],
};

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Brand descriptor for a (possibly partial) card number. Never returns null. */
export function detectCardBrand(value) {
  const digits = onlyDigits(value);
  if (!digits) return UNKNOWN_BRAND;
  return BRANDS.find((b) => b.pattern.test(digits)) ?? UNKNOWN_BRAND;
}

/** "4242424242424242" → "4242 4242 4242 4242" (Amex groups 4-6-5). */
export function formatCardNumber(value) {
  const brand = detectCardBrand(value);
  const digits = onlyDigits(value).slice(0, brand.length);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (brand.gaps.includes(i)) out += ' ';
    out += digits[i];
  }
  return out;
}

/**
 * "1228" → "12 / 28". A leading digit above 1 is padded ("9" → "09") so the
 * field can't be left in a state that reads as month 90-something.
 */
export function formatExpiry(value) {
  let digits = onlyDigits(value).slice(0, 4);
  if (digits.length === 1 && digits > '1') digits = `0${digits}`;
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
}

/** True when the expiry is a real month that has not already passed. */
export function isExpiryValid(value, now = new Date()) {
  const digits = onlyDigits(value);
  if (digits.length !== 4) return false;
  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2));
  if (month < 1 || month > 12) return false;
  // A card is good through the LAST day of its expiry month, so compare against
  // the first instant of the month after it.
  return new Date(year, month, 1) > now;
}

/** CVC length the current brand expects (Amex 4, everything else 3). */
export function cvcLengthFor(value) {
  return detectCardBrand(value).cvcLength;
}

/** Every field present and well-formed — gates the pay button. */
export function isCardComplete(card, now = new Date()) {
  if (!card) return false;
  const brand = detectCardBrand(card.number);
  return onlyDigits(card.number).length === brand.length
    && isExpiryValid(card.expiry, now)
    && onlyDigits(card.cvc).length === brand.cvcLength
    && String(card.name ?? '').trim().length >= 2;
}

/** "•••• •••• •••• 4242" — the number as shown once we stop echoing it back. */
export function maskedCardNumber(card) {
  const brand = detectCardBrand(card?.number);
  const digits = onlyDigits(card?.number);
  const last4 = digits.slice(-4);
  if (!last4) return '';
  const hiddenGroups = brand.id === 'amex' ? ['••••', '••••••'] : ['••••', '••••', '••••'];
  return [...hiddenGroups, last4].join(' ');
}

/**
 * The string written to `transactions.method` for a card payment, e.g.
 * "Visa •••• 4242". Chosen over a bare "Card" so the activity feed and the
 * All-transactions report stay legible when a member pays several ways.
 */
export function cardRecordLabel(card) {
  const brand = detectCardBrand(card?.number);
  const last4 = onlyDigits(card?.number).slice(-4);
  return last4 ? `${brand.label} •••• ${last4}` : brand.label;
}
