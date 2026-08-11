// Notifications service — Supabase-backed with mock fallback under VITE_USE_SUPABASE=false.
//
// Phase 3 of the commission-flow simplification. Surfaces the `notifications`
// feed (migration 0031): an agent / branch receives a "Commission settled"
// in-app notification when a distributor uploads a settlement.
//
// Dual-mode shape mirrors the sibling services:
//   * Supabase ON  — reads SELECT against the `notifications` table (RLS scopes
//     each role to its own feed; the explicit recipient filters keep the query
//     correct + cheap) and marks-read via the `mark_notifications_read` RPC.
//     Settlement notifications are inserted SERVER-SIDE by the `apply_settlement`
//     RPC, so `createCommissionSettledNotifications` is a NO-OP here.
//   * Supabase OFF — an in-memory session store seeded from a clone of
//     mockData's NOTIFICATIONS export, mirroring tickets.js. Settlement
//     notifications are created client-side by `createCommissionSettledNotifications`
//     (wired from commissions.js `_legacy_mock_applySettlementUpload`).
//
// Rollback parity with commissions.js: errors from supabase-js are wrapped so
// callers get a uniform Error with code/details/hint.

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';
import { NOTIFICATIONS, currentTime } from '../data/mockData';
import { formatSettlementNotificationBody } from '../utils/settlement';

/* ─── In-memory session store ─────────────────────────────────────────────────
 * Shallow-clone each seed row so the frozen mockData export is never mutated and
 * every value in the store is independently writable. Kept newest-first to match
 * the order the feed renders in. The module has no side effects beyond this. */
let _store = NOTIFICATIONS.map((n) => ({ ...n })).sort(byCreatedDesc);

/** Newest-created first — the order an inbox/feed renders in. */
function byCreatedDesc(a, b) {
  return (b.createdAt || '').localeCompare(a.createdAt || '');
}

/* ─── Shared helpers ─────────────────────────────────────────────────────── */

/**
 * Relative-time anchor for the feed's "3d"/"2w" labels. Components never import
 * the mock store (CLAUDE.md §4.1), so the service supplies the clock: in mock
 * mode the seeded `createdAt`s are anchored to MOCK_NOW, so labels must compute
 * against `currentTime()` to stay stable; in Supabase mode the `createdAt`s are
 * real wall-clock instants, so we return `undefined` and `formatRelativeTime`
 * falls back to the live wall clock (BL-37).
 */
function _mockNowAnchor() {
  return IS_SUPABASE_ENABLED ? undefined : currentTime().toISOString();
}

function _rpcError(err, fnName) {
  const message = err?.message || `RPC ${fnName} failed`;
  const wrapped = new Error(message);
  wrapped.code = err?.code || 'rpc_error';
  wrapped.details = err?.details;
  wrapped.hint = err?.hint;
  return wrapped;
}

/** Map a snake_case DB notification row to the camelCase shape the UI expects. */
function _rowToNotification(row) {
  if (!row) return row;
  return {
    id: row.id,
    recipientRole: row.recipient_role,
    recipientId: row.recipient_id,
    type: row.type,
    title: row.title,
    body: row.body,
    amount: row.amount != null ? Number(row.amount) : null,
    refId: row.ref_id,
    isRead: !!row.is_read,
    createdAt: row.created_at,
  };
}

/* ─── Reads ───────────────────────────────────────────────────────────────── */

/**
 * List one recipient's notifications, newest-first.
 * @param {{ role: string, entityId: string, unreadOnly?: boolean }} params
 * @returns {Promise<object[]>} Notification[]
 */
