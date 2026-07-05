// supabaseClient service tests — exercise token helpers + env fallback.
//
// `services/supabaseClient.js` is mostly a thin wrapper around `createClient`
// from `@supabase/supabase-js` plus three localStorage helpers
// (`getToken`/`setToken`/`clearToken`) and a third-party-JWT `accessToken`
// callback. The interesting surface to test:
//
//   1. Token helpers round-trip strings through localStorage.
//   2. Token helpers tolerate localStorage throwing (private-browsing).
//   3. setToken(null/empty) deletes the key.
//   4. The module constructs `createClient` with the env URL + anon key when
//      they are set, and falls back to harmless `http://localhost:54321` +
//      `'public-anon-key'` when they are unset (current behaviour — Phase 7
//      will tighten this to fail-loud).
//   5. The `accessToken` callback re-reads localStorage on each call (which
//      is how supabase-js gets a fresh JWT on every request).
//
// Mocking strategy:
//   - `@supabase/supabase-js`'s `createClient` is spied via `vi.mock` so we
//     can capture the URL/anon and the options.accessToken callback.
//   - `vi.stubEnv` injects VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for the
//     env-validation tests; we `vi.resetModules` + dynamically re-import so
//     the module-top reads pick up the stubbed values.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const TOKEN_KEY = 'upensions_token';

// Mock createClient at the module path the source uses. The factory returns a
// vi.fn that captures (url, anon, opts) — tests inspect the call args.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((url, anon, opts) => ({
    __ctor: { url, anon, opts },
    from: vi.fn(),
    rpc: vi.fn(),
  })),
}));

