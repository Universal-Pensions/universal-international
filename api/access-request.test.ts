// Unit tests for POST /api/access-request.
//
// Scoped to the 0140 change: the DISTRICT a distributor now has to supply, and
// the office address behind it. The rest of the route (phone canonicalisation,
// idempotency, the length caps) is exercised only where it interacts with those.
//
// Why this file exists at all: the defect 0140 fixes lived on ONE line here —
//     district: kind === 'employer' ? (district || null) : null
// — which discarded a distributor's district even when the form sent one. That
// is invisible to every frontend test, because the frontend was posting the
// value correctly. It needs a test at this layer or nowhere.
//
// Mocking mirrors contact.test.ts: `vi.mock` swaps the admin Supabase client.
// This route touches the DB twice — a SELECT for the idempotency check and the
// INSERT — so the chain covers both.

import { describe, it, expect, beforeEach, vi } from 'vitest';

type InsertResult = { error: unknown };
let insertQueue: InsertResult[] = [];
let selectResult: { data: unknown } = { data: null };
const insertCalls: Array<{ table: string; row: Record<string, unknown> }> = [];

vi.mock('./_lib/supabase-admin.js', () => ({
  default: {
    from: vi.fn((table: string) => {
      // The idempotency read is a chain of .eq()/.limit() ending in
      // .maybeSingle(); every link returns the same object so order is free.
      const chain: Record<string, unknown> = {};
      const link = () => chain;
      chain.select = vi.fn(link);
      chain.eq = vi.fn(link);
      chain.limit = vi.fn(link);
      chain.maybeSingle = vi.fn(() => Promise.resolve(selectResult));
      chain.insert = vi.fn((row: Record<string, unknown>) => {
        insertCalls.push({ table, row });
        return Promise.resolve(insertQueue.shift() ?? { error: null });
      });
      return chain;
    }),
  },
}));

// eslint-disable-next-line import/first
import handler from './access-request';

type StubReq = { method?: string; body?: unknown; headers?: Record<string, string> };

function makeReq(body: unknown): StubReq {
  return { method: 'POST', headers: {}, body };
}

function makeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let payload: unknown = undefined;
  const res = {
    setHeader(name: string, value: string) { headers[name] = value; },
    status(code: number) { statusCode = code; return res; },
    json(body: unknown) { payload = body; return res; },
    __headers: headers,
    __getStatus: () => statusCode,
    __getPayload: () => payload as { code?: string; submitted?: boolean },
  };
  return res;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (req: StubReq, res: ReturnType<typeof makeRes>) => handler(req as any, res as any);

const BASE = {
  orgName: 'Probe Networks Ltd',
  registrationNo: '80020002345678',
  contactName: 'Jane Doe',
  contactEmail: 'jane@probe.co.ug',
  contactPhone: '0771234567',
};
const VALID_DISTRIBUTOR = {
  ...BASE, type: 'distributor', district: 'Gulu', physicalAddress: 'Plot 9, Gulu Avenue',
};
const VALID_EMPLOYER = {
  ...BASE, type: 'employer', sector: 'Manufacturing', district: 'Kampala',
};

describe('POST /api/access-request — distributor geography (0140)', () => {
  let res: ReturnType<typeof makeRes>;

  beforeEach(() => {
    insertQueue = [];
    selectResult = { data: null };
    insertCalls.length = 0;
    res = makeRes();
  });

  it('PERSISTS a distributor district and office address', async () => {
    await call(makeReq(VALID_DISTRIBUTOR), res);
    expect(res.__getStatus()).toBe(200);
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].row).toMatchObject({
      kind: 'distributor',
      district: 'Gulu',
      physical_address: 'Plot 9, Gulu Avenue',
      // Employer-only, and still nulled for a distributor.
      sector: null,
    });
  });

  it('rejects a distributor with no district', async () => {
    const { district: _drop, ...noDistrict } = VALID_DISTRIBUTOR;
    await call(makeReq(noDistrict), res);
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload().code).toBe('invalid_district');
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects a distributor with no office address', async () => {
    const { physicalAddress: _drop, ...noAddress } = VALID_DISTRIBUTOR;
    await call(makeReq(noAddress), res);
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload().code).toBe('invalid_physical_address');
    expect(insertCalls).toHaveLength(0);
  });

  it('caps the office address at the length create_distributor accepts', async () => {
    await call(makeReq({ ...VALID_DISTRIBUTOR, physicalAddress: 'x'.repeat(201) }), res);
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload().code).toBe('physical_address_too_long');
    expect(insertCalls).toHaveLength(0);
  });

  it('still requires a district for an employer, and still nulls its address', async () => {
    await call(makeReq({ ...VALID_EMPLOYER, district: '' }), res);
    expect(res.__getStatus()).toBe(400);
    expect(res.__getPayload().code).toBe('invalid_district');

    const res2 = makeRes();
    // An address sent on an employer request is dropped: the employer journey
    // does not ask for one, so accepting it here would let the two doors
    // provision differently-shaped rows again.
    await call(makeReq({ ...VALID_EMPLOYER, physicalAddress: 'Plot 1' }), res2);
    expect(res2.__getStatus()).toBe(200);
    expect(insertCalls.at(-1)?.row).toMatchObject({
      kind: 'employer', district: 'Kampala', sector: 'Manufacturing', physical_address: null,
    });
  });
});
