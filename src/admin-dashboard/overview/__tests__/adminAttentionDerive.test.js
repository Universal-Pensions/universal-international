import { describe, it, expect } from 'vitest';
import {
  ATTENTION_TYPES,
  SEVERITY,
  computeAdminAttention,
  countToAction,
  attentionRouteMobile,
  attentionPanelDesktop,
} from '../adminAttentionDerive';

/** A realistic get_admin_attention() payload, matching the seeded demo targets. */
const payload = {
  asOf: '2026-08-07T09:00:00.000Z',
  today: '2026-08-07',
  dormantSubscribers: 1096,
  delayedEmployerTransfers: 3,
  delayedNav: 4,
  pendingAccessRequests: 4,
  underperformingDistributors: 1,
  delayedInsurancePayouts: 11,
  delayedWithdrawals: { total: 14, retirement: 5, emergency: 9 },
  delayedCustodyTransfers: 4,
  reconciliation: { total: 10, userWise: 7, transactionWise: 3 },
  inactiveBranches: 31,
  thresholds: {
    withdrawalSlaDays: 5,
    claimSlaDays: 10,
    navStaleDays: 1,
    custodyGraceDays: 0,
    underperformActiveRatePct: 60,
    employerGraceDays: { weekly: 10, monthly: 35, quarterly: 100, 'half-yearly': 190, annually: 380 },
  },
};

const byType = (items) => Object.fromEntries(items.map((i) => [i.type, i]));

