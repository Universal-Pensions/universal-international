// React Query hooks for the Subscriber dashboard.
// Components consume these; never import from mockData directly.
//
// ── Optimistic-update pattern (used by user-facing mutations below) ──
// onMutate snapshots affected caches and applies an optimistic patch so the
// UI reflects the change immediately. onError restores from the snapshot
// so a backend rejection doesn't leave the UI desynchronised. onSettled
// invalidates the caches so the server's truth wins on the next refetch.
// New mutations should follow the same shape — see `useUpdateProfile` and
// `useUpdateNominees` as templates.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import * as subscriberService from '../services/subscriber';

/** Current subscriber derived from the authenticated phone. Falls back to
 *  the first mock record if no exact match (prototype only). */
export function useCurrentSubscriber() {
  const { user } = useAuth();
  const phone = user?.phone;
  return useQuery({
    queryKey: ['currentSubscriber', phone],
    queryFn: () => subscriberService.getCurrentSubscriber(phone),
  });
}

// Canonical query-key shape: ['subscriberTransactions', id, filters].
// Invalidations elsewhere (this file's `useInvalidateSubscriber`, the agent-side
// `useUpdateSubscriberSchedule.onSettled`) use the two-element prefix
// `['subscriberTransactions', id]` which matches every cached filter variant
// for that subscriber via TanStack Query's default partial-key match.
export function useSubscriberTransactions(id, filters) {
  return useQuery({
    queryKey: ['subscriberTransactions', id, filters],
    queryFn: () => subscriberService.getSubscriberTransactions(id, filters),
    enabled: !!id,
  });
}

/** Total / own / employer contribution breakdown (for employer-tagged members). */
export function useContributionBreakdown(id) {
  return useQuery({
    queryKey: ['contributionBreakdown', id],
    queryFn: () => subscriberService.getContributionBreakdown(id),
    enabled: !!id,
  });
}

/**
 * Sum of the subscriber's own contributions in the current (demo-clock) month —
 * drives the schedule "pay the difference" settle prompt.
 */
export function useContributionPaidThisMonth(id) {
  return useQuery({
    queryKey: ['contributionPaidThisMonth', id],
    queryFn: () => subscriberService.getContributionPaidThisMonth(id),
    enabled: !!id,
  });
}

export function useSubscriberClaims(id) {
  return useQuery({
    queryKey: ['subscriberClaims', id],
    queryFn: () => subscriberService.getSubscriberClaims(id),
    enabled: !!id,
  });
}

export function useSubscriberWithdrawals(id) {
  return useQuery({
    queryKey: ['subscriberWithdrawals', id],
    queryFn: () => subscriberService.getSubscriberWithdrawals(id),
    enabled: !!id,
  });
}

export function useSubscriberNominees(id) {
  return useQuery({
    queryKey: ['subscriberNominees', id],
    queryFn: () => subscriberService.getSubscriberNominees(id),
    enabled: !!id,
  });
}

/** Returns the agent tagged to a subscriber, enriched with branch name. */
export function useSubscriberAgent(id) {
  return useQuery({
    queryKey: ['subscriberAgent', id],
    queryFn: () => subscriberService.getSubscriberAgent(id),
    enabled: !!id,
  });
}

function useInvalidateSubscriber(id) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['currentSubscriber'] });
    qc.invalidateQueries({ queryKey: ['subscriberTransactions', id] });
    qc.invalidateQueries({ queryKey: ['contributionBreakdown', id] });
    qc.invalidateQueries({ queryKey: ['subscriberClaims', id] });
    qc.invalidateQueries({ queryKey: ['subscriberWithdrawals', id] });
    qc.invalidateQueries({ queryKey: ['subscriberNominees', id] });
    qc.invalidateQueries({ queryKey: ['contributionPaidThisMonth', id] });
  };
}

export function useMakeContribution(id) {
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (payload) => subscriberService.makeAdHocContribution(id, payload),
    onSuccess: invalidate,
  });
}

