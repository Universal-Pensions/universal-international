// Unit tests for POST /api/auth/verify-otp.
//
// Covers the request-shape validators, the demo wildcard OTP (any 6-digit
// code is accepted), demo-persona fallback IDs, DB-error surfacing, JWT-
// claim parity per role, and the Phase-1 headers (`Cache-Control: no-store`,
// `Allow: POST`).
//
// Mocking strategy: `vi.mock` swaps `supabase-admin` for a fluent chain
// stub whose terminal `.maybeSingle()` returns a per-table FIFO of canned
// `{ data, error }` results; `signJwt` is stubbed to return a sentinel so
// we can introspect what claim shape the route minted without paying the
// cost of real signing.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase-admin mock — fluent chain with per-table FIFO results.
// ---------------------------------------------------------------------------

type CannedResult = { data: unknown; error: unknown };
const fromQueues = new Map<string, CannedResult[]>();
const fromCalls: Array<{ table: string; upsertArg?: unknown; updateArg?: unknown }> = [];

function queueFrom(table: string, result: CannedResult) {
  if (!fromQueues.has(table)) fromQueues.set(table, []);
  fromQueues.get(table)!.push(result);
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const passThrough = [
    'select', 'insert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'in', 'is', 'not', 'or', 'filter', 'match',
    'order', 'limit', 'range', 'offset',
  ];
  for (const m of passThrough) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // `upsert` / `update` each capture their argument — E18's fix (see
  // verify-otp.ts's `upsertOrTouchUser`) is precisely which of the two gets
  // called, so the tests below need to tell them apart, not just see that
  // "something" was queued for the `users` table.
  chain.upsert = vi.fn((arg: unknown) => {
    fromCalls.push({ table, upsertArg: arg });
    return chain;
  });
  chain.update = vi.fn((arg: unknown) => {
    fromCalls.push({ table, updateArg: arg });
    return chain;
  });
  // Terminal — resolves with the queued result for this table.
  chain.maybeSingle = vi.fn(() => {
    const queued = (fromQueues.get(table) || []).shift();
    return Promise.resolve(queued ?? { data: null, error: null });
  });
  chain.single = chain.maybeSingle;
  return chain;
}

vi.mock('../_lib/supabase-admin.js', () => ({
  default: {
    from: vi.fn((table: string) => {
      if (!fromCalls.find((c) => c.table === table)) {
        fromCalls.push({ table });
      }
      return makeChain(table);
    }),
  },
}));

// ---------------------------------------------------------------------------
// JWT mock — return a sentinel and capture the claims the route passed.
// ---------------------------------------------------------------------------

const signJwtMock = vi.fn(async () => 'signed-token-fake');
vi.mock('../_lib/jwt.js', () => ({
  signJwt: (...args: unknown[]) => signJwtMock(...args),
}));

// ---------------------------------------------------------------------------
// Password helper — keep the REAL bcrypt behaviour (so the happy path stays
// byte-faithful) but wrap `hashPassword` in a spy so we can assert it is NOT
// invoked on the password-less branch (preserving the short-circuit that
// avoids paying the ~80ms bcrypt cost on OTP-only logins). `importActual`
// preserves `validatePasswordShape`/`verifyPassword` unchanged.
// ---------------------------------------------------------------------------

// `vi.hoisted` so the spy exists before the hoisted `vi.mock` factory below
// runs (the factory references it during module init, not lazily).
const { hashPasswordSpy } = vi.hoisted(() => ({
  hashPasswordSpy: vi.fn<(plain: string) => Promise<string>>(),
}));
vi.mock('./_lib/password.js', async (importActual) => {
  const actual = await importActual<typeof import('./_lib/password.js')>();
  hashPasswordSpy.mockImplementation((plain: string) => actual.hashPassword(plain));
  return {
    ...actual,
    hashPassword: (plain: string) => hashPasswordSpy(plain),
  };
});

// ---------------------------------------------------------------------------
// Import the handler AFTER mocks are registered so the bindings resolve to
// the stubs above.
// ---------------------------------------------------------------------------

// eslint-disable-next-line import/first
import handler from './verify-otp';

// ---------------------------------------------------------------------------
// Req/Res stubs (same minimal shape as send-otp.test.ts).
// ---------------------------------------------------------------------------

