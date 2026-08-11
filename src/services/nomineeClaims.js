// Admin-side nominee-claims service. Reads and triages the death-benefit claims
// captured by the public form at /claim (persisted to `nominee_claims` via
// /api/nominee-claim). Backed by the 0100 admin-gated SECURITY DEFINER RPCs.
//
// Distinct from `claims`: that table holds the member's OWN hospital-cash claims
// and is keyed on subscriber_id. These are filed by someone with no account, so
// they cannot be represented there — and matching one to a real member is a
// deliberate human step, not a lookup (see migration 0100's header).
//
// Both calls go through the authed `supabase` PostgREST client (the admin's JWT
// is attached automatically). Guarded by IS_SUPABASE_ENABLED so the rollback
// flag / mock mode degrades gracefully, exactly as accessRequests.js does.

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';

/**
 * @param {'pending'|'in_review'|'approved'|'rejected'|'all'} [status]
 * @returns {Promise<Array>} nominee-claim rows (camelCase, newest first)
 */
export async function listNomineeClaims(status = 'pending') {
  if (!IS_SUPABASE_ENABLED) return [];
  const { data, error } = await supabase.rpc('list_nominee_claims', { p_status: status });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * Record a decision. `approved` and `rejected` are terminal — the RPC refuses to
 * re-decide a claim that already carries one.
 *
 * @param {{ id: string, status: 'in_review'|'approved'|'rejected',
 *           note?: string, subscriberId?: string }} payload
 *   subscriberId is the admin's manual match of the deceased to a real member.
 */
export async function reviewNomineeClaim({ id, status, note, subscriberId } = {}) {
  if (!IS_SUPABASE_ENABLED) return { id, status };
  const { data, error } = await supabase.rpc('review_nominee_claim', {
    p_id: id,
    p_status: status,
    p_note: note ?? null,
    p_subscriber_id: subscriberId ?? null,
  });
  if (error) throw error;
  return data;
}
