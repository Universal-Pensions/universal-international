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

// ── updateInsuranceCover — the free DOWNGRADE path ──────────────────────────
// Not an RPC: lowering cover takes no payment, so it writes directly under the
// subscriber's own *_self RLS. The routing must follow migration 0064's storage
// split, and health/funeral must UPDATE rather than upsert — upserting would
// mint a policy nobody paid a premium for.
describe('updateInsuranceCover — per-product direct write (live path)', () => {
  let svc;
  beforeEach(async () => {
    svc = await import('../subscriber');
  });

  it('routes life to insurance_policies as an upsert', async () => {
    supabaseMock.__queueFrom('insurance_policies', {
      data: {
        cover: 1_000_000, premium_monthly: 2_000, status: 'active',
        policy_start: '2026-01-01', renewal_date: '2027-01-01',
      },
      error: null,
    });
    const res = await svc.updateInsuranceCover('s-1', {
      product: 'life', cover: 1_000_000, premiumMonthly: 2_000,
    });

    const call = supabaseMock.__getFromCalls('insurance_policies').at(-1);
    expect(call.chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriber_id: 's-1', cover: 1_000_000, premium_monthly: 2_000, status: 'active',
      }),
      { onConflict: 'subscriber_id' },
    );
    expect(res).toMatchObject({ product: 'life', cover: 1_000_000, premiumMonthly: 2_000 });
  });

  it('defaults to life when no product is given (back-compat)', async () => {
    supabaseMock.__queueFrom('insurance_policies', {
      data: { cover: 2_000_000, premium_monthly: 3_500, status: 'active' },
      error: null,
    });
    await svc.updateInsuranceCover('s-1', { cover: 2_000_000, premiumMonthly: 3_500 });
    expect(supabaseMock.__getFromCalls('insurance_policies')).toHaveLength(1);
    expect(supabaseMock.__getFromCalls('subscriber_insurance_products')).toHaveLength(0);
  });

  it('routes health to subscriber_insurance_products as a scoped UPDATE', async () => {
    supabaseMock.__queueFrom('subscriber_insurance_products', {
      data: { cover: 3_000_000, premium_monthly: 5_000, status: 'active' },
      error: null,
    });
    const res = await svc.updateInsuranceCover('s-1', {
      product: 'health', cover: 3_000_000, premiumMonthly: 5_000,
    });

    const call = supabaseMock.__getFromCalls('subscriber_insurance_products').at(-1);
    // UPDATE, never upsert — no free cover for an unheld product.
    expect(call.chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ cover: 3_000_000, premium_monthly: 5_000, status: 'active' }),
    );
    expect(call.chain.upsert).not.toHaveBeenCalled();
    expect(call.chain.eq).toHaveBeenCalledWith('subscriber_id', 's-1');
    expect(call.chain.eq).toHaveBeenCalledWith('product', 'health');
    expect(supabaseMock.__getFromCalls('insurance_policies')).toHaveLength(0);
    expect(res).toMatchObject({ product: 'health', cover: 3_000_000 });
  });

  it('routes funeral to subscriber_insurance_products too', async () => {
    supabaseMock.__queueFrom('subscriber_insurance_products', {
      data: { cover: 2_000_000, premium_monthly: 1_500, status: 'active' },
      error: null,
    });
    await svc.updateInsuranceCover('s-1', {
      product: 'funeral', cover: 2_000_000, premiumMonthly: 1_500,
    });
    const call = supabaseMock.__getFromCalls('subscriber_insurance_products').at(-1);
    expect(call.chain.eq).toHaveBeenCalledWith('product', 'funeral');
  });

  it('marks zero cover inactive', async () => {
    supabaseMock.__queueFrom('insurance_policies', {
      data: { cover: 0, premium_monthly: 0, status: 'inactive' }, error: null,
    });
    await svc.updateInsuranceCover('s-1', { product: 'life', cover: 0, premiumMonthly: 0 });
    const call = supabaseMock.__getFromCalls('insurance_policies').at(-1);
    expect(call.chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'inactive' }),
      expect.anything(),
    );
  });

  it('rejects an unknown product BEFORE touching Supabase', async () => {
    await expect(
      svc.updateInsuranceCover('s-1', { product: 'motor', cover: 1, premiumMonthly: 1 }),
    ).rejects.toThrow(/insurance product/i);
    expect(supabaseMock.__getFromCalls()).toHaveLength(0);
  });
});