export async function listNotifications({ role, entityId, unreadOnly = false }) {
  // '*' means "every recipient at this role" — the admin case. Ops-queue
  // notifications are addressed to a queue (ops-treasury, ops-claims, …) rather
  // than to a person, so filtering on the caller's own id would return nothing.
  // Safe because RLS still scopes the read: notifications_select_admin (0049)
  // only matches when the caller's app_role is 'admin'.
  const allRecipients = entityId === '*';

  if (IS_SUPABASE_ENABLED) {
    let q = supabase
      .from('notifications')
      .select('*')
      .eq('recipient_role', role);
    if (!allRecipients) q = q.eq('recipient_id', entityId);
    if (unreadOnly) q = q.eq('is_read', false);
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw _rpcError(error, 'listNotifications');
    // No nowAnchor in live mode — real createdAts are wall-clock instants, so
    // formatRelativeTime's default (wall clock) is correct (BL-37).
    return (data || []).map(_rowToNotification);
  }

  // Stamp the mock clock so the feed's relative-time labels stay anchored to
  // MOCK_NOW instead of drifting against the real wall clock (BL-37).
  const nowAnchor = _mockNowAnchor();
  return _store
    .filter(
      (n) =>
        n.recipientRole === role &&
        (allRecipients || n.recipientId === entityId) &&
        (!unreadOnly || !n.isRead),
    )
    .sort(byCreatedDesc)
    .map((n) => ({ ...n, nowAnchor }));
}

/**
 * Count one recipient's unread notifications.
 * @param {{ role: string, entityId: string }} params
 * @returns {Promise<number>}
 */
export async function getUnreadCount({ role, entityId }) {
  const allRecipients = entityId === '*';   // see listNotifications

  if (IS_SUPABASE_ENABLED) {
    let q = supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_role', role)
      .eq('is_read', false);
    if (!allRecipients) q = q.eq('recipient_id', entityId);
    const { count, error } = await q;
    if (error) throw _rpcError(error, 'getUnreadCount');
    return count ?? 0;
  }

  return _store.filter(
    (n) => n.recipientRole === role
      && (allRecipients || n.recipientId === entityId)
      && !n.isRead,
  ).length;
}

/* ─── Mutations ───────────────────────────────────────────────────────────── */

/**
 * Mark a recipient's notifications read. When `ids` is omitted, every unread
 * notification belonging to the recipient is marked.
 *
 * Two round-trips in Supabase mode are REQUIRED here, not an oversight: the
 * `mark_notifications_read(p_ids text[])` RPC only accepts an explicit id list
 * (it has no "mark all unread for the caller" mode), and the `notifications`
 * table has no UPDATE RLS policy (writes must flow through the SECURITY DEFINER
 * RPC — CLAUDE.md §5/§7), so a single client-side `UPDATE ... WHERE` is not an
 * option. We therefore gather the recipient's unread ids first when none were
 * supplied, then hand them to the RPC. Collapsing this to one call needs an RPC
 * change (add a recipient-scoped "mark all" path) — out of scope this wave.
 * @param {{ role: string, entityId: string, ids?: string[] }} params
 * @returns {Promise<void>}
 */
export async function markNotificationsRead({ role, entityId, ids }) {
  if (IS_SUPABASE_ENABLED) {
    let targetIds = ids;
    if (!targetIds?.length) {
      const { data, error } = await supabase
        .from('notifications')
        .select('id')
        .eq('recipient_role', role)
        .eq('recipient_id', entityId)
        .eq('is_read', false);
      if (error) throw _rpcError(error, 'markNotificationsRead:gather');
      targetIds = (data || []).map((r) => r.id);
    }
    if (!targetIds.length) return;
    const { error } = await supabase.rpc('mark_notifications_read', { p_ids: targetIds });
    if (error) throw _rpcError(error, 'mark_notifications_read');
    return;
  }

  // Mock: flip isRead on the recipient's matching rows (constrained to `ids`
  // when provided, otherwise every one of the recipient's unread rows).
  const idSet = ids?.length ? new Set(ids) : null;
  _store = _store.map((n) => {
    if (
      n.recipientRole === role &&
      n.recipientId === entityId &&
      !n.isRead &&
      (!idSet || idSet.has(n.id))
    ) {
      return { ...n, isRead: true };
    }
    return n;
  });
}

/* ─── Settlement notification creation (mock-mode only) ─────────────────────── */

