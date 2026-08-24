import { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { onAuthExpired } from '../services/api';
import { setToken, clearToken, getToken, isJwtExpired } from '../services/supabaseClient';

/**
 * @typedef {Object} AuthUser
 * @property {string} role - 'subscriber'|'employer'|'distributor'|'branch'|'agent'|'admin'
 * @property {string} phone - Phone number (E.164)
 * @property {string} [name] - Display name; may be omitted by the backend.
 *   AuthContext falls back to `phone` for display when missing.
 * @property {string} [subscriberId] - Set when role === 'subscriber'
 * @property {string} [agentId] - Set when role === 'agent'
 * @property {string} [branchId] - Set when role === 'branch'
 * @property {string} [distributorId] - Set when role === 'distributor'
 * @property {string} [employerId] - Set when role === 'employer'
 * @property {string} [adminId] - Set when role === 'admin'
 * @property {{frequency:'weekly'|'monthly'|'quarterly'|'half-yearly'|'annually', amount:number, retirementPct:number, emergencyPct:number}|null} [contributionSchedule]
 */

/**
 * @typedef {Object} AuthContextValue
 * @property {AuthUser|null} user
 * @property {string|null} role - Shortcut to user.role
 * @property {boolean} isAuthenticated
 * @property {(payload: { token: string, user: AuthUser }) => Promise<AuthUser>} login
 *   - Clears the React Query cache (so no component can render the incoming
 *     identity against the outgoing identity's cached data — A22-001), then
 *     persists the JWT (`upensions_token`) and user object (`upensions_auth`),
 *     updates React state, and returns the resolved user.
 * @property {() => void} logout - Clears the React Query cache, then both auth keys.
 * @property {(updates: Partial<AuthUser>) => void} updateUser - Merge partial updates.
 */

const AUTH_KEY = 'upensions_auth';

const AuthContext = createContext(null);

function readStoredSession() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredSession);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  /**
   * Persist the JWT + user object and resolve with the user so callers can do
   * `await login({...}).then(() => navigate(...))`.
   * Signature is `({ token, user })` rather than the legacy bare user object.
   */
  const login = useCallback(async ({ token, user: nextUser }) => {
    // Drop cached server data BEFORE switching the signed-in user (A22-001).
    // Clearing afterward leaves a window where React has already
    // re-rendered the incoming identity's components against the outgoing
    // identity's cached, RLS-scoped data — e.g. a distributor briefly
    // rendering the previous admin session's platform-wide totals. Ordering
    // is the whole fix.
    queryClient.clear();
    if (token) setToken(token);
    setUser(nextUser);
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(nextUser));
    } catch {
      // Quota / private-browsing — non-fatal; session lives in memory only.
    }
    return nextUser;
  }, [queryClient]);

  /** Apply partial updates to the active session (e.g. profile edits). */
  const updateUser = useCallback((updates) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify(next));
      } catch {
        // Storage may be inaccessible — non-fatal.
      }
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    // Drop cached server data BEFORE switching the signed-in user to null
    // (A22-001) — mirrors `login` above. Clearing afterward would leave a
    // window where already-mounted components re-render against the
    // outgoing user's stale cache for one tick before it's wiped. Ordering
    // is the whole fix.
    queryClient.clear();
    setUser(null);
    clearToken();
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      // Storage may be inaccessible — non-fatal.
    }
  }, [queryClient]);

  // When the API client surfaces a 401, log out and route home via
  // react-router rather than a full page reload. Use refs so the listener
  // body stays identity-stable across renders while always reading the
  // current `logout` + `navigate` callbacks.
  const logoutRef = useRef(logout);
  const navigateRef = useRef(navigate);
  useEffect(() => {
    logoutRef.current = logout;
  });
  useEffect(() => {
    navigateRef.current = navigate;
  });

  // G54 — Subscribe synchronously during render (not inside useEffect) so a
  // 401 returned by an in-flight request that resolves *before* effects run
  // (or during React StrictMode's intentional unmount+remount) still hits a
  // listener. The Set-backed subscribe is naturally idempotent: subsequent
  // renders short-circuit on the ref, and unmount tears down via the
  // sibling effect's cleanup. After StrictMode tears the listener down, the
  // re-mount effect re-subscribes — there is no permanent unsubscribe
  // window because each new mount runs the synchronous block again on its
  // first render (refs are mount-scoped).
  const unsubAuthExpiredRef = useRef(null);
  // Audit G54 intentionally registers the onAuthExpired listener during render
  // (not inside useEffect) so a 401 returned by an in-flight request that
  // resolves *before* effects run still hits a listener. ESLint flags this as
  // a refs-during-render violation; we accept the trade because the failure
  // mode if we miss the early-401 window is a hard page reload (the existing
  // notifyAuthExpired fallback), which is materially worse for a sales demo.
  if (unsubAuthExpiredRef.current === null) {
    // eslint-disable-next-line react-hooks/refs
    unsubAuthExpiredRef.current = onAuthExpired(() => {
      logoutRef.current();
      navigateRef.current('/');
    });
  }
  useEffect(() => {
    // MED-6 — startup token-expiry gate. Our JWT has a fixed 24h TTL and no
    // refresh, so a returning visitor whose token lapsed while they were away
    // would otherwise be restored (from `upensions_auth`) straight into a
    // dashboard where every authed read 401s, with no automatic way out. If we
    // booted with a stored session whose token is provably past `exp`, log out
    // cleanly (clears keys + query cache) and route to sign-in — the same
    // outcome as the mid-session 401 channel (onAuthExpired) below. Decode-only;
    // PostgREST owns signature verification, and isJwtExpired fails OPEN on an
    // unparseable/opaque token so a live token is never wrongly suppressed.
    const storedToken = getToken();
    if (storedToken && isJwtExpired(storedToken) && readStoredSession()) {
      logoutRef.current();
      navigateRef.current('/');
    }

    // If the ref was nulled by a prior cleanup (StrictMode unmount/remount
    // sequence), re-register here. On the first mount this is a no-op
    // because the synchronous render block above already registered.
    if (unsubAuthExpiredRef.current === null) {
      unsubAuthExpiredRef.current = onAuthExpired(() => {
        logoutRef.current();
        navigateRef.current('/');
      });
    }

    // G55 — cross-tab logout sync. When another tab clears the JWT (via
    // logout or notifyAuthExpired), the `storage` event fires here with a
    // null newValue. We mirror the logout in this tab so the session can't
    // linger after the user has signed out elsewhere.
    function onStorage(e) {
      if (e.key === 'upensions_token' && !e.newValue) {
        logoutRef.current();
        navigateRef.current('/');
      }
    }
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      if (unsubAuthExpiredRef.current) {
        unsubAuthExpiredRef.current();
        unsubAuthExpiredRef.current = null;
      }
    };
  }, []);

  const value = useMemo(
    () => ({ user, role: user?.role ?? null, isAuthenticated: !!user, login, logout, updateUser }),
    [user, login, logout, updateUser],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

/**
 * Access the authentication context.
 * @returns {AuthContextValue}
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
