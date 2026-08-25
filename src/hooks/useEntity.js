// React Query hooks for entity data — components import these, never mockData directly.
// When backend is ready, only the service layer changes. These hooks stay the same.
//
// Mutations follow the optimistic-update pattern: onMutate snapshots, applies a
// patch, and returns the snapshot; onError restores it; onSettled invalidates
// for the server's truth. See `useUpdateBranch` and `useSetBranchStatus` for
// templates new mutations should follow.

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as entities from '../services/entities';
import * as searchService from '../services/search';

const CHILD_LEVEL = {
  country: 'region',
  region: 'district',
  district: 'branch',
  branch: 'agent',
};

/**
 * Fetch the top-level country entity.
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useCountry() {
  return useQuery({
    queryKey: ['country'],
    queryFn: entities.getCountry,
  });
}

/**
 * Fetch a single entity by level and ID.
 * @param {string} level - Hierarchy level
 * @param {string} id - Entity ID
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useEntity(level, id) {
  return useQuery({
    queryKey: ['entity', level, id],
    queryFn: () => entities.getEntity(level, id),
    enabled: !!id && !!level && level !== 'country',
  });
}

/**
 * Fetch the current entity based on drill-down level and selected IDs.
 * @param {string} level - Current drill-down level
 * @param {Record<string, string>} selectedIds - Map of level to entity ID
 * @returns {{ data: Object|undefined, isLoading: boolean }}
 */
export function useCurrentEntity(level, selectedIds) {
  const id = level === 'country' ? null : selectedIds[level];
  const countryQuery = useCountry();
  const entityQuery = useEntity(level, id);

  if (level === 'country') {
    return { data: countryQuery.data, isLoading: countryQuery.isLoading };
  }
  return { data: entityQuery.data, isLoading: entityQuery.isLoading };
}

/**
 * Fetch child entities for a given parent.
 * @param {string} level - Parent's hierarchy level
 * @param {string} parentId - Parent entity ID
 * @returns {import('@tanstack/react-query').UseQueryResult<Object[]>}
 */
export function useChildren(level, parentId) {
  return useQuery({
    queryKey: ['children', level, parentId],
    queryFn: () => entities.getChildren(level, parentId),
    enabled: !!parentId,
  });
}

/**
 * Per-agent "overdue contributions" breakdown for a branch (Needs-attention
 * drill-down). Backs the branch Home "Overdue contributions" value + the
 * AttentionAgentsMobile list. See entities.getBranchPendingContributions.
 * @param {string} branchId
 * @returns {import('@tanstack/react-query').UseQueryResult<{
 *   total: number, byAgent: Array<{agentId,agentName,total,pending}> }>}
 */
