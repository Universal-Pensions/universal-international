// Plain-language error copy for user-facing toasts / ErrorCards.
//
// A22-004 (docs/audits/2026-08-23/22-state-errors.md): every write catch block
// in the app follows the same shape —
//   addToast('error', err?.message || 'Could not do the thing.')
// — on the theory that `err.message` is USUALLY empty so the friendly fallback
// wins. In practice `err.message` is ALWAYS populated:
//   - services/api.js's createApiError always sets a message.
//   - the direct-Supabase path (`supabase.rpc()`/`.from()`) throws the raw
//     PostgREST error body, whose `message` field is never empty either — and
//     on a network failure, postgrest-js builds it as
//     `${fetchError.name}: ${fetchError.message}`, i.e. the literal string
//     "TypeError: Failed to fetch" (verified against
//     node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts).
// So the `|| fallback` branch never runs, and a prospect can see raw JS/DB
// internals on a money action during a demo.
//
// This does NOT blanket-replace every message — a short, human-authored
// validation message an RPC deliberately raises (e.g. "amount must be greater
// than zero") is exactly the honest, actionable copy a low-literacy audience
// needs, and is left untouched. Only messages that are demonstrably technical
// (a bare JS error-name prefix, a raw fetch failure, or opaque
// Postgres/PostgREST internals) are replaced — with the CALLER's own
// `fallback` (never an invented, more-specific cause we don't actually know —
// see the P4 task brief: "never invent a cause you do not know").

/** Known api.js (services/api.js createApiError) infra codes that are always
 * a network/transport problem, never a domain error. */
const NETWORK_CODES = new Set(['network_unreachable', 'timeout']);
/** Known api.js infra codes that mean "the server didn't answer" — a real,
 * known cause, but not one worth re-explaining beyond the page's own fallback. */
const SERVER_DOWN_CODES = new Set(['server_unavailable', 'backend_down']);

/** PostgREST's expired/invalid-JWT codes (services/supabaseClient.js
 * isSupabaseAuthError) plus api.js's own expiry code. Duplicated as literal
 * checks here (rather than importing isSupabaseAuthError) so this stays a
 * dependency-free copy utility usable from any layer. */
function isAuthExpiryShaped(err) {
  const code = err?.code || err?.error || '';
  if (code === 'PGRST301' || code === 'PGRST302' || code === 'session_expired') return true;
  const status = err?.status ?? err?.statusCode ?? err?.httpStatus;
  return status === 401;
}

/** Browsers spell "the fetch() call itself failed" differently. postgrest-js
 * additionally prefixes the JS error name, so a network drop on the direct-
 * Supabase path surfaces as the literal string "TypeError: Failed to fetch". */
const NETWORK_MESSAGE_RE = /^(?:[A-Z][A-Za-z]*Error:\s*)?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i;

/** A bare "<SomeError>: …" prefix (TypeError/SyntaxError/RangeError/…) is a JS
 * implementation detail, not something to read aloud to a prospect. */
const JS_ERROR_PREFIX_RE = /^[A-Z][A-Za-z]*Error\b\s*:?/;

/** Opaque Postgres/PostgREST internals — the raw exception text a
 * SECURITY DEFINER function's default (uncaught) handler produces, or raw
 * constraint/permission text that leaks table/column names. */
const OPAQUE_DB_TEXT_RE = /unexpected error while executing|internal server error|permission denied for|violates .* constraint|duplicate key value|invalid input syntax|null value in column/i;

/**
 * Map a caught write/read error to plain-language copy safe to show a user.
 *
 * @param {unknown} err - the caught error (Error instance, or the plain
 *   `{message, code, details, hint}` object the direct-Supabase path throws).
 * @param {string} fallback - the caller's own plain-language default, e.g.
 *   "Could not complete the top-up."
 * @returns {string}
 */
export function getFriendlyErrorMessage(err, fallback) {
  const rawMessage = typeof err?.message === 'string' ? err.message.trim() : '';
  if (!rawMessage) return fallback;

  if (isAuthExpiryShaped(err)) {
    return 'Your session has expired. Please sign in again.';
  }

  const code = err?.code;
  if (NETWORK_CODES.has(code) || NETWORK_MESSAGE_RE.test(rawMessage)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (SERVER_DOWN_CODES.has(code)) {
    return fallback;
  }

  if (JS_ERROR_PREFIX_RE.test(rawMessage) || OPAQUE_DB_TEXT_RE.test(rawMessage)) {
    return fallback;
  }

  // Whatever is left reads as a short, human-authored sentence (e.g. a
  // validation message an RPC raised on purpose) — show it as-is.
  return rawMessage;
}
