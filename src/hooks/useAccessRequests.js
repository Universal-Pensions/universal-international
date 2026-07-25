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
 * the row approved. Invalidates the request list plus the platform/entity reads
 * the new account now appears in.
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
    },
  });
}

/** Deny a request → flips it to denied (no account created). */
export function useDenyAccessRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => accessRequests.denyAccessRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accessRequests'] });
    },
  });
}
