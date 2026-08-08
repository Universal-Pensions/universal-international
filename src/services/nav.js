// Fund NAV (unit price) service — Supabase-backed, with a flat-1000 fallback
// under VITE_USE_SUPABASE=false.
//
// Backs the admin "Unit price" page. Three RPCs, all admin-gated (migration 0104):
//
//   get_nav_overview(fund)                        → header figures + inline series
//   list_nav_snapshots(fund, limit, offset, status) → the paged valuation register
//   publish_nav_snapshot(date, price, …)          → the ONLY write path
//
// WHY THIS MATTERS MORE THAN A NORMAL ADMIN SCREEN: since 0104 the unit price is
// the platform's pricing authority. Contributions buy units at it, withdrawals
// redeem at it, and publishing a new price revalues all ~5,060 members in one
// transaction. Every member's corpus and the whole platform AUM move when the
// admin presses Publish, which is why the mutation is never optimistic and why
// its invalidation list is deliberately broad (see hooks/useNav.js).
//
// SERIES IS INLINE: get_nav_overview returns the trailing ~260 published points
// on the overview payload, so the trend chart costs no extra round-trip.
//
// PENDING DAYS come from this RPC, NOT from get_admin_attention. The NAV page has
// to work whether or not the admin-attention migrations (0096/0097) are applied.

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';

/** The one fund this demo prices. The schema carries fund_code for future use. */
export const DEFAULT_FUND = 'UPU-BAL';

/**
 * Safe skeleton with the RPC's exact keys, so the page never needs optional
 * chaining and a loading/rollback render can't diverge from a loaded one.
 */
export const EMPTY_NAV_OVERVIEW = Object.freeze({
  fundCode: DEFAULT_FUND,
  currentNav: null,
  currentNavDate: null,
  previousNav: null,
  previousNavDate: null,
  changeAbs: null,
  changePct: null,
  unitsInIssue: 0,
  aum: 0,
  totalInvested: 0,
  totalGrowth: 0,
  growthPct: 0,
  membersPriced: 0,
  membersUnpriced: 0,
  firstNavDate: null,
  publishedCount: 0,
  pendingDays: 0,
  lastPublishedDaysAgo: null,
  series: Object.freeze([]),
});

/** Wrap a supabase-js error uniformly (mirrors adminAttention.js). */
function _rpcError(err, fnName) {
  const wrapped = new Error(err?.message || `RPC ${fnName} failed`);
  wrapped.code = err?.code || 'rpc_error';
  wrapped.details = err?.details;
  wrapped.hint = err?.hint;
  return wrapped;
}

/**
 * @endpoint RPC get_nav_overview(p_fund_code) — header figures + series (0104).
 * @description Current and previous price, the day-on-day move, units in issue,
 *   AUM at that price, aggregate cost basis and growth, how many members are
 *   priced, and the trailing published series for the chart — one round-trip.
 * @param {string} [fundCode]
 * @returns {Promise<typeof EMPTY_NAV_OVERVIEW>}
 * @scope Admin only — the RPC RAISEs for any other app_role.
 * @cache ['navOverview', fundCode], 5 min — the price changes at most once a day.
 */
export async function getNavOverview(fundCode = DEFAULT_FUND) {
  if (!IS_SUPABASE_ENABLED) {
    // Rollback path: a flat register at the historical demo price. Returning a
    // shaped object rather than throwing keeps the page renderable.
    return { ...EMPTY_NAV_OVERVIEW, currentNav: 1000, fundCode };
  }
  const { data, error } = await supabase.rpc('get_nav_overview', { p_fund_code: fundCode });
  if (error) throw _rpcError(error, 'get_nav_overview');
  return { ...EMPTY_NAV_OVERVIEW, ...(data ?? {}) };
}

/**
 * @endpoint RPC list_nav_snapshots(p_fund_code, p_limit, p_offset, p_status) (0104).
 * @description The valuation register, newest first. `changePct` is computed
 *   server-side with lag(), so the client never re-sorts to derive a move.
 *   `unitsInIssue`/`aum` are null on rows written by the 0105 backfill — the
 *   table renders "—" rather than inventing a figure.
 * @param {{fundCode?:string, limit?:number, offset?:number, status?:string|null}} [opts]
 * @returns {Promise<{rows: Array<Object>, total: number}>}
 * @scope Admin only.
 * @cache ['navSnapshots', fundCode, limit, offset, status], 5 min.
 */
export async function listNavSnapshots(opts = {}) {
  const { fundCode = DEFAULT_FUND, limit = 60, offset = 0, status = null } = opts;
  if (!IS_SUPABASE_ENABLED) return { rows: [], total: 0 };
  const { data, error } = await supabase.rpc('list_nav_snapshots', {
    p_fund_code: fundCode, p_limit: limit, p_offset: offset, p_status: status,
  });
  if (error) throw _rpcError(error, 'list_nav_snapshots');
  return { rows: data?.rows ?? [], total: data?.total ?? 0 };
}

/**
 * @endpoint RPC publish_nav_snapshot(...) — publish a price (0104).
 * @description Atomic: writes the register row and revalues every member in one
 *   transaction, so the book can never be half-priced. Re-publishing a date
 *   CORRECTS it, and flips a `pending` valuation day to `published` — which is
 *   how the admin clears a "Delayed NAV updation" signal. A back-dated
 *   correction updates the register but deliberately does NOT restate today's
 *   book at a stale price (`revalued: false` in the result).
 *
 *   A move of more than ±10% is REJECTED server-side unless `confirmMove` is
 *   set. The confirm dialog in the UI is a courtesy; the RPC is the gate, so a
 *   replayed or scripted call cannot skip it.
 * @param {{navDate:string, unitPrice:number, fundCode?:string, source?:string,
 *   confirmMove?:boolean}} input
 * @returns {Promise<{id:string, navDate:string, unitPrice:number,
 *   previousUnitPrice:?number, changePct:?number, revalued:boolean,
 *   unitsInIssue:number, aum:number, membersPriced:number}>}
 * @scope Admin only.
 */
export async function publishNavSnapshot(input) {
  const {
    navDate, unitPrice, fundCode = DEFAULT_FUND,
    source = 'admin_manual', confirmMove = false,
  } = input ?? {};
  if (!IS_SUPABASE_ENABLED) {
    return {
      id: 'nav-mock', fundCode, navDate, unitPrice: Number(unitPrice),
      previousUnitPrice: null, changePct: null, revalued: false,
      unitsInIssue: 0, aum: 0, membersPriced: 0,
    };
  }
  const { data, error } = await supabase.rpc('publish_nav_snapshot', {
    p_nav_date: navDate,
    p_unit_price: Number(unitPrice),
    p_fund_code: fundCode,
    p_source: source,
    p_confirm_move: Boolean(confirmMove),
  });
  if (error) throw _rpcError(error, 'publish_nav_snapshot');
  return data;
}
