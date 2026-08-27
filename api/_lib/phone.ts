// Phone normalization shared across API routes.
//
// Mirrors src/utils/phone.js (canonical form: `+256XXXXXXXXX`). Kept duplicated
// because api/ is compiled separately from src/ — there's no shared module
// boundary that survives Vercel's bundler split.

// Ceiling for a caller-supplied phone STRING, before normalisation.
//
// Two auth routes (verify-otp, verify-password) fall back to the raw input when
// normalisation fails — `toCanonicalUGPhone(phone) || phone` — because CLAUDE.md
// §8 requires every demo login to succeed, including on a non-UG number. That
// fallback is deliberate and stays. What was NOT deliberate is that it had no
// upper bound: `express.json({ limit: '200kb' })` was the only ceiling, so a
// ~200,000-char string flowed verbatim into the JWT `phone` claim and, with a
// valid password alongside, into `users.id` (a TEXT PRIMARY KEY). Review
// 2026-08-26 §1.3.
//
// 20 is derived, not picked: canonical is 13 (`+256777247884`), and the longest
// human form the routes accept is 16 (`+256 777 247 884`). 20 leaves headroom
// for a stray separator without leaving room for an amplification tail. Shared
// from here rather than duplicated at each call site — a cap that exists twice
// is a cap that drifts.
export const MAX_PHONE_INPUT_LEN = 20;

function parseUGPhoneLocal(raw: unknown): string {
  if (raw == null) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('256')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
}

// Return canonical `+256XXXXXXXXX` (13 chars) or empty if input can't be
// normalized to a valid 9-digit local number.
export function toCanonicalUGPhone(raw: unknown): string {
  const local = parseUGPhoneLocal(raw);
  if (local.length !== 9) return '';
  return `+256${local}`;
}
