// Sentry PII / secret scrubber — frontend (@sentry/react) half.
//
// This is observability hardening, NOT a new integration: it is a `beforeSend`
// guard that runs only when a DSN is configured (`src/main.jsx`). Its purpose is
// to keep CLAUDE.md §7 ("never log JWTs", PII hygiene) true even if a future
// maintainer flips `sendDefaultPii: true`, adds Replay, or wires a breadcrumb
// that captures form state. Today Sentry v8 already defaults `sendDefaultPii`
// false and strips Authorization/cookies — this is belt-and-braces on top.
//
// KEEP IN SYNC with `server/sentryScrub.ts` — the two halves are intentionally
// identical (separate build graphs: Vite bundles this, tsc compiles the server
// copy with NodeNext/`rootDir: ..` which cannot reach `src/`). Any change to the
// redaction rules below must be mirrored there.
//
// PII vectors specific to this app (audit BL-26 / H-4):
//   - Ugandan phone numbers (synthetic `+25671XXXXXXX` demo range, but redact
//     any `+256…` / bare `25671…` shape).
//   - `users.id` is `` `${role}:${phone}` `` and becomes the JWT `sub`, so a
//     `subscriber:+256701234567` substring can ride along in a Supabase error
//     message or breadcrumb.
//   - Bearer tokens / Authorization headers / JWT-shaped strings.
//   - `password` fields (e.g. change-password form state).

const REDACTED = '[redacted]';

// Ugandan phone: optional +/256 prefix then a 9-digit local number, with the
// `role:phone` id form (`subscriber:+256…`) caught by leaving the optional
// `+`/`256` outside a word boundary. Matches `+256701234567`, `256701234567`,
// and `+256 701 234 567` once separators are collapsed by the caller path —
// here we match the compact form most error/id strings carry.
const PHONE_RE = /(?:\+?256|0)?7\d{8}/g;

/** Ugandan NIN: C + M|F + 12 alphanumerics, the format ReviewStep.jsx's
 *  NIN_RE enforces on entry. Matched case-sensitively — a real NIN is upper. */
const NIN_RE = /\bC[MF][A-Z0-9]{12}\b/g;
// JWTs: three base64url segments separated by dots (header.payload.signature).
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// `Bearer <token>` anywhere in a string.
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+/gi;

// Header/field names whose VALUES are dropped wholesale (case-insensitive).
const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-auth-token',
  'password',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'token',
  'access_token',
  'refresh_token',
  'jwt',
  'otp',
  // National ID. NOT previously here, and no pattern matched it either — so
  // every NIN this platform handles went to Sentry in the clear, from the one
  // module whose entire purpose is stripping PII. Found while testing the cycle
  // guard: a NIN survived a scrub that was otherwise working correctly.
  'nin',
  'nationalid',
  'national_id',
  'idnumber',
  'id_number',
]);

/** Redact PII/secret substrings inside a single string. */
export function scrubString(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  return value
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(PHONE_RE, REDACTED)
    .replace(NIN_RE, REDACTED);
}

/**
 * Deep-clone-and-redact an arbitrary value. Drops whole values for keys in
 * `SENSITIVE_KEYS`; scrubs substrings everywhere else. Guards against cycles
 * and caps recursion depth so a pathological event can't hang the tab.
 */
export function scrubValue(value, depth = 0, seen = new Map()) {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return scrubString(value);
  if (value == null || typeof value !== 'object') return value;
  // ⚠️ The SCRUBBED twin, never the raw input. This was
  //     if (seen.has(value)) return value;
  // over a WeakSet, which fires on any REPEATED REFERENCE, not just a cycle. An
  // event holding the same object twice ({ a: ctx, b: ctx }) got one scrubbed
  // copy and one pristine original, so the payload Sentry serialised still
  // carried the NIN/phone this module exists to remove. Registering the twin
  // BEFORE recursing fixes cycles and shared references in one move.
  if (seen.has(value)) return seen.get(value);

  if (Array.isArray(value)) {
    const arr = [];
    seen.set(value, arr);
    for (const v of value) arr.push(scrubValue(v, depth + 1, seen));
    return arr;
  }

  const out = {};
  seen.set(value, out);
  for (const [key, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else {
      out[key] = scrubValue(v, depth + 1, seen);
    }
  }
  return out;
}

/**
 * `beforeSend` hook. Scrubs the message, exception values, breadcrumbs,
 * request data/headers, extra, contexts, and user fields of an outgoing event.
 * Returns the same (mutated) event so Sentry still sends it — we redact, we
 * don't drop.
 */
export function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.message) event.message = scrubString(event.message);

  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex && typeof ex.value === 'string') ex.value = scrubString(ex.value);
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b));
  }

  if (event.request) {
    // Belt-and-braces: assert auth headers/cookies are gone even if a future
    // Sentry default change stops stripping them.
    if (event.request.headers) {
      event.request.headers = scrubValue(event.request.headers);
    }
    if (event.request.cookies) event.request.cookies = REDACTED;
    if (event.request.data) event.request.data = scrubValue(event.request.data);
    if (typeof event.request.query_string === 'string') {
      event.request.query_string = scrubString(event.request.query_string);
    }
  }

  if (event.extra) event.extra = scrubValue(event.extra);
  if (event.contexts) event.contexts = scrubValue(event.contexts);
  if (event.user) event.user = scrubValue(event.user);

  return event;
}

/** `beforeBreadcrumb` hook — scrubs message + data of each breadcrumb. */
export function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb;
  if (breadcrumb.message) breadcrumb.message = scrubString(breadcrumb.message);
  if (breadcrumb.data) breadcrumb.data = scrubValue(breadcrumb.data);
  return breadcrumb;
}
