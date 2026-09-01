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
  // Pooled: total growth / total cost basis. Money-weighted, so a few large
  // long-tenured balances pull it away from the typical member's experience.
  growthPct: 0,
  // The mean of each member's OWN growth% (0107). This is what the page shows —
  // it is a fact about members, where the pooled figure is a fact about the fund.
  avgGrowthPct: 0,
  membersPriced: 0,
  membersUnpriced: 0,
  membersWithBasis: 0,
  firstNavDate: null,
  publishedCount: 0,
  // 0145: business days in the register's range with NO published price. This
  // used to count only nav_snapshots rows carrying status='pending', so a day
  // the fund simply never priced was invisible; it is now the same figure the
  // Needs-attention badge reads, so the tile and the badge cannot disagree.
  pendingDays: 0,
  // 0145: the actual dates behind pendingDays, oldest first, as YYYY-MM-DD.
  // A hole BEHIND the published frontier appears here — the old detector
  // started its search at the frontier and could never see one.
  missingDays: Object.freeze([]),
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
/**
 * @endpoint RPC get_pending_pricing_summary(p_fund) — migration 0147.
 * @description What money is waiting for a price: how many contributions and
 *   redemptions, worth how much, how many of them the NEXT publish would
 *   actually release (their dealing date already has a price) and how many are
 *   still waiting on the fund. Counts and values only — no member detail — so
 *   it is safe on a rollup surface.
 *
 *   Every figure is zero while fund_dealing_config.pricing_enabled is false.
 * @param {string} [fundCode]
 * @returns {Promise<Object>} shaped like EMPTY_PENDING_PRICING
 * @scope Admin only — 0155 revoked this from `authenticated` and added the
 *   app_role gate. (It read "Any signed-in role" until 2026-09-01, describing
 *   the 0147 grant that 0155 removed; a non-admin now gets the empty skeleton
 *   via the error path below rather than a payload.)
 * @cache ['pendingPricingSummary', fundCode] — invalidated by usePublishNav,
 *   because a publish is exactly what empties this queue.
 */
export async function getPendingPricingSummary(fundCode = DEFAULT_FUND) {
  if (!IS_SUPABASE_ENABLED) return { ...EMPTY_PENDING_PRICING, fundCode };
  const { data, error } = await supabase.rpc('get_pending_pricing_summary', { p_fund: fundCode });
  // The queue preview must never block the page that publishes prices — that
  // page is how the queue gets drained in the first place.
  if (error) return { ...EMPTY_PENDING_PRICING, fundCode };
  return { ...EMPTY_PENDING_PRICING, ...(data ?? {}) };
}

/** Safe skeleton with the RPC's exact keys, so no caller needs optional chaining. */
export const EMPTY_PENDING_PRICING = Object.freeze({
  fundCode: DEFAULT_FUND,
  pendingContributions: 0,
  pendingContributionValue: 0,
  pendingRedemptions: 0,
  pendingRedemptionValue: 0,
  releasableNow: 0,
  awaitingPrice: 0,
  oldestDealingDate: null,
  oldestPendingBusinessDays: 0,
  maxPendingDays: 3,
  pricingEnabled: false,
});

/**
 * @endpoint RPC forward_dealing_readiness(p_fund) — migration 0158.
 * @description Can forward dealing safely be switched on (or left on)? Six
 *   checks, read-only, flipping nothing. The one that matters most is the price
 *   register being current: turn the switch on while the fund is days behind and
 *   every new contribution joins a queue that cannot clear until somebody
 *   back-fills the gap, and members watch their money sit there. Publish first,
 *   flip second — this is what says whether that order has been honoured.
 *
 *   `blockers` are reasons not to be in this state at all; `warnings` are things
 *   that will bite later, chiefly the movable holidays (Eid is moon-sighted and
 *   cannot be computed, so it can only come from the gazette).
 * @param {string} [fundCode]
 * @returns {Promise<Object>} shaped like EMPTY_DEALING_READINESS
 * @scope Admin only — the RPC RAISEs P0001 for any other app_role.
 * @cache ['forwardDealingReadiness', fundCode] — invalidated by usePublishNav,
 *   because publishing is precisely what clears the unpriced-days blocker.
 */
