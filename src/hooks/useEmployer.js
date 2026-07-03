// React Query hooks for employer data — components import these, never
// `employerSeed` directly. Mirrors `src/hooks/useEntity.js`.
//
// UNIFIED MODEL (0043–0045): the employer's "staff" are tagged subscribers. The
// onboard + group-insurance + run mutations are NON-optimistic — the server
// (SECURITY DEFINER RPC) is the source of truth (it re-derives every figure and
// can touch many rows), so we let it win and only invalidate on success. The
// funding model is company-wide (Issue 2) — there is no per-member config edit.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as employer from '../services/employer';

const READ_STALE_TIME = 5 * 60 * 1000;

/**
 * Fetch the employer profile.
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useEmployer(employerId) {
  return useQuery({
    queryKey: ['employer', employerId],
    queryFn: () => employer.getEmployer(employerId),
    enabled: !!employerId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Fetch the employer's staff roster.
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseQueryResult<Object[]>}
 */
export function useEmployees(employerId) {
  return useQuery({
    queryKey: ['employees', employerId],
    queryFn: () => employer.getEmployees(employerId),
    enabled: !!employerId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Fetch a single employee by ID.
 * @param {string} employeeId
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useEmployee(employeeId) {
  return useQuery({
    queryKey: ['employee', employeeId],
    queryFn: () => employer.getEmployee(employeeId),
    enabled: !!employeeId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Fetch the employer's contribution-run history (newest-first).
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseQueryResult<Object[]>}
 */
export function useContributionRuns(employerId) {
  return useQuery({
    queryKey: ['contributionRuns', employerId],
    queryFn: () => employer.getContributionRuns(employerId),
    enabled: !!employerId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Fetch a single contribution run (header + per-employee lines).
 * @param {string} runId
 * @returns {import('@tanstack/react-query').UseQueryResult<{run:Object, lines:Object[]}>}
 */
export function useContributionRun(runId) {
  return useQuery({
    queryKey: ['contributionRun', runId],
    queryFn: () => employer.getContributionRun(runId),
    enabled: !!runId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Fetch one employee's contribution history — their run-lines joined to the run
 * period/date, newest-first. Drives the transactions section of the employee
 * detail panel.
 * @param {string} employeeId
 * @returns {import('@tanstack/react-query').UseQueryResult<Object[]>}
 */
export function useEmployeeContributions(employeeId) {
  return useQuery({
    queryKey: ['employeeContributions', employeeId],
    queryFn: () => employer.getEmployeeContributions(employeeId),
    enabled: !!employeeId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Aggregated metrics for the hero / overview (headcount, balances, YTD, mode
 * split). Threads `employerId` through the queryKey so it invalidates with the
 * roster even though the RPC reads scope from the JWT.
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useEmployerMetrics(employerId) {
  return useQuery({
    queryKey: ['employerMetrics', employerId],
    queryFn: () => employer.getEmployerMetrics(),
    enabled: !!employerId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Monthly-contributions leaderboard for the Overview hero — the employer's own
 * "this month" total ranked against a field of seeded peers (newest run's
 * grandTotal vs `LEADERBOARD_COMPETITORS`). Returns `[{ rank, name,
 * monthlyTotal, isYou, deltaRanks }]`, best-first.
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseQueryResult<Object[]>}
 */
export function useEmployerLeaderboard(employerId) {
  return useQuery({
    queryKey: ['employerLeaderboard', employerId],
    queryFn: () => employer.getEmployerLeaderboard(employerId),
    enabled: !!employerId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Mutation: patch the employer profile. Optimistically patches the cached
 * employer so settings/header chips reflect the change immediately; rolls back
 * on error.
 *
 * ATOMIC config save (audit §7d-3, migration 0056): the patch may ALSO carry the
 * company-wide insurance toggle (`insuranceEnabled` + `groupCover`), which the
 * service folds into the same `update_employer_profile` transaction (UPSERT/clear
 * `insurance_policies`). Those two control keys are stripped from the optimistic
 * cache patch (they aren't `employer` columns), and on settle this also
 * invalidates the roster (`['employees']`) + every cached single employee
 * (`['employee']`) — the surfaces the policy write moves — so the save needs no
 * separate `applyGroupInsurance` call.
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useUpdateEmployerProfile(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch) => employer.updateEmployerProfile(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['employer', employerId] });
      const previous = queryClient.getQueryData(['employer', employerId]);
      // Strip the insurance-control keys — they drive the policy write, they are
      // not columns on the `employer` record, so they must not leak into cache.
      const { insuranceEnabled, groupCover, ...cachePatch } = patch ?? {};
      void insuranceEnabled; void groupCover;
      queryClient.setQueryData(['employer', employerId], (old) =>
        old ? { ...old, ...cachePatch } : old,
      );
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['employer', employerId], ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['employer', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employerMetrics', employerId] });
      // The atomic insurance leg can touch the whole roster + any open detail.
      queryClient.invalidateQueries({ queryKey: ['employees', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employee'] });
    },
  });
}

/**
 * Pending employer invites (members who've been invited but not yet completed
 * KYC) — shown in the roster as "Pending KYC".
 * @param {string} employerId
 */
export function usePendingInvites(employerId) {
  return useQuery({
    queryKey: ['pendingInvites', employerId],
    queryFn: () => employer.listPendingInvites(employerId),
    enabled: !!employerId,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Mutation: create an employer invite (identity-only). Returns
 * { token, collectSchedule }; the UI surfaces the copy-able link. On success
 * refreshes the pending-invites list.
 * @param {string} employerId
 */
export function useCreateInvite(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefill) => employer.createEmployerInvite(prefill),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingInvites', employerId] });
    },
  });
}

/**
 * Mutation: bulk-create invites from an uploaded Excel (mass onboarding).
 * Returns { created, failed, total }; refreshes the pending-invites list once.
 * @param {string} employerId
 */
export function useBulkCreateInvites(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefills) => employer.bulkCreateEmployerInvites(prefills),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingInvites', employerId] });
    },
  });
}

/** Mutation: cancel (expire) a pending invite. */
export function useCancelInvite(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token) => employer.cancelEmployerInvite(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingInvites', employerId] });
    },
  });
}

/**
 * Mutation: activate a FLAT group life cover across the entire roster. Roster-
 * wide, so it's a plain invalidate-on-success (no optimistic patch — a single
 * employee key can't represent the whole roster). On success it invalidates the
 * roster (`['employees', employerId]` — the InsuranceBenefits page), the hero
 * "insured" figure (`['employerMetrics', employerId]`), and every cached single
 * employee (`['employee']` — so any open employee detail refreshes too).
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useApplyGroupInsurance(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ cover }) => employer.applyGroupInsurance(employerId, { cover }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employerMetrics', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employee'] });
    },
  });
}

/**
 * Mutation: remove a member from the company (un-link `employer_id`). The
 * subscriber's account stays active — they just leave the roster. On success it
 * invalidates the roster (`['employees', employerId]`), the hero's headcount /
 * active / suspended counts (`['employerMetrics', employerId]`), and every cached
 * single employee (`['employee']`) so an open detail panel refreshes too.
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useRemoveEmployee(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId }) => employer.removeEmployee(employerId, employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employerMetrics', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employee'] });
    },
  });
}

/**
 * Mutation: update a member's monthly compensation (the two-leg run driver,
 * migration 0062). NON-optimistic — the RPC validates + is the source of truth.
 * On success it invalidates the SAME reads `useRemoveEmployee` does: the roster
 * (`['employees', employerId]`), the hero counts (`['employerMetrics',
 * employerId]`), and every cached single employee (`['employee']`) so an open
 * detail panel refreshes too.
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useUpdateMemberCompensation(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, compensation }) =>
      employer.updateMemberCompensation(employerId, employeeId, compensation),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employerMetrics', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employee'] });
    },
  });
}

/**
 * Mutation: submit a contribution run. NON-optimistic — the server re-derives
 * every figure and is the source of truth. On success, invalidates every read
 * the run could have moved: the roster, the drilled-in employee, the run
 * history, the metrics, and the leaderboard.
 * @param {string} employerId
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useRunContribution(employerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ periodLabel, method, nonce } = {}) =>
      employer.submitContributionRun(employerId, { periodLabel, method, nonce }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employee'] });
      queryClient.invalidateQueries({ queryKey: ['employeeContributions'] });
      queryClient.invalidateQueries({ queryKey: ['contributionRuns', employerId] });
      queryClient.invalidateQueries({ queryKey: ['employerMetrics', employerId] });
      // A run moves the funded totals that drive the leaderboard rank, so
      // refresh it too (otherwise the rank is stale for up to 5 min).
      queryClient.invalidateQueries({ queryKey: ['employerLeaderboard', employerId] });
    },
  });
}

/**
 * Invalidate every employer-scoped query. Convenience for cross-laptop demo
 * sync or a manual refresh button.
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 */
export function invalidateAllEmployer(queryClient) {
  ['employer', 'employees', 'employee', 'employeeContributions', 'contributionRuns', 'contributionRun', 'employerMetrics']
    .forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
}

// ─── Admin-scoped employer hooks (platform-wide, used by the Admin dashboard) ──

/**
 * Admin: per-employer roster rollup across EVERY employer (member counts +
 * balances + contributions). Wraps get_all_employers_metrics (0049, admin-gated).
 * @returns {import('@tanstack/react-query').UseQueryResult<Array<Object>>}
 */
export function useAllEmployersMetrics() {
  return useQuery({
    queryKey: ['allEmployersMetrics'],
    queryFn: employer.getAllEmployersMetrics,
    staleTime: READ_STALE_TIME,
  });
}

/**
 * Admin: create a new employer. Invalidates the admin roster rollup so the
 * ViewEmployers list refreshes on success.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useCreateEmployer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: employer.createEmployer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allEmployersMetrics'] });
      queryClient.invalidateQueries({ queryKey: ['platformOverview'] });
      // A new employer shifts the employer geo rollup + the activity strip's
      // top-employer / counts (Platform Overview scope filter).
      queryClient.invalidateQueries({ queryKey: ['employerGeoRollup'] });
      queryClient.invalidateQueries({ queryKey: ['employerActivityRollup'] });
    },
  });
}

/**
 * Admin: deactivate / reactivate an employer (set_employer_status, 0060). On
 * 'inactive' the RPC detaches all members (employer_id → NULL, → self-onboarded).
 * Optimistically patches the admin rollup entry; invalidates every employer +
 * platform read the detach moves.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useSetEmployerStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => employer.setEmployerStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['allEmployersMetrics'] });
      const prevList = queryClient.getQueryData(['allEmployersMetrics']);
      queryClient.setQueryData(['allEmployersMetrics'], (old) =>
        Array.isArray(old) ? old.map((e) => (e.id === id ? { ...e, status } : e)) : old,
      );
      return { prevList };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prevList !== undefined) {
        queryClient.setQueryData(['allEmployersMetrics'], ctx.prevList);
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['allEmployersMetrics'] });
      queryClient.invalidateQueries({ queryKey: ['platformOverview'] });
      queryClient.invalidateQueries({ queryKey: ['employerGeoRollup'] });
      queryClient.invalidateQueries({ queryKey: ['employerActivityRollup'] });
      queryClient.invalidateQueries({ queryKey: ['employer', id] });
      queryClient.invalidateQueries({ queryKey: ['employees', id] });
      queryClient.invalidateQueries({ queryKey: ['employerMetrics', id] });
    },
  });
}