describe('computeAdminAttention', () => {
  it('always returns exactly ten rows, in the product-spec order', () => {
    const items = computeAdminAttention(payload);
    expect(items).toHaveLength(10);
    expect(items.map((i) => i.type)).toEqual([
      ATTENTION_TYPES.DORMANT,
      ATTENTION_TYPES.EMPLOYER_TRANSFERS,
      ATTENTION_TYPES.NAV,
      ATTENTION_TYPES.COMPLAINTS,
      ATTENTION_TYPES.ACCESS_REQUESTS,
      ATTENTION_TYPES.DISTRIBUTORS,
      ATTENTION_TYPES.INSURANCE_PAYOUTS,
      ATTENTION_TYPES.WITHDRAWALS,
      ATTENTION_TYPES.CUSTODY,
      ATTENTION_TYPES.RECONCILIATION,
    ]);
  });

  it('still returns ten all-clear rows when called with nothing', () => {
    // The first render, and the VITE_USE_SUPABASE=false rollback path, both hit
    // this. It must never throw or drop rows.
    const items = computeAdminAttention();
    expect(items).toHaveLength(10);
    expect(items.every((i) => i.severity === SEVERITY.OK)).toBe(true);
    expect(items.every((i) => i.value === 0)).toBe(true);
    expect(countToAction(items)).toBe(0);
  });

  it('survives a partial payload without inventing values', () => {
    const items = byType(computeAdminAttention({ delayedNav: 2 }));
    expect(items[ATTENTION_TYPES.NAV].value).toBe(2);
    expect(items[ATTENTION_TYPES.WITHDRAWALS].value).toBe(0);
    expect(items[ATTENTION_TYPES.RECONCILIATION].value).toBe(0);
  });

  it('marks a zero-valued signal ok so it renders a "Clear" pill', () => {
    const items = byType(computeAdminAttention({ ...payload, delayedNav: 0 }));
    expect(items[ATTENTION_TYPES.NAV].severity).toBe(SEVERITY.OK);
    expect(items[ATTENTION_TYPES.NAV].value).toBe(0);
  });

  it('escalates warning → alert at each type threshold', () => {
    const at = (over) => byType(computeAdminAttention({ ...payload, ...over }));

    expect(at({ delayedCustodyTransfers: 2 })[ATTENTION_TYPES.CUSTODY].severity).toBe(SEVERITY.WARNING);
    expect(at({ delayedCustodyTransfers: 3 })[ATTENTION_TYPES.CUSTODY].severity).toBe(SEVERITY.ALERT);

    expect(at({ delayedEmployerTransfers: 2 })[ATTENTION_TYPES.EMPLOYER_TRANSFERS].severity).toBe(SEVERITY.WARNING);
    expect(at({ delayedEmployerTransfers: 3 })[ATTENTION_TYPES.EMPLOYER_TRANSFERS].severity).toBe(SEVERITY.ALERT);

    expect(at({ underperformingDistributors: 1 })[ATTENTION_TYPES.DISTRIBUTORS].severity).toBe(SEVERITY.WARNING);
    expect(at({ underperformingDistributors: 2 })[ATTENTION_TYPES.DISTRIBUTORS].severity).toBe(SEVERITY.ALERT);

    expect(at({ delayedInsurancePayouts: 9 })[ATTENTION_TYPES.INSURANCE_PAYOUTS].severity).toBe(SEVERITY.WARNING);
    expect(at({ delayedInsurancePayouts: 10 })[ATTENTION_TYPES.INSURANCE_PAYOUTS].severity).toBe(SEVERITY.ALERT);

    expect(at({ reconciliation: { total: 4, userWise: 4, transactionWise: 0 } })[ATTENTION_TYPES.RECONCILIATION].severity)
      .toBe(SEVERITY.WARNING);
    expect(at({ reconciliation: { total: 10, userWise: 7, transactionWise: 3 } })[ATTENTION_TYPES.RECONCILIATION].severity)
      .toBe(SEVERITY.ALERT);
  });

  it('scales dormancy severity to the size of the book, not an absolute', () => {
    const small = byType(computeAdminAttention({ dormantSubscribers: 40, totalSubscribers: 5000 }));
    expect(small[ATTENTION_TYPES.DORMANT].severity).toBe(SEVERITY.WARNING);

    const big = byType(computeAdminAttention({ dormantSubscribers: 900, totalSubscribers: 5000 }));
    expect(big[ATTENTION_TYPES.DORMANT].severity).toBe(SEVERITY.ALERT);
  });

  it('escalates complaints on urgency even when the volume is low', () => {
    const routine = byType(computeAdminAttention(payload, { openComplaints: 3 }));
    expect(routine[ATTENTION_TYPES.COMPLAINTS].severity).toBe(SEVERITY.WARNING);
    expect(routine[ATTENTION_TYPES.COMPLAINTS].sub).toBe('Open support threads');

    const urgent = byType(computeAdminAttention(payload, { openComplaints: 3, urgentComplaints: 1 }));
    expect(urgent[ATTENTION_TYPES.COMPLAINTS].severity).toBe(SEVERITY.ALERT);
    expect(urgent[ATTENTION_TYPES.COMPLAINTS].sub).toContain('1 urgent');
  });

  it('merges the complaint count from the caller, since tickets have no RPC', () => {
    const without = byType(computeAdminAttention(payload));
    expect(without[ATTENTION_TYPES.COMPLAINTS].value).toBe(0);

    const withCounts = byType(computeAdminAttention(payload, { openComplaints: 6 }));
    expect(withCounts[ATTENTION_TYPES.COMPLAINTS].value).toBe(6);
  });

  it('reports withdrawals as ONE flat row — no retirement/emergency children', () => {
    // The bucket split was removed on purpose: the drill-down names each
    // payout's bucket per row, so the children re-asked the next screen's
    // question. Guard it, or a future edit reintroduces the nesting.
    const items = computeAdminAttention(payload);
    const wd = byType(items)[ATTENTION_TYPES.WITHDRAWALS];

    expect(wd.value).toBe(14);            // still the total of both buckets
    expect(wd.subRows).toBeUndefined();
    expect(items.some((i) => i.subRows)).toBe(false);
    expect(items.map((i) => i.label)).not.toContain('Retirement payout');
    expect(items.map((i) => i.label)).not.toContain('Emergency payout');
  });

  it('builds SLA sub-labels from the server thresholds, never a local constant', () => {
    const base = byType(computeAdminAttention(payload));
    expect(base[ATTENTION_TYPES.WITHDRAWALS].sub).toBe('Past the 5-day payout SLA');
    expect(base[ATTENTION_TYPES.INSURANCE_PAYOUTS].sub).toBe('Claims past the 10-day decision SLA');
    expect(base[ATTENTION_TYPES.DISTRIBUTORS].sub).toContain('60%');

    // Change the server's mind and the copy must follow it.
    const moved = byType(computeAdminAttention({
      ...payload,
      thresholds: { ...payload.thresholds, withdrawalSlaDays: 3, claimSlaDays: 21, underperformActiveRatePct: 75 },
    }));
    expect(moved[ATTENTION_TYPES.WITHDRAWALS].sub).toBe('Past the 3-day payout SLA');
    expect(moved[ATTENTION_TYPES.INSURANCE_PAYOUTS].sub).toBe('Claims past the 21-day decision SLA');
    expect(moved[ATTENTION_TYPES.DISTRIBUTORS].sub).toContain('75%');
  });

  it('falls back to threshold-free copy when the server omits thresholds', () => {
    const items = byType(computeAdminAttention({ ...payload, thresholds: undefined }));
    expect(items[ATTENTION_TYPES.WITHDRAWALS].sub).toBe('Past their payout SLA');
    expect(items[ATTENTION_TYPES.INSURANCE_PAYOUTS].sub).toBe('Claims past their decision SLA');
  });

  it('reports the reconciliation split in its sub-label', () => {
    const recon = byType(computeAdminAttention(payload))[ATTENTION_TYPES.RECONCILIATION];
    expect(recon.value).toBe(10);
    expect(recon.sub).toBe('7 member · 3 transaction');
  });

  it('coerces non-numeric payload values instead of rendering NaN', () => {
    const items = byType(computeAdminAttention({
      delayedNav: null,
      delayedCustodyTransfers: undefined,
      delayedEmployerTransfers: 'not-a-number',
      reconciliation: { total: '10', userWise: '7', transactionWise: null },
    }));
    expect(items[ATTENTION_TYPES.NAV].value).toBe(0);
    expect(items[ATTENTION_TYPES.CUSTODY].value).toBe(0);
    expect(items[ATTENTION_TYPES.EMPLOYER_TRANSFERS].value).toBe(0);
    // Numeric strings are real (PostgREST returns bigint counts as strings).
    expect(items[ATTENTION_TYPES.RECONCILIATION].value).toBe(10);
    expect(items[ATTENTION_TYPES.RECONCILIATION].sub).toBe('7 member · 0 transaction');
    expect(Object.values(items).every((i) => Number.isFinite(i.value))).toBe(true);
  });
});

