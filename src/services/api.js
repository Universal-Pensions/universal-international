// Thin wrapper around fetch() for same-origin /api/* routes (Vercel functions).
//
// Responsibilities:
//   - JWT injection: reads `localStorage['upensions_token']` and sets
//     `Authorization: Bearer <token>` on every request.
//   - 401 detection: notifies all `onAuthExpired` listeners and clears local
//     auth keys before throwing.
//   - Convenience wrappers: api.get / post / put / delete.
//
// `vercel.json` rewrites everything except `/api/*` and `/assets/*` to
// `/index.html`, so the same-origin `/api` prefix works in dev (`vercel dev`)
// and production. The prefix is read from `src/config/env.js` (`API_BASE_URL`)
// which honours `VITE_API_BASE_URL` when set and falls back to `/api`. Override
// the env var only if the `/api/*` routes are hosted elsewhere (separate
// origin, preview vs. prod split, etc.).
//
// `VITE_USE_SUPABASE` is the rollback feature flag. When set to the string
// `'false'` it flips `IS_SUPABASE_ENABLED` off; downstream services can branch
// on it to fall back to mocks.

import { API_BASE_URL } from '../config/env';

const AUTH_KEY = 'upensions_auth';
const TOKEN_KEY = 'upensions_token';

const API_PREFIX = API_BASE_URL;

/** Rollback feature flag (string env -> boolean). Default ON. */
export const IS_SUPABASE_ENABLED =
  String(import.meta.env.VITE_USE_SUPABASE ?? 'true').toLowerCase() !== 'false';

