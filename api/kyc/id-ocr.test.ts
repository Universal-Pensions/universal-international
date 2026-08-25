// Tests for POST /api/kyc/id-ocr.
//
// Covers: success path mints a full, correctly-shaped IdExtraction whose
// fields are internally consistent (barcode derived from the same identity,
// NIN prefix tracks gender); the mint is STABLE for a given sessionId
// (same identity across a "Try again" retry) and DISTINCT across sessionIds
// (A11-002 regression — the old fixed identity's NIN collided with the
// UNIQUE index on subscribers.nin the moment a second subscriber was
// onboarded); missing front/back -> 400 with code:id_sides_required;
// 2200ms simulated latency; and method-not-allowed semantics.
//
// This route has no QA override headers and no env-key short-circuits — the
// SHAPE it returns is fixed, but the VALUES are minted per sessionId (see
// id-ocr.ts's IDENTITY MINTING comment), so assertions below check shape +
// derivation + stability/uniqueness rather than one exact fixed body.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './id-ocr';

function buildReq(overrides: Partial<VercelRequest> = {}): VercelRequest {
  return {
    method: 'POST',
    headers: {},
    body: {},
    ...overrides,
  } as VercelRequest;
}

function buildRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res as unknown as VercelResponse & {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
  };
}

type OcrBody = {
  fullName: string;
  nin: string;
  cardNumber: string;
  dob: string;
  gender: 'male' | 'female';
  barcodeRaw: string;
  confidence: number;
};

const NIN_RE = /^C[MF][A-Z0-9]{12}$/;
const CARD_RE = /^UG\d{7}$/;
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

/** POST { front, back, sessionId } and resolve once the 2200ms mock latency has elapsed. */
async function callOcr(body: Record<string, unknown>) {
  const req = buildReq({ body });
  const res = buildRes();
  const pending = handler(req, res);
  await vi.advanceTimersByTimeAsync(2200);
  await pending;
  return res;
}

