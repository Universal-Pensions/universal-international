// Supabase singleton client + token helpers.
//
// We deliberately wrap @supabase/postgrest-js's PostgrestClient instead of
// @supabase/supabase-js's createClient: the app only ever calls `.from()` and
// `.rpc()`, so the auth-js / realtime / storage / webauthn machinery the full
// SDK pulls in (~80 kB gz, modulepreloaded on every route) was provably dead
// weight. PostgrestClient (~23 kB gz standalone) exposes the identical
// `{ from, rpc }` surface, so no consumer import changes.
//
// Token lifecycle:
//   - `setToken(token)` after a successful `verifyOtp` (called by AuthContext.login).
//   - `getToken()` reads localStorage; returned to anything that needs to inspect it.
//   - `clearToken()` on logout (called by AuthContext.logout).
//   - The custom `fetch` wrapper below is invoked by postgrest-js on every
//     request; it re-reads localStorage so the freshest JWT is sent and
//     PostgREST's `auth.jwt()` reflects the current session inside RLS.
//
// Why a custom `fetch`, not the static construction-time `headers`: PostgrestClient
// snapshots `headers` once at construction, so a token minted after login would
// never reach a long-lived singleton. supabase-js solved this with its
// `accessToken` async hook (`getAccessToken()` → `Authorization: Bearer …`);
// postgrest-js has no such hook, so we replicate the same dynamic injection by
// reading the JWT inside a per-request `fetch` wrapper. When no token is present
// (pre-login / post-logout) we fall back to the anon key in `Authorization`,
// matching supabase-js's anon-fallback behaviour. The `apikey` header (anon key)
// is set statically at construction — it is constant for the session.
//
// 401 handling: postgrest-js does NOT expose a generic per-response hook. Service
// callers that fall back to `apiFetch` (services/api.js) get 401 detection via
// `onAuthExpired` listeners there. For supabase-js calls, downstream services
// inspect each `.from()` / `.rpc()` error and forward PGRST301 / 401-equivalent
// errors via `forwardSupabaseAuthError()` below, which drives the SAME
// logout+redirect outcome that `apiFetch`'s `notifyAuthExpired()` does.
//
// Why not call `notifyAuthExpired` directly: it is private to services/api.js
// (only `onAuthExpired` — the subscribe side — is exported). Re-exporting it
// would be an api.js change outside this task's file scope, so we reuse the
// other end of the SAME channel AuthContext already listens on: AuthContext's
// `storage`-event handler logs the user out + redirects to "/" when the
// `upensions_token` key is cleared (AuthContext.jsx ~144). We clear the auth
// keys and dispatch that synthetic StorageEvent, producing an identical
// logout. (RESTORE-VERIFY: once api.js exports a notifier, swap the storage
// dispatch below for a direct call to it so we hit the in-process
// `authExpiredListeners` Set without the StorageEvent indirection.)

import { PostgrestClient } from '@supabase/postgrest-js';

const TOKEN_KEY = 'upensions_token';

/** localStorage can throw in private-browsing modes; treat as missing. */
function safeRead(key) {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function safeWrite(key, value) {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    /* ignore — token lives in memory only this session */
  }
}
function safeRemove(key) {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getToken() {
  return safeRead(TOKEN_KEY);
}
export function setToken(token) {
  if (!token) {
    safeRemove(TOKEN_KEY);
    return;
  }
  safeWrite(TOKEN_KEY, token);
}
export function clearToken() {
  safeRemove(TOKEN_KEY);
}

/**
 * True ONLY for a token we can prove is past its `exp`. An expired custom JWT is
 * rejected by PostgREST with 401 "JWT expired", so it must never be sent as the
 * bearer — a stale token left in localStorage from an old session would
 * otherwise break even public, anon-only reads (e.g. the signup district list,
 * which every unauthenticated visitor needs). We decode WITHOUT verifying
 * (PostgREST owns signature verification); if the value can't be parsed or has
 * no numeric `exp`, we fail OPEN (return false) and send it exactly as before,
 * so this can only ever suppress a provably-dead token — never a live one, and
 * never the opaque test fixtures the accessToken round-trip relies on.
 */
export function isJwtExpired(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return false;
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const { exp } = JSON.parse(atob(b64));
    return typeof exp === 'number' && Date.now() >= exp * 1000;
  } catch {
    return false;
  }
}

/** The stored user JWT, but only when present AND not provably expired. */
function liveToken() {
  const stored = safeRead(TOKEN_KEY);
  return stored && !isJwtExpired(stored) ? stored : null;
}

// `upensions_auth` mirrors the key apiFetch's notifyAuthExpired() clears, so the
// post-logout state is identical whether the 401 came from `/api/*` or supabase.
const AUTH_KEY = 'upensions_auth';

/**
 * True when a supabase-js error means the session JWT is missing/expired/invalid
 * — i.e. it should log the user out, NOT be handled as a domain error.
 *
 * PostgREST surfaces an expired/invalid JWT as code `PGRST301` (JWT expired) or
 * `PGRST302` (anonymous access disallowed); `.rpc()` / `.from()` propagate that
 * in `error.code`. Some transports also attach an HTTP `status`/`statusCode` of
 * 401, which we treat the same. We deliberately do NOT log out on PGRST116
 * (no rows) or RLS-denied reads that return empty — only on auth-token failures.
 */
