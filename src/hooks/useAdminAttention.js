// TanStack Query hooks for the admin "Needs attention" card and its drill-downs.
// Services in ../services/adminAttention.js; RPCs in migration 0097.

import { useQuery } from '@tanstack/react-query';
import * as adminAttention from '../services/adminAttention';

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