/** localStorage in private-browsing modes can throw; treat as missing. */
function safeRead(key) {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}
function safeRemove(key) {
  try {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Subscribe to 401 (session-expired) events. AuthContext wires its `logout`
 * + `useNavigate('/')` into this so we never hard-reload the page (which
 * would destroy in-memory React Query state).
 */
const authExpiredListeners = new Set();
export function onAuthExpired(handler) {
  authExpiredListeners.add(handler);
  return () => authExpiredListeners.delete(handler);
}

function notifyAuthExpired() {
  safeRemove(AUTH_KEY);
  safeRemove(TOKEN_KEY);
  if (authExpiredListeners.size === 0) {
    if (typeof window !== 'undefined') window.location.assign('/');
    return;
  }
  authExpiredListeners.forEach((h) => {
    try { h(); } catch { /* ignore listener failure */ }
  });
}

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

/** Build a standard error object surfaced to callers (B18 / G47 / G48 / G50). */
function createApiError(code, message, status, body) {
  const err = new Error(message);
  err.code = code;
  if (status != null) err.status = status;
  if (body !== undefined) err.body = body;
  return err;
}

/**
 * Fire a request against an `/api/*` route (Vercel during dev rewrite or the
 * Express server in production).
 *
 * @param {string} path - Path beginning with `/`, e.g. `/auth/verify-otp`.
 * @param {RequestInit & { signal?: AbortSignal, _retry?: boolean }} [options] -
 *   Standard fetch options. `options.signal` (G52) is honoured alongside the
 *   internal 20s timeout. `_retry` is internal — set on the second pass so
 *   the retry loop never recurses past depth 1.
 * @returns {Promise<any>} Parsed JSON body (or null on 204).
 * @throws {Error} On non-OK responses. The thrown error has a `code`, `status`
 *   (HTTP status when applicable), and an optional `body` (the parsed JSON).
 *   Cold-start error codes layered by Phase 5:
 *     - `timeout`             — fetch took >20s or aborted (B18 / G67).
 *     - `network_unreachable` — fetch threw `TypeError` (G50).
 *     - `server_unavailable`  — 5xx or non-JSON response body (G48).
 *   401 fires `onAuthExpired` listeners before throwing (unchanged).
 */
export async function apiFetch(path, options = {}) {
  const url = `${API_PREFIX}${path}`;
  const token = safeRead(TOKEN_KEY);
  const method = (options.method || 'GET').toUpperCase();
  // Only GET/HEAD are safe to auto-retry — they're idempotent. POST/PUT/PATCH/
  // DELETE must fast-fail and surface the error to the caller rather than
  // silently replaying a write (pairs with the P5 signup nonce so a genuine
  // duplicate is rejected server-side; here we simply never re-send).
  const isIdempotent = method === 'GET' || method === 'HEAD';

  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (METHODS_WITH_BODY.has(method) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // B18 + G67 — Portable timeout via AbortController. We can't use
  // `AbortSignal.timeout(...)` because Safari 15 (still common in the
  // demo's target deployment) needs polyfilling for it. G52 — if the caller
  // passes their own signal, we forward theirs so they retain cancellation
  // control; otherwise we use our internal controller.
  //
  // Auth paths (`/auth/*` — login / OTP / password) fail fast (~8s) so a sales
  // rep at the sign-in modal isn't left hanging for 20s on a cold start; every
  // other path keeps the 20s budget for cold-start tolerance.
  const isAuthPath = path.startsWith('/auth/');
  const timeoutMs = isAuthPath ? 8_000 : 20_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  // Strip internal-only flags from the fetch init.
  const { signal: callerSignal, _retry, ...rest } = options;

  let res;
  try {
    res = await fetch(url, {
      ...rest,
      headers,
      signal: callerSignal ?? controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      const timeoutErr = createApiError('timeout', 'Request timed out');
      // G49 — single retry on transient cold-start failures, idempotent only.
      // Writes (POST/PUT/PATCH/DELETE) fast-fail so a timed-out request is not
      // silently replayed (it may have already mutated server state).
      if (!_retry && isIdempotent) {
        await new Promise((r) => setTimeout(r, 1500));
        return apiFetch(path, { ...options, _retry: true });
      }
      throw timeoutErr;
    }
    if (err instanceof TypeError) {
      // G50 — "Failed to fetch" / DNS / TLS / offline all surface as TypeError.
      const netErr = createApiError('network_unreachable', 'Could not reach server');
      throw netErr;
    }
    throw err;
  }
  clearTimeout(timeoutId);

  // G48 — Treat 5xx or non-JSON bodies as server_unavailable (cold-start
  // returning Render's HTML maintenance page, an LB 502, etc.).
  if (res.status >= 500) {
    // Dev-only: the Vite proxy (vite.config.js) mints a `backend_down` body when
    // the local Express API (:3001) isn't running. Surface its actionable hint
    // instead of the generic "Server unavailable" so the sign-in UI tells the
    // developer exactly what to do. Guarded on DEV + `clone` so this never
    // changes production behaviour or perturbs test fetch-doubles.
    if (import.meta.env?.DEV && typeof res.clone === 'function') {
      const proxyBody = await res.clone().json().catch(() => null);
      if (proxyBody?.code === 'backend_down') {
        throw createApiError('backend_down', proxyBody.message || 'API server not running — run `npm run dev:all`.', res.status);
      }
    }
    const err = createApiError('server_unavailable', 'Server unavailable', res.status);
    // G49 — single retry with 1.5s backoff, idempotent only. A 5xx on a write
    // may have partially applied server-side, so we never auto-replay it.
    if (!_retry && isIdempotent) {
      await new Promise((r) => setTimeout(r, 1500));
      return apiFetch(path, { ...options, _retry: true });
    }
    throw err;
  }
  // Defensive header read — some test doubles (and some unusual transport
  // wrappers) don't expose a `Headers` instance. Treat a missing/empty
  // content-type as "trust it" — JSON parsing further down will surface any
  // real mismatch as raw text instead of a thrown server_unavailable.
  const contentType = (res.headers && typeof res.headers.get === 'function')
    ? (res.headers.get('content-type') || '')
    : '';
  if (res.status !== 204 && contentType && !contentType.includes('json')) {
    // Server returned 2xx/4xx but the body isn't JSON — most likely a CDN /
    // load-balancer HTML page interposed in front of the Express server.
    const err = createApiError('server_unavailable', 'Server unavailable', res.status);
    // Idempotent only — same write-safety reasoning as the 5xx branch above.
    if (!_retry && isIdempotent) {
      await new Promise((r) => setTimeout(r, 1500));
      return apiFetch(path, { ...options, _retry: true });
    }
    throw err;
  }

  if (res.status === 401) {
    // Read the body once so we can distinguish "the token itself is bad"
    // (no code, session_expired, or unauthorized — all server signals that
    // the JWT is missing/expired/invalid) from a domain-level 401 like
    // `password_not_set`, `invalid_password`, or `current_password_invalid`
    // that the caller needs to handle without being logged out.
    const body = await res.json().catch(() => ({}));
    const code = body?.error || body?.code;
    if (!code || code === 'session_expired' || code === 'unauthorized') {
      notifyAuthExpired();
      throw createApiError('session_expired', 'Session expired', 401);
    }
    const message = body?.message || code || `API error: ${res.status}`;
    throw createApiError(code, message, 401, body);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = body?.error || body?.code;
    const message = body?.message || code || `API error: ${res.status}`;
    // G49 — 4xx is NOT retried; only the transient codes above hit the retry
    // branch. We fall through to the normal throw.
    throw createApiError(code, message, res.status, body);
  }

  if (res.status === 204) return null;

  // Some routes return empty bodies on 200 (no Content-Type / zero length).
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Convenience wrappers around `apiFetch`.
 *
 * The third `options` argument on body-bearing methods is optional and supports
 * `{ headers: {...} }` — handy for forwarding per-call headers like
 * `X-QA-Force` from the KYC service without polluting the global `Authorization`
 * + `Content-Type` defaults handled inside `apiFetch`. Any keys passed in
 * `options.headers` are merged on top of the defaults.
 */
export const api = {
  get: (path, options = {}) => apiFetch(path, { ...options }),
  post: (path, data, options = {}) =>
    apiFetch(path, { ...options, method: 'POST', body: JSON.stringify(data ?? {}) }),
  put: (path, data, options = {}) =>
    apiFetch(path, { ...options, method: 'PUT', body: JSON.stringify(data ?? {}) }),
  delete: (path, options = {}) => apiFetch(path, { ...options, method: 'DELETE' }),
};