export function useRequestWithdrawal(id) {
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (payload) => subscriberService.requestWithdrawal(id, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateSchedule(id) {
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (schedule) => subscriberService.updateContributionSchedule(id, schedule),
    onSuccess: invalidate,
  });
}

/**
 * Optimistically updates the cached subscriber's nominees so the UI reflects
 * the change before the backend confirms. Rolls back on error.
 */
export function useUpdateNominees(id) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (payload) => subscriberService.updateNominees(id, payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['subscriberNominees', id] });
      await queryClient.cancelQueries({ queryKey: ['currentSubscriber'] });
      const previousNominees = queryClient.getQueryData(['subscriberNominees', id]);
      const previousCurrent = queryClient.getQueriesData({ queryKey: ['currentSubscriber'] });
      queryClient.setQueryData(['subscriberNominees', id], (old) =>
        old ? { ...old, ...payload } : old,
      );
      queryClient.setQueriesData({ queryKey: ['currentSubscriber'] }, (old) =>
        old ? { ...old, nominees: { ...(old.nominees || {}), ...payload } } : old,
      );
      return { previousNominees, previousCurrent };
    },
    onError: (_err, _payload, ctx) => {
      if (ctx?.previousNominees !== undefined) {
        queryClient.setQueryData(['subscriberNominees', id], ctx.previousNominees);
      }
      if (ctx?.previousCurrent) {
        ctx.previousCurrent.forEach(([key, data]) => queryClient.setQueryData(key, data));
      }
    },
    onSettled: invalidate,
  });
}

export function useSubmitClaim(id) {
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (payload) => subscriberService.submitClaim(id, payload),
    onSuccess: invalidate,
  });
}

export function useUpdateInsuranceCover(id) {
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (payload) => subscriberService.updateInsuranceCover(id, payload),
    onSuccess: invalidate,
  });
}

/**
 * Pays an insurance premium for a single product (health | funeral | life),
 * activating its policy row + recording a 'premium' transaction (idempotent on
 * the payload `nonce`). Invalidates the subscriber cache so the new product
 * appears on the Policies page and the premium shows in the activity feed.
 */
export function usePayInsurancePremium(id) {
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (payload) => subscriberService.payInsurancePremium(id, payload),
    onSuccess: invalidate,
  });
}

/**
 * Funds one or more insurance products post-signup on the annual-premium model
 * (migration 0073). `pay_now` activates + charges the annual premium; `save_to_cover`
 * creates 'building' policies and puts the schedule into save-to-cover (the DB
 * accrual trigger funds them from savings). Invalidates the subscriber cache so
 * the new active/building policies + any premium charge surface immediately.
 */
export function useFundInsuranceProducts(id) {
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (payload) => subscriberService.fundInsuranceProducts(id, payload),
    onSuccess: invalidate,
  });
}

/**
 * Renews a policy (life | health) via a demo premium payment. Invalidates the
 * subscriber + transactions caches so the derived `policies` list and the
 * Insurance Statement feed reflect the renewal.
 */
export function useRenewPolicy(id) {
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (payload) => subscriberService.renewPolicy(id, payload),
    onSuccess: invalidate,
  });
}

/**
 * Optimistic profile update — the changed fields appear immediately across
 * every cached `currentSubscriber` query and roll back if the backend rejects.
 */
export function useUpdateProfile(id) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateSubscriber(id);
  return useMutation({
    mutationFn: (updates) => subscriberService.updateProfile(id, updates),
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ['currentSubscriber'] });
      const previous = queryClient.getQueriesData({ queryKey: ['currentSubscriber'] });
      queryClient.setQueriesData({ queryKey: ['currentSubscriber'] }, (old) =>
        old ? { ...old, ...updates } : old,
      );
      return { previous };
    },
    onError: (_err, _updates, ctx) => {
      if (ctx?.previous) {
        ctx.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
      }
    },
    onSettled: invalidate,
  });
}
