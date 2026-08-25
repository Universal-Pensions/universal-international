import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as accessRequests from '../services/accessRequests';

/**
 * Admin: pending employer/distributor access requests (from the public
 * request-access form). Keyed by status so the list refetches after a decision.
 */
export function useAccessRequests(status = 'pending') {
  return useQuery({
    queryKey: ['accessRequests', status],
    queryFn: () => accessRequests.listAccessRequests(status),
  });
}

/**
 * Approve a request → provisions the real distributor/employer account and marks
 * the row approved. Invalidates the request list, the platform/entity reads the
 * new account now appears in, and the admin Needs-attention card (A22-005) —
 * `get_admin_attention`'s `pendingAccessRequests` count is stale otherwise for
 * up to its 5-min staleTime, same as usePublishNav must invalidate it for NAV.
 */
export function useApproveAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => accessRequests.approveAccessRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] });
      queryClient.invalidateQueries({ queryKey: ['platformOverview'] });
      queryClient.invalidateQueries({ queryKey: ['entities', 'distributor'] });
      queryClient.invalidateQueries({ queryKey: ['entitiesMap', 'distributor'] });
      queryClient.invalidateQueries({ queryKey: ['allEmployersMetrics'] });
      queryClient.invalidateQueries({ queryKey: ['adminAttention'] });
      queryClient.invalidateQueries({ queryKey: ['adminAttentionRows'] });
    },
  });
}

/**
 * Deny a request → flips it to denied (no account created). Also invalidates
 * the admin Needs-attention card (A22-005) — same staleness as approve above.
 */
export function useDenyAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => accessRequests.denyAccessRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] });
      queryClient.invalidateQueries({ queryKey: ['adminAttention'] });
      queryClient.invalidateQueries({ queryKey: ['adminAttentionRows'] });
    },
  });
}
