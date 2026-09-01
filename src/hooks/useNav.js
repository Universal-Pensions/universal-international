// TanStack Query hooks for the admin "Unit price" page.
// Services in ../services/nav.js; RPCs in migration 0104.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as nav from '../services/nav';

/**
 * Admin: the NAV page header — current/previous price, the move, units in issue,
 * AUM, aggregate growth, and the trailing series for the trend chart, all in one
 * round-trip.
 *
 * 5-min staleTime matches usePlatformOverview/useAdminAttention: a fund prices
 * once a day at most, so this is not a live ticker.
 *
 * @param {string} [fundCode]
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useNavOverview(fundCode = nav.DEFAULT_FUND) {
  return useQuery({
    queryKey: ['navOverview', fundCode],
    queryFn: () => nav.getNavOverview(fundCode),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Admin: the paged valuation register behind the history table.
 *
 * @param {{fundCode?:string, limit?:number, offset?:number, status?:string|null}} [opts]
 * @returns {import('@tanstack/react-query').UseQueryResult<{rows:Array<Object>, total:number}>}
 */
export function useNavSnapshots(opts = {}) {
  const {
    fundCode = nav.DEFAULT_FUND, limit = 60, offset = 0, status = null,
  } = opts;
  return useQuery({
    queryKey: ['navSnapshots', fundCode, limit, offset, status],
    queryFn: () => nav.listNavSnapshots({ fundCode, limit, offset, status }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Admin: publish a unit price.
 *
 * ⚠️ DELIBERATELY NOT OPTIMISTIC. A publish revalues every member in one server
 * transaction; the client cannot predict the resulting AUM without redoing the
 * rounding for ~5,060 rows, and showing a guessed figure for money is worse than
 * waiting ~300ms for the real one.
 *
 * ⚠️ THE INVALIDATION LIST IS BROAD ON PURPOSE. Publishing a price moves EVERY
 * AUM surface on the platform at once — the admin overview, the distributor and
 * branch rollups, the league tables, the employer metrics, and every subscriber's
 * own corpus — because they all read subscriber_balances.total_balance, which the
 * revaluation has just rewritten. Anything narrower leaves stale money on screen.
 * Key enumeration mirrors useSetDistributorStatus in ./useEntity.js.
 *
 * @returns {import('@tanstack/react-query').UseMutationResult<Object, Error, Object>}
 */
export function usePublishNav() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => nav.publishNavSnapshot(input),
    onSuccess: () => {
      [
        ['navOverview'], ['navSnapshots'],
        ['platformOverview'], ['topEntities'], ['distributorRollup'],
        ['entityMetrics'], ['allEntitiesMetrics'], ['childrenMetrics'],
        ['children'], ['entity-page'], ['entities'], ['entitiesMap'],
        ['allEmployersMetrics'], ['employerGeoRollup'],
        ['currentSubscriber'], ['subscriberAnalytics'],
        // 0147: a publish now RELEASES THE PRICING QUEUE, so it changes
        // transaction ROWS too, not only balances — a row that read "being put
        // into savings" a second ago now carries a price, a unit count and a
        // settled status. Without this the member's history keeps showing the
        // pending wording after the money has actually been invested.
        ['subscriberTransactions'], ['subscriberWithdrawals'],
        ['pendingPricingSummary'],
        // 0158: publishing is precisely what clears the readiness report's
        // dominant blocker ("N business days have no published price"), so the
        // panel must not keep saying "not ready" after the admin has just fixed
        // the thing it was complaining about.
        ['forwardDealingReadiness'],
        ['adminAttention'], ['adminAttentionRows'],
      ].forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    },
  });
}

/**
 * What a publish is about to release: contributions and redemptions waiting for
 * a price, and how many of them THIS publish would actually settle.
 *
 * Shown before the Publish button so the admin knows what pressing it does to
 * members' money, not just to the register. Every figure is zero while the
 * pricing switch is off, so the block renders empty and harmless until then.
 *
 * @param {string} [fundCode]
 */
export function usePendingPricingSummary(fundCode = nav.DEFAULT_FUND) {
  return useQuery({
    queryKey: ['pendingPricingSummary', fundCode],
    queryFn: () => nav.getPendingPricingSummary(fundCode),
    // Short: the queue changes whenever any member pays in or takes out, and a
    // stale preview would misdescribe what the button is about to do.
    staleTime: 60 * 1000,
  });
}

/**
 * Whether the fund is in a safe state to run forward dealing — the go/no-go
 * check that lived only in a runbook telling the operator to open a SQL client.
 *
 * Read-only; it flips nothing. `ready` is false while any blocker stands, and
 * the blocker that matters is a stale price register: switching on while the
 * fund is behind sends every new contribution into a queue that cannot clear.
 *
 * NOT retried. This is a yes/no about the fund's safety, and quietly retrying a
 * failing safety check in the background is how it ends up looking answered when
 * it was never answered.
 *
 * @param {string} [fundCode]
 */
export function useForwardDealingReadiness(fundCode = nav.DEFAULT_FUND) {
  return useQuery({
    queryKey: ['forwardDealingReadiness', fundCode],
    queryFn: () => nav.getForwardDealingReadiness(fundCode),
    staleTime: 60 * 1000,
    retry: false,
  });
}
