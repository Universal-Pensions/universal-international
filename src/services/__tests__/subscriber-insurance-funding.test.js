// Tests for fundInsuranceProducts — the post-signup annual-premium + save-to-cover
// funding path (migration 0073 `fund_insurance_products`). Mirrors the money-RPC
// tests: we mock supabase.rpc and assert call args / nonce stability, never a real
// DB. The RPC is the ONLY client path that may set the 0072-REVOKE'd funding-mode
// columns + create 'building' policies post-signup.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeSupabaseMock } from '../../test/supabaseMock';

const supabaseMock = makeSupabaseMock();

vi.mock('@/services/supabaseClient', () => ({
  supabase: supabaseMock,
  default: supabaseMock,
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));
vi.mock('../supabaseClient', () => ({
  supabase: supabaseMock,
  default: supabaseMock,
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

beforeEach(() => {
  supabaseMock.__reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('fundInsuranceProducts — fund_insurance_products RPC (live path)', () => {
  let svc;
  beforeEach(async () => {
    svc = await import('../subscriber');
  });

  it('Route A (pay_now) routes health cover through the RPC with the true monthly premium', async () => {
    supabaseMock.__queueRpc('fund_insurance_products', {
      data: { fundingMode: 'pay_now', annualTotal: 60000, charged: 60000, status: 'active', reference: 'PR-1' },
      error: null,
    });
    const res = await svc.fundInsuranceProducts('s-1', {
      fundingMode: 'pay_now',
      products: [{ product: 'health', cover: 3_000_000, premiumMonthly: 5_000 }],
      method: 'Airtel Money',
      nonce: 'fund-nonce-a',
    });
    expect(res).toMatchObject({ fundingMode: 'pay_now', charged: 60000 });

    const call = supabaseMock.__getRpcCalls('fund_insurance_products').at(-1);
    expect(call.args).toMatchObject({
      p_nonce: 'fund-nonce-a',
      p_funding_mode: 'pay_now',
      p_savings_pct: 100,
      p_method: 'Airtel Money',
    });
    // The stored premium_monthly is the TRUE monthly (5,000) — the RPC charges ×12.
    expect(call.args.p_products).toEqual([
      { product: 'health', cover: 3_000_000, premiumMonthly: 5_000 },
    ]);
  });

  it('Route B (save_to_cover) passes the savings split + mode through the RPC', async () => {
    supabaseMock.__queueRpc('fund_insurance_products', {
      data: { fundingMode: 'save_to_cover', annualTotal: 24000, charged: 0, status: 'building' },
      error: null,
    });
    await svc.fundInsuranceProducts('s-1', {
      fundingMode: 'save_to_cover',
      products: [{ product: 'life', cover: 1_000_000, premiumMonthly: 2_000 }],
      savingsPct: 60,
      nonce: 'fund-nonce-b',
    });
    const call = supabaseMock.__getRpcCalls('fund_insurance_products').at(-1);
    expect(call.args).toMatchObject({
      p_funding_mode: 'save_to_cover',
      p_savings_pct: 60,
      p_nonce: 'fund-nonce-b',
    });
  });

  it('reuses the SAME nonce across a retry (idempotency key is stable)', async () => {
    supabaseMock.__queueRpc('fund_insurance_products', { data: { charged: 0 }, error: null });
    supabaseMock.__queueRpc('fund_insurance_products', { data: { charged: 0 }, error: null });
    const payload = {
      fundingMode: 'save_to_cover',
      products: [{ product: 'funeral', cover: 2_000_000, premiumMonthly: 1_500 }],
      nonce: 'retry-fund',
    };
    await svc.fundInsuranceProducts('s-1', payload);
    await svc.fundInsuranceProducts('s-1', payload);
    const calls = supabaseMock.__getRpcCalls('fund_insurance_products');
    expect(calls).toHaveLength(2);
    expect(calls[0].args.p_nonce).toBe('retry-fund');
    expect(calls[1].args.p_nonce).toBe('retry-fund');
  });

  it('mints a fresh nonce when the caller omits one', async () => {
    supabaseMock.__queueRpc('fund_insurance_products', { data: {}, error: null });
    await svc.fundInsuranceProducts('s-1', {
      fundingMode: 'pay_now',
      products: [{ product: 'health', cover: 3_000_000, premiumMonthly: 5_000 }],
    });
    const call = supabaseMock.__getRpcCalls('fund_insurance_products').at(-1);
    expect(typeof call.args.p_nonce).toBe('string');
    expect(call.args.p_nonce.length).toBeGreaterThan(0);
  });

  it('rejects an unknown funding mode BEFORE hitting the RPC', async () => {
    await expect(
      svc.fundInsuranceProducts('s-1', { fundingMode: 'freebie', products: [] }),
    ).rejects.toThrow(/funding mode/i);
    expect(supabaseMock.__getRpcCalls('fund_insurance_products')).toHaveLength(0);
  });

  it('rejects an unknown product BEFORE hitting the RPC', async () => {
    await expect(
      svc.fundInsuranceProducts('s-1', {
        fundingMode: 'pay_now',
        products: [{ product: 'pet', cover: 1, premiumMonthly: 1 }],
      }),
    ).rejects.toThrow(/insurance product/i);
    expect(supabaseMock.__getRpcCalls('fund_insurance_products')).toHaveLength(0);
  });

  it('propagates an RPC error (e.g. employer-funded guard)', async () => {
    supabaseMock.__queueRpc('fund_insurance_products', {
      data: null,
      error: { message: 'life cover is provided and paid for by your employer' },
    });
    await expect(
      svc.fundInsuranceProducts('s-1', {
        fundingMode: 'pay_now',
        products: [{ product: 'life', cover: 1_000_000, premiumMonthly: 2_000 }],
        nonce: 'n',
      }),
    ).rejects.toMatchObject({ message: /employer/ });
  });
});