beforeEach(async () => {
  window.localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('supabaseClient service', () => {
  describe('token helpers — happy path', () => {
    it('getToken returns null when no token is stored', async () => {
      const { getToken } = await import('../supabaseClient');
      expect(getToken()).toBeNull();
    });

    it('setToken writes to localStorage and getToken reads it back', async () => {
      const { getToken, setToken } = await import('../supabaseClient');
      setToken('jwt.payload.sig');
      expect(window.localStorage.getItem(TOKEN_KEY)).toBe('jwt.payload.sig');
      expect(getToken()).toBe('jwt.payload.sig');
    });

    it('setToken(null) clears the stored token', async () => {
      const { setToken } = await import('../supabaseClient');
      window.localStorage.setItem(TOKEN_KEY, 'jwt');
      setToken(null);
      expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('setToken("") clears the stored token', async () => {
      const { setToken } = await import('../supabaseClient');
      window.localStorage.setItem(TOKEN_KEY, 'jwt');
      setToken('');
      expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    });

    it('clearToken removes the stored token', async () => {
      const { setToken, clearToken, getToken } = await import('../supabaseClient');
      setToken('jwt');
      clearToken();
      expect(getToken()).toBeNull();
    });
  });

  describe('token helpers — localStorage failures', () => {
    it('getToken returns null when localStorage.getItem throws', async () => {
      const { getToken } = await import('../supabaseClient');
      const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(getToken()).toBeNull();
      spy.mockRestore();
    });

    it('setToken does not throw when localStorage.setItem throws', async () => {
      const { setToken } = await import('../supabaseClient');
      const spy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('quota');
      });
      expect(() => setToken('jwt')).not.toThrow();
      spy.mockRestore();
    });

    it('clearToken does not throw when removeItem throws', async () => {
      const { clearToken } = await import('../supabaseClient');
      const spy = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
        throw new Error('denied');
      });
      expect(() => clearToken()).not.toThrow();
      spy.mockRestore();
    });
  });

  describe('createClient construction — env validation (current behaviour)', () => {
    it('uses VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY when both are set', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co');
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-xxx');
      vi.resetModules();
      const { supabase } = await import('../supabaseClient');
      expect(supabase.__ctor.url).toBe('https://proj.supabase.co');
      expect(supabase.__ctor.anon).toBe('anon-xxx');
    });

    it('falls back to http://localhost:54321 + "public-anon-key" when env is unset', async () => {
      // Documented "current behaviour" per the source comment. Phase 7 plans to
      // tighten this to throw — when that lands, this test should flip to
      // assert the throw, NOT delete this case silently.
      vi.stubEnv('VITE_SUPABASE_URL', '');
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
      vi.resetModules();
      const { supabase } = await import('../supabaseClient');
      expect(supabase.__ctor.url).toBe('http://localhost:54321');
      expect(supabase.__ctor.anon).toBe('public-anon-key');
    });

    it('falls back when only URL is missing', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', '');
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-only');
      vi.resetModules();
      const { supabase } = await import('../supabaseClient');
      expect(supabase.__ctor.url).toBe('http://localhost:54321');
      expect(supabase.__ctor.anon).toBe('anon-only');
    });

    it('falls back when only anon key is missing', async () => {
      vi.stubEnv('VITE_SUPABASE_URL', 'https://x.supabase.co');
      vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
      vi.resetModules();
      const { supabase } = await import('../supabaseClient');
      expect(supabase.__ctor.url).toBe('https://x.supabase.co');
      expect(supabase.__ctor.anon).toBe('public-anon-key');
    });
  });

  describe('accessToken callback', () => {
    it('reads the freshest token from localStorage on each call', async () => {
      const { setToken, supabase } = await import('../supabaseClient');
      const accessToken = supabase.__ctor.opts.accessToken;
      expect(typeof accessToken).toBe('function');

      // Empty → null fallback (supabase-js uses anon key in this case).
      expect(await accessToken()).toBeNull();

      // After setToken, the callback should pick up the new value.
      setToken('first-jwt');
      expect(await accessToken()).toBe('first-jwt');

      // Rotate — callback re-reads, not the cached value.
      setToken('second-jwt');
      expect(await accessToken()).toBe('second-jwt');
    });

    it('returns null when localStorage throws (private-browsing parity)', async () => {
      const { supabase } = await import('../supabaseClient');
      const accessToken = supabase.__ctor.opts.accessToken;
      const spy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(await accessToken()).toBeNull();
      spy.mockRestore();
    });
  });

  describe('isJwtExpired — suppress provably-dead tokens', () => {
    // Minimal JWT with a chosen `exp`; only the payload segment is decoded.
    const makeJwt = (exp) => {
      const b64u = (obj) => btoa(JSON.stringify(obj))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `eyJhbGciOiJIUzI1NiJ9.${b64u({ app_role: 'agent', exp })}.sig`;
    };
    const NOW = Math.floor(Date.now() / 1000);

    it('flags a token whose exp is in the past', async () => {
      const { isJwtExpired } = await import('../supabaseClient');
      expect(isJwtExpired(makeJwt(NOW - 60))).toBe(true);
    });

    it('does not flag a token whose exp is in the future', async () => {
      const { isJwtExpired } = await import('../supabaseClient');
      expect(isJwtExpired(makeJwt(NOW + 3600))).toBe(false);
    });

    it('fails OPEN for opaque / unparseable / exp-less tokens', async () => {
      const { isJwtExpired } = await import('../supabaseClient');
      expect(isJwtExpired('first-jwt')).toBe(false);      // no segments
      expect(isJwtExpired('a.b.c')).toBe(false);          // undecodable payload
      const b64u = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '');
      expect(isJwtExpired(`x.${b64u({ app_role: 'agent' })}.y`)).toBe(false); // no exp claim
    });

    it('the accessToken hook returns null for an expired token but keeps a live one', async () => {
      const { setToken, supabase } = await import('../supabaseClient');
      const accessToken = supabase.__ctor.opts.accessToken;
      setToken(makeJwt(NOW - 60));
      expect(await accessToken()).toBeNull();
      const live = makeJwt(NOW + 3600);
      setToken(live);
      expect(await accessToken()).toBe(live);
    });
  });

  describe('default export', () => {
    it('default export is the same client as the named `supabase` export', async () => {
      const mod = await import('../supabaseClient');
      expect(mod.default).toBe(mod.supabase);
    });
  });
});
