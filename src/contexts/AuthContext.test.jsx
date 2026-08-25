// A22-001 regression guard — cross-tenant React Query cache bleed on an
// in-SPA identity switch (docs/audits/2026-08-23/22-state-errors.md).
//
// The confirmed bug: `login` set the new user but never cleared the query
// cache, so signing in as a second role in the same tab (no hard reload, no
// prior Log out) rendered that role's dashboard against the PREVIOUS role's
// cached, RLS-scoped data. Audited live: an admin session cached
// `['entityMetrics','country','ug']` = platform totals (UGX 2.45B / 321
// branches); signing in as distributor d-002 without logging out rendered
// those same platform totals instead of d-002's own ~UGX 0.17B / 27 branches.
// `logout` DID clear the cache, but textually AFTER `setUser(null)`.
//
// Why the tests below are shaped the way they are: React 18 batches state
// updates made inside a plain synchronous callback (neither `login` nor
// `logout` awaits anything before either statement), so no render can ever
// land *between* `queryClient.clear()` and `setUser(...)` — by the time
// anything commits, the whole callback has already finished. That makes the
// *runtime-observable* contract "the cache must already be empty by the
// commit that first exposes the new identity" (Tests 1 & 2 check this in a
// `useEffect` that fires right after that commit — the earliest point a
// consumer can legitimately act on it — and fail hard against the pre-fix
// `login`, which never cleared at all, because the stale data is still
// sitting in the cache). The *textual* ordering — clear() must be the first
// statement, not merely present somewhere in the function — is what protects
// against a future regression that would make the ordering observable too
// (e.g. an `await` introduced between the two calls), so it is checked
// directly against the source (Test 3).

import { useEffect, useRef } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './AuthContext';

// Real cache key + real sample values from the audit evidence
// (get_entity_metrics_rollup('country', ['ug'])).
const PROBE_KEY = ['entityMetrics', 'country', 'ug'];
const ADMIN_CACHED_DATA = { aum: 2450226487, totalBranches: 321, totalSubscribers: 5064 };
const DISTRIBUTOR_CACHED_DATA = { aum: 170104155, totalBranches: 27, totalSubscribers: 399 };
const DISTRIBUTOR_USER = { role: 'distributor', phone: '+256700000022', distributorId: 'd-002' };

