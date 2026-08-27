// Unit tests for POST /api/auth/verify-password.
//
// Covers the password sign-in companion to verify-otp: bcrypt compare,
// `password_not_set` (no row OR null hash), `role_mismatch` defense-in-depth,
// `invalid_password` on bcrypt mismatch, `db_error` surfacing, JWT-claim
// parity per role, and the Phase-1 headers (`Cache-Control: no-store`,
// `Allow: POST`).
//
// Real bcrypt is used (via the production password helper) — the bcrypt
// round-trip is already covered in `_lib/password.test.ts`, but the few
// hashes generated here are quick (cost=10, one per success-path test).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hashPassword } from './_lib/password.js';

// ---------------------------------------------------------------------------
// Supabase-admin mock — fluent chain with per-table FIFO results.
// ---------------------------------------------------------------------------

type CannedResult = { data: unknown; error: unknown };
const fromQueues = new Map<string, CannedResult[]>();
// Records every `supabaseAdmin.from(table)` the handler makes, so a guard that
// is supposed to short-circuit BEFORE the DB can be proven to do so rather than
// inferred from the status code. Mirrors verify-otp.test.ts's recorder.
const fromCalls: string[] = [];

function queueFrom(table: string, result: CannedResult) {
  if (!fromQueues.has(table)) fromQueues.set(table, []);
  fromQueues.get(table)!.push(result);
}

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  const passThrough = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'in', 'is', 'not', 'or', 'filter', 'match',
    'order', 'limit', 'range', 'offset',
  ];
  for (const m of passThrough) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn(() => {
    const queued = (fromQueues.get(table) || []).shift();
    return Promise.resolve(queued ?? { data: null, error: null });
  });
  chain.single = chain.maybeSingle;
  // `update` on `users` (touchLastLogin) is fire-and-forget — its chain is
  // awaited directly, so we wire a thenable that resolves to {error: null}.
  // The `.eq().eq()` pair returns a chain whose await resolves to the
  // queued result (or the default no-op).
  (chain as Record<string, unknown>).then = (
    onFulfilled: (v: unknown) => unknown,
    onRejected: (e: unknown) => unknown,
  ) => {
    const queued = (fromQueues.get(`${table}:update`) || []).shift();
    return Promise.resolve(queued ?? { data: null, error: null }).then(
      onFulfilled,
      onRejected,
    );
  };
  return chain;
}

vi.mock('../_lib/supabase-admin.js', () => ({
  default: {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      return makeChain(table);
    }),
  },
}));

// ---------------------------------------------------------------------------
// JWT mock — sentinel + claims capture.
// ---------------------------------------------------------------------------

const signJwtMock = vi.fn(async () => 'signed-token-fake');
vi.mock('../_lib/jwt.js', () => ({
  signJwt: (...args: unknown[]) => signJwtMock(...args),
}));

// eslint-disable-next-line import/first
import handler from './verify-password';

// ---------------------------------------------------------------------------
// Req/Res stubs.
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