export function isSupabaseAuthError(error) {
  if (!error) return false;
  const code = error.code || error.error || '';
  if (code === 'PGRST301' || code === 'PGRST302') return true;
  const status = error.status ?? error.statusCode ?? error.httpStatus;
  return status === 401;
}

/**
 * Forward a supabase-js auth error to the same logout channel `apiFetch` uses.
 *
 * Detection is gated by `isSupabaseAuthError` so a normal domain error (empty
 * read, RLS-denied row, validation failure) never trips a logout. On a real
 * token failure we clear the auth + token keys and dispatch the synthetic
 * `storage` event AuthContext listens on, which runs the same logout + redirect
 * as the in-process `onAuthExpired` listeners would.
 *
 * @param {unknown} error - the `error` field from a supabase-js `.from()`/`.rpc()` result.
 * @returns {boolean} true if the error was an auth error and was forwarded.
 */
export function forwardSupabaseAuthError(error) {
  if (!isSupabaseAuthError(error)) return false;
  safeRemove(AUTH_KEY);
  safeRemove(TOKEN_KEY);
  // Same-tab `storage` events don't fire automatically, so dispatch one
  // explicitly. AuthContext's onStorage handler keys on `upensions_token` with
  // a null newValue and performs logout()+navigate('/') — identical to the
  // notifyAuthExpired() outcome in services/api.js.
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(
        new StorageEvent('storage', { key: TOKEN_KEY, oldValue: 'expired', newValue: null }),
      );
    } catch {
      /* StorageEvent constructor unavailable (very old engines) — keys already
         cleared above, so a subsequent navigation re-evaluates as logged-out. */
    }
  }
  return true;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const IS_DEV = import.meta.env.DEV === true;

// In dev with the rollback flag flipped off (or with no `.env.local` at all),
// we still want a valid client construction so imports don't blow up — the
// services that gate on `VITE_USE_SUPABASE=false` will short-circuit before
// any network call. In any non-dev build (production, preview, vercel dev with
// NODE_ENV=production) a missing URL/anon key is a hard failure: the previous
// silent fallback to `localhost:54321` / `'public-anon-key'` shipped broken
// builds to prod with no signal until the first failed request.
function resolveUrl() {
  if (SUPABASE_URL) return SUPABASE_URL;
  if (!IS_DEV) {
    throw new Error('VITE_SUPABASE_URL is not set. Add it to .env.local — see .env.local.example.');
  }
  console.warn(
    '[supabaseClient] VITE_SUPABASE_URL is unset — falling back to http://localhost:54321 (dev only). Add it to .env.local — see .env.local.example.',
  );
  return 'http://localhost:54321';
}

function resolveAnonKey() {
  if (SUPABASE_ANON_KEY) return SUPABASE_ANON_KEY;
  if (!IS_DEV) {
    throw new Error('VITE_SUPABASE_ANON_KEY is not set. Add it to .env.local — see .env.local.example.');
  }
  console.warn(
    '[supabaseClient] VITE_SUPABASE_ANON_KEY is unset — falling back to a placeholder (dev only). Add it to .env.local — see .env.local.example.',
  );
  return 'public-anon-key';
}

const url = resolveUrl();
const anon = resolveAnonKey();

// Per-request JWT injection (the postgrest-js equivalent of supabase-js's
// `accessToken` hook): re-read the freshest JWT from localStorage on every call
// and set `Authorization: Bearer …`. When no user token is present (pre-login /
// post-logout) we fall back to the anon key, so public reads keep working — the
// same anon-fallback supabase-js applied. The static `apikey` header (set at
// construction below) is always sent; PostgREST requires it independently of
// the bearer token. We only override `Authorization` and leave every other
// header postgrest-js already set (apikey, content-type, prefer, …) untouched.
const fetchWithAuth = (input, init = {}) => {
  // A live user JWT when we have one, else the anon key. A provably-expired
  // token is treated as absent (see liveToken/isJwtExpired) so it can't 401 an
  // otherwise-public read.
  const token = liveToken() || anon;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

// supabase-js appends `/rest/v1` to the project URL; do the same. Strip any
// trailing slash first so we never emit a `//rest/v1` double-slash.
const REST_URL = `${url.replace(/\/+$/, '')}/rest/v1`;

export const supabase = new PostgrestClient(REST_URL, {
  // anon key — PostgREST's `apikey` gate; constant for the session.
  headers: { apikey: anon },
  // dynamic user-JWT bearer injection (see fetchWithAuth above).
  fetch: fetchWithAuth,
});

// Test hook (no production reader): mirrors the construction inputs the way the
// old supabase-js `createClient` mock exposed them — the resolved (un-suffixed)
// URL + anon key, plus an `accessToken` callback matching supabase-js's hook
// semantics (re-reads the freshest JWT from localStorage on each call, returns
// null when absent or when localStorage throws). The live per-request bearer
// injection is `fetchWithAuth` above; this hook just lets the existing
// supabaseClient.test.js assert the env-resolution + token-read behaviour
// without depending on the SDK we no longer construct.
supabase.__ctor = {
  url,
  anon,
  opts: {
    accessToken: async () => liveToken(),
  },
};

export default supabase;