function makeWrapper(queryClient) {
  return function Wrapper({ children }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
}

beforeEach(() => {
  // AuthProvider seeds initial state from localStorage (`upensions_auth`);
  // without this, a `login()` call in one test would leak a signed-in
  // session into the next test's initial render.
  localStorage.clear();
});

describe('AuthContext — A22-001 cache-bleed ordering', () => {
  it('login: the cache is already empty on the very render that first exposes the new user — not merely "eventually"', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(PROBE_KEY, ADMIN_CACHED_DATA);
    expect(queryClient.getQueryData(PROBE_KEY)).toEqual(ADMIN_CACHED_DATA); // seed landed

    const snapshotsAtNewUser = [];
    // Named `use*` so this satisfies react-hooks/rules-of-hooks like any
    // other custom hook (mirrors the repo's `renderHook(() => useXxx())`
    // convention) — see useEntity.test.js. The capture runs in a `useEffect`
    // (refs/side effects may not be touched during render — react-hooks/refs
    // — same rule AuthContext.jsx itself carries a documented exception for)
    // keyed on `auth.user`, so it fires immediately after the commit that
    // first shows the new identity — the earliest a real consumer could ever
    // observe it.
    function useProbe() {
      const auth = useAuth();
      useEffect(() => {
        if (auth.user?.role === 'distributor') {
          snapshotsAtNewUser.push(queryClient.getQueryData(PROBE_KEY));
        }
      }, [auth.user]);
      return auth;
    }

    const { result } = renderHook(() => useProbe(), { wrapper: makeWrapper(queryClient) });
    expect(result.current.user).toBeNull(); // starts signed out

    await act(async () => {
      await result.current.login({ token: 'jwt-distributor', user: DISTRIBUTOR_USER });
    });

    expect(result.current.user?.role).toBe('distributor');
    expect(snapshotsAtNewUser.length).toBeGreaterThan(0);
    // The A22-001 bug, reproduced: every capture taken at the role-B render
    // would still hold ADMIN_CACHED_DATA because `login` never cleared it.
    for (const snapshot of snapshotsAtNewUser) {
      expect(snapshot).toBeUndefined();
    }
    expect(queryClient.getQueryData(PROBE_KEY)).toBeUndefined();
  });

  it('logout: the cache is already empty on the very render that first shows the signed-out (null) state', async () => {
    const queryClient = new QueryClient();

    const snapshotsAtSignedOut = [];
    function useProbe() {
      const auth = useAuth();
      // sawSignedInRef tracks "have we seen a signed-in user yet"; both it
      // and the cache capture are only ever touched inside the effect below
      // (never during render), which is where React refs/side effects
      // belong.
      const sawSignedInRef = useRef(false);
      useEffect(() => {
        if (auth.user) {
          sawSignedInRef.current = true;
          return;
        }
        if (sawSignedInRef.current) {
          snapshotsAtSignedOut.push(queryClient.getQueryData(PROBE_KEY));
        }
      }, [auth.user]);
      return auth;
    }

    const { result } = renderHook(() => useProbe(), { wrapper: makeWrapper(queryClient) });

    await act(async () => {
      await result.current.login({ token: 'jwt-distributor', user: DISTRIBUTOR_USER });
    });
    // Simulate the distributor's own dashboard having fetched + cached its
    // own (correctly-scoped) data during the session.
    queryClient.setQueryData(PROBE_KEY, DISTRIBUTOR_CACHED_DATA);

    await act(async () => {
      result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(snapshotsAtSignedOut.length).toBeGreaterThan(0);
    for (const snapshot of snapshotsAtSignedOut) {
      expect(snapshot).toBeUndefined();
    }
    expect(queryClient.getQueryData(PROBE_KEY)).toBeUndefined();
  });

  it('source order: queryClient.clear() precedes the user-state update in both login and logout', () => {
    // React's batching (see file header) means the two statements are
    // behaviorally indistinguishable at runtime for a synchronous, no-await
    // callback — so the textual invariant itself is asserted directly
    // against the source. This is what actually caught the original bug in
    // `logout` (clear() was present, but AFTER setUser(null)) and is the
    // only thing that would catch a regression that swaps the lines back.
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, 'AuthContext.jsx'), 'utf8');

    // Blank out full-line comments before searching, so prose that happens
    // to mention `setUser(...)` (e.g. explaining the ordering fix) can't be
    // mistaken for the real statement.
    const stripLineComments = (s) =>
      s
        .split('\n')
        .map((line) => (line.trim().startsWith('//') ? '' : line))
        .join('\n');

    const loginStart = src.indexOf('const login = useCallback');
    const loginEnd = src.indexOf('const updateUser = useCallback');
    const logoutStart = src.indexOf('const logout = useCallback');
    const logoutEnd = src.indexOf('const logoutRef = useRef');
    expect(loginStart).toBeGreaterThan(-1);
    expect(loginEnd).toBeGreaterThan(loginStart);
    expect(logoutStart).toBeGreaterThan(loginEnd);
    expect(logoutEnd).toBeGreaterThan(logoutStart);

    const loginBody = stripLineComments(src.slice(loginStart, loginEnd));
    const logoutBody = stripLineComments(src.slice(logoutStart, logoutEnd));

    const cases = [
      { name: 'login', body: loginBody, setUserCall: 'setUser(nextUser)' },
      { name: 'logout', body: logoutBody, setUserCall: 'setUser(null)' },
    ];

    for (const { name, body, setUserCall } of cases) {
      const clearIdx = body.indexOf('queryClient.clear()');
      const setUserIdx = body.indexOf(setUserCall);
      expect(clearIdx, `${name}: expected a queryClient.clear() call`).toBeGreaterThan(-1);
      expect(setUserIdx, `${name}: expected a ${setUserCall} call`).toBeGreaterThan(-1);
      expect(clearIdx, `${name}: queryClient.clear() must run BEFORE ${setUserCall}`).toBeLessThan(setUserIdx);
    }

    // Task (c): a stale closure over an old `queryClient` would silently
    // reintroduce the bug, so it must be a real dependency, not omitted.
    expect(loginBody, 'login: queryClient must be in the useCallback dependency array').toMatch(
      /\},\s*\[queryClient\]\)/,
    );
    expect(logoutBody, 'logout: queryClient must be in the useCallback dependency array').toMatch(
      /\},\s*\[queryClient\]\)/,
    );
  });
});
