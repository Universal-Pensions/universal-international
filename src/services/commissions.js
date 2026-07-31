// Commission service — Supabase-backed with mock fallback under VITE_USE_SUPABASE=false.
//
// Phase 2 of the commission-flow simplification collapsed the lifecycle to two
// states: `due → paid`. Settlement is now a single distributor action
// (apply_settlement, migration 0031) that stamps an agent's `due` commissions
// `paid`, records a settlement_batches row (0030), and emits notifications.
//
// Reads delegate to the slimmed read RPCs (get_commission_summary,
// get_entity_commission_summary, get_agent_commission_detail re-emitted in
// 0029; get_agent_commission_list / get_pending_dues_by_agent /
// get_pending_dues_by_branch added in 0041). The 0041 trio folds server-side,
// so the per-agent/per-branch list reads no longer silently truncate at
// PostgREST's 1000-row default cap (the prior JS folds pulled every row to the
// browser and dropped any commission past row 1000 before the reduce). A direct
// SELECT now backs only the settlement-batches feed.
//
// Hook contracts in src/hooks/useCommission.js are preserved, so the React
// Query layer remains the source of caching.
//
// Rollback strategy: when IS_SUPABASE_ENABLED is false the file falls back to
// mockData-backed implementations. The legacy code lives below the Supabase
// wrappers as `_legacy_mock_*`.

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';
import { createCommissionSettledNotifications } from './notifications';
import {
  COMMISSIONS, COMMISSION_CONFIG,
  commissionsByAgent, commissionsByBranch,
  AGENTS, BRANCHES, DISTRICTS, SUBSCRIBERS,
  SETTLEMENT_BATCHES,
  MOCK_NOW,
} from '../data/mockData';

/* ─── Shared helpers ─────────────────────────────────────────────────────── */

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _rpcError(err, fnName) {
  const message = err?.message || `RPC ${fnName} failed`;
  const wrapped = new Error(message);
  wrapped.code = err?.code || 'rpc_error';
  wrapped.details = err?.details;
  wrapped.hint = err?.hint;
  return wrapped;
}

/** Map a snake_case DB commission row to the camelCase shape the UI expects. */
function _rowToCommission(row) {
  if (!row) return row;
  return {
    id: row.id,
    agentId: row.agent_id,
    branchId: row.branch_id,
    subscriberId: row.subscriber_id,
    subscriberName: row.subscriber_name,
    amount: Number(row.amount),
    status: row.status,
    firstContributionDate: row.first_contribution_date,
    dueDate: row.due_date,
    paidDate: row.paid_date,
    txnRef: row.txn_ref,
    paidAmount: row.paid_amount != null ? Number(row.paid_amount) : null,
  };
}

/* ─── 0041 aggregate-RPC row mappers ─────────────────────────────────────────
 * The three 0041 RPCs return RETURNS TABLE rowsets (so `data` is an ARRAY, not
 * an object — do NOT read `data.totalX`). Each mapper turns one snake_case row
 * into the exact camelCase shape the prior JS fold emitted, so the swap is a
 * pure data-source change with no UI-contract change. The defaults below mirror
 * the old folds (`|| 'Unknown'`, `|| ''`); the RPCs already COALESCE these, so
 * the defaults are belt-and-braces parity. */

/** get_agent_commission_list row → per-agent tally (mirrors commissions.js fold). */
function _rowToAgentTally(row) {
  return {
    agentId: row.agent_id,
    agentName: row.agent_name || 'Unknown',
    employeeId: row.employee_id || '',
    branchId: row.branch_id || '',
    branchName: row.branch_name || 'Unknown',
    totalCommissions: Number(row.total_commissions ?? 0),
    totalPaid: Number(row.total_paid ?? 0),
    totalDue: Number(row.total_due ?? 0),
    subscribersOnboarded: Number(row.subscribers_onboarded ?? 0),
    activeSubscribers: Number(row.active_subscribers ?? 0),
    filteredAmount: Number(row.filtered_amount ?? 0),
    filteredCount: Number(row.filtered_count ?? 0),
  };
}