describe('countToAction', () => {
  it('counts only non-clear rows', () => {
    expect(countToAction(computeAdminAttention(payload, { openComplaints: 6 }))).toBe(10);
  });

  it('counts a delayed withdrawal backlog once, whatever its bucket mix', () => {
    // Only withdrawals are non-zero. The retirement/emergency figures still ride
    // on the payload but are no longer rows, so they add nothing to the count.
    const items = computeAdminAttention({ delayedWithdrawals: { total: 14, retirement: 5, emergency: 9 } });
    expect(countToAction(items)).toBe(1);
  });

  it('is zero when everything is clear', () => {
    expect(countToAction(computeAdminAttention())).toBe(0);
  });

  it('tolerates junk entries', () => {
    expect(countToAction([null, undefined, { severity: SEVERITY.OK }])).toBe(0);
    expect(countToAction()).toBe(0);
  });
});

describe('drill targets', () => {
  it('routes the generic signals to the mobile attention page', () => {
    expect(attentionRouteMobile(ATTENTION_TYPES.DORMANT)).toBe('/dashboard/attention/dormantSubscribers');
    expect(attentionRouteMobile(ATTENTION_TYPES.WITHDRAWALS))
      .toBe('/dashboard/attention/delayedWithdrawals');
  });

  it('routes the two signals that already own a surface to that surface', () => {
    expect(attentionRouteMobile(ATTENTION_TYPES.ACCESS_REQUESTS)).toBe('/dashboard/access-requests');
    expect(attentionRouteMobile(ATTENTION_TYPES.COMPLAINTS)).toBe('/dashboard/support');
  });

  it('returns a panel intent on desktop, since the admin shell has no routes', () => {
    expect(attentionPanelDesktop(ATTENTION_TYPES.NAV)).toEqual({ attentionType: ATTENTION_TYPES.NAV });
    expect(attentionPanelDesktop(ATTENTION_TYPES.ACCESS_REQUESTS)).toEqual({ panel: 'access-requests' });
    expect(attentionPanelDesktop(ATTENTION_TYPES.COMPLAINTS)).toEqual({ panel: 'tickets' });
  });
});
