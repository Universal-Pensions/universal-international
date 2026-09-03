// Admin "Needs attention" service — Supabase-backed with a zeros fallback under
// VITE_USE_SUPABASE=false.
//
// Backs the ten-signal Needs-attention card on the admin home (desktop + mobile)
// and its drill-downs. Three RPCs, all admin-gated (migration 0097):
//
//   get_admin_attention()                     → every count in one round-trip
//   get_admin_attention_rows(type, limit)     → the drill-down list for one signal
//   admin_notify(...)                         → see services/notifications.js
//   resolve_nav_missed_day(date, note, fund)  → close out one missing NAV day (0162)
//
// WHY ONE AGGREGATE CALL: the card renders on every admin home load on BOTH
// surfaces. Nine per-signal queries × two surfaces is 18 round-trips for numbers
// that are all independent single-table aggregates behind one identical JWT gate.
// A single cache key also guarantees desktop and mobile can never disagree.
//
// CLOCK: every date comparison happens server-side against CURRENT_DATE, and the
// RPC echoes back `asOf` plus the whole `thresholds` object. Callers must never
// re-derive "days late" or hardcode an SLA. JS now reads ONE canonical anchor
// (src/constants/demoClock.js, MOCK_NOW = 2026-07-01); public._demo_now() is a
// separate, necessarily-independent SQL literal that a still-unapplied migration
// (0126) would bring into agreement — until it ships, _demo_now() stays months
// behind. Either way: trust the RPC's `asOf`, never re-derive it client-side.

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';

/**
 * Shape returned when Supabase is disabled, or when the caller wants a safe
 * skeleton. Mirrors the RPC's keys exactly so the derive module has one shape to
 * reason about and never needs optional chaining on the nested objects.
 */
export const EMPTY_ATTENTION = Object.freeze({
  asOf: null,
  today: null,
  dormantSubscribers: 0,
  delayedEmployerTransfers: 0,
  delayedNav: 0,
  pendingAccessRequests: 0,
  underperformingDistributors: 0,
  delayedInsurancePayouts: 0,
  delayedWithdrawals: Object.freeze({ total: 0, retirement: 0, emergency: 0 }),
  delayedCustodyTransfers: 0,
  reconciliation: Object.freeze({ total: 0, userWise: 0, transactionWise: 0 }),
  inactiveBranches: 0,
  thresholds: Object.freeze({
    withdrawalSlaDays: 5,
    claimSlaDays: 10,
    navStaleDays: 1,
    custodyGraceDays: 0,
    underperformActiveRatePct: 60,
    employerGraceDays: Object.freeze({
      weekly: 10, monthly: 35, quarterly: 100, 'half-yearly': 190, annually: 380,
    }),
  }),
});

/** Wrap a supabase-js error uniformly (mirrors notifications.js / commissions.js). */
function _rpcError(err, fnName) {
  const wrapped = new Error(err?.message || `RPC ${fnName} failed`);
  wrapped.code = err?.code || 'rpc_error';
  wrapped.details = err?.details;
  wrapped.hint = err?.hint;
  return wrapped;
}

/**
 * @endpoint RPC get_admin_attention() — every Needs-attention count (0097).
 * @description Ten signals in one call, plus `inactiveBranches` (used only for the
 *   Platform-network card caption) and the server-owned `thresholds` / `asOf`.
 *   `pendingComplaints` is deliberately absent — ticketing has no Supabase tables,
 *   so that count is merged client-side from services/tickets.js.
 * @returns {Promise<typeof EMPTY_ATTENTION>}
 * @scope Admin only — the RPC RAISEs for any other app_role.
 */
export async function getAdminAttention() {
  if (!IS_SUPABASE_ENABLED) {
    // Rollback path. Returning zeros (rather than throwing) keeps the card
    // rendering as ten "Clear" rows instead of collapsing the admin home.
    return { ...EMPTY_ATTENTION };
  }
  const { data, error } = await supabase.rpc('get_admin_attention');
  if (error) throw _rpcError(error, 'get_admin_attention');
  return { ...EMPTY_ATTENTION, ...(data ?? {}) };
}

/**
 * @endpoint RPC get_admin_attention_rows(p_type, p_limit) — drill-down rows (0097).
 * @description One polymorphic RPC with a uniform row shape, so a single table
 *   renders every drill-down. Each row carries the `recipientRole`/`recipientId`
 *   the Notify composer posts back to admin_notify, resolved server-side rather
 *   than guessed in the UI.
 * @param {string} type One of the ATTENTION_TYPES values. The RPC also still
 *   accepts `delayedWithdrawalsRetirement` / `delayedWithdrawalsEmergency` to
 *   filter the withdrawals list to one bucket, but no UI asks for that today —
 *   the withdrawals drill-down names each row's bucket in `secondary` instead.
 * @param {number} [limit=50] Clamped server-side to 1..500.
 * @returns {Promise<Array<{id:string,primary:string,secondary:string,amount:?number,
 *   date:?string,dueBy:?string,daysLate:?number,status:string,count:?number,kind:?string,
 *   recipientRole:?string,recipientId:?string,recipientName:?string,href:?string}>>}
 * @scope Admin only.
 */
export async function getAdminAttentionRows(type, limit = 50) {
  if (!IS_SUPABASE_ENABLED) return [];
  const { data, error } = await supabase.rpc('get_admin_attention_rows', {
    p_type: type,
    p_limit: limit,
  });
  if (error) throw _rpcError(error, 'get_admin_attention_rows');
  return Array.isArray(data) ? data : [];
}

/**
 * @endpoint RPC resolve_nav_missed_day(p_nav_date, p_note, p_fund_code) — 0162.
 * @description Closes out ONE valuation day that has no published price, so it
 *   stops counting toward the Needs-attention badge. It does NOT publish a
 *   price: the day stays unpriced in the register, still shows on the Unit-price
 *   page's "Days with no published price" list, and is still a forward-dealing
 *   blocker. The date, who resolved it and when are kept, and the day remains
 *   visible in the drill-down flagged as resolved.
 *
 *   The RPC refuses a date the signal is not currently flagging, refuses a
 *   second resolution of the same day, and — importantly — refuses a day whose
 *   status is 'pending', because a pending day already has a price awaiting
 *   sign-off and publishing it is the real fix.
 *
 *   There is no reopen: resolving is final by product decision.
 * @param {{navDate: string, note?: string|null, fundCode?: string}} params
 * @returns {Promise<{fundCode:string, navDate:string, note:?string,
 *   resolvedBy:string, resolvedAt:string}>}
 * @scope Admin only — the RPC RAISEs for any other app_role.
 */
export async function resolveNavMissedDay({ navDate, note = null, fundCode = 'UPU-BAL' } = {}) {
  if (!IS_SUPABASE_ENABLED) {
    // Rollback path: getAdminAttentionRows returns [] here, so there is nothing
    // to resolve. Echo a plausible success rather than throwing, so a caller
    // exercising this directly does not hit a dead end.
    return {
      fundCode, navDate, note: note || null,
      resolvedBy: 'admin', resolvedAt: new Date().toISOString(),
    };
  }
  const { data, error } = await supabase.rpc('resolve_nav_missed_day', {
    p_nav_date: navDate,
    p_note: note ?? null,
    p_fund_code: fundCode,
  });
  if (error) throw _rpcError(error, 'resolve_nav_missed_day');
  return data;
}
