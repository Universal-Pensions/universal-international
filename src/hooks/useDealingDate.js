import { useQuery } from '@tanstack/react-query';
import { getDealingDate } from '../services/nav';

// When money taken RIGHT NOW starts working, straight from the database.
//
// Used at every point of sale — the member's pay-in screen, the agent's
// onboarding review, the take-out confirm sheet — so that an agent collecting
// cash at 3pm on a Friday can say out loud what will actually happen, before
// the member hands the money over. Setting that expectation at the counter is
// worth more than any amount of explanation afterwards.
//
// Deliberately NOT computed in JS: the cutoff, the timezone and the holiday
// calendar are all live database state (migration 0143) and can change without
// a redeploy. See getDealingDate().
//
// Cached for 5 minutes. The answer only changes when the clock crosses the
// cutoff or midnight, and a stale-by-minutes note is far better than a request
// per keystroke — but see `refetchOnWindowFocus`, which is what catches a
// session left open across the 14:00 boundary.

/**
 * @param {{ receivedAt?: string|Date, enabled?: boolean }} [opts]
 * @returns {{ dealingDate: string|null, isLoading: boolean }}
 */
export function useDealingDate(opts = {}) {
  const { receivedAt, enabled = true } = opts;
  const key = receivedAt ? String(receivedAt) : 'now';
  const q = useQuery({
    queryKey: ['dealingDate', key],
    queryFn: () => getDealingDate(receivedAt ? { receivedAt } : {}),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return { dealingDate: q.data ?? null, isLoading: q.isLoading };
}
