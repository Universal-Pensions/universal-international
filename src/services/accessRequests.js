// Admin-side access-requests service. Reads/decides the pending employer &
// distributor lead rows captured by the public request-access form (persisted to
// `access_requests` via /api/access-request). Backed by the 0079 admin-gated
// SECURITY DEFINER RPCs (list/approve/deny). Approving provisions the real
// account via the create_distributor / create_employer RPCs (server-side).
//
// All three calls go through the authed `supabase` PostgREST client (the admin's
// JWT is attached automatically). Guarded by IS_SUPABASE_ENABLED so the rollback
// flag / mock mode degrades gracefully.

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';

/**
 * @param {'pending'|'approved'|'denied'|'all'} [status]
 * @returns {Promise<Array>} access-request rows (camelCase, newest first)
 */
export async function listAccessRequests(status = 'pending') {
  if (!IS_SUPABASE_ENABLED) return [];
  const { data, error } = await supabase.rpc('list_access_requests', { p_status: status });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/** Approve → provisions the real account + marks the row approved. */
export async function approveAccessRequest(id) {
  if (!IS_SUPABASE_ENABLED) return { id, status: 'approved' };
  const { data, error } = await supabase.rpc('approve_access_request', { p_id: id });
  if (error) throw error;
  return data;
}

/** Deny → flips the row to denied (no account created). */
export async function denyAccessRequest(id) {
  if (!IS_SUPABASE_ENABLED) return { id, status: 'denied' };
  const { data, error } = await supabase.rpc('deny_access_request', { p_id: id });
  if (error) throw error;
  return data;
}