export async function getForwardDealingReadiness(fundCode = DEFAULT_FUND) {
  if (!IS_SUPABASE_ENABLED) return { ...EMPTY_DEALING_READINESS, fundCode };
  const { data, error } = await supabase.rpc('forward_dealing_readiness', { p_fund: fundCode });
  // Deliberately NOT the swallow-the-error pattern getPendingPricingSummary
  // uses. That one is a nice-to-have preview on a page that must stay usable;
  // this one answers "is the fund in a safe state?", and a safety check that
  // fails silently is worse than no safety check — it reads as "all clear".
  // The caller surfaces the error instead.
  if (error) throw error;
  return { ...EMPTY_DEALING_READINESS, ...(data ?? {}) };
}

/**
 * Safe skeleton with the RPC's exact keys.
 *
 * `ready` defaults to FALSE. An unloaded or unavailable readiness report must
 * never render as "good to go" — the whole point of the check is that nobody
 * flips the switch on an assumption.
 */
export const EMPTY_DEALING_READINESS = Object.freeze({
  fundCode: DEFAULT_FUND,
  pricingEnabled: false,
  ready: false,
  blockers: Object.freeze([]),
  warnings: Object.freeze([]),
  unpricedBusinessDays: 0,
  oldestUnpricedDay: null,
  queuedTransactions: 0,
  membersHoldingInFlight: 0,
  calendarCoverTo: null,
  movableHolidaysNext12Months: 0,
  cutoffLocalTime: null,
  timezone: null,
});

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
 *   Re-publishing a date no longer DESTROYS the price it replaces: since 0145
 *   every version is kept in nav_snapshot_versions and `priceVersion` says
 *   which one this is (1 = first publish, 2+ = a correction). That matters
 *   because the superseded price is the one members' money was dealt at.
 * @returns {Promise<{id:string, navDate:string, unitPrice:number,
 *   previousUnitPrice:?number, changePct:?number, revalued:boolean,
 *   unitsInIssue:number, aum:number, membersPriced:number, priceVersion:number,
 *   releasedContributions:number, releasedRedemptions:number}>}
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
      priceVersion: 1, releasedContributions: 0, releasedRedemptions: 0,
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

/**
 * @endpoint RPC dealing_date_for(p_received_at, p_fund) — migration 0143.
 * @description The date on which money received AT A GIVEN INSTANT starts
 *   working: the same day if it arrives at or before the Kampala cutoff on a
 *   business day, otherwise the next business day. Weekends and Ugandan public
 *   holidays roll forward.
 *
 *   ⚠️ NEVER RE-DERIVE THIS IN JAVASCRIPT. The cutoff, the timezone and the
 *   holiday calendar all live in the database and are changeable without a
 *   redeploy; a second implementation here would be correct on the day it was
 *   written and silently wrong the first time an admin moved the cutoff or
 *   entered an Eid date. One derivation, server-side, no exceptions.
 *
 * @param {{receivedAt?: string|Date, fundCode?: string}} [opts] defaults to now
 * @returns {Promise<string|null>} `YYYY-MM-DD`, or null when unavailable
 * @scope Any signed-in role — an agent needs it at the point of sale.
 */
export async function getDealingDate(opts = {}) {
  const { receivedAt = new Date(), fundCode = DEFAULT_FUND } = opts;
  // Mock mode has no calendar; render nothing rather than invent a date.
  if (!IS_SUPABASE_ENABLED) return null;
  const { data, error } = await supabase.rpc('dealing_date_for', {
    p_received_at: receivedAt instanceof Date ? receivedAt.toISOString() : receivedAt,
    p_fund: fundCode,
  });
  // A missing calendar must never block taking a member's money — the note is
  // an explanation, not a gate. Swallow and render nothing.
  if (error) return null;
  return data ?? null;
}
