import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as nomineeClaims from '../services/nomineeClaims';

/**
 * Admin: death-benefit claims filed by nominees through the public /claim form.
 * Keyed by status so the list refetches after a decision.
 */
export function useNomineeClaims(status = 'pending') {
  return useQuery({
    queryKey: ['nomineeClaims', status],
    queryFn: () => nomineeClaims.listNomineeClaims(status),
  });
}

/**
 * Record a decision on a nominee claim (start review / approve / reject), and
 * optionally match the deceased to a real member.
 *
 * Invalidates EVERY status bucket, not just the current one — a decision moves
 * the row from one list to another, so a stale 'pending' cache would keep
 * showing a claim that has already been actioned.
 */
export function useReviewNomineeClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => nomineeClaims.reviewNomineeClaim(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nomineeClaims'] });
    },
  });
}