type StubReq = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

function makeReq(overrides: StubReq = {}): StubReq {
  return { method: 'POST', headers: {}, body: {}, ...overrides };
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let payload: unknown = undefined;
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      payload = body;
      return res;
    },
    __headers: headers,
    __getStatus: () => statusCode,
    __getPayload: () => payload,
  };
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (req: StubReq, res: ReturnType<typeof makeRes>) =>
  handler(req as any, res as any);

// ---------------------------------------------------------------------------

describe('POST /api/auth/verify-otp', () => {
  let res: ReturnType<typeof makeRes>;

  beforeEach(() => {
    fromQueues.clear();
    fromCalls.length = 0;
    signJwtMock.mockClear();
    signJwtMock.mockImplementation(async () => 'signed-token-fake');
    hashPasswordSpy.mockClear();
    res = makeRes();
  });

  // -------------------------------------------------------------------------
  // Method gate
  // -------------------------------------------------------------------------

  it('returns 405 method_not_allowed + Allow: POST for GET', async () => {
    await call(makeReq({ method: 'GET' }), res);
    expect(res.__getStatus()).toBe(405);
    expect(res.__getPayload()).toEqual({ code: 'method_not_allowed' });
    expect(res.__headers['Allow']).toBe('POST');
  });

  it('sets Cache-Control: no-store on the 405 path (2a.2)', async () => {
    // The no-store header must be set BEFORE the method check so even a 405
    // carries it — a 405 from the auth family must not be cacheable.
    await call(makeReq({ method: 'GET' }), res);
    expect(res.__getStatus()).toBe(405);
    expect(res.__headers['Cache-Control']).toBe('no-store');
  });

  it('returns 405 method_not_allowed for PUT/DELETE/PATCH', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const r = makeRes();
      await call(makeReq({ method }), r);
      expect(r.__getStatus(), method).toBe(405);
      expect(r.__getPayload(), method).toEqual({ code: 'method_not_allowed' });
    }
  });

  // -------------------------------------------------------------------------
  // Request-shape failures (all surface `invalid_otp` per the route's contract)
  // -------------------------------------------------------------------------

  it('returns 400 invalid_otp when phone is missing', async () => {
    await call(
      makeReq({ body: { otp: '123456', role: 'subscriber' } }),
      res,
    );
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload()).toEqual({ code: 'invalid_otp' });
    expect(res.__headers['Cache-Control']).toBe('no-store');
  });

  it('returns 400 invalid_otp when otp is missing', async () => {
    await call(
      makeReq({ body: { phone: '+256777247884', role: 'subscriber' } }),
      res,
    );
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload()).toEqual({ code: 'invalid_otp' });
  });

  it('returns 400 invalid_otp when otp is not 6 digits', async () => {
    for (const bad of ['12345', '1234567', 'abcdef', '12345a']) {
      const r = makeRes();
      await call(
        makeReq({
          body: { phone: '+256777247884', otp: bad, role: 'subscriber' },
        }),
        r,
      );
      expect(r.__getStatus(), `otp=${bad}`).toBe(400);
      expect(r.__getPayload()).toEqual({ code: 'invalid_otp' });
    }
  });

  it('returns 400 invalid_otp when role is missing or out-of-allow-list', async () => {
    // All six app roles (incl. 'employer' and 'admin') are now valid — only
    // unknown roles are rejected.
    for (const role of [undefined, 'superadmin', 42]) {
      const r = makeRes();
      await call(
        makeReq({
          body: { phone: '+256777247884', otp: '123456', role },
        }),
        r,
      );
      expect(r.__getStatus(), `role=${String(role)}`).toBe(400);
      expect(r.__getPayload()).toEqual({ code: 'invalid_otp' });
    }
  });

  it('surfaces password shape errors before role lookup', async () => {
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
          password: 'short',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload()).toEqual({ code: 'password_too_short' });
  });

  // -------------------------------------------------------------------------
  // Demo wildcard OTP — any 6-digit code is accepted (CLAUDE.md §10a).
  // -------------------------------------------------------------------------

  it('accepts ANY 6-digit OTP — wildcard demo behaviour', async () => {
    // Seed: subscriber lookup returns a row, users upsert returns no hash.
    queueFrom('subscribers', {
      data: { id: 's-0007', name: 'Test Subscriber' },
      error: null,
    });
    queueFrom('users', { data: { password_hash: null }, error: null });
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          // 000000 is not a "magic" value — the route accepts any digits.
          otp: '000000',
          role: 'subscriber',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    const payload = res.__getPayload() as { token: string; user: unknown };
    expect(payload.token).toBe('signed-token-fake');
    expect(payload.user).toMatchObject({
      role: 'subscriber',
      phone: '+256777247884',
      subscriberId: 's-0007',
      name: 'Test Subscriber',
      hasPassword: false,
    });
  });

  // -------------------------------------------------------------------------
  // Success path — subscriber with a known phone resolves to its row.
  // -------------------------------------------------------------------------

  it('returns 200 + signed JWT for a subscriber whose phone matches a row', async () => {
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian Okello' },
      error: null,
    });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
        },
      }),
      res,
    );

    expect(res.__getStatus()).toBe(200);
    const payload = res.__getPayload() as {
      token: string;
      user: Record<string, unknown>;
    };
    expect(payload.token).toBe('signed-token-fake');
    expect(payload.user).toMatchObject({
      role: 'subscriber',
      phone: '+256777247884',
      subscriberId: 's-0001',
      name: 'Brian Okello',
      hasPassword: false,
    });
    // No agentId/branchId/distributorId on a subscriber payload.
    expect(payload.user.agentId).toBeUndefined();
    expect(payload.user.branchId).toBeUndefined();
    expect(payload.user.distributorId).toBeUndefined();

    // signJwt received the right claim shape.
    expect(signJwtMock).toHaveBeenCalledTimes(1);
    expect(signJwtMock.mock.calls[0][0]).toMatchObject({
      sub: 's-0001',
      role: 'authenticated',
      app_role: 'subscriber',
      phone: '+256777247884',
      subscriberId: 's-0001',
    });
  });

  it('returns hasPassword: true when the upsert leaves a non-null hash', async () => {
    // No password supplied in this request, but a previous run had set one
    // — the users.password_hash returned by maybeSingle reflects that.
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian' },
      error: null,
    });
    queueFrom('users', {
      data: { password_hash: 'bcrypted' },
      error: null,
    });
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect((res.__getPayload() as { user: { hasPassword: boolean } }).user.hasPassword).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Concurrent persona-lookup + password-hash, preserving the bcrypt short-
  // circuit. The lookup and hash run inside a single Promise.all, but the
  // hash arm is only entered when a password was actually supplied — an
  // OTP-only login must never start bcrypt.
  // -------------------------------------------------------------------------

  it('does NOT invoke hashPassword when no password is supplied (short-circuit preserved)', async () => {
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian' },
      error: null,
    });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
          // No `password` key at all — the OTP-only happy path.
        },
      }),
      res,
    );

    expect(res.__getStatus()).toBe(200);
    // The whole point of the short-circuit: bcrypt is never started.
    expect(hashPasswordSpy).not.toHaveBeenCalled();
    expect(
      (res.__getPayload() as { user: { hasPassword: boolean } }).user.hasPassword,
    ).toBe(false);
  });

  it('does NOT invoke hashPassword when password is an empty string (treated as not provided)', async () => {
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian' },
      error: null,
    });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
          password: '',
        },
      }),
      res,
    );

    expect(res.__getStatus()).toBe(200);
    expect(hashPasswordSpy).not.toHaveBeenCalled();
  });

  it('invokes hashPassword once and stamps the hash when a valid password is supplied', async () => {
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian' },
      error: null,
    });
    // The upsert reads back the freshly-stamped hash, so hasPassword: true.
    queueFrom('users', { data: { password_hash: 'bcrypted' }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );

    expect(res.__getStatus()).toBe(200);
    // Hash arm was entered exactly once, with the supplied plaintext.
    expect(hashPasswordSpy).toHaveBeenCalledTimes(1);
    expect(hashPasswordSpy).toHaveBeenCalledWith('Demo1234');

    // The upsert patch carried a real bcrypt hash (not the plaintext) —
    // proves the parallel hash result flowed through to the write unchanged.
    const usersUpsert = fromCalls.find(
      (c) => c.table === 'users' && c.upsertArg,
    );
    const patch = usersUpsert?.upsertArg as { password_hash?: string };
    expect(typeof patch.password_hash).toBe('string');
    expect(patch.password_hash).not.toBe('Demo1234');
    expect(patch.password_hash?.startsWith('$2')).toBe(true);

    expect(
      (res.__getPayload() as { user: { hasPassword: boolean } }).user.hasPassword,
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // E18 / A06-013 (recurring) — verify-otp must stop planting a fresh
  // entity_id-less, password_hash-less `users` row on every OTP sign-in.
  // `0121` pruned the 32 that had accumulated; without this fix the same
  // unconditional upsert keeps refilling the table (re-measured live
  // 2026-08-25: back down to 2, both created earlier TODAY by ordinary demo
  // OTP logins during this remediation session).
  // -------------------------------------------------------------------------

  describe('users table write — E18 / A06-013 (upsertOrTouchUser)', () => {
    it('does not upsert (never INSERTs a fresh row) on a password-less OTP login for a phone/role never seen before', async () => {
      queueFrom('subscribers', { data: null, error: null }); // unseeded phone → fallback id
      queueFrom('users', { data: null, error: null }); // no existing users row either

      await call(
        makeReq({
          body: { phone: '+256799999999', otp: '123456', role: 'subscriber' },
        }),
        res,
      );

      expect(res.__getStatus()).toBe(200);
      // The whole point of the fix: no upsert call at all when nothing is
      // being persisted, so no row can be created.
      expect(fromCalls.find((c) => c.table === 'users' && c.upsertArg)).toBeUndefined();
      // It still touches last_login_at via UPDATE — which is a no-op (not an
      // error) when zero rows match, exactly as it should be here.
      const usersUpdate = fromCalls.find((c) => c.table === 'users' && c.updateArg);
      expect(usersUpdate).toBeTruthy();
      expect((usersUpdate!.updateArg as { last_login_at?: string }).last_login_at).toEqual(
        expect.any(String),
      );
      expect(
        (res.__getPayload() as { user: { hasPassword: boolean } }).user.hasPassword,
      ).toBe(false);
    });

    it('updates last_login_at (not upsert) on a password-less login for a phone/role that already has a row', async () => {
      // A seeded demo account (or one that previously set a password) — the
      // row already exists, so this must still get touched on every login.
      queueFrom('demo_personas', {
        data: { entity_id: 'a-042', label: 'Alice' },
        error: null,
      });
      queueFrom('users', { data: { password_hash: 'existing-hash' }, error: null });

      await call(
        makeReq({
          body: { phone: '+256777247884', otp: '123456', role: 'agent' },
        }),
        res,
      );

      expect(res.__getStatus()).toBe(200);
      expect(fromCalls.find((c) => c.table === 'users' && c.upsertArg)).toBeUndefined();
      const usersUpdate = fromCalls.find((c) => c.table === 'users' && c.updateArg);
      expect(usersUpdate).toBeTruthy();
      // The existing hash is read back unchanged — password-login is unaffected.
      expect(
        (res.__getPayload() as { user: { hasPassword: boolean } }).user.hasPassword,
      ).toBe(true);
    });

    it('still upserts (can still INSERT) when a password IS supplied for a brand-new phone/role — signup-completion must keep working', async () => {
      // No pre-existing users row (data: null) — the exact shape of a
      // subscriber's very first OTP verification right after self-signup
      // (ContributionRoute.jsx passes the chosen password on that call).
      queueFrom('subscribers', { data: { id: 's-9999', name: 'New Signup' }, error: null });
      queueFrom('users', { data: { password_hash: 'bcrypted' }, error: null });

      await call(
        makeReq({
          body: {
            phone: '+256799999999',
            otp: '123456',
            role: 'subscriber',
            password: 'Demo1234',
          },
        }),
        res,
      );

      expect(res.__getStatus()).toBe(200);
      const usersUpsert = fromCalls.find((c) => c.table === 'users' && c.upsertArg);
      expect(usersUpsert).toBeTruthy();
      expect(
        (res.__getPayload() as { user: { hasPassword: boolean } }).user.hasPassword,
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Subscriber demo persona fallback (no row → s-0001).
  // -------------------------------------------------------------------------

  it('falls back to ROLE_DEFAULTS.subscriber (s-0001) when no subscriber row matches', async () => {
    queueFrom('subscribers', { data: null, error: null });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256711000099',
          otp: '123456',
          role: 'subscriber',
        },
      }),
      res,
    );

    expect(res.__getStatus()).toBe(200);
    const payload = res.__getPayload() as {
      user: { subscriberId: string; name?: string };
    };
    expect(payload.user.subscriberId).toBe('s-0001');
    // Fallback returns no `name` from personas.ts.
    expect(payload.user.name).toBeUndefined();
    expect(signJwtMock.mock.calls[0][0]).toMatchObject({
      sub: 's-0001',
      app_role: 'subscriber',
      subscriberId: 's-0001',
    });
  });

  // -------------------------------------------------------------------------
  // Non-subscriber roles — demo_personas hit and fallback.
  // -------------------------------------------------------------------------

  it.each([
    ['agent', 'a-001', 'agentId'],
    ['branch', 'b-kam-015', 'branchId'],
    ['distributor', 'd-001', 'distributorId'],
    // Employer falls back to emp-001 (Phase 0) just like the other
    // non-subscriber roles when demo_personas misses.
    ['employer', 'emp-001', 'employerId'],
    // Admin falls back to admin-001 (0049) — the fallback + the `adminId` claim
    // were never asserted before (audit §7b.4); pin both here.
    ['admin', 'admin-001', 'adminId'],
  ] as const)(
    'returns the role-scoped %s claim with fallback id %s when demo_personas misses',
    async (role, fallbackId, claimKey) => {
      queueFrom('demo_personas', { data: null, error: null });
      queueFrom('users', { data: { password_hash: null }, error: null });

      await call(
        makeReq({
          body: { phone: '+256711000099', otp: '123456', role },
        }),
        res,
      );
      expect(res.__getStatus()).toBe(200);
      const payload = res.__getPayload() as {
        user: Record<string, unknown>;
      };
      expect(payload.user.role).toBe(role);
      expect(payload.user[claimKey]).toBe(fallbackId);

      expect(signJwtMock.mock.calls[0][0]).toMatchObject({
        sub: fallbackId,
        app_role: role,
        [claimKey]: fallbackId,
      });
    },
  );

  it('uses the demo_personas row when one matches (agent path)', async () => {
    queueFrom('demo_personas', {
      data: { entity_id: 'a-042', label: 'Alice Field-Agent' },
      error: null,
    });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'agent',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    const payload = res.__getPayload() as {
      user: Record<string, unknown>;
    };
    expect(payload.user.agentId).toBe('a-042');
    expect(payload.user.name).toBe('Alice Field-Agent');
  });

  // -------------------------------------------------------------------------
  // Deactivation gate (H1) — a deactivated agent / branch / distributor /
  // employer cannot authenticate. Subscriber + admin are never gated. The gate
  // adds a `.from(<entityTable>).select('status').eq('id',…).maybeSingle()`
  // call after identity resolution; we queue its result per entity table.
  // -------------------------------------------------------------------------

  it.each([
    ['agent', 'a-001', 'agents'],
    ['branch', 'b-kam-015', 'branches'],
    ['distributor', 'd-001', 'distributors'],
    ['employer', 'emp-001', 'employers'],
  ] as const)(
    'returns 403 account_deactivated for an inactive %s',
    async (role, fallbackId, entityTable) => {
      // demo_personas miss → fallback id; the entity status row is inactive.
      queueFrom('demo_personas', { data: null, error: null });
      queueFrom(entityTable, { data: { status: 'inactive' }, error: null });

      await call(
        makeReq({
          body: { phone: '+256700000001', otp: '123456', role },
        }),
        res,
      );
      expect(res.__getStatus(), `${role}/${fallbackId}`).toBe(403);
      expect(res.__getPayload()).toEqual({
        code: 'account_deactivated',
        message:
          'This account has been deactivated. Please contact support to reactivate it.',
      });
      // Gate fires before the users upsert — no JWT minted for a blocked login.
      expect(signJwtMock).not.toHaveBeenCalled();
    },
  );

  it('proceeds to 200 when the entity status is active', async () => {
    queueFrom('demo_personas', {
      data: { entity_id: 'a-042', label: 'Active Agent' },
      error: null,
    });
    queueFrom('agents', { data: { status: 'active' }, error: null });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: { phone: '+256777247884', otp: '123456', role: 'agent' },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect((res.__getPayload() as { user: { agentId: string } }).user.agentId).toBe('a-042');
  });

  it('never gates a subscriber (no entity status lookup blocks it)', async () => {
    // No `subscribers`-table status row is queued; the gate must not block.
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian' },
      error: null,
    });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: { phone: '+256777247884', otp: '123456', role: 'subscriber' },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect((res.__getPayload() as { user: { subscriberId: string } }).user.subscriberId).toBe('s-0001');
  });

  it('never gates an admin (admin has no status concept)', async () => {
    queueFrom('demo_personas', { data: null, error: null });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: { phone: '+256700000001', otp: '123456', role: 'admin' },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect((res.__getPayload() as { user: { adminId: string } }).user.adminId).toBe('admin-001');
  });

  it('treats a status-lookup error as non-fatal (login proceeds, 200)', async () => {
    queueFrom('demo_personas', { data: null, error: null });
    // A real Supabase error on the status read must NOT block the demo login.
    queueFrom('distributors', {
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: { phone: '+256700000001', otp: '123456', role: 'distributor' },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect((res.__getPayload() as { user: { distributorId: string } }).user.distributorId).toBe('d-001');
  });

  it('treats a missing entity row (maybeSingle null) as non-fatal (200)', async () => {
    queueFrom('demo_personas', { data: null, error: null });
    // No row for the fallback id — must not block (data: null, error: null).
    queueFrom('agents', { data: null, error: null });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: { phone: '+256700000001', otp: '123456', role: 'agent' },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect((res.__getPayload() as { user: { agentId: string } }).user.agentId).toBe('a-001');
  });

  // -------------------------------------------------------------------------
  // DB error on the users upsert → 500 db_error (opaque; no leaked DB detail).
  // -------------------------------------------------------------------------

  it('returns 500 db_error when the users upsert returns a non-PGRST116 error', async () => {
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian' },
      error: null,
    });
    queueFrom('users', {
      data: null,
      error: { code: '23505', message: 'duplicate key violation' },
    });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
        },
      }),
      res,
    );

    expect(res.__getStatus()).toBe(500);
    // §11-M1: opaque payload — the raw supabase code/message must NOT leak.
    expect(res.__getPayload()).toEqual({ code: 'db_error' });
  });

  it('treats PGRST116 on upsert as non-fatal (200, hasPassword reflects request)', async () => {
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian' },
      error: null,
    });
    queueFrom('users', {
      data: null,
      error: { code: 'PGRST116', message: 'no row' },
    });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect(
      (res.__getPayload() as { user: { hasPassword: boolean } }).user.hasPassword,
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Phone normalisation — different request forms produce the same canonical
  // phone in the JWT.
  // -------------------------------------------------------------------------

  it('normalises 9-digit local phone to +256… in the JWT', async () => {
    queueFrom('subscribers', { data: null, error: null });
    queueFrom('users', { data: { password_hash: null }, error: null });

    await call(
      makeReq({
        body: { phone: '777247884', otp: '123456', role: 'subscriber' },
      }),
      res,
    );

    expect(res.__getStatus()).toBe(200);
    expect(signJwtMock.mock.calls[0][0]).toMatchObject({
      phone: '+256777247884',
    });
  });

  // -------------------------------------------------------------------------
  // Generic catch — signJwt blowing up surfaces as 500 unexpected_error
  // (distinct from the 4xx invalid_otp vocabulary; BL-39).
  // -------------------------------------------------------------------------

  it('returns 500 unexpected_error on unexpected error (e.g. signJwt failure)', async () => {
    queueFrom('subscribers', {
      data: { id: 's-0001', name: 'Brian' },
      error: null,
    });
    queueFrom('users', { data: { password_hash: null }, error: null });
    signJwtMock.mockRejectedValueOnce(new Error('boom'));

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          otp: '123456',
          role: 'subscriber',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(500);
    expect(res.__getPayload()).toEqual({ code: 'unexpected_error' });
  });
});