/** get_pending_dues_by_agent row → per-agent pending-dues row. */
function _rowToAgentDues(row) {
  return {
    agentId: row.agent_id,
    agentName: row.agent_name || 'Unknown',
    employeeId: row.employee_id || '',
    branchId: row.branch_id || '',
    branchName: row.branch_name || 'Unknown',
    pendingAmount: Number(row.pending_amount ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
  };
}

/** get_pending_dues_by_branch row → per-branch pending-dues row. */
function _rowToBranchDues(row) {
  return {
    branchId: row.branch_id,
    branchName: row.branch_name || 'Unknown',
    pendingAmount: Number(row.pending_amount ?? 0),
    pendingCount: Number(row.pending_count ?? 0),
    agentCount: Number(row.agent_count ?? 0),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * COMMISSION RATE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @endpoint RPC get_commission_rate() — the CALLER'S OWN effective rate (0089).
 * @description Rates are per-distributor since 0089. This used to read
 *   `commission_config` directly at `id='default'`, which now returns the
 *   PLATFORM FALLBACK rather than the signed-in operator's rate — i.e. it would
 *   silently show the wrong number to any distributor that has set its own.
 *   The RPC resolves `distributorId` → that operator's row, falling back to the
 *   platform row for roles without the claim (admin, branch, agent).
 * @cache ['commissionRate']
 */
export async function getCommissionRate() {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getCommissionRate();
  const { data, error } = await supabase.rpc('get_commission_rate');
  if (error) throw _rpcError(error, 'getCommissionRate');
  return data != null ? Number(data) : 0;
}

/**
 * @endpoint RPC set_commission_rate(p_rate numeric)
 * @scope Distributor (its OWN rate) or admin (the platform fallback).
 * @description Routes the commission-rate write through a SECURITY DEFINER RPC
 *   (migration 0055) that range-checks the rate (0 ≤ rate ≤ 1,000,000 UGX)
 *   server-side. Replaces the prior unvalidated direct
 *   `commission_config.update({rate})` client write (audit §4a F-7) — a §7.3
 *   money-config direct-write with no bound check and no audit. The RPC stamps
 *   last_updated_by/updated_at and returns the persisted rate, so the hook
 *   contract is unchanged.
 *
 *   0089: rates are PER-DISTRIBUTOR. The RPC upserts the caller's own row, so a
 *   distributor can no longer change the rate another operator's commissions are
 *   generated at (the direct-UPDATE RLS grant that allowed that is dropped).
 *   Changing a rate is never retroactive — the amount is stamped onto the
 *   `commissions` row when it is generated on first contribution.
 */
export async function setCommissionRate(amount) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_setCommissionRate(amount);
  const { data, error } = await supabase.rpc('set_commission_rate', {
    p_rate: amount,
  });
  if (error) throw _rpcError(error, 'set_commission_rate');
  return data != null ? Number(data) : amount;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SUMMARIES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @endpoint RPC get_commission_summary(p_branch_id)
 * @scope Distributor: any. Branch: own branch (RLS-enforced).
 */
export async function getCommissionSummary(branchId = null) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getCommissionSummary(branchId);
  const { data, error } = await supabase.rpc('get_commission_summary', {
    p_branch_id: branchId,
  });
  if (error) throw _rpcError(error, 'get_commission_summary');
  const d = data || {};
  return {
    totalCommissions: Number(d.totalCommissions ?? 0),
    totalPaid: Number(d.totalPaid ?? 0),
    totalDue: Number(d.totalDue ?? 0),
    countTotal: Number(d.countTotal ?? 0),
    countPaid: Number(d.countPaid ?? 0),
    countDue: Number(d.countDue ?? 0),
  };
}

/**
 * @endpoint RPC get_entity_commission_summary(p_level, p_entity_id)
 * @cache ['entityCommissionSummary', level, entityId]
 */
export async function getEntityCommissionSummary(level, entityId) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getEntityCommissionSummary(level, entityId);
  const { data, error } = await supabase.rpc('get_entity_commission_summary', {
    p_level: level,
    p_entity_id: entityId ?? null,
  });
  if (error) throw _rpcError(error, 'get_entity_commission_summary');
  const d = data || {};
  return {
    totalPaid: Number(d.totalPaid ?? 0),
    totalDue: Number(d.totalDue ?? 0),
    countPaid: Number(d.countPaid ?? 0),
    countDue: Number(d.countDue ?? 0),
    total: Number(d.total ?? 0),
    countTotal: Number(d.countTotal ?? 0),
    settlementRate: Number(d.settlementRate ?? 0),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * AGENT / SUBSCRIBER LISTINGS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @endpoint RPC get_agent_commission_list(p_status_focus)
 * @description Per-agent commission tallies, folded SERVER-SIDE by the 0041 RPC
 *   (one round-trip, no 1000-row truncation — see file header). Replaces the
 *   prior client-side fold over an unbounded `commissions` SELECT. The RPC's
 *   arithmetic is the line-for-line equivalent of the old reduce (documented in
 *   0041_commission_aggregate_rpcs.sql); `filteredAmount`/`filteredCount`
 *   honour `p_status_focus` ('paid'→paid rows, 'due'→due rows, else all rows).
 * @param {('paid'|'due'|null)} statusFocus
 * @scope SECURITY DEFINER → the RPC BYPASSES RLS and folds the FULL network
 *   rowset for every caller (it does not branch on app_role), like the sibling
 *   0029 read RPCs. The distributor (the intended consumer) wants this; the
 *   branch view (CommissionPanel mounted in BranchDashboardShell) re-scopes the
 *   result CLIENT-SIDE by branchId. So branch/agent isolation moved from
 *   RLS-enforced (the old per-role SELECT) to client-side filtering — acceptable
 *   for the demo, but before real multi-tenant data an in-RPC app_role/branchId
 *   scope gate should be added (mirror commissions_select_branch; see the SCOPE
 *   caveat in 0041_commission_aggregate_rpcs.sql).
 * @cache ['agentCommissions', statusFocus || 'all']
 */
export async function getAgentCommissionList(statusFocus) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getAgentCommissionList(statusFocus);

  const { data, error } = await supabase.rpc('get_agent_commission_list', {
    p_status_focus: statusFocus ?? null,
  });
  if (error) throw _rpcError(error, 'get_agent_commission_list');
  // The RPC's HAVING COUNT(*) > 0 already drops zero-row agents, so the prior
  // `.filter(subscribersOnboarded > 0)` is intrinsically satisfied.
  return (data || []).map(_rowToAgentTally);
}

/**
 * @endpoint RPC get_agent_commission_detail(p_agent_id)
 * @cache ['agentCommissionDetail', agentId]
 */
export async function getAgentCommissionDetail(agentId) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getAgentCommissionDetail(agentId);
  const { data, error } = await supabase.rpc('get_agent_commission_detail', {
    p_agent_id: agentId,
  });
  if (error) throw _rpcError(error, 'get_agent_commission_detail');
  if (!data) return null;

  // The RPC already returns the per-line breakdown the UI consumes as
  // `paidTransactions` / `dueTransactions`; no consumer reads a separate raw
  // `commissions` array off this detail, so a second SELECT for those rows was
  // dead weight (one round-trip saved). If a caller ever needs the full raw set
  // here, prefer extending the RPC rather than reintroducing the extra query.
  return {
    ...data,
    totalCommissions: Number(data.totalCommissions ?? 0),
    totalPaid: Number(data.totalPaid ?? 0),
    totalDue: Number(data.totalDue ?? 0),
  };
}

/**
 * @endpoint SELECT subscribers (+ subscriber_balances) JOIN commissions WHERE agent_id = ?
 * @cache ['commissionSubscribers', agentId, filter]
 */
export async function getCommissionSubscribers(agentId, filter) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getCommissionSubscribers(agentId, filter);

  const [{ data: commissions, error: cErr }, { data: subscribers, error: sErr }] = await Promise.all([
    supabase.from('commissions').select('subscriber_id, subscriber_name, status, first_contribution_date').eq('agent_id', agentId),
    // `total_contributions` is NOT a column on `subscribers` — it lived on the
    // retired `employees` table (dropped in migration 0045). Selecting it 400s
    // (PostgREST 42703, "column does not exist"), which threw here and broke the
    // distributor/branch commission → agent → subscribers drill on real data.
    // The per-subscriber contribution figure the drill renders is sourced from
    // `subscriber_balances.total_balance` — the same proxy agent.js / subscriber.js
    // use (there is no per-subscriber lifetime-contributions denorm column).
    supabase.from('subscribers').select('id, name, registered_date, is_active, subscriber_balances(total_balance)').eq('agent_id', agentId),
  ]);
  if (cErr) throw _rpcError(cErr, 'getCommissionSubscribers:commissions');
  if (sErr) throw _rpcError(sErr, 'getCommissionSubscribers:subscribers');

  const subMap = new Map((subscribers || []).map((s) => [s.id, s]));
  const rows = commissions || [];

  return rows.map((c) => {
    const sub = subMap.get(c.subscriber_id) || {};
    // PostgREST returns the embedded resource as an array (to-many shape) or an
    // object; normalise to the single balance row, mirroring agent.js/subscriber.js.
    const bal = Array.isArray(sub.subscriber_balances)
      ? sub.subscriber_balances[0]
      : sub.subscriber_balances;
    return {
      subscriberId: c.subscriber_id,
      subscriberName: c.subscriber_name || sub.name || 'Unknown',
      registeredDate: sub.registered_date || c.first_contribution_date,
      lastContribution: 0,           // not surfaced by current schema; left at 0 for backwards-compat
      lastContributionDate: '',      // ditto — CommissionPanel hides the "Last:" line when empty (BL-36)
      totalContributions: Number(bal?.total_balance ?? 0),
      isActive: !!sub.is_active,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PENDING DUES — settlement-prep reads
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @endpoint RPC get_pending_dues_by_agent()
 * @description Per-agent DUE-only tallies, folded SERVER-SIDE by the 0041 RPC
 *   (replaces the prior client-side fold over a `.eq('status','due')` SELECT —
 *   no 1000-row truncation). The RPC returns only agents with pendingCount > 0
 *   (HAVING COUNT(*) > 0) already ordered by pendingAmount DESC, so the prior
 *   JS filter + sort are intrinsic to the rowset.
 * @returns {Promise<Array<{agentId, agentName, employeeId, branchId, branchName,
 *   pendingAmount, pendingCount}>>} sorted by pendingAmount desc.
 * @cache ['pendingDuesByAgent']
 */
export async function getPendingDuesByAgent() {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getPendingDuesByAgent();

  const { data, error } = await supabase.rpc('get_pending_dues_by_agent');
  if (error) throw _rpcError(error, 'get_pending_dues_by_agent');
  return (data || []).map(_rowToAgentDues);
}

/**
 * @endpoint RPC get_pending_dues_by_branch()
 * @description Per-branch DUE-only tallies, folded SERVER-SIDE by the 0041 RPC
 *   (replaces the prior client-side fold — no 1000-row truncation). Grouping is
 *   on the COMMISSION's branch_id (faithful to the old JS, which keyed on
 *   `row.branch_id`, NOT the agent's branch). `agentCount` is COUNT(DISTINCT
 *   agent_id). The RPC returns only branches with pendingCount > 0, ordered by
 *   pendingAmount DESC.
 * @returns {Promise<Array<{branchId, branchName, pendingAmount, pendingCount,
 *   agentCount}>>} sorted by pendingAmount desc.
 * @cache ['pendingDuesByBranch']
 */
export async function getPendingDuesByBranch() {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_getPendingDuesByBranch();

  const { data, error } = await supabase.rpc('get_pending_dues_by_branch');
  if (error) throw _rpcError(error, 'get_pending_dues_by_branch');
  return (data || []).map(_rowToBranchDues);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * SETTLEMENT — write + batches feed
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @endpoint RPC apply_settlement(p_rows jsonb, p_nonce text)
 * @scope Distributor only.
 * @description Stamps each agent's `due` commissions `paid` FIFO (oldest-first)
 *   up to the entered Amount Paid, records a `settlement_batches` row, and emits
 *   notifications. INFORM-NOT-BLOCK partial semantics: when the entered amount
 *   is less than the agent's due total, only the lines the amount fully covers
 *   are settled — the remainder stays genuinely `due` (BL-1/BL-2). `paid_amount`
 *   is allocated per line (the line's own amount), so summing per-line
 *   `paid_amount` reconciles with `settlement_batches.paid_amount`.
 * @param {{ rows: Array<{agentId, amountPaid, paymentRef, paymentDate}>, nonce?: string }} params
 *   `nonce` is a per-upload idempotency key (BL-13) — a re-submit / reload /
 *   second-tab replay with the same nonce returns the original result without
 *   re-recording batches or re-notifying.
 * @returns {Promise<{agentsSettled, linesSettled, totalPaid,
 *   skipped: Array<{agentId, reason}>}>}
 */
export async function applySettlementUpload({ rows, nonce } = {}) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_applySettlementUpload(rows, nonce);
  // 'Payment Date' is an optional fill-me column (see SETTLEMENT_TEMPLATE_COLUMNS
  // — only Agent ID + Amount Paid are required), and `coerceDate` represents
  // "blank" as ''. Sent as-is that reaches the RPC as `""` and Postgres throws
  // `invalid input syntax for type date: ""` on the `::date` cast — BEFORE the
  // RPC's own `COALESCE(..., current_date)` can default it. So a distributor who
  // left the date blank had the whole settlement rejected with a raw driver error.
  // Send null and let the RPC apply its intended default. The mock branch already
  // did the equivalent (`row.paymentDate || today`); this brings the live branch
  // in line so both behave the same.
  const p_rows = (rows ?? []).map((row) => ({
    ...row,
    paymentDate: row?.paymentDate ? row.paymentDate : null,
  }));
  const { data, error } = await supabase.rpc('apply_settlement', {
    p_rows,
    p_nonce: nonce ?? null,
  });
  if (error) throw _rpcError(error, 'apply_settlement');
  return data;
}

/**
 * @endpoint SELECT settlement_batches (+ agent/branch names), newest first.
 * @param {{ limit?: number, branchId?: string, agentId?: string }} [opts]
 *   `agentId` narrows the feed to a single agent's batches. In LIVE mode RLS
 *   already scopes `settlement_batches` to the caller, but this explicit filter
 *   also lets the agent page surface only its OWN batches in MOCK mode (where
 *   there is no RLS) — see `_legacy_mock_listSettlements`.
 * @returns {Promise<Array<{id, agentId, agentName, branchId, branchName,
 *   pendingTotal, paidAmount, txnRef, paidDate, lineCount, createdAt}>>}
 * @cache ['settlementsList', branchId, agentId, limit]
 */
export async function listSettlements({ limit, branchId, agentId } = {}) {
  if (!IS_SUPABASE_ENABLED) return _legacy_mock_listSettlements({ limit, branchId, agentId });

  let q = supabase
    .from('settlement_batches')
    .select('id, agent_id, branch_id, pending_total, paid_amount, txn_ref, paid_date, line_count, created_at')
    .order('created_at', { ascending: false });
  if (branchId) q = q.eq('branch_id', branchId);
  if (agentId) q = q.eq('agent_id', agentId);
  if (typeof limit === 'number') q = q.limit(limit);
  const { data: batches, error: bErr } = await q;
  if (bErr) throw _rpcError(bErr, 'listSettlements:batches');
  if (!batches || batches.length === 0) return [];

  const agentIds = Array.from(new Set(batches.map((b) => b.agent_id).filter(Boolean)));
  const branchIds = Array.from(new Set(batches.map((b) => b.branch_id).filter(Boolean)));
  const [{ data: agents, error: aErr }, { data: branches, error: brErr }] = await Promise.all([
    agentIds.length
      ? supabase.from('agents').select('id, name').in('id', agentIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length
      ? supabase.from('branches').select('id, name').in('id', branchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (aErr) throw _rpcError(aErr, 'listSettlements:agents');
  if (brErr) throw _rpcError(brErr, 'listSettlements:branches');

  const agentMap = new Map((agents || []).map((a) => [a.id, a]));
  const branchMap = new Map((branches || []).map((b) => [b.id, b]));

  return batches.map((b) => ({
    id: b.id,
    agentId: b.agent_id,
    agentName: agentMap.get(b.agent_id)?.name || 'Unknown',
    branchId: b.branch_id,
    branchName: branchMap.get(b.branch_id)?.name || 'Unknown',
    pendingTotal: Number(b.pending_total ?? 0),
    paidAmount: Number(b.paid_amount ?? 0),
    txnRef: b.txn_ref,
    paidDate: b.paid_date,
    lineCount: Number(b.line_count ?? 0),
    createdAt: b.created_at,
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LEGACY MOCK IMPLEMENTATIONS — used under IS_SUPABASE_ENABLED=false
 * ═══════════════════════════════════════════════════════════════════════════ */

// Session-mutable settlement batches store: clone the seed so settlements
// persist for the session without freezing/mutating the shared mockData export.
const _mockBatches = (SETTLEMENT_BATCHES || []).map((b) => ({ ...b }));

// Idempotency ledger (BL-13): per-upload nonce → the result returned the first
// time it was processed. A SEQUENTIAL re-submit / reload / second-tab replay
// with the same nonce returns the original result without re-recording batches
// or notifying. Mirrors the server-side settlement_uploads ledger added in
// migration 0032 — which likewise covers the sequential-replay case; true
// concurrency on the server is handled by the FOR UPDATE row lock on the due
// lines, not the ledger (n/a here: this mock branch is single-threaded JS).
const _mockSettlementNonces = new Map();

function _legacy_mock_getCommissionRate() {
  return Promise.resolve(COMMISSION_CONFIG.ratePerSubscriber);
}

function _legacy_mock_setCommissionRate(amount) {
  COMMISSION_CONFIG.ratePerSubscriber = amount;
  return Promise.resolve(amount);
}

function _legacy_mock_getCommissionSummary(branchId = null) {
  const all = branchId
    ? (commissionsByBranch[branchId] || [])
    : Object.values(COMMISSIONS);
  const totalCommissions = all.reduce((sum, c) => sum + c.amount, 0);
  const paid = all.filter((c) => c.status === 'paid');
  const due = all.filter((c) => c.status === 'due');
  return Promise.resolve({
    totalCommissions,
    totalPaid: paid.reduce((s, c) => s + c.amount, 0),
    totalDue: due.reduce((s, c) => s + c.amount, 0),
    countTotal: all.length,
    countPaid: paid.length,
    countDue: due.length,
  });
}

function _legacy_mock_getAgentCommissionList(statusFocus) {
  const agentIds = Object.keys(commissionsByAgent);
  return Promise.resolve(
    agentIds
      .map((agentId) => {
        const agent = AGENTS[agentId];
        const branch = BRANCHES[agent?.parentId];
        const comms = commissionsByAgent[agentId] || [];
        let filtered = comms;
        if (statusFocus === 'paid') filtered = comms.filter((c) => c.status === 'paid');
        else if (statusFocus === 'due') filtered = comms.filter((c) => c.status === 'due');
        const totalAmount = comms.reduce((s, c) => s + c.amount, 0);
        const paidAmount = comms.filter((c) => c.status === 'paid').reduce((s, c) => s + c.amount, 0);
        const dueAmount = comms.filter((c) => c.status === 'due').reduce((s, c) => s + c.amount, 0);
        return {
          agentId,
          agentName: agent?.name || 'Unknown',
          employeeId: agent?.employeeId || '',
          branchId: agent?.parentId || '',
          branchName: branch?.name || 'Unknown',
          totalCommissions: totalAmount,
          totalPaid: paidAmount,
          totalDue: dueAmount,
          subscribersOnboarded: comms.length,
          activeSubscribers: comms.length,
          filteredAmount: filtered.reduce((s, c) => s + c.amount, 0),
          filteredCount: filtered.length,
        };
      })
      .filter((a) => a.subscribersOnboarded > 0)
  );
}

function _legacy_mock_getAgentCommissionDetail(agentId) {
  const agent = AGENTS[agentId];
  const branch = BRANCHES[agent?.parentId];
  const comms = commissionsByAgent[agentId] || [];
  const paid = comms.filter((c) => c.status === 'paid');
  const due = comms.filter((c) => c.status === 'due');
  return Promise.resolve({
    agentId,
    agentName: agent?.name || 'Unknown',
    employeeId: agent?.employeeId || '',
    agentPhone: agent?.phone || '',
    branchId: agent?.parentId || '',
    branchName: branch?.name || 'Unknown',
    rating: agent?.rating || 0,
    totalCommissions: comms.reduce((s, c) => s + c.amount, 0),
    totalPaid: paid.reduce((s, c) => s + c.amount, 0),
    totalDue: due.reduce((s, c) => s + c.amount, 0),
    subscribersOnboarded: comms.length,
    activeSubscribers: comms.length,
    dormantSubscribers: 0,
    paidTransactions: paid.map((c) => ({
      id: c.id,
      transactionDate: c.paidDate,
      amount: c.amount,
      paidAmount: c.paidAmount,
      status: c.status,
      txnRef: c.txnRef,
      subscriberId: c.subscriberId,
      subscriberName: c.subscriberName,
    })),
    dueTransactions: due.map((c) => {
      const dueDate = new Date(c.dueDate);
      const daysToDate = Math.ceil((dueDate - MOCK_NOW) / 86400000);
      return {
        id: c.id,
        dueDate: c.dueDate,
        daysToDate,
        amount: c.amount,
        status: c.status,
        branchId: c.branchId,
        branchName: branch?.name || 'Unknown',
        subscriberId: c.subscriberId,
        subscriberName: c.subscriberName,
      };
    }),
    commissions: comms,
  });
}

function _legacy_mock_getCommissionSubscribers(agentId, filter) {
  const comms = commissionsByAgent[agentId] || [];
  let filtered = comms;
  if (filter === 'active' || filter === 'dormant') {
    // No dormant concept survives the collapse; both filters return the full set.
    filtered = comms;
  }
  return Promise.resolve(
    filtered.map((c) => {
      const sub = SUBSCRIBERS[c.subscriberId];
      return {
        subscriberId: c.subscriberId,
        subscriberName: c.subscriberName,
        registeredDate: sub?.registeredDate || c.firstContributionDate,
        lastContribution: sub ? sub.contributionHistory[sub.contributionHistory.length - 1] : 0,
        lastContributionDate: sub
          ? `2026-03-${String(Math.min(28, parseInt(sub.registeredDate.split('-')[2]) + 5)).padStart(2, '0')}`
          : '',
        totalContributions: sub?.totalContributions || 0,
        isActive: sub?.isActive || false,
      };
    })
  );
}

function _legacy_mock_getPendingDuesByAgent() {
  const result = [];
  for (const agentId of Object.keys(commissionsByAgent)) {
    const due = (commissionsByAgent[agentId] || []).filter((c) => c.status === 'due');
    if (due.length === 0) continue;
    const agent = AGENTS[agentId];
    const branch = BRANCHES[agent?.parentId];
    result.push({
      agentId,
      agentName: agent?.name || 'Unknown',
      employeeId: agent?.employeeId || '',
      branchId: agent?.parentId || '',
      branchName: branch?.name || 'Unknown',
      pendingAmount: due.reduce((s, c) => s + c.amount, 0),
      pendingCount: due.length,
    });
  }
  return Promise.resolve(result.sort((a, b) => b.pendingAmount - a.pendingAmount));
}

function _legacy_mock_getPendingDuesByBranch() {
  const result = [];
  for (const branchId of Object.keys(commissionsByBranch)) {
    const due = (commissionsByBranch[branchId] || []).filter((c) => c.status === 'due');
    if (due.length === 0) continue;
    const agents = new Set(due.map((c) => c.agentId).filter(Boolean));
    const branch = BRANCHES[branchId];
    result.push({
      branchId,
      branchName: branch?.name || 'Unknown',
      pendingAmount: due.reduce((s, c) => s + c.amount, 0),
      pendingCount: due.length,
      agentCount: agents.size,
    });
  }
  return Promise.resolve(result.sort((a, b) => b.pendingAmount - a.pendingAmount));
}

function _legacy_mock_applySettlementUpload(rows, nonce) {
  // Idempotency short-circuit (BL-13): replay the prior result for a seen nonce.
  if (nonce != null && nonce !== '' && _mockSettlementNonces.has(nonce)) {
    return Promise.resolve(_mockSettlementNonces.get(nonce));
  }

  const today = fmtDate(MOCK_NOW);
  const skipped = [];
  let agentsSettled = 0;
  let linesSettled = 0;
  let totalPaid = 0;

  for (const row of rows || []) {
    const agentId = row?.agentId;
    if (!agentId) {
      skipped.push({ agentId: agentId ?? null, reason: 'missing_agent_id' });
      continue;
    }
    const dueLines = (commissionsByAgent[agentId] || []).filter((c) => c.status === 'due');
    if (dueLines.length === 0) {
      skipped.push({ agentId, reason: 'no_due' });
      continue;
    }

    // Round to whole UGX at the boundary (BL-8) — defence-in-depth even though
    // the upload normalizer already rounds via the canonical parseAmount.
    const amountPaid = Math.round(Number(row.amountPaid ?? 0));
    const paymentRef = row.paymentRef ?? null;
    const paidDate = row.paymentDate || today;
    const pendingTotal = dueLines.reduce((s, c) => s + c.amount, 0);

    // FIFO allocation (BL-1/BL-2): settle the oldest due lines first, stamping
    // each settled line with its OWN amount as paid_amount (not the batch
    // total). When the entered amount can't cover the next line in full, stop —
    // the remaining lines stay genuinely `due` (INFORM-NOT-BLOCK: a partial
    // payment settles only what it covers; it does NOT clear unpaid lines).
    //
    // >>> PRODUCT-OWNER DECISION (confirmed 2026-05-31) <<<
    // FIFO inform-not-block is CONFIRMED: settle the oldest due lines fully
    // covered by the paid amount; uncovered lines stay Outstanding; the agent
    // is informed via the partial-settlement banner + a support mailto (no hard
    // block). This is the settled semantics — keep this FIFO loop as-is.
    // (If this is ever reversed to "any payment clears ALL the agent's due
    // lines" / all-or-nothing per agent, replace this loop with: settle every
    // line in `ordered`, set settledTotal = pendingTotal. One-line change here
    // + the matching branch in migration 0032's apply_settlement.)
    const ordered = [...dueLines].sort((a, b) => {
      const da = a.dueDate || '';
      const db = b.dueDate || '';
      if (da !== db) return da.localeCompare(db);
      return (a.id || '').localeCompare(b.id || '');
    });

    let remaining = amountPaid;
    let settledCount = 0;
    let settledTotal = 0;
    for (const c of ordered) {
      if (remaining < c.amount) break; // can't cover this line in full — leave it due
      c.status = 'paid';
      c.paidDate = paidDate;
      c.txnRef = paymentRef;
      c.paidAmount = c.amount; // per-line own amount, reconciles with the batch
      remaining -= c.amount;
      settledCount += 1;
      settledTotal += c.amount;
    }

    // The entered amount covered no full line (e.g. paid < the cheapest due
    // line): nothing settles, surface it as a skip so the distributor sees why.
    if (settledCount === 0) {
      skipped.push({ agentId, reason: 'amount_too_low' });
      continue;
    }

    // Record the settlement batch in the session-mutable store. paid_amount is
    // the actually-allocated total (= sum of settled lines), so it reconciles
    // with SUM(paid_amount) across the settled commission lines.
    const branchId = AGENTS[agentId]?.parentId || null;
    const batchId = `sb-${MOCK_NOW.getFullYear()}-${Date.now().toString(36)}-${agentId}`;
    _mockBatches.unshift({
      id: batchId,
      agentId,
      branchId,
      pendingTotal,
      paidAmount: settledTotal,
      txnRef: paymentRef,
      paidDate,
      lineCount: settledCount,
      createdAt: new Date().toISOString(),
    });

    // Emit the "Commission settled" in-app notifications for the agent (and
    // their branch, if any). Mirrors the apply_settlement RPC's server-side
    // INSERTs; in mock mode the notifications service stores them in-memory.
    createCommissionSettledNotifications({
      agentId,
      branchId,
      amount: settledTotal,
      lineCount: settledCount,
      refId: batchId,
    });

    agentsSettled += 1;
    linesSettled += settledCount;
    totalPaid += settledTotal;
  }

  const result = { agentsSettled, linesSettled, totalPaid, skipped };
  if (nonce != null && nonce !== '') _mockSettlementNonces.set(nonce, result);
  return Promise.resolve(result);
}

function _legacy_mock_listSettlements({ limit, branchId, agentId } = {}) {
  let pool = _mockBatches;
  if (branchId) pool = pool.filter((b) => b.branchId === branchId);
  // No RLS in mock mode, so honor an explicit agentId filter — without it the
  // agent CommissionsPage (which has no branch scope) would otherwise see every
  // agent's batches and could surface another agent's partial-settlement
  // mismatch banner. LIVE mode relies on RLS; this keeps mock mode equivalent.
  if (agentId) pool = pool.filter((b) => b.agentId === agentId);
  const sorted = [...pool].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const sliced = typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
  return Promise.resolve(
    sliced.map((b) => {
      const agent = AGENTS[b.agentId];
      const branch = BRANCHES[b.branchId];
      return {
        id: b.id,
        agentId: b.agentId,
        agentName: agent?.name || 'Unknown',
        branchId: b.branchId,
        branchName: branch?.name || 'Unknown',
        pendingTotal: b.pendingTotal,
        paidAmount: b.paidAmount,
        txnRef: b.txnRef,
        paidDate: b.paidDate,
        lineCount: b.lineCount,
        createdAt: b.createdAt,
      };
    })
  );
}

function _legacyAggregateRecords(records) {
  let totalPaid = 0, totalDue = 0;
  let countPaid = 0, countDue = 0;
  for (const c of records) {
    if (c.status === 'paid') { totalPaid += c.amount; countPaid++; }
    else if (c.status === 'due') { totalDue += c.amount; countDue++; }
  }
  const countTotal = countPaid + countDue;
  return {
    totalPaid, totalDue,
    countPaid, countDue,
    total: totalPaid + totalDue,
    countTotal,
    settlementRate: countTotal > 0 ? Math.round((countPaid / countTotal) * 100) : 0,
  };
}

function _legacy_mock_getEntityCommissionSummary(level, entityId) {
  if (level === 'agent') {
    return Promise.resolve(_legacyAggregateRecords(commissionsByAgent[entityId] || []));
  }
  if (level === 'branch') {
    return Promise.resolve(_legacyAggregateRecords(commissionsByBranch[entityId] || []));
  }
  if (level === 'district') {
    const records = Object.values(BRANCHES)
      .filter((b) => b.parentId === entityId)
      .flatMap((b) => commissionsByBranch[b.id] || []);
    return Promise.resolve(_legacyAggregateRecords(records));
  }
  if (level === 'region') {
    const districtIds = new Set(
      Object.values(DISTRICTS).filter((d) => d.parentId === entityId).map((d) => d.id)
    );
    const records = Object.values(BRANCHES)
      .filter((b) => districtIds.has(b.parentId))
      .flatMap((b) => commissionsByBranch[b.id] || []);
    return Promise.resolve(_legacyAggregateRecords(records));
  }
  return Promise.resolve(_legacyAggregateRecords(Object.values(COMMISSIONS)));
}