export function useBranchPendingContributions(branchId) {
  return useQuery({
    queryKey: ['branchPendingContributions', branchId],
    queryFn: () => entities.getBranchPendingContributions(branchId),
    enabled: !!branchId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch all entities at a given hierarchy level, optionally narrowed to one
 * parent.
 *
 * `scope` mirrors `entities.getAllAtLevel`'s second argument — e.g.
 * `useAllEntities('subscriber', { agentId })`. It is threaded into the query key
 * so a scoped list never reads (or clobbers) the unscoped cache entry. Passing
 * no scope keeps the original key `['entities', level]` byte-for-byte, so every
 * existing caller and its cached data are untouched.
 *
 * @param {string} level - Hierarchy level
 * @param {{agentId?: string, branchId?: string, districtId?: string, distributorId?: string}} [scope]
 * @returns {import('@tanstack/react-query').UseQueryResult<Object[]>}
 */
export function useAllEntities(level, scope = null) {
  // Normalise to a stable key fragment: an object literal would be a new
  // reference every render, and key order must not matter.
  const scopeKey = scope
    ? Object.entries(scope)
        .filter(([, v]) => v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${v}`)
        .join('|')
    : null;
  return useQuery({
    queryKey: scopeKey ? ['entities', level, scopeKey] : ['entities', level],
    queryFn: () => entities.getAllAtLevel(level, scope),
    enabled: !!level,
  });
}

/**
 * Subscribers under a BRANCH — a two-hop read (branch → agents → subscribers)
 * that `useAllEntities('subscriber', …)` can't express, since `subscribers` has
 * no branch_id column. See `entities.getSubscribersForBranch`.
 *
 * @param {string|null} branchId
 * @returns {import('@tanstack/react-query').UseQueryResult<Object[]>}
 */
export function useSubscribersForBranch(branchId) {
  return useQuery({
    queryKey: ['entities', 'subscriber', `branchId:${branchId}`],
    queryFn: () => entities.getSubscribersForBranch(branchId),
    enabled: !!branchId,
  });
}

/**
 * Server-side paginated + filtered + sorted entity list. Used by
 * ViewSubscribers to replace the 30-page subscriber fetch (AUDIT-1-7,
 * AUDIT-2-1). One page = 1000 rows; the virtualizer's `onEndReached` calls
 * `fetchNextPage`. Each page carries the full filtered `total` so the
 * "Showing X of Y" header can render after the first page lands.
 *
 * Search / status / sort are passed through to the server via PostgREST
 * `or=`, `eq=`, `order=`. The query key threads them so cache invalidates
 * cleanly on filter change.
 *
 * @param {string} level - 'subscriber' (others coming follow-up)
 * @param {Object} [opts]
 * @param {string} [opts.search='']
 * @param {string} [opts.statusFilter='all'] - 'all' | 'active' | 'inactive'
 * @param {string} [opts.sortKey='balance'] - 'balance' | 'contributions' | 'name' | 'registration'
 * @param {number} [opts.pageSize=1000]
 * @returns {import('@tanstack/react-query').UseInfiniteQueryResult}
 */
export function useInfiniteEntityList(level, opts = {}) {
  const { search = '', statusFilter = 'all', sortKey = 'balance', pageSize = 1000 } = opts;
  return useInfiniteQuery({
    queryKey: ['entity-page', level, { search, statusFilter, sortKey, pageSize }],
    queryFn: ({ pageParam = 0, signal }) =>
      entities.getEntityPage(level, {
        offset: pageParam,
        limit: pageSize,
        search,
        statusFilter,
        sortKey,
        signal,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      const loaded = allPages.reduce((acc, p) => acc + p.rows.length, 0);
      return loaded;
    },
    staleTime: 5 * 60 * 1000,
    enabled: !!level,
  });
}

/**
 * Fetch all entities at a level as a Map keyed by ID.
 * @param {string} level - Hierarchy level
 * @returns {import('@tanstack/react-query').UseQueryResult<Map<string, Object>>}
 */
export function useAllEntitiesMap(level) {
  return useQuery({
    queryKey: ['entitiesMap', level],
    queryFn: () => entities.getAllAtLevelMap(level),
    enabled: !!level,
  });
}

/**
 * Fetch the top-performing branch under a given parent entity.
 * @param {string} level - Parent hierarchy level
 * @param {string} parentId - Parent entity ID
 * @returns {import('@tanstack/react-query').UseQueryResult<{name: string, contribution: number}|null>}
 */
export function useTopBranch(level, parentId) {
  return useQuery({
    queryKey: ['topBranch', level, parentId],
    queryFn: () => entities.getTopPerformingBranch(level, parentId),
    enabled: !!level && !!parentId,
  });
}

/**
 * Build breadcrumb trail from the current drill-down position.
 *
 * `selectedIds` is recreated on every parent render (it's the
 * DashboardContext map), so feeding the object straight into the queryKey
 * thrashed the cache — TanStack Query does referential equality on key
 * elements. We serialise to a stable string so the key only changes when an
 * actual ID changes. `JSON.stringify` here is the same pattern `MetricsRow`
 * already uses to stabilise this object for keyed remounts (F13).
 *
 * @param {string} currentLevel - Current hierarchy level
 * @param {Record<string, string>} selectedIds - Map of level to entity ID
 * @returns {import('@tanstack/react-query').UseQueryResult<Array<{level: string, name: string}>>}
 */
export function useBreadcrumb(currentLevel, selectedIds) {
  const selectedIdsKey = JSON.stringify(selectedIds ?? {});
  return useQuery({
    queryKey: ['breadcrumb', currentLevel, selectedIdsKey],
    queryFn: () => entities.getBreadcrumb(currentLevel, selectedIds),
    enabled: currentLevel !== 'country',
  });
}

/**
 * Search entities by name across all levels.
 * @param {string} query - Search string (enabled when length >= 2)
 * @returns {import('@tanstack/react-query').UseQueryResult<Array<{id: string, name: string, level: string, label: string}>>}
 */
export function useSearch(query) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: () => searchService.searchEntities(query),
    enabled: query.length >= 2,
  });
}

/**
 * Mutation to create a new branch entity. Invalidates entity caches on success.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: entities.createBranch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities', 'branch'] });
      queryClient.invalidateQueries({ queryKey: ['children'] });
    },
  });
}

/**
 * Mutation to create a new agent under a branch. Invalidates the parent
 * branch's children list and the flat agent collection on success.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: entities.createAgent,
    onSuccess: (_agent, variables) => {
      queryClient.invalidateQueries({ queryKey: ['entities', 'agent'] });
      queryClient.invalidateQueries({ queryKey: ['children', 'branch', variables.branchId] });
      queryClient.invalidateQueries({ queryKey: ['entity', 'branch', variables.branchId] });
    },
  });
}

/**
 * Mutation to apply partial updates to a branch (admin info, name, etc).
 * Optimistically patches the cached entity so the detail panel reflects the
 * change immediately; rolls back on error.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useUpdateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => entities.updateBranch(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['entity', 'branch', id] });
      const previous = queryClient.getQueryData(['entity', 'branch', id]);
      queryClient.setQueryData(['entity', 'branch', id], (old) =>
        old ? { ...old, ...updates } : old,
      );
      return { previous };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['entity', 'branch', id], ctx.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['entity', 'branch', id] });
      queryClient.invalidateQueries({ queryKey: ['entities', 'branch'] });
      queryClient.invalidateQueries({ queryKey: ['children'] });
    },
  });
}

/**
 * Batch metrics for a parent's children — used by OverlayPanel child rows,
 * the per-row "subscribers" counts in regions/districts/branches/agents lists,
 * and any report view that maps over `useChildren` results.
 *
 * Runs in parallel with `useChildren`; the children list paints first, then
 * the metrics overlay arrives. queryKey threads `ids` so the cache invalidates
 * cleanly when the parent's children set changes.
 *
 * @param {string} parentLevel - 'country' | 'region' | 'district' | 'branch'
 * @param {string} parentId
 * @returns {import('@tanstack/react-query').UseQueryResult<Record<string, Object>>}
 */
export function useChildrenMetrics(parentLevel, parentId) {
  const childLevel = CHILD_LEVEL[parentLevel];
  const { data: children = [] } = useChildren(parentLevel, parentId);
  const ids = useMemo(() => children.map((c) => c.id), [children]);
  return useQuery({
    queryKey: ['childrenMetrics', parentLevel, parentId, ids],
    queryFn: () => entities.getEntityMetricsRollup(childLevel, ids),
    enabled: !!childLevel && ids.length > 0,
    // 15-min staleTime: the entity-metrics rollup is the #1 live hot path
    // (audit §5b.1) and country/region aggregates change slowly — avoid
    // refetching it aggressively on remount/refocus.
    staleTime: 15 * 60 * 1000,
  });
}

/**
 * Metrics for one drilled-into entity — used by OverlayPanel hero card,
 * MetricsRow, ViewBranches/ViewAgents detail panes. Returns the full 8-field
 * rollup at any level (country/region/district/branch/agent).
 *
 * @param {string} level - 'region' | 'district' | 'branch' | 'agent' | 'country'
 * @param {string} id
 * @returns {import('@tanstack/react-query').UseQueryResult<Object|null>}
 */
export function useEntityMetrics(level, id) {
  return useQuery({
    queryKey: ['entityMetrics', level, id],
    queryFn: async () => {
      const result = await entities.getEntityMetricsRollup(level, [id]);
      return result[id] ?? null;
    },
    enabled: !!id && !!level,
    // 15-min staleTime: same #1-hot-path rollup (audit §5b.1); country/region
    // metrics are slow-changing so a longer stale window cuts refetches.
    staleTime: 15 * 60 * 1000,
  });
}

/**
 * Bounded server-side top-N entities at a level for the country overview's
 * "Top branches" / "Top agents" tables (0077 `get_top_entities`). Returns only the
 * `limit` display-ready rows each table renders, replacing the old
 * useAllEntities + useAllEntitiesMetrics full-collection pull on the default dash
 * landing. 15-min staleTime — the same slow-changing aggregate hot path as the
 * metrics rollups.
 *
 * @param {('branch'|'agent')} level
 * @param {('aum'|'contributions'|'subscribers')} [sortKey]
 * @param {number} [limit=6]
 * @returns {import('@tanstack/react-query').UseQueryResult<Array<Object>>}
 */
export function useTopEntities(level, sortKey, limit = 6) {
  return useQuery({
    queryKey: ['topEntities', level, sortKey ?? null, limit],
    queryFn: () => entities.getTopEntities(level, sortKey, limit),
    enabled: !!level,
    staleTime: 15 * 60 * 1000,
  });
}

/**
 * Batch metrics for ALL entities at a level — used by report views
 * (AllBranches, AllAgents, AgentPerformance, BranchPerformance,
 * DistributionSummary, etc.) that today reach into `row.metrics` from a
 * `useAllEntities(level)` list and would otherwise see zeros.
 *
 * @param {string} level
 * @returns {import('@tanstack/react-query').UseQueryResult<Record<string, Object>>}
 */
export function useAllEntitiesMetrics(level) {
  const { data: entityList = [] } = useAllEntities(level);
  const ids = useMemo(() => entityList.map((e) => e.id), [entityList]);
  return useQuery({
    queryKey: ['allEntitiesMetrics', level, ids],
    queryFn: () => entities.getEntityMetricsRollup(level, ids),
    enabled: !!level && ids.length > 0,
    // 15-min staleTime: same #1-hot-path rollup (audit §5b.1); report views over
    // country/region/branch aggregates are slow-changing — fewer refetches.
    staleTime: 15 * 60 * 1000,
  });
}

/**
 * Mutation to apply partial updates to the distributor row (manager_name /
 * phone / email). Optimistically patches the cached entity so header chips
 * reflect the new value immediately; rolls back on error. RLS gates via
 * `distributors_update_self` — caller must hold the distributor JWT.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useUpdateDistributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => entities.updateDistributor(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['entity', 'distributor', id] });
      const previous = queryClient.getQueryData(['entity', 'distributor', id]);
      queryClient.setQueryData(['entity', 'distributor', id], (old) =>
        old ? { ...old, ...updates } : old,
      );
      return { previous };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['entity', 'distributor', id], ctx.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['entity', 'distributor', id] });
    },
  });
}

/**
 * Mutation to create a new distributor (admin only — RLS/RPC gated). Invalidates
 * the flat distributor collection so the admin ViewDistributors list refreshes.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useCreateDistributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: entities.createDistributor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entities', 'distributor'] });
      queryClient.invalidateQueries({ queryKey: ['entitiesMap', 'distributor'] });
      queryClient.invalidateQueries({ queryKey: ['platformOverview'] });
    },
  });
}

/**
 * Admin: TRUE platform-wide overview (all subscribers incl. employer-onboarded +
 * channel breakdown + distributor/employer counts). Wraps get_platform_overview
 * (0050, admin-gated). Powers the admin country Summary card. 5-min staleTime.
 *
 * @param {boolean} [enabled=true] Distributor-isolation guard, same shape as
 *   useEmployerActivityRollup: get_platform_overview is admin-gated and RAISEs
 *   for any other role, so a scoped (distributor/branch/agent) caller must be
 *   able to opt out rather than fire a query that can only fail.
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function usePlatformOverview(enabled = true) {
  return useQuery({
    queryKey: ['platformOverview'],
    queryFn: entities.getPlatformOverview,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/**
 * Admin: employer-channel subscriber aggregates placed on the region/district map
 * (byRegion / byDistrict + per-district employer leaf list). Wraps
 * get_employer_geo_rollup (0058, admin-gated). Powers the Platform Overview
 * data-scope filter (Employers/All) and the district drill-down "Employers" tab.
 * 5-min staleTime to match usePlatformOverview.
 *
 * @param {boolean} [enabled=true] Distributor-isolation guard: the shared
 *   OverlayPanel passes `false` for non-admin scopes so the distributor role never
 *   fires this admin-only query.
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
/**
 * Admin: per-distributor branch/agent/subscriber/AUM counts (0088), keyed by
 * distributor id. Bounded server-side aggregate — one row per distributor.
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useDistributorRollup() {
  return useQuery({
    queryKey: ['distributorRollup'],
    queryFn: entities.getDistributorRollup,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEmployerGeoRollup(enabled = true) {
  return useQuery({
    queryKey: ['employerGeoRollup'],
    queryFn: entities.getEmployerGeoRollup,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/**
 * Admin: employer-channel Today/Week/Month activity (new members, contributions,
 * withdrawals) + topEmployer. Wraps get_employer_activity_rollup (0059, admin-
 * gated) — powers the Platform Overview "Employers" scope trends strip. 5-min
 * staleTime to match the other admin overview queries.
 *
 * @param {boolean} [enabled=true] Distributor-isolation guard: pass `false` for
 *   non-employer scopes so the admin-only query never fires when it isn't shown.
 * @returns {import('@tanstack/react-query').UseQueryResult<Object>}
 */
export function useEmployerActivityRollup(enabled = true) {
  return useQuery({
    queryKey: ['employerActivityRollup'],
    queryFn: entities.getEmployerActivityRollup,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

/**
 * Branch: deactivate / reactivate one of its own agents (direct agents UPDATE —
 * RLS `agents_update_branch`, migration 0007; no dedicated RPC needed). The
 * login gate (api/auth/verify-otp) already reads `agents.status`, so a
 * deactivated agent can no longer sign in. Optimistically patches the cached
 * agent so the detail page flips immediately; invalidates the branch's agent
 * list + metrics so the roster and hero KPIs recompute.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useSetAgentStatus(branchId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => entities.setAgentStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['entity', 'agent', id] });
      const previous = queryClient.getQueryData(['entity', 'agent', id]);
      queryClient.setQueryData(['entity', 'agent', id], (old) =>
        old ? { ...old, status } : old,
      );
      return { previous };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['entity', 'agent', id], ctx.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['entity', 'agent', id] });
      queryClient.invalidateQueries({ queryKey: ['entities', 'agent'] });
      queryClient.invalidateQueries({ queryKey: ['children', 'branch', branchId] });
      queryClient.invalidateQueries({ queryKey: ['childrenMetrics', 'branch', branchId] });
    },
  });
}

/**
 * Mutation to flip a branch between active and inactive. Optimistically
 * updates the cached entity so the status pill flips instantly; rolls back
 * on error.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useSetBranchStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => entities.setBranchStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['entity', 'branch', id] });
      const previous = queryClient.getQueryData(['entity', 'branch', id]);
      queryClient.setQueryData(['entity', 'branch', id], (old) =>
        old ? { ...old, status } : old,
      );
      return { previous };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['entity', 'branch', id], ctx.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['entity', 'branch', id] });
      queryClient.invalidateQueries({ queryKey: ['entities', 'branch'] });
      queryClient.invalidateQueries({ queryKey: ['children'] });
    },
  });
}

/**
 * Admin: deactivate / reactivate a distributor (set_distributor_status, 0060).
 * On 'inactive' the RPC also flips the distributor's branches + agents inactive
 * and detaches every subscriber under its agent tree (→ self-onboarded). So the
 * invalidation is BROAD — the whole agent tree's reads could have moved.
 *
 * The status pill in ViewDistributors renders off the ['entities','distributor']
 * LIST (useAllEntities('distributor')), not the ['entity','distributor',id] detail,
 * so the optimistic patch targets that rendered list (mirrors useSetEmployerStatus)
 * — the pill flips instantly instead of waiting for the onSettled refetch. The
 * detail-key patch is kept too for any open detail view.
 * @returns {import('@tanstack/react-query').UseMutationResult}
 */
export function useSetDistributorStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => entities.setDistributorStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['entities', 'distributor'] });
      await queryClient.cancelQueries({ queryKey: ['entity', 'distributor', id] });
      const prevList = queryClient.getQueryData(['entities', 'distributor']);
      const previous = queryClient.getQueryData(['entity', 'distributor', id]);
      queryClient.setQueryData(['entities', 'distributor'], (old) =>
        Array.isArray(old) ? old.map((e) => (e.id === id ? { ...e, status } : e)) : old,
      );
      queryClient.setQueryData(['entity', 'distributor', id], (old) =>
        old ? { ...old, status } : old,
      );
      return { prevList, previous };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.prevList !== undefined) {
        queryClient.setQueryData(['entities', 'distributor'], ctx.prevList);
      }
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(['entity', 'distributor', id], ctx.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['entity', 'distributor', id] });
      queryClient.invalidateQueries({ queryKey: ['entities', 'distributor'] });
      queryClient.invalidateQueries({ queryKey: ['entities', 'branch'] });
      queryClient.invalidateQueries({ queryKey: ['entities', 'agent'] });
      queryClient.invalidateQueries({ queryKey: ['platformOverview'] });
      queryClient.invalidateQueries({ queryKey: ['children'] });
      queryClient.invalidateQueries({ queryKey: ['childrenMetrics'] });
      queryClient.invalidateQueries({ queryKey: ['entityMetrics'] });
      queryClient.invalidateQueries({ queryKey: ['allEntitiesMetrics'] });
      queryClient.invalidateQueries({ queryKey: ['entity-page'] });
      // get_top_entities counts subscribers/AUM through subscribers.agent_id, so a
      // status flip moves its numbers too. Its 15-min staleTime otherwise leaves the
      // admin + distributor overviews showing pre-flip top-N rows (see 0080).
      queryClient.invalidateQueries({ queryKey: ['topEntities'] });
    },
  });
}