let _ntfSeq = 0;
/** Mint a unique ntf-mock-<n> id (no Date.now() collisions within a batch). */
function nextNotificationId() {
  _ntfSeq += 1;
  return `ntf-mock-${_ntfSeq}`;
}

/**
 * Create + store the "Commission settled" notifications for a settled agent and
 * (if any) their branch. MOCK MODE ONLY — in Supabase mode this is a NO-OP that
 * returns `[]` because the `apply_settlement` RPC already inserted them.
 *
 * @param {{ agentId: string, branchId?: string|null, amount: number,
 *   lineCount: number, refId: string }} params
 * @returns {object[]} the created Notification[] (empty in Supabase mode)
 */
export function createCommissionSettledNotifications({ agentId, branchId, amount, lineCount, refId }) {
  if (IS_SUPABASE_ENABLED) return [];

  const createdAt = new Date().toISOString();
  // Round to whole UGX + format with thousands separators and correct
  // pluralization (BL-8 / BL-18); mirrors the RPC's server-side body builder.
  const settledAmount = Math.round(Number(amount) || 0);
  const body = formatSettlementNotificationBody(settledAmount, lineCount);
  const created = [];

  created.push({
    id: nextNotificationId(),
    recipientRole: 'agent',
    recipientId: agentId,
    type: 'commission_settled',
    title: 'Commission settled',
    body,
    amount: settledAmount,
    refId,
    isRead: false,
    createdAt,
  });

  if (branchId) {
    created.push({
      id: nextNotificationId(),
      recipientRole: 'branch',
      recipientId: branchId,
      type: 'commission_settled',
      title: 'Commission settled',
      body,
      amount: settledAmount,
      refId,
      isRead: false,
      createdAt,
    });
  }

  // unshift so the freshest notifications lead the newest-first store.
  _store.unshift(...created);
  return created;
}

/**
 * Admin → stakeholder in-app notification, sent from a Needs-attention
 * drill-down (migration 0097 `admin_notify`).
 *
 * Recipients are validated server-side: entity roles must reference a real
 * agent/branch/distributor/employer row, and `admin` is only accepted with one
 * of the fixed internal ops-queue ids. `subscriber` is rejected — the subscriber
 * dashboard reads a different feed component, so such a row would be written but
 * never seen.
 *
 * DEMO SCOPE (CLAUDE.md §10a): this delivers an in-app notification only. There
 * is no SMS or email provider behind it and none should be added.
 *
 * @param {Object} params
 * @param {'agent'|'branch'|'distributor'|'employer'|'admin'} params.recipientRole
 * @param {string} params.recipientId Entity id, or an ops-queue id for `admin`.
 * @param {string} params.type Attention signal id (whitelisted by the RPC).
 * @param {string} params.title Capped at 200 chars server-side.
 * @param {string} params.body Capped at 1000 chars server-side.
 * @param {string} [params.refId] The row this was raised against.
 * @param {number} [params.amount]
 * @returns {Promise<object>} The created Notification.
 */
export async function sendAdminNotification({
  recipientRole, recipientId, type, title, body, refId = null, amount = null,
}) {
  if (IS_SUPABASE_ENABLED) {
    const { data, error } = await supabase.rpc('admin_notify', {
      p_recipient_role: recipientRole,
      p_recipient_id: recipientId,
      p_type: type,
      p_title: title,
      p_body: body,
      p_ref_id: refId,
      p_amount: amount,
    });
    if (error) throw _rpcError(error, 'admin_notify');
    return data;
  }

  // Rollback path: mirror the RPC's shape into the in-memory store so the bell
  // and the drill-down behave identically with Supabase disabled.
  const created = {
    id: nextNotificationId(),
    recipientRole,
    recipientId,
    type,
    title: String(title || '').slice(0, 200),
    body: String(body || '').slice(0, 1000),
    amount,
    refId,
    isRead: false,
    createdAt: currentTime().toISOString(),
  };
  _store.unshift(created);
  return created;
}