describe('POST /api/kyc/id-ocr', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mints a 200 IdExtraction whose fields are correctly shaped and cross-consistent', async () => {
    const res = await callOcr({ front: 'front-token', back: 'back-token', sessionId: 'session-shape-check' });
    expect(res.statusCode).toBe(200);
    const body = res.body as OcrBody;

    expect(typeof body.fullName).toBe('string');
    expect(body.fullName.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
    expect(body.nin).toMatch(NIN_RE);
    expect(body.cardNumber).toMatch(CARD_RE);
    expect(body.dob).toMatch(DOB_RE);
    expect(['male', 'female']).toContain(body.gender);
    expect(body.confidence).toBeGreaterThan(0);
    expect(body.confidence).toBeLessThanOrEqual(1);

    // NIN prefix must track the minted gender (ReviewStep.jsx's NIN_RE
    // requires CM for male / CF for female — 'other' has no valid prefix and
    // must never be minted).
    expect(body.nin.slice(0, 2)).toBe(body.gender === 'male' ? 'CM' : 'CF');

    // barcodeRaw must be REBUILT from the same minted values, not just
    // independently well-formed: NIN|cardNumber|dob|SURNAME,GIVEN,OTHER.
    const [barNin, barCard, barDob, barNames] = body.barcodeRaw.split('|');
    expect(barNin).toBe(body.nin);
    expect(barCard).toBe(body.cardNumber);
    expect(barDob).toBe(body.dob);
    const nameParts = barNames!.split(',');
    expect(nameParts).toHaveLength(3);
    const [given, surname] = body.fullName.split(' ');
    expect(nameParts[0]).toBe(surname!.toUpperCase());
    expect(nameParts[1]).toBe(given!.toUpperCase());
    expect(nameParts.every((p) => /^[A-Z]+$/.test(p))).toBe(true);
  });

  it('keeps the minted DOB inside the 18-100 age window as an offset from today (not a fixed calendar date)', async () => {
    const res = await callOcr({ front: 'f', back: 'b', sessionId: 'session-age-check' });
    const body = res.body as OcrBody;
    const ageYears = (Date.now() - new Date(body.dob).getTime()) / (365.25 * 24 * 3600 * 1000);
    expect(ageYears).toBeGreaterThanOrEqual(18);
    expect(ageYears).toBeLessThanOrEqual(100);
  });

  it('mints the SAME identity for the SAME sessionId across repeated calls (a "Try again" retry must not swap the person)', async () => {
    const first = await callOcr({ front: 'front-token', back: 'back-token', sessionId: 'session-retry-stable' });
    const second = await callOcr({ front: 'front-token', back: 'back-token', sessionId: 'session-retry-stable' });
    expect(second.body).toEqual(first.body);
  });

  it('mints a DIFFERENT NIN for a different sessionId — A11-002 regression: a second onboarding must not collide with the first', async () => {
    const first = await callOcr({ front: 'f', back: 'b', sessionId: 'session-subscriber-A' });
    const second = await callOcr({ front: 'f', back: 'b', sessionId: 'session-subscriber-B' });
    const bodyA = first.body as OcrBody;
    const bodyB = second.body as OcrBody;
    expect(bodyB.nin).not.toBe(bodyA.nin);
  });

  it('mints unique, correctly-prefixed NINs across many distinct sessions, covering both genders', async () => {
    const sessionCount = 24;
    const results: OcrBody[] = [];
    for (let i = 0; i < sessionCount; i++) {
      const res = await callOcr({ front: 'f', back: 'b', sessionId: `session-batch-${i}` });
      results.push(res.body as OcrBody);
    }

    // Every NIN is unique across the batch (the actual constraint that broke
    // the demo — ux_subscribers_nin) and every NIN's prefix matches its own
    // gender.
    const nins = results.map((r) => r.nin);
    expect(new Set(nins).size).toBe(sessionCount);
    for (const r of results) {
      expect(r.nin).toMatch(NIN_RE);
      expect(r.nin.slice(0, 2)).toBe(r.gender === 'male' ? 'CM' : 'CF');
    }

    // Sanity: the mint isn't secretly a gender monoculture.
    const genders = new Set(results.map((r) => r.gender));
    expect(genders.has('male')).toBe(true);
    expect(genders.has('female')).toBe(true);
  });

  it('deliberately omits district (subscriber picks manually on ReviewStep)', async () => {
    const res = await callOcr({ front: 'f', back: 'b', sessionId: 'session-district-check' });
    expect((res.body as Record<string, unknown>).district).toBeUndefined();
  });

  it('mints a usable identity even when sessionId is missing (defensive fallback, not the production path)', async () => {
    const res = await callOcr({ front: 'f', back: 'b' });
    expect(res.statusCode).toBe(200);
    const body = res.body as OcrBody;
    expect(body.nin).toMatch(NIN_RE);
  });

  it('returns 400 + code:id_sides_required when front is missing', async () => {
    const req = buildReq({ body: { back: 'back-token' } });
    const res = buildRes();
    const pending = handler(req, res);
    await vi.advanceTimersByTimeAsync(2200);
    await pending;
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: 'id_sides_required' });
  });

  it('returns 400 + code:id_sides_required when back is missing', async () => {
    const req = buildReq({ body: { front: 'front-token' } });
    const res = buildRes();
    const pending = handler(req, res);
    await vi.advanceTimersByTimeAsync(2200);
    await pending;
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: 'id_sides_required' });
  });

  it('awaits the simulated 2200ms latency before resolving', async () => {
    const req = buildReq({ body: { front: 'f', back: 'b' } });
    const res = buildRes();
    const pending = handler(req, res);
    await vi.advanceTimersByTimeAsync(2100);
    expect(res.body).toBeUndefined();
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(res.body).toBeDefined();
  });

  it('returns 405 + Allow:POST for GET', async () => {
    const req = buildReq({ method: 'GET' });
    const res = buildRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ code: 'method_not_allowed' });
    expect(res.headers.Allow).toBe('POST');
  });

  // This route returns identity PII (name, NIN, DOB), so no-store matters most
  // here. Assert it on the success, 400, and 405 paths (B13).
  it('sets Cache-Control: no-store on the success (PII) path (B13)', async () => {
    const res = await callOcr({ front: 'front-token', back: 'back-token', sessionId: 'session-cache-check' });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('sets Cache-Control: no-store on the 400 path (B13)', async () => {
    const req = buildReq({ body: { back: 'back-token' } });
    const res = buildRes();
    const pending = handler(req, res);
    await vi.advanceTimersByTimeAsync(2200);
    await pending;
    expect(res.statusCode).toBe(400);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('sets Cache-Control: no-store on the 405 path (B13)', async () => {
    const req = buildReq({ method: 'GET' });
    const res = buildRes();
    await handler(req, res);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

// ---------------------------------------------------------------------------
// The demo ID-card pool (migration 0133).
//
// The route claims a pre-seeded card and falls back to the PRNG when the pool
// is dry or unreachable. That fallback is not a nicety: a demo that hard-fails
// because a pool ran out would be A11-002 all over again, which is the exact
// failure this whole line of work exists to end.
//
// NOTE the tests ABOVE already exercise the fallback for real — there is no
// Supabase config in the unit environment, so `supabaseAdmin.rpc` rejects and
// every one of them still gets a valid identity. These add the pool path.
// ---------------------------------------------------------------------------
const rpcMock = vi.hoisted(() => vi.fn());
vi.mock('../_lib/supabase-admin.js', () => ({ default: { rpc: rpcMock } }));

const CARD = {
  nin: 'CF34071A2B3C4D',
  first_name: 'Prossy',
  other_name: 'Nabirye',
  last_name: 'Nakato',
  gender: 'female' as const,
  dob: '1992-07-14',
  card_number: 'UG7654321',
};

describe('POST /api/kyc/id-ocr — demo ID-card pool', () => {
  beforeEach(() => { rpcMock.mockReset(); });

  it('returns a claimed card, mapped onto the IdExtraction shape', async () => {
    rpcMock.mockResolvedValue({ data: CARD, error: null });
    const res = buildRes();
    await handler(buildReq({ body: { front: 'f', back: 'b', sessionId: 'sess-pool-1' } }), res);

    expect(rpcMock).toHaveBeenCalledWith('claim_demo_id_card', { p_session_id: 'sess-pool-1' });
    expect(res.body as OcrBody).toMatchObject({
      fullName: 'Prossy Nakato',   // first + last; other_name is barcode-only
      nin: CARD.nin,
      cardNumber: CARD.card_number,
      dob: CARD.dob,
      gender: 'female',
      confidence: 0.94,
    });
    // Barcode keeps the provider's SURNAME,GIVEN,OTHER ordering.
    expect((res.body as OcrBody).barcodeRaw).toBe(
      `${CARD.nin}|${CARD.card_number}|${CARD.dob}|NAKATO,PROSSY,NABIRYE`,
    );
  });

  it('accepts a single-row array, as PostgREST returns for a RETURNS-record RPC', async () => {
    rpcMock.mockResolvedValue({ data: [CARD], error: null });
    const res = buildRes();
    await handler(buildReq({ body: { front: 'f', back: 'b', sessionId: 'sess-pool-2' } }), res);
    expect((res.body as OcrBody).nin).toBe(CARD.nin);
  });

  it('falls back to the PRNG when the pool is EXHAUSTED (data null)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const res = buildRes();
    await handler(buildReq({ body: { front: 'f', back: 'b', sessionId: 'sess-dry' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as OcrBody).nin).toMatch(/^C[MF][A-Z0-9]{12}$/);
    expect((res.body as OcrBody).fullName).toBeTruthy();
  });

  it('falls back to the PRNG when the claim ERRORS', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    const res = buildRes();
    await handler(buildReq({ body: { front: 'f', back: 'b', sessionId: 'sess-err' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as OcrBody).nin).toMatch(/^C[MF][A-Z0-9]{12}$/);
  });

  it('falls back to the PRNG when Supabase is unreachable (rpc throws)', async () => {
    rpcMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = buildRes();
    await handler(buildReq({ body: { front: 'f', back: 'b', sessionId: 'sess-down' } }), res);
    expect(res.statusCode).toBe(200);
    expect((res.body as OcrBody).nin).toMatch(/^C[MF][A-Z0-9]{12}$/);
  });

  it('does not claim a card when no sessionId is supplied', async () => {
    rpcMock.mockResolvedValue({ data: CARD, error: null });
    const res = buildRes();
    await handler(buildReq({ body: { front: 'f', back: 'b' } }), res);
    // A claim with no session could never be returned again on retry, so it
    // would burn one card per render. Skip straight to the PRNG.
    expect(rpcMock).not.toHaveBeenCalled();
    expect((res.body as OcrBody).nin).toMatch(/^C[MF][A-Z0-9]{12}$/);
  });
});
