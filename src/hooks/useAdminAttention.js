// TanStack Query hooks for the admin "Needs attention" card and its drill-downs.
// Services in ../services/adminAttention.js; RPCs in migration 0097.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as adminAttention from '../services/adminAttention';
import { ATTENTION_TYPES } from '../admin-dashboard/overview/adminAttentionDerive';

/**
 * Admin: all ten Needs-attention counts in one round-trip (0097), plus the
 * server-owned SLA thresholds and `asOf` clock the card formats its sub-labels
 * from. Powers AdminOverview (desktop) and AdminHomeMobile — one query key, so
 * the two surfaces can never render different numbers.
 *
 * 5-min staleTime matches usePlatformOverview: these are operational counts, not
 * live tickers, and the card sits on a dashboard the admin leaves open.
 *
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useAdminAttention() {
  return useQuery({
    queryKey: ['adminAttention'],
    queryFn: adminAttention.getAdminAttention,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Admin: the drill-down rows for one attention signal (0097). Shorter staleTime
 * than the card — the admin lands here to act, so the list should be close to
 * live, and it is only fetched once a row has actually been opened.
 *
 * @param {string|null|undefined} type Attention type; the query stays disabled
 *   until one is supplied (the desktop panel mounts before a type is chosen).
 * @param {number} [limit=50]
 * @returns {import('@tanstack/react-query').UseQueryResult<Array<Object>>}
 */
export function useAdminAttentionRows(type, limit = 50) {
  return useQuery({
    queryKey: ['adminAttentionRows', type, limit],
    queryFn: () => adminAttention.getAdminAttentionRows(type, limit),
    staleTime: 60 * 1000,
    enabled: Boolean(type),
  });
}

/**
 * Which signals can be closed out without fixing the underlying data, and how.
 *
 * Resolving is strictly opt-in per signal: every other Needs-attention signal
 * clears only by doing the real work (settle the withdrawal, run the payroll,
 * publish the price), and that should stay the default. A signal joins this
 * registry and sets `resolvable` in attentionMeta — nothing else changes.
 */
const RESOLVERS = Object.freeze({
  [ATTENTION_TYPES.NAV]: ({ row, note }) => adminAttention.resolveNavMissedDay({
    // `date` is the raw ISO valuation date; `primary` is the formatted display
    // string ("02 Sep 2026") and must never be sent to the RPC.
    navDate: row.date,
    note,
  }),
});

/**
 * Admin: close out one drill-down row so it stops counting in Needs attention.
 *
 * Unlike useSendAdminNotification — which deliberately invalidates NEITHER key,
 * because escalating changes no underlying data — resolving changes both the
 * headline counts and the drill-down list, so both are invalidated.
 * `['adminAttentionRows']` is a prefix match, covering every (type, limit) pair.
 *
 * @param {string|null|undefined} type Attention signal id.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useResolveAttentionRow(type) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args) => {
      const resolve = RESOLVERS[type];
      if (!resolve) {
        return Promise.reject(new Error(`${type} cannot be resolved`));
      }
      return resolve(args);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminAttention'] });
      queryClient.invalidateQueries({ queryKey: ['adminAttentionRows'] });
    },
  });
}