describe('POST /api/auth/verify-password', () => {
  let res: ReturnType<typeof makeRes>;
  // A single hash, reused across tests — bcrypt is the slow part.
  let validHash: string;

  beforeEach(() => {
    fromQueues.clear();
    fromCalls.length = 0;
    signJwtMock.mockClear();
    signJwtMock.mockImplementation(async () => 'signed-token-fake');
    res = makeRes();
  });

  // Hash lazily on first use and memoise — bcrypt at cost=10 is ~80ms per
  // call, so we pay the round-trip exactly once for the whole suite.
  async function ensureHash() {
    if (!validHash) validHash = await hashPassword('Demo1234');
    return validHash;
  }

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
    // no-store is set BEFORE the method check, so even a 405 carries it.
    await call(makeReq({ method: 'GET' }), res);
    expect(res.__getStatus()).toBe(405);
    expect(res.__headers['Cache-Control']).toBe('no-store');
  });

  it('returns 405 method_not_allowed for PUT/DELETE', async () => {
    for (const method of ['PUT', 'DELETE']) {
      const r = makeRes();
      await call(makeReq({ method }), r);
      expect(r.__getStatus(), method).toBe(405);
      expect(r.__getPayload(), method).toEqual({ code: 'method_not_allowed' });
    }
  });

  // -------------------------------------------------------------------------
  // Request-shape failures — surfaced as `invalid_request`.
  // -------------------------------------------------------------------------

  it('returns 400 invalid_request when phone is missing', async () => {
    await call(
      makeReq({ body: { role: 'subscriber', password: 'Demo1234' } }),
      res,
    );
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload()).toEqual({ code: 'invalid_request' });
    expect(res.__headers['Cache-Control']).toBe('no-store');
  });

  it('returns 400 invalid_request when role is missing or invalid', async () => {
    // 'admin' is now a valid role (all six ship); 'superadmin' stands in as the unknown role.
    for (const role of [undefined, 'superadmin', 42, '']) {
      const r = makeRes();
      await call(
        makeReq({
          body: { phone: '+256777247884', password: 'Demo1234', role },
        }),
        r,
      );
      expect(r.__getStatus(), `role=${String(role)}`).toBe(400);
      expect(r.__getPayload()).toEqual({ code: 'invalid_request' });
    }
  });

  it('returns 400 invalid_request when password is missing or empty', async () => {
    for (const password of [undefined, '', 42]) {
      const r = makeRes();
      await call(
        makeReq({
          body: { phone: '+256777247884', role: 'subscriber', password },
        }),
        r,
      );
      expect(r.__getStatus(), `password=${String(password)}`).toBe(400);
      expect(r.__getPayload()).toEqual({ code: 'invalid_request' });
    }
  });

  // Review 2026-08-26 §1.3 — same unbounded-phone hole as verify-otp: line ~94
  // falls back to the raw input (`toCanonicalUGPhone(phone) || phone`) and the
  // result reaches the JWT `phone` claim on the success path.
  it('returns 400 invalid_request when phone exceeds MAX_PHONE_INPUT_LEN, without touching the DB', async () => {
    await call(
      makeReq({
        body: { phone: '9'.repeat(100_000), role: 'subscriber', password: 'Demo1234' },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload()).toEqual({ code: 'invalid_request' });
    expect(res.__headers['Cache-Control']).toBe('no-store');
    // The cap must sit ahead of the `users` lookup and the bcrypt compare.
    expect(fromCalls).toEqual([]);
    expect(signJwtMock).not.toHaveBeenCalled();
  });

  it('rejects one char over the cap and lets one char under it reach the DB lookup', async () => {
    const over = makeRes();
    await call(
      makeReq({ body: { phone: '+'.padEnd(21, '2'), role: 'subscriber', password: 'Demo1234' } }),
      over,
    );
    expect(over.__getStatus()).toBe(400);
    expect(over.__getPayload()).toEqual({ code: 'invalid_request' });
    expect(fromCalls).toEqual([]);

    // 20 chars clears the LENGTH guard. No `users` row is queued for it, so the
    // route answers `password_not_set` — the point is that it got far enough to
    // ASK, i.e. the cap did not swallow a legitimate-length input.
    const under = makeRes();
    await call(
      makeReq({ body: { phone: '+'.padEnd(20, '2'), role: 'subscriber', password: 'Demo1234' } }),
      under,
    );
    expect(under.__getStatus()).toBe(401);
    expect(under.__getPayload()).toEqual({ code: 'password_not_set' });
    expect(fromCalls).toContain('users');
  });

  // -------------------------------------------------------------------------
  // password_not_set — no row OR row with NULL hash.
  // -------------------------------------------------------------------------

  it('returns 401 password_not_set when no users row matches', async () => {
    queueFrom('users', { data: null, error: null });
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(401);
    expect(res.__getPayload()).toEqual({ code: 'password_not_set' });
  });

  it('returns 401 password_not_set when the row has password_hash: null (distinct from invalid_password)', async () => {
    queueFrom('users', {
      data: { password_hash: null, role: 'subscriber' },
      error: null,
    });
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(401);
    expect(res.__getPayload()).toEqual({ code: 'password_not_set' });
  });

  // -------------------------------------------------------------------------
  // role_mismatch — defense-in-depth.
  // -------------------------------------------------------------------------

  it('returns 401 role_mismatch when the stored row.role differs from the request role', async () => {
    const hash = await ensureHash();
    queueFrom('users', {
      data: { password_hash: hash, role: 'agent' },
      error: null,
    });
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(401);
    expect(res.__getPayload()).toEqual({ code: 'role_mismatch' });
  });

  // -------------------------------------------------------------------------
  // invalid_password — row exists with hash, bcrypt compare fails.
  // -------------------------------------------------------------------------

  it('returns 401 invalid_password when the password does not match the stored hash', async () => {
    const hash = await ensureHash();
    queueFrom('users', {
      data: { password_hash: hash, role: 'subscriber' },
      error: null,
    });
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'subscriber',
          password: 'wrong-password-1',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(401);
    expect(res.__getPayload()).toEqual({ code: 'invalid_password' });
  });

  // -------------------------------------------------------------------------
  // db_error — non-PGRST116 supabase error on the user lookup.
  // -------------------------------------------------------------------------

  it('returns 500 db_error when the users lookup returns a non-PGRST116 error', async () => {
    queueFrom('users', {
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(500);
    // §11-M1: opaque payload — the raw supabase code/message must NOT leak.
    expect(res.__getPayload()).toEqual({ code: 'db_error' });
  });

  // -------------------------------------------------------------------------
  // Generic catch — signJwt blowing up surfaces as 500 unexpected_error
  // (distinct from the 4xx invalid_request vocabulary; BL-39).
  // -------------------------------------------------------------------------

  it('returns 500 unexpected_error on unexpected error (e.g. signJwt failure)', async () => {
    const hash = await ensureHash();
    queueFrom('users', {
      data: { password_hash: hash, role: 'subscriber' },
      error: null,
    });
    queueFrom('subscribers', { data: null, error: null });
    signJwtMock.mockRejectedValueOnce(new Error('boom'));

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(500);
    expect(res.__getPayload()).toEqual({ code: 'unexpected_error' });
  });

  // -------------------------------------------------------------------------
  // Success — JWT claim shape per role.
  // -------------------------------------------------------------------------

  it('returns 200 + signed JWT for a subscriber with a matching row', async () => {
    const hash = await ensureHash();
    queueFrom('users', {
      data: { password_hash: hash, role: 'subscriber' },
      error: null,
    });
    queueFrom('subscribers', {
      data: { id: 's-0042', name: 'Mary' },
      error: null,
    });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'subscriber',
          password: 'Demo1234',
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
      subscriberId: 's-0042',
      name: 'Mary',
      hasPassword: true,
    });
    // verify-password always returns hasPassword: true (we just verified one).
    expect(payload.user.hasPassword).toBe(true);
    expect(signJwtMock.mock.calls[0][0]).toMatchObject({
      sub: 's-0042',
      role: 'authenticated',
      app_role: 'subscriber',
      phone: '+256777247884',
      subscriberId: 's-0042',
    });
  });

  it('falls back to ROLE_DEFAULTS.subscriber when no subscriber row matches', async () => {
    const hash = await ensureHash();
    queueFrom('users', {
      data: { password_hash: hash, role: 'subscriber' },
      error: null,
    });
    queueFrom('subscribers', { data: null, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256711000099',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    const payload = res.__getPayload() as {
      user: { subscriberId: string };
    };
    expect(payload.user.subscriberId).toBe('s-0001');
  });

  it.each([
    ['agent', 'a-001', 'agentId'],
    ['branch', 'b-kam-015', 'branchId'],
    ['distributor', 'd-001', 'distributorId'],
    // Employer falls back to emp-001 (Phase 0) like the other roles.
    ['employer', 'emp-001', 'employerId'],
  ] as const)(
    'returns the %s-scoped claim with fallback id %s when demo_personas misses',
    async (role, fallbackId, claimKey) => {
      const hash = await ensureHash();
      queueFrom('users', {
        data: { password_hash: hash, role },
        error: null,
      });
      queueFrom('demo_personas', { data: null, error: null });

      await call(
        makeReq({
          body: {
            phone: '+256711000099',
            role,
            password: 'Demo1234',
          },
        }),
        res,
      );
      expect(res.__getStatus()).toBe(200);
      const payload = res.__getPayload() as {
        user: Record<string, unknown>;
      };
      expect(payload.user.role).toBe(role);
      expect(payload.user[claimKey]).toBe(fallbackId);
      expect(payload.user.hasPassword).toBe(true);
      expect(signJwtMock.mock.calls[0][0]).toMatchObject({
        sub: fallbackId,
        app_role: role,
        [claimKey]: fallbackId,
      });
    },
  );

  it('uses the demo_personas row when one matches (agent path)', async () => {
    const hash = await ensureHash();
    queueFrom('users', {
      data: { password_hash: hash, role: 'agent' },
      error: null,
    });
    queueFrom('demo_personas', {
      data: { entity_id: 'a-009', label: 'Alex Agent' },
      error: null,
    });
    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'agent',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    const payload = res.__getPayload() as { user: Record<string, unknown> };
    expect(payload.user.agentId).toBe('a-009');
    expect(payload.user.name).toBe('Alex Agent');
  });

  // -------------------------------------------------------------------------
  // Deactivation gate (H1) — a deactivated entity cannot authenticate via the
  // password route either. CRITICAL ORDERING: the gate runs AFTER the bcrypt
  // compare, so a WRONG password on a deactivated account still returns 401
  // invalid_password; only a CORRECT password on a deactivated account is
  // turned away with 403 account_deactivated.
  // -------------------------------------------------------------------------

  it('returns 403 account_deactivated for a deactivated entity + CORRECT password', async () => {
    const hash = await ensureHash();
    queueFrom('users', { data: { password_hash: hash, role: 'distributor' }, error: null });
    queueFrom('demo_personas', { data: null, error: null }); // → fallback d-001
    queueFrom('distributors', { data: { status: 'inactive' }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256700000001',
          role: 'distributor',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(403);
    expect(res.__getPayload()).toEqual({
      code: 'account_deactivated',
      message:
        'This account has been deactivated. Please contact support to reactivate it.',
    });
    // Gate fires before signJwt — a blocked login mints no token.
    expect(signJwtMock).not.toHaveBeenCalled();
  });

  it('returns 401 invalid_password for a deactivated entity + WRONG password (gate not reached)', async () => {
    const hash = await ensureHash();
    queueFrom('users', { data: { password_hash: hash, role: 'distributor' }, error: null });
    // No demo_personas / distributors status row queued — proves the gate is
    // never reached when the bcrypt compare fails first.

    await call(
      makeReq({
        body: {
          phone: '+256700000001',
          role: 'distributor',
          password: 'wrong-password-1',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(401);
    expect(res.__getPayload()).toEqual({ code: 'invalid_password' });
  });

  it('returns 200 for an active entity + correct password', async () => {
    const hash = await ensureHash();
    queueFrom('users', { data: { password_hash: hash, role: 'agent' }, error: null });
    queueFrom('demo_personas', {
      data: { entity_id: 'a-009', label: 'Alex Agent' },
      error: null,
    });
    queueFrom('agents', { data: { status: 'active' }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'agent',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    const payload = res.__getPayload() as { user: Record<string, unknown> };
    expect(payload.user.agentId).toBe('a-009');
    expect(payload.user.hasPassword).toBe(true);
  });

  it('never gates a subscriber (no entity status lookup blocks it)', async () => {
    const hash = await ensureHash();
    queueFrom('users', { data: { password_hash: hash, role: 'subscriber' }, error: null });
    queueFrom('subscribers', { data: { id: 's-0042', name: 'Mary' }, error: null });

    await call(
      makeReq({
        body: {
          phone: '+256777247884',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect((res.__getPayload() as { user: { subscriberId: string } }).user.subscriberId).toBe('s-0042');
  });

  it('treats a status-lookup error as non-fatal (login proceeds, 200)', async () => {
    const hash = await ensureHash();
    queueFrom('users', { data: { password_hash: hash, role: 'distributor' }, error: null });
    queueFrom('demo_personas', { data: null, error: null });
    queueFrom('distributors', {
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    await call(
      makeReq({
        body: {
          phone: '+256700000001',
          role: 'distributor',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect((res.__getPayload() as { user: { distributorId: string } }).user.distributorId).toBe('d-001');
  });

  // -------------------------------------------------------------------------
  // Phone normalisation
  // -------------------------------------------------------------------------

  it('normalises 9-digit local phone in the JWT claim', async () => {
    const hash = await ensureHash();
    queueFrom('users', {
      data: { password_hash: hash, role: 'subscriber' },
      error: null,
    });
    queueFrom('subscribers', { data: null, error: null });

    await call(
      makeReq({
        body: {
          phone: '777247884',
          role: 'subscriber',
          password: 'Demo1234',
        },
      }),
      res,
    );
    expect(res.__getStatus()).toBe(200);
    expect(signJwtMock.mock.calls[0][0]).toMatchObject({
      phone: '+256777247884',
    });
  });
});

