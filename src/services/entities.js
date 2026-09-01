// Entity data service — Supabase-backed.
//
// Phase 3 / Agent 9 rewrite: replaced the frozen-mockData + _entityOverrides
// pattern with direct `supabase.from()` selects and the three read-side RPCs
// (`get_entity_commission_summary`, `get_top_branch`, `get_breadcrumb`).
//
// Rollback path: when `IS_SUPABASE_ENABLED === false`, every function falls
// through to a mock implementation that reads `src/data/mockData.js` so the
// app keeps working from the seed snapshot. See `src/services/api.js` for the
// flag wiring.
//
// Naming convention: Supabase returns snake_case rows. We map them into the
// camelCase shape that components/hooks have always consumed (see
// CLAUDE.md "Data access rule") so this rewrite stays caller-transparent.

import { supabase } from './supabaseClient';
import { IS_SUPABASE_ENABLED } from './api';
import {
  COUNTRY, REGIONS, DISTRICTS, BRANCHES, AGENTS, DISTRIBUTORS,
  getEntityById, getChildEntities, getAllEntities,
  getParentEntity, getTopBranch, getBreadcrumbPath,
} from '../data/mockData';

// ─── Mappers ────────────────────────────────────────────────────────────────
// Each table-row → entity mapper preserves the legacy camelCase keys that the
// hooks + components have been built against. The aggregated `metrics` block
// (landing-page-style totals) is not yet computed by the entity rewrite —
// `ViewAgents` and `ViewBranches` access `.metrics.totalSubscribers` etc.
// unguarded, so we return a zero-shape default rather than `null` to avoid
// crashing the branch/distributor shells. Real aggregation will replace these
// zeros once it's wired from commissions/transactions.
const EMPTY_GENDER_RATIO = Object.freeze({ male: 0, female: 0, other: 0 });
const EMPTY_AGE_DISTRIBUTION = Object.freeze({
  '18-25': 0, '26-35': 0, '36-45': 0, '46-55': 0, '56+': 0,
});

const EMPTY_METRICS = Object.freeze({
  totalSubscribers: 0,
  // Exact active headcount (0082). Distinct from `activeRate`, which is a
  // ROUNDed whole percent and must never be multiplied back into a count.
  activeSubscribers: 0,
  totalAgents: 0,
  totalBranches: 0,
  totalContributions: 0,
  totalWithdrawals: 0,
  aum: 0,
  activeRate: 0,
  coverageRate: 0,
  dailyContributions: 0,
  weeklyContributions: 0,
  monthlyContributions: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  dailyWithdrawals: 0,
  weeklyWithdrawals: 0,
  monthlyWithdrawals: 0,
  newSubscribersToday: 0,
  newSubscribersThisWeek: 0,
  newSubscribersThisMonth: 0,
  prevDailyContributions: 0,
  prevWeeklyContributions: 0,
  prevDailyWithdrawals: 0,
  prevWeeklyWithdrawals: 0,
  prevMonthlyWithdrawals: 0,
  prevNewSubscribersToday: 0,
  prevNewSubscribersThisWeek: 0,
  prevNewSubscribersThisMonth: 0,
  genderRatio: EMPTY_GENDER_RATIO,
  ageDistribution: EMPTY_AGE_DISTRIBUTION,
  kycPending: 0,
  kycIncomplete: 0,
});

function center(row) {
  if (row?.center_lng == null || row?.center_lat == null) return null;
  return [Number(row.center_lng), Number(row.center_lat)];
}

function mapRegion(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? 'ug',
    center: center(row),
    metrics: EMPTY_METRICS,
  };
}

function mapDistrict(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    parentId: row.region_id,
    center: center(row),
    active: row.active,
    metrics: EMPTY_METRICS,
  };
}

function mapBranch(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    parentId: row.district_id,
    center: center(row),
    managerName: row.manager_name,
    managerPhone: row.manager_phone,
    managerEmail: row.manager_email,
    status: row.status,
    score: row.score,
    rank: row.rank,
    districtRank: row.district_rank,
    districtBranchCount: row.district_branch_count,
    createdAt: row.created_at,
    metrics: EMPTY_METRICS,
  };
}

function mapAgent(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    gender: row.gender,
    employeeId: row.employee_id,
    parentId: row.branch_id,
    center: center(row),
    phone: row.phone,
    email: row.email,
    rating: row.rating,
    performance: row.performance,
    status: row.status,
    languages: Array.isArray(row.languages) ? row.languages : [],
    specialties: Array.isArray(row.specialties) ? row.specialties : [],
    tenureMonths: row.tenure_months,
    joinedDate: row.joined_date,
    createdAt: row.created_at,
    metrics: EMPTY_METRICS,
  };
}

function mapSubscriber(row) {
  if (!row) return null;
  // `total_balance`, `total_contributions`, `total_withdrawals` may be flat
  // (PostgREST embedded resource lifted) or live on `row.subscriber_balances`
  // (raw embed). Support both shapes for forward-compat.
  const balRow = Array.isArray(row.subscriber_balances)
    ? row.subscriber_balances[0]
    : row.subscriber_balances;
  // The member TOTAL: allocated units at the book price, plus money received
  // that has not bought units yet, plus money already sold and not yet paid.
  // Falls back to the flat/legacy shape, where the two are equal by definition.
  //
  // NOTE the 'balance' SORT (SORTS.balance below) still orders on the raw
  // `subscriber_balances(total_balance)` column, because PostgREST cannot order
  // by a computed sum. Ordering and display can therefore disagree slightly
  // while money is in flight — a display concern only, and the alternative is
  // fetching every row to sort in memory.
  const totalBalance = row.total_balance
    ?? (balRow
      ? Number(balRow.total_balance ?? 0)
        + Number(balRow.pending_contribution_retirement ?? 0)
        + Number(balRow.pending_contribution_emergency ?? 0)
        + Number(balRow.pending_payout_retirement ?? 0)
        + Number(balRow.pending_payout_emergency ?? 0)
      : 0);
  const totalContributions = row.total_contributions ?? balRow?.total_contributions ?? 0;
  const totalWithdrawals = row.total_withdrawals ?? balRow?.total_withdrawals ?? 0;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    age: row.age,
    dob: row.dob,
    nin: row.nin,
    occupation: row.occupation,
    parentId: row.agent_id,
    districtId: row.district_id,
    kycStatus: row.kyc_status,
    isActive: row.is_active,
    registeredDate: row.registered_date,
    productsHeld: Array.isArray(row.products_held) ? row.products_held : [],
    contributionHistory: Array.isArray(row.contribution_history) ? row.contribution_history : [],
    currentUnitValue: row.current_unit_value,
    unitValueAsOf: row.unit_value_as_of,
    totalContributions: Number(totalContributions) || 0,
    totalWithdrawals: Number(totalWithdrawals) || 0,
    totalBalance: Number(totalBalance) || 0,
  };
}

// Distributors sit just above the country sentinel — there is one row in the
// demo seed (`d-001`). The `metrics` block is overwritten by the
// `get_entity_metrics_rollup` RPC (via `useEntityMetrics('country','ug')`)
// once aggregated counts have been fetched.
function mapDistributor(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? 'ug',
    managerName: row.manager_name,
    managerPhone: row.manager_phone,
    managerEmail: row.manager_email,
    registrationNo: row.registration_no ?? null,
    // District NAME, not districts.id — the 0140 column mirrors the
    // employers.district contract (A06-011).
    district: row.district ?? null,
    physicalAddress: row.physical_address ?? null,
    status: row.status,
    createdAt: row.created_at,
    metrics: EMPTY_METRICS,
  };
}

const LEVEL_TABLES = {
  region: 'regions',
  district: 'districts',
  branch: 'branches',
  agent: 'agents',
  subscriber: 'subscribers',
  distributor: 'distributors',
};

const LEVEL_PARENT_FK = {
  // For a given parent level, which column on the *child* table is the FK?
  country: { childLevel: 'region', column: 'parent_id' },     // regions.parent_id = 'ug'
  region: { childLevel: 'district', column: 'region_id' },
  district: { childLevel: 'branch', column: 'district_id' },
  branch: { childLevel: 'agent', column: 'branch_id' },
  agent: { childLevel: 'subscriber', column: 'agent_id' },
};

const LEVEL_MAPPERS = {
  region: mapRegion,
  district: mapDistrict,
  branch: mapBranch,
  agent: mapAgent,
  subscriber: mapSubscriber,
  distributor: mapDistributor,
};

// ─── List-path column projections ────────────────────────────────────────────
// LIST reads (getChildren / getAllAtLevel / getEntityPage) only need the
// columns the level's mapper actually reads — pulling `*` over the ~5k
// subscriber set (or ~2k agents) ships wide rows the UI never renders.
//
// CONSERVATIVE RULE: a level is narrowed ONLY if its mapper reads a strict
// SUBSET of the table's columns. `branch` and `agent` mappers read essentially
// every column on their tables, so narrowing them buys ~nothing and risks
// silently dropping a column the mapper expects — those stay `*`. DETAIL reads
// (`getEntity`) also stay `*`.
//
// Each list MUST be a superset of the columns its mapper dereferences (see
// mapRegion/mapDistrict/mapSubscriber/mapDistributor above). `subscriber`
// intentionally omits balance columns — they don't exist on `subscribers`
// (they live in `subscriber_balances`); `getAllAtLevel` never joined them, so
// the mapped balance fields have always defaulted to 0 on the list path.
// The balance embed, named ONCE because it belongs on both the list and the
// detail read and they must not drift. They did drift: 0146 added the in-flight
// components to the list projection below and left `detailColumns()` embedding
// `total_balance` alone, so opening a member showed a SMALLER number than the
// row that was just clicked. On the mobile subscriber detail that was visible
// motion — the list hands its (correct) row over via router state for first
// paint, then this fetch resolves and the balance drops by whatever the member
// has in flight.
//
// `mapSubscriber` sums allocated + in-flight, but only from the columns it is
// given; a missing column is `undefined`, which its `?? 0` silently reads as
// "nothing in flight" rather than "you forgot to ask for it".
//
// NOTE the columns named here are the only ones that may be embedded. There is
// no `total_contributions` / `total_withdrawals` column on `subscriber_balances`
// — naming one makes PostgREST reject the whole request with a 400. Those two
// exist only as aggregates over `transactions` and need a bounded RPC; they stay
// 0 on both paths. The embed is RLS-governed independently, and 0081 scopes
// `subscriber_balances` to the same set as `subscribers`, so the two agree.
const SUBSCRIBER_BALANCE_EMBED =
  'subscriber_balances(total_balance, pending_contribution_retirement, ' +
  'pending_contribution_emergency, pending_payout_retirement, pending_payout_emergency)';

const LEVEL_LIST_COLUMNS = {
  region: 'id, name, parent_id, center_lng, center_lat',
  district: 'id, name, region_id, center_lng, center_lat, active',
  // The balance is an embed, not a column on `subscribers` — without it every
  // list row rendered UGX 0 (mapSubscriber defaults the money fields), which
  // read as "the balances are broken".
  subscriber:
    'id, name, phone, email, gender, age, dob, nin, occupation, agent_id, ' +
    'district_id, kyc_status, is_active, registered_date, products_held, ' +
    'contribution_history, current_unit_value, unit_value_as_of, ' +
    // 0146: the in-flight components too. Without them this list shows the
    // ALLOCATED balance while the member's own dashboard shows their TOTAL, so
    // the same person's money reads differently to an admin and to themselves
    // for as long as anything is waiting for a price.
    SUBSCRIBER_BALANCE_EMBED,
  // `district` / `physical_address` (0140) are part of the LIST projection, not
  // just the detail read: ViewDistributors renders the district on every row,
  // and an explicit projection that omits a column returns it as undefined
  // rather than erroring — which showed as "No district set" on rows that
  // definitely had one.
  distributor:
    'id, name, parent_id, manager_name, manager_phone, manager_email, status, ' +
    'created_at, district, physical_address',
};

// Column projection for a level's LIST reads; `*` for un-narrowed levels.
function listColumns(level) {
  return LEVEL_LIST_COLUMNS[level] ?? '*';
}

// ─── Detail-path column projection ──────────────────────────────────────────
// A15-001: getEntity() DETAIL reads stay `*` for every level per the
// CONSERVATIVE RULE above — except `subscriber`. `total_balance` is not a
// column on `subscribers` at all (it lives on `subscriber_balances`), so a
// bare `*` left mapSubscriber() with nothing to read and `totalBalance`
// defaulted to 0 — the mobile subscriber detail (and any other getEntity
// caller) rendered "—" for members holding millions, even though the LIST
// read (LEVEL_LIST_COLUMNS.subscriber, above) already carries this exact
// embed and rendered correctly. `*` plus an embedded resource is valid
// PostgREST syntax (mirrors LEVEL_LIST_COLUMNS.subscriber). This is a
// single-row `.eq('id', id).maybeSingle()` read, so the embed returns at most
// one balance row — NOT a list query, so it is not subject to the
// db-max-rows=1000 cap that bounds the paging in getAllAtLevel() below.
//
// It embeds the SAME projection as the list read (SUBSCRIBER_BALANCE_EMBED) —
// see that constant for why the two must never diverge again.
function detailColumns(level) {
  return level === 'subscriber' ? `*, ${SUBSCRIBER_BALANCE_EMBED}` : '*';
}

// ─── Parent scoping for list reads ──────────────────────────────────────────
// `getAllAtLevel(level)` returns EVERY row the caller's RLS allows. The
// drill-down UX needs the same list narrowed to one parent — "the subscribers
// belonging to agent a-001" — so a distributor drilling into an agent doesn't
// see the whole network. Two shapes are supported per level so callers can pass
// whichever id they hold:
//
//   getAllAtLevel('subscriber', { agentId })     → subscribers.agent_id  = :id
//   getAllAtLevel('subscriber', { districtId })  → subscribers.district_id = :id
//   getAllAtLevel('agent',      { branchId })    → agents.branch_id      = :id
//   getAllAtLevel('branch',     { districtId })  → branches.district_id  = :id
//
// A branch-scoped SUBSCRIBER list is deliberately absent: `subscribers` has no
// branch_id column (the edge is subscribers.agent_id → agents.branch_id), so it
// can't be expressed as a single `.eq()`. Callers that need it resolve the
// branch's agents first — see `getSubscribersForBranch`.
const SCOPE_COLUMNS = {
  subscriber: { agentId: 'agent_id', districtId: 'district_id' },
  agent: { branchId: 'branch_id' },
  branch: { districtId: 'district_id', distributorId: 'distributor_id' },
};

/** Map a `{agentId}`-style scope onto `{column, value}` for the given level. */
function resolveScopeFilter(level, scope) {
  if (!scope) return null;
  const columns = SCOPE_COLUMNS[level];
  if (!columns) return null;
  for (const [key, column] of Object.entries(columns)) {
    const value = scope[key];
    if (value) return { column, value };
  }
  return null;
}

/**
 * Mock-branch equivalent of the PostgREST `.eq()` above. The mock entities carry
 * camelCase fields (`agentId`), not the snake_case column names, so this filters
 * on the scope KEY rather than the resolved column.
 */
function filterByScope(list, level, scope) {
  if (!scope || !SCOPE_COLUMNS[level]) return list;
  for (const key of Object.keys(SCOPE_COLUMNS[level])) {
    const value = scope[key];
    if (value) return (list ?? []).filter((e) => e?.[key] === value);
  }
  return list;
}

// ─── In-memory sync cache for getEntitySync ─────────────────────────────────
// `getEntitySync` is called by `DashboardNavContext.buildSelectedIds` during
// URL routing to walk the parent chain. Supabase calls are async, so we keep
// a per-process cache that is opportunistically populated by every async
// read in this file. First navigation may return null (the URL effect will
// then re-render once React Query resolves the data and the cache fills);
// subsequent navigations are sync. This is the minimum-surface alternative
// to refactoring DashboardNavContext to be async-aware.
// F27: cache may be null on first-navigation until the first async read populates it; this is expected, not a bug — the URL effect re-renders once React Query resolves.
const _syncCache = new Map();
function syncCacheKey(level, id) { return `${level}:${id}`; }
function cacheEntity(level, entity) {
  if (entity && entity.id) _syncCache.set(syncCacheKey(level, entity.id), entity);
}

// ─── Country sentinel ───────────────────────────────────────────────────────

/**
 * @endpoint (none — static sentinel)
 * @returns {Promise<{id: 'ug', name: 'Uganda', center: [number, number], metrics: null|Object}>}
 * @description Returns the country-level entity. Static — no DB hit. Falls
 *   back to the mockData country (which carries aggregated metrics) so the
 *   Distributor overlay panel keeps showing roll-up numbers; under Supabase
 *   the live aggregation is done by the read RPCs.
 * @cache ['country']
 * @scope All authenticated roles.
 */
export async function getCountry() {
  // The country row isn't stored in Supabase (regions.parent_id = 'ug' is the
  // sentinel reference). Returning the mock COUNTRY keeps the overlay's
  // pre-computed metrics block working. Once we wire live aggregation we'll
  // recompute these from get_entity_commission_summary + transactions.
  cacheEntity('country', COUNTRY);
  return COUNTRY;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * @endpoint SELECT 1 row from the level's table (subscriber additionally
 *   embeds the balance row — allocated AND in-flight; see `detailColumns()`
 *   and `SUBSCRIBER_BALANCE_EMBED`).
 * @param {string} level - region|district|branch|agent|subscriber
 * @param {string} id
 * @returns {Promise<Object|null>} mapped entity, or null if not found.
 * @cache ['entity', level, id]
 * @scope RLS-enforced. Distributor: any; Branch: own branch + children; etc.
 */
export async function getEntity(level, id) {
  if (!IS_SUPABASE_ENABLED) {
    return getEntityById(level, id);
  }
  if (level === 'country') {
    return getCountry();
  }
  const table = LEVEL_TABLES[level];
  const mapper = LEVEL_MAPPERS[level];
  if (!table || !mapper) return null;

  const { data, error } = await supabase
    .from(table)
    .select(detailColumns(level))
    .eq('id', id)
    .maybeSingle();

  if (error) {
    // PGRST116 = no row found via .single(); .maybeSingle returns null already.
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  const entity = mapper(data);
  cacheEntity(level, entity);
  return entity;
}

/**
 * @endpoint SELECT * FROM <child-table> WHERE <parent-fk> = $1
 * @param {string} parentLevel - country|region|district|branch|agent
 * @param {string} parentId
 * @returns {Promise<Array<Object>>}
 * @cache ['children', parentLevel, parentId]
 */
export async function getChildren(parentLevel, parentId) {
  if (!IS_SUPABASE_ENABLED) {
    const childLevel = LEVEL_PARENT_FK[parentLevel]?.childLevel;
    const list = getChildEntities(parentLevel, parentId);
    if (!childLevel) return list;
    return list;
  }
  const cfg = LEVEL_PARENT_FK[parentLevel];
  if (!cfg) return [];
  const table = LEVEL_TABLES[cfg.childLevel];
  const mapper = LEVEL_MAPPERS[cfg.childLevel];
  if (!table || !mapper) return [];

  const { data, error } = await supabase
    .from(table)
    .select(listColumns(cfg.childLevel))
    .eq(cfg.column, parentId);

  if (error) throw error;
  const mapped = (data ?? []).map(mapper);
  mapped.forEach((e) => cacheEntity(cfg.childLevel, e));
  return mapped;
}

/**
 * @endpoint SELECT <projection> FROM <level-table>
 * @param {string} level - region|district|branch|agent|subscriber
 * @returns {Promise<Array<Object>>}
 * @cache ['entities', level]
 * @description Returns the COMPLETE set at a level (callers reduce/aggregate
 *   over the whole list — reports, totals, charts — so truncation would
 *   silently corrupt their numbers). PostgREST caps a single response at
 *   1,000 rows, so larger levels (subscribers ~5k, agents ~2k) span multiple
 *   pages.
 *
 *   AUDIT-2-5: previously this paged STRICTLY SERIALLY — request page 0, await,
 *   request page 1, await, … up to a 100-page (100k-row) ceiling. For ~5k
 *   subscribers that is ~5 blocking round-trips end-to-end, and the original
 *   code path was capped at 100 sequential trips. We now fetch page 0, and if
 *   (and only if) it came back FULL, learn the exact total via a single
 *   `count: 'exact', head: true` probe and fan out the remaining pages in
 *   PARALLEL. Same projection, same rows, same order within each page — just
 *   gathered concurrently instead of in a waterfall. Small levels
 *   (region/district/branch/distributor, and any level whose first page isn't
 *   full) issue exactly ONE query, identical to before.
 *
 *   The narrowed `listColumns(level)` projection (vs the old `*`) further
 *   shrinks each subscriber/agent row to the columns the mapper reads.
 */
export async function getAllAtLevel(level, scope = null) {
  if (!IS_SUPABASE_ENABLED) {
    return filterByScope(getAllEntities(level), level, scope);
  }
  const table = LEVEL_TABLES[level];
  const mapper = LEVEL_MAPPERS[level];
  if (!table || !mapper) return [];

  const PAGE_SIZE = 1000;
  const SAFETY_CAP_ROWS = 100_000; // 100k-row ceiling to bound a runaway fan-out
  const columns = listColumns(level);
  // Parent scoping — pushed DOWN to PostgREST rather than filtered client-side,
  // so a scoped list costs one small query instead of paging the whole level and
  // discarding most of it. It also makes the `count: 'exact'` probe below report
  // the SCOPED total, which is what the "Showing N of M" header must show.
  const scopeFilter = resolveScopeFilter(level, scope);
  const applyScope = (q) => (scopeFilter ? q.eq(scopeFilter.column, scopeFilter.value) : q);

  const collect = (rows) => {
    const out = [];
    for (const row of rows ?? []) {
      const entity = mapper(row);
      out.push(entity);
      cacheEntity(level, entity);
    }
    return out;
  };

  // Page 0 — always serial (it tells us whether a fan-out is even needed).
  const { data: firstData, error: firstError } = await applyScope(
    supabase.from(table).select(columns),
  ).range(0, PAGE_SIZE - 1);
  if (firstError) throw firstError;
  const firstRows = firstData ?? [];
  const mapped = collect(firstRows);

  // Common case (every small level + any level that fits in one page): done in
  // a single round-trip, byte-for-byte the same result the old loop produced.
  if (firstRows.length < PAGE_SIZE) return mapped;

  // The set spans multiple pages. Learn the exact total with a HEAD count, then
  // fetch pages 1..N concurrently. `count: 'exact'` (not 'estimated') so we
  // never drop the tail — this list MUST be complete for the aggregating
  // callers (ViewSubscribers totals, KYC roll-ups, report CSV exports).
  const { count, error: countError } = await applyScope(
    supabase.from(table).select(columns, { count: 'exact', head: true }),
  );
  if (countError) throw countError;

  const total = Math.min(count ?? firstRows.length, SAFETY_CAP_ROWS);
  if (total <= PAGE_SIZE) return mapped;

  const pageRequests = [];
  for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, total - 1);
    pageRequests.push(
      applyScope(supabase.from(table).select(columns))
        .range(from, to)
        .then(({ data, error }) => {
          if (error) throw error;
          return data ?? [];
        }),
    );
  }

  const pages = await Promise.all(pageRequests);
  for (const rows of pages) {
    mapped.push(...collect(rows));
  }
  return mapped;
}

/**
 * @endpoint SELECT * FROM <level-table> (paginated, filtered, sorted, scoped)
 * @param {string} level - 'subscriber' (the only level any caller uses today)
 * @param {Object} opts
 * @param {number} [opts.offset=0]
 * @param {number} [opts.limit=1000]
 * @param {string} [opts.search=''] - matched against name/phone via ILIKE
 * @param {string} [opts.statusFilter='all'] - 'all' | 'active' | 'inactive'
 * @param {string} [opts.sortKey='balance'] - 'balance' | 'contributions' | 'name' | 'registration'
 * @param {{agentId?: string, branchId?: string}} [opts.scope] - same shape as
 *   `getAllAtLevel`'s scope arg. `branchId` is the two-hop case (resolve the
 *   branch's agents first, same as `getSubscribersForBranch`) since
 *   `subscribers` has no `branch_id` column.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{rows: Object[], total: number, hasMore: boolean}>}
 * @description Server-side filter + sort + paginate + scope. Powers
 *   ViewSubscribers' virtualized infinite scroll (A21-001) — the panel used to
 *   pull the ENTIRE scoped collection (~4,600 rows / ~2.7MB raw for the
 *   unscoped case, plus a full unscoped agents + branches pull just to label
 *   one detail pane) via `getAllAtLevel`/`useAllEntities`, just to virtualize a
 *   ~20-row viewport. This function was DEAD CODE until now — its only caller
 *   (`useInfiniteEntityList`, src/hooks/useEntity.js) has no scope parameter
 *   and no consumers, so ViewSubscribers builds its own `useInfiniteQuery`
 *   directly over this function instead (see ViewSubscribers.jsx), threading
 *   `scope` through.
 *
 *   `total_balance` arrives via the SAME embed `listColumns('subscriber')`
 *   already carries (`subscriber_balances(total_balance)`) — no second
 *   id-bounded balance query needed. An earlier version of this function ran
 *   one; it predated the embed landing on the list projection and is removed
 *   here as dead weight, not a behaviour change.
 *
 *   'balance' sort now orders by the embedded `subscriber_balances.total_balance`
 *   directly — PostgREST accepts `order=<table>(<col>)` for a resource
 *   embedded in the same `select=` (verified live against PostgREST 2026-08-25:
 *   `GET .../subscribers?select=id,subscriber_balances(total_balance)&order=
 *   subscriber_balances(total_balance).desc` → 200, correctly ordered). This
 *   fixes what used to be a documented gap (balance sort silently substituted
 *   `registered_date`). 'contributions' still has no backing column
 *   (`total_contributions`/`total_withdrawals` are `transactions` aggregates,
 *   not a column anywhere) so it keeps the `registered_date` proxy — a
 *   pre-existing, unrelated limitation this change doesn't touch.
 * @cache Keyed by the caller (ViewSubscribers.jsx's `useInfiniteQuery`), not a
 *   fixed key here — this is a plain data function, not a hook.
 */
export async function getEntityPage(level, opts = {}) {
  const {
    offset = 0,
    limit = 1000,
    search = '',
    statusFilter = 'all',
    sortKey = 'balance',
    scope = null,
    signal,
  } = opts;

  if (!IS_SUPABASE_ENABLED) {
    // Mock fallback: apply scope + filters in-memory over the seed. Branch
    // scope is the same two-hop `getSubscribersForBranch` does — `subscribers`
    // carries no `branchId` field even in the mock shape, so `filterByScope`
    // alone (which only knows agentId/districtId for this level) would leak
    // every subscriber across every branch.
    let all = getAllEntities(level);
    if (level === 'subscriber' && scope?.branchId) {
      const agentsInBranch = filterByScope(getAllEntities('agent'), 'agent', { branchId: scope.branchId });
      const owned = new Set((agentsInBranch ?? []).map((a) => a.id));
      all = (all ?? []).filter((s) => owned.has(s?.agentId));
    } else {
      all = filterByScope(all, level, scope);
    }
    const trimmedSearch = search.trim().toLowerCase();
    let list = all.filter((e) => {
      if (statusFilter === 'active' && !e.isActive) return false;
      if (statusFilter === 'inactive' && e.isActive) return false;
      if (trimmedSearch && level === 'subscriber') {
        const name = String(e.name ?? '').toLowerCase();
        const phone = String(e.phone ?? '').toLowerCase();
        if (!name.includes(trimmedSearch) && !phone.includes(trimmedSearch)) return false;
      }
      return true;
    });
    const sortFn = MOCK_SORT_FNS[sortKey] ?? MOCK_SORT_FNS.balance;
    list = [...list].sort(sortFn);
    const total = list.length;
    const rows = list.slice(offset, offset + limit);
    return { rows, total, hasMore: offset + rows.length < total };
  }

  const table = LEVEL_TABLES[level];
  const mapper = LEVEL_MAPPERS[level];
  if (!table || !mapper) return { rows: [], total: 0, hasMore: false };

  // Branch-scoped subscriber lists are a two-hop read (branch -> agents ->
  // subscribers) — same reasoning as `getSubscribersForBranch`. An agentless
  // branch short-circuits to empty rather than `in(agent_id, [])`, which
  // PostgREST answers with EVERY row.
  let branchAgentIds = null;
  if (level === 'subscriber' && scope?.branchId) {
    const agents = await getAllAtLevel('agent', { branchId: scope.branchId });
    branchAgentIds = (agents ?? []).map((a) => a.id).filter(Boolean);
    if (branchAgentIds.length === 0) return { rows: [], total: 0, hasMore: false };
  }

  // count: 'estimated' reads pg_class.reltuples (instant) instead of a
  // 911 ms COUNT(*) with RLS overhead (AUDIT-2-1) — fine here because this
  // `total` only backs "Showing X of Y" where Y is the current search/filter's
  // matching count. The unfiltered, exact, HEADLINE scoped total (e.g. "4,602
  // subscribers in your network") is a separate read via
  // `get_entity_metrics_rollup` (see ViewSubscribers.jsx's `useEntityMetrics`
  // call) — distributor-renders-data.spec.ts pins that number against the same
  // rollup the KPI tiles use, which an *estimated* count here cannot guarantee
  // agreement with, especially on a small scoped (single-agent) set.
  let query = supabase
    .from(table)
    .select(listColumns(level), { count: 'estimated' });

  const scopeFilter = resolveScopeFilter(level, scope);
  if (scopeFilter) {
    query = query.eq(scopeFilter.column, scopeFilter.value);
  } else if (branchAgentIds) {
    query = query.in('agent_id', branchAgentIds);
  }

  if (search.trim() && level === 'subscriber') {
    // ILIKE escape: PostgREST handles `%` literally inside the value. The
    // current UI strips reserved chars at the input level (search is bare
    // text); if we ever start accepting wildcards from users, escape here.
    const q = search.trim();
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
  }

  if (statusFilter === 'active') query = query.eq('is_active', true);
  if (statusFilter === 'inactive') query = query.eq('is_active', false);

  const orderSpec = SUBSCRIBER_SORT_ORDER[sortKey] ?? SUBSCRIBER_SORT_ORDER.balance;
  query = query.order(orderSpec.column, {
    ascending: orderSpec.ascending,
    nullsFirst: orderSpec.nullsFirst ?? false,
  });
  // Deterministic tie-breaker. Every sort column above is non-unique — balances
  // tie, registered_date ties in bulk (the seed writes many rows per day), names
  // collide — and .range() over a non-total order lets a row appear on two pages
  // or on none. Same fix, same reason, as subscriber.js's transaction paging.
  query = query.order('id', { ascending: true });

  query = query.range(offset, offset + limit - 1);
  if (signal) query = query.abortSignal(signal);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = (data ?? []).map((row) => {
    const mapped = mapper(row);
    cacheEntity(level, mapped);
    return mapped;
  });

  const total = count ?? 0;
  return { rows, total, hasMore: offset + rows.length < total };
}

// Server-side sort column mapping. 'balance' orders by the embedded
// `subscriber_balances.total_balance` — PostgREST accepts `order=
// <foreignTable>(<column>)` when that table is embedded in `select=`, which
// `listColumns('subscriber')` always does (verified live 2026-08-25).
// 'contributions' has no backing column anywhere (those totals are
// `transactions` aggregates) so it still substitutes `registered_date` — a
// pre-existing, documented gap this change doesn't touch; closing it needs
// its own RPC.
// ⚠️ THE EMBEDDED COLUMN IS SPELLED INLINE, NOT VIA foreignTable.
// This was `{ column: 'total_balance', foreignTable: 'subscriber_balances' }`,
// which supabase-js turns into `subscriber_balances.order=total_balance.desc`
// — the order of the EMBEDDED resource, not a top-level ORDER BY. Since
// subscriber_balances is 1:1 on the subscriber PK, that embed order is a no-op,
// so the query emitted NO top-level ordering at all. Two consequences: the
// panel was never balance-sorted (a regression from the previous deterministic
// registered_date order), and `.range()` below paginated an UNORDERED query, so
// page 2+ of a ~4,600-row list can repeat rows and silently omit others.
// Verified against the installed @supabase/postgrest-js:
//   foreignTable   -> ?subscriber_balances.order=total_balance.desc   (embedded)
//   referencedTable-> ?subscriber_balances.order=total_balance.desc   (embedded)
//   dotted inline  -> ?order=subscriber_balances(total_balance).desc  (top-level)
const SUBSCRIBER_SORT_ORDER = {
  balance:       { column: 'subscriber_balances(total_balance)', ascending: false, nullsFirst: false },
  contributions: { column: 'registered_date', ascending: false, nullsFirst: false },
  registration:  { column: 'registered_date', ascending: false, nullsFirst: false },
  name:          { column: 'name',            ascending: true,  nullsFirst: false },
};

// Mock-fallback sort functions for the IS_SUPABASE_ENABLED=false branch.
const MOCK_SORT_FNS = {
  balance:       (a, b) => (b.totalContributions - b.totalWithdrawals) - (a.totalContributions - a.totalWithdrawals),
  contributions: (a, b) => b.totalContributions - a.totalContributions,
  registration:  (a, b) => String(b.registeredDate ?? '').localeCompare(String(a.registeredDate ?? '')),
  name:          (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
};

/**
 * @description Every subscriber under a BRANCH.
 *
 *   `subscribers` carries no `branch_id` — the ownership edge is
 *   `subscribers.agent_id → agents.branch_id` — so a branch-scoped list can't be
 *   one `.eq()`. Resolve the branch's agents first, then fetch their subscribers
 *   with a single `in(agent_id, …)`.
 *
 *   An agentless branch short-circuits to `[]` rather than issuing `in(…, [])`,
 *   which PostgREST would answer with every row — the exact "scoped list leaks
 *   the whole network" bug the drill-down specs guard against.
 *
 * @param {string} branchId
 * @returns {Promise<Array>} subscribers, mapped like `getAllAtLevel('subscriber')`
 */
export async function getSubscribersForBranch(branchId) {
  if (!branchId) return [];

  const agents = await getAllAtLevel('agent', { branchId });
  const agentIds = (agents ?? []).map((a) => a.id).filter(Boolean);
  if (agentIds.length === 0) return [];

  if (!IS_SUPABASE_ENABLED) {
    const all = getAllEntities('subscriber') ?? [];
    const owned = new Set(agentIds);
    return all.filter((s) => owned.has(s?.agentId));
  }

  // One page per 1000 agent ids would be pathological; branches hold single
  // digits of agents in the seed, so a single `in()` is fine. Page the RESULT
  // the same way getAllAtLevel does, since a large branch can exceed 1000 subs.
  const PAGE_SIZE = 1000;
  const columns = listColumns('subscriber');
  const mapper = LEVEL_MAPPERS.subscriber;
  const out = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(LEVEL_TABLES.subscriber)
      .select(columns)
      .in('agent_id', agentIds)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) {
      const entity = mapper(row);
      out.push(entity);
      cacheEntity('subscriber', entity);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * @description Returns all entities at a level as a Map<id, entity> for
 *   O(1) lookups (used by report views).
 * @param {string} level
 * @returns {Promise<Object<string, Object>>}
 * @cache ['entitiesMap', level]
 */
export async function getAllAtLevelMap(level) {
  const list = await getAllAtLevel(level);
  const map = {};
  list.forEach((e) => { map[e.id] = e; });
  return map;
}

/**
 * @description Walks back to the parent at the next level up. Kept for hook
 *   compat — production callers should pull `parentId` off the entity row
 *   directly (the React Query cache already has it).
 * @param {string} level
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getParent(level, id) {
  if (!IS_SUPABASE_ENABLED) {
    return getParentEntity(level, id);
  }
  const entity = await getEntity(level, id);
  if (!entity?.parentId) return null;
  const order = ['country', 'region', 'district', 'branch', 'agent'];
  const idx = order.indexOf(level);
  if (idx <= 0) return COUNTRY;
  return getEntity(order[idx - 1], entity.parentId);
}

/**
 * @endpoint RPC `get_top_branch(level, parent_id)`
 * @param {string} level - country|region|district
 * @param {string} parentId
 * @returns {Promise<{name: string, contribution: number}|null>}
 * @cache ['topBranch', level, parentId]
 */
export async function getTopPerformingBranch(level, parentId) {
  if (!IS_SUPABASE_ENABLED) {
    return getTopBranch(level, parentId);
  }
  const { data, error } = await supabase.rpc('get_top_branch', {
    p_level: level,
    p_parent_id: parentId,
  });
  if (error) throw error;
  return data ?? null;
}

/**
 * @endpoint RPC `get_breadcrumb(level, ids)`
 * @param {string} currentLevel
 * @param {Record<string,string>} selectedIds
 * @returns {Promise<Array<{level: string, id: string, name: string}>>}
 * @cache ['breadcrumb', currentLevel, selectedIds]
 */
export async function getBreadcrumb(currentLevel, selectedIds) {
  if (!IS_SUPABASE_ENABLED) {
    return getBreadcrumbPath(currentLevel, selectedIds);
  }
  const { data, error } = await supabase.rpc('get_breadcrumb', {
    p_level: currentLevel,
    p_ids: selectedIds ?? {},
  });
  if (error) throw error;
  // RPC returns jsonb array of { level, id, name } — pass through.
  return Array.isArray(data) ? data : [];
}

/**
 * @description Synchronous entity lookup. Used by `DashboardNavContext` to
 *   derive `selectedIds` from the URL during render.
 *
 *   DECISION (Agent 9): keep this sync but back it with a client-side cache
 *   that every async read in this file opportunistically populates. First
 *   navigation to a deep URL may return null (the route effect re-renders
 *   once React Query resolves and the cache fills); subsequent renders are
 *   sync. This required ZERO caller changes — the only caller is
 *   `DashboardNavContext.buildSelectedIds`, which already treated a null
 *   return as "stop walking". Alternative (a) — making the function async
 *   and refactoring the context — would have cascaded into every
 *   `useMemo`/`useEffect` in `DashboardNavContext` and is out of scope.
 *
 *   Under `IS_SUPABASE_ENABLED === false` this still reads frozen mockData
 *   directly (truly sync).
 */
export function getEntitySync(level, id) {
  if (!IS_SUPABASE_ENABLED) {
    return getEntityById(level, id);
  }
  if (level === 'country') return COUNTRY;
  return _syncCache.get(syncCacheKey(level, id)) ?? null;
}

// `getDistributorMetrics` retired in PR-2 (remediation plan Phase 2). Every
// caller now uses `useEntityMetrics('country', 'ug')`, which routes through
// `getEntityMetricsRollup` → `get_entity_metrics_rollup` RPC. That RPC
// returns totalSubscribers/totalAgents/totalBranches/aum as part of its
// 8-field result, eliminating the 4-call fan-out (3× HEAD count + 1× full
// `subscriber_balances` pull) this function used to do.

/**
 * @endpoint RPC get_entity_metrics_rollup(p_level, p_entity_ids)
 * @param {('country'|'region'|'district'|'branch'|'agent')} level
 * @param {string[]} entityIds - IDs at `level`; empty array short-circuits to `{}`.
 * @returns {Promise<Record<string, {
 *   totalSubscribers: number, totalAgents: number, totalBranches: number,
 *   totalContributions: number, totalWithdrawals: number, aum: number,
 *   activeRate: number, coverageRate: number,
 * }>>}
 * @description Batched per-entity rollup that replaces the EMPTY_METRICS
 *   placeholder returned by mapRegion/mapDistrict/mapBranch/mapAgent. One
 *   round-trip per (level, parent) instead of one per child. Backs the
 *   useChildrenMetrics / useEntityMetrics / useAllEntitiesMetrics hooks.
 *   Mock fallback reads pre-computed metrics from the seeded mockData maps.
 */
export async function getEntityMetricsRollup(level, entityIds) {
  if (!IS_SUPABASE_ENABLED) {
    const maps = {
      country: { ug: COUNTRY },
      region: REGIONS,
      district: DISTRICTS,
      branch: BRANCHES,
      agent: AGENTS,
    };
    const map = maps[level] || {};
    return Object.fromEntries(
      (entityIds ?? []).map((id) => [id, map[id]?.metrics ?? EMPTY_METRICS]),
    );
  }
  if (!entityIds?.length) return {};
  const { data, error } = await supabase.rpc('get_entity_metrics_rollup', {
    p_level: level,
    p_entity_ids: entityIds,
  });
  if (error) {
    // Surface so devs see it in the console instead of zeros in the UI.
    // Consumers (useEntityMetrics / useChildrenMetrics / useAllEntitiesMetrics)
    // expose this as React Query's `isError` — OverlayPanel renders a badge.
    console.warn('[getEntityMetricsRollup] RPC failed', { level, ids: entityIds, error });
    throw error;
  }
  return data ?? {};
}

const TOP_ENTITY_PARENT_LEVEL = { branch: 'district', agent: 'branch' };
const TOP_ENTITY_SORT_FIELD = { aum: 'aum', contributions: 'totalContributions', subscribers: 'totalSubscribers' };

/**
 * @endpoint RPC get_top_entities(p_level, p_sort_key, p_limit)
 * @param {('branch'|'agent')} level
 * @param {('aum'|'contributions'|'subscribers')} [sortKey] - defaults server-side
 *   (aum for branch, contributions for agent).
 * @param {number} [limit=6]
 * @returns {Promise<Array<{ id: string, name: string, parentId: string,
 *   parentName: string|null, managerName: string|null, status: string,
 *   m: { totalSubscribers: number, activeRate: number, aum: number, totalContributions: number } }>>}
 * @description Bounded, server-side top-N for the country overview's "Top branches"
 *   / "Top agents" tables (0077). Replaces the old landing fan-out that pulled the
 *   ENTIRE agent + branch collections into the browser via useAllEntities +
 *   useAllEntitiesMetrics only to sort client-side and slice 6. Rows are
 *   display-ready: identity + parent name + the four metrics the tables render.
 *   Mock fallback mirrors the old client-side compute over the seeded maps.
 * @cache ['topEntities', level, sortKey, limit]
 */
/**
 * @endpoint RPC get_distributor_rollup() — admin-only (0088).
 * @description Per-distributor branch/agent/subscriber/AUM counts, aggregated
 *   server-side. Bounded to one row per distributor, so it replaces what would
 *   otherwise be a ~2k-agent + ~5k-subscriber client fan-out just to length the
 *   collections (same reasoning as `get_top_entities`).
 *   Before 0060 there was no ownership column and ViewDistributors repeated
 *   PLATFORM totals under every row; with two real tenants that is misleading.
 * @returns {Promise<Record<string, {branches:number, agents:number,
 *   subscribers:number, activeSubscribers:number, aum:number}>>} keyed by distributor id
 * @cache ['distributorRollup']
 * @scope Admin only — the RPC returns no rows for any other app_role.
 */
export async function getDistributorRollup() {
  if (!IS_SUPABASE_ENABLED) return {};
  const { data, error } = await supabase.rpc('get_distributor_rollup');
  if (error) {
    console.warn('[getDistributorRollup] RPC failed', error);
    throw error;
  }
  // PostgREST returns bigint/numeric as strings — coerce.
  return Object.fromEntries((data ?? []).map((r) => [r.distributor_id, {
    branches: Number(r.branches) || 0,
    agents: Number(r.agents) || 0,
    subscribers: Number(r.subscribers) || 0,
    activeSubscribers: Number(r.active_subscribers) || 0,
    aum: Number(r.aum) || 0,
  }]));
}

export async function getTopEntities(level, sortKey, limit = 6) {
  const effLimit = Math.min(Math.max(limit || 6, 1), 50);
  const effSort = sortKey || (level === 'agent' ? 'contributions' : 'aum');

  if (!IS_SUPABASE_ENABLED) {
    const all = getAllEntities(level) || [];
    const parentLevel = TOP_ENTITY_PARENT_LEVEL[level];
    const parents = parentLevel ? (getAllEntities(parentLevel) || []) : [];
    const parentNameById = Object.fromEntries(parents.map((p) => [p.id, p.name]));
    const field = TOP_ENTITY_SORT_FIELD[effSort] || 'aum';
    return all
      .map((e) => ({
        id: e.id,
        name: e.name,
        parentId: e.parentId ?? null,
        parentName: parentNameById[e.parentId] ?? null,
        managerName: e.managerName ?? null,
        status: e.status,
        m: {
          totalSubscribers: e.metrics?.totalSubscribers ?? 0,
          activeRate: e.metrics?.activeRate ?? 0,
          aum: e.metrics?.aum ?? 0,
          totalContributions: e.metrics?.totalContributions ?? 0,
        },
      }))
      .sort((a, b) => (b.m[field] || 0) - (a.m[field] || 0))
      .slice(0, effLimit);
  }

  const { data, error } = await supabase.rpc('get_top_entities', {
    p_level: level,
    p_sort_key: effSort,
    p_limit: effLimit,
  });
  if (error) {
    console.warn('[getTopEntities] RPC failed', { level, sortKey: effSort, error });
    throw error;
  }
  // PostgREST returns numeric/bigint columns as strings — coerce to Number.
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    parentName: r.parent_name,
    managerName: r.manager_name,
    status: r.status,
    m: {
      totalSubscribers: Number(r.total_subscribers) || 0,
      activeRate: Number(r.active_rate) || 0,
      aum: Number(r.aum) || 0,
      totalContributions: Number(r.total_contributions) || 0,
    },
  }));
}

/**
 * @endpoint RPC get_branch_pending_contributions(p_branch_id)
 * @param {string} branchId
 * @returns {Promise<{ total: number, byAgent: Array<{
 *   agentId: string, agentName: string, total: number, pending: number }> }>}
 * @description Per-agent "overdue contributions" breakdown for a branch admin's
 *   Needs-attention drill-down: for each agent in the branch, the count of ACTIVE
 *   subscribers whose scheduled contribution is past due (next_due_date < today).
 *   `total` is the branch-wide sum (drives the Home "Overdue contributions"
 *   value); `byAgent` drives the drill-down list. Mock fallback approximates the
 *   live ~18% overdue rate from each agent's active-subscriber count so the demo
 *   stays non-zero without per-member mock data.
 */
export async function getBranchPendingContributions(branchId) {
  if (!branchId) return { total: 0, byAgent: [] };
  if (!IS_SUPABASE_ENABLED) {
    const agentsInBranch = getChildEntities('branch', branchId) || [];
    const byAgent = agentsInBranch.map((a) => {
      const active = Math.round(
        (a.metrics?.totalSubscribers || 0) * ((a.metrics?.activeRate || 0) / 100),
      );
      const pending = Math.round(active * 0.18);
      return { agentId: a.id, agentName: a.name, total: active, pending };
    });
    return { total: byAgent.reduce((s, r) => s + r.pending, 0), byAgent };
  }
  const { data, error } = await supabase.rpc('get_branch_pending_contributions', {
    p_branch_id: branchId,
  });
  if (error) {
    console.warn('[getBranchPendingContributions] RPC failed', { branchId, error });
    throw error;
  }
  const byAgent = (data ?? []).map((r) => ({
    agentId: r.agent_id,
    agentName: r.agent_name,
    total: Number(r.total) || 0,
    pending: Number(r.pending) || 0,
  }));
  return { total: byAgent.reduce((s, r) => s + r.pending, 0), byAgent };
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * @endpoint INSERT INTO branches
 * @param {Object} payload - branch creation payload (camelCase, see legacy
 *   JSDoc for fields). Translated to snake_case for the DB column names.
 * @returns {Promise<Object>} The newly-inserted, mapped branch row.
 * @cache Invalidates: ['entities','branch'], ['children']
 * @scope Distributor only (RLS WRITE policy in 0003_rls_policies.sql).
 */
export async function createBranch(payload) {
  if (!IS_SUPABASE_ENABLED) {
    return mockCreateBranch(payload);
  }
  // The mock service generated an ID. Schema has TEXT id (no default) so we
  // mint one client-side. Format mirrors mockData ('b-new-…') so the React
  // Query cache key stays predictable.
  const id = payload.id ?? `b-new-${Date.now()}`;
  const row = {
    id,
    name: payload.name,
    district_id: payload.districtId,
    manager_name: payload.adminName ?? payload.managerName ?? null,
    manager_phone: payload.adminPhone ?? payload.managerPhone ?? null,
    manager_email: payload.adminEmail ?? payload.managerEmail ?? null,
    status: payload.status ?? 'active',
    // 0081 scopes EVERY distributor read through branches.distributor_id, so a
    // NULL here would hide this branch — and every agent and subscriber under
    // it — from the distributor that just created it. Omitted (or null) falls
    // through to 0081's `branches_default_distributor` BEFORE INSERT trigger,
    // which stamps the caller's own `distributorId` JWT claim; an admin may
    // pass one explicitly to create on another distributor's behalf.
    ...(payload.distributorId ? { distributor_id: payload.distributorId } : {}),
  };
  const { data, error } = await supabase
    .from('branches')
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  const mapped = mapBranch(data);
  cacheEntity('branch', mapped);
  return mapped;
}

/**
 * @endpoint INSERT INTO agents
 * @param {Object} payload - agent creation payload (camelCase).
 * @returns {Promise<Object>} The newly-inserted, mapped agent row.
 * @cache Invalidates: ['children','branch',branchId], ['entities','agent']
 * @scope Branch admin (own branch only) — RLS-enforced.
 */
export async function createAgent(payload) {
  if (!IS_SUPABASE_ENABLED) {
    return mockCreateAgent(payload);
  }
  const id = payload.id ?? `a-new-${Date.now()}`;
  const row = {
    id,
    name: payload.name,
    gender: payload.gender ?? null,
    employee_id: payload.employeeId ?? null,
    branch_id: payload.branchId,
    phone: payload.phone ?? null,
    email: payload.email ?? null,
    status: payload.status ?? 'active',
    languages: payload.languages ?? [],
    specialties: payload.specialties ?? [],
  };
  const { data, error } = await supabase
    .from('agents')
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  const mapped = mapAgent(data);
  cacheEntity('agent', mapped);
  return mapped;
}

/**
 * @endpoint UPDATE branches SET <patch> WHERE id = $1
 * @param {string} id
 * @param {Object} patch - camelCase patch — only known columns are mapped.
 * @returns {Promise<Object>} The updated, mapped branch.
 * @cache Invalidates: ['entity','branch',id], ['entities','branch'], ['children']
 * @scope Distributor only.
 */
export async function updateBranch(id, patch) {
  if (!IS_SUPABASE_ENABLED) {
    return mockUpdateBranch(id, patch);
  }
  const row = {};
  if (patch.name != null) row.name = patch.name;
  if (patch.districtId != null) row.district_id = patch.districtId;
  if (patch.managerName != null) row.manager_name = patch.managerName;
  if (patch.managerPhone != null) row.manager_phone = patch.managerPhone;
  if (patch.managerEmail != null) row.manager_email = patch.managerEmail;
  if (patch.status != null) row.status = patch.status;

  const { data, error } = await supabase
    .from('branches')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  const mapped = mapBranch(data);
  cacheEntity('branch', mapped);
  return mapped;
}

/**
 * @endpoint Thin wrapper over updateBranch — kept as a separate export for
 *   hook compat (`useSetBranchStatus`) and so the intent is explicit in
 *   callers.
 * @param {string} id
 * @param {'active'|'inactive'} status
 */
export async function setBranchStatus(id, status) {
  return updateBranch(id, { status });
}

/**
 * @endpoint UPDATE distributors SET ... WHERE id = $1
 * @param {string} id - distributor ID (singleton 'd-001' today)
 * @param {{managerName?: string, managerPhone?: string, managerEmail?: string}} patch
 * @returns {Promise<Object>} updated, mapped distributor row
 * @cache Invalidates: ['entity','distributor',id]
 * @scope Distributor only — gated by `distributors_update_self` RLS policy
 *   (auth.jwt() ->> 'distributorId' = id).
 */
export async function updateDistributor(id, patch) {
  if (!IS_SUPABASE_ENABLED) {
    const existing = DISTRIBUTORS?.[id];
    if (existing) {
      if (patch.managerName != null) existing.managerName = patch.managerName;
      if (patch.managerPhone != null) existing.managerPhone = patch.managerPhone;
      if (patch.managerEmail != null) existing.managerEmail = patch.managerEmail;
    }
    return existing ?? null;
  }
  const row = {};
  if (patch.managerName != null) row.manager_name = patch.managerName;
  if (patch.managerPhone != null) row.manager_phone = patch.managerPhone;
  if (patch.managerEmail != null) row.manager_email = patch.managerEmail;
  if (Object.keys(row).length === 0) {
    // No-op patch — return current row.
    return getEntity('distributor', id);
  }

  const { data, error } = await supabase
    .from('distributors')
    .update(row)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  const mapped = mapDistributor(data);
  cacheEntity('distributor', mapped);
  return mapped;
}

/**
 * @endpoint RPC create_distributor(p_name, p_manager_name, p_manager_phone,
 *   p_manager_email, p_parent_id, p_registration_no) — admin-only SECURITY
 *   DEFINER write (0049; p_registration_no added in 0095).
 * @param {{name: string, managerName?: string, managerPhone?: string,
 *   managerEmail?: string, parentId?: string, registrationNo?: string}} payload
 * @returns {Promise<Object>} newly-inserted, mapped distributor row
 * @cache Caller invalidates: ['entities','distributor']
 * @scope Admin only — the RPC RAISEs for any other app_role.
 */
export async function createDistributor(payload) {
  if (!IS_SUPABASE_ENABLED) {
    // Emergency mock fallback — shaped row, not persisted.
    const id = payload.id ?? `d-new-${Date.now()}`;
    return mapDistributor({
      id,
      name: payload.name,
      parent_id: payload.parentId ?? 'ug',
      manager_name: payload.managerName ?? null,
      manager_phone: payload.managerPhone ?? null,
      manager_email: payload.managerEmail ?? null,
      registration_no: payload.registrationNo ?? null,
      district: payload.district ?? null,
      physical_address: payload.physicalAddress ?? null,
      status: 'active',
      created_at: new Date().toISOString(),
    });
  }
  const { data, error } = await supabase.rpc('create_distributor', {
    p_name: payload.name,
    p_manager_name: payload.managerName ?? null,
    p_manager_phone: payload.managerPhone ?? null,
    p_manager_email: payload.managerEmail ?? null,
    p_parent_id: payload.parentId ?? 'ug',
    p_registration_no: payload.registrationNo ?? null,
    p_district: payload.district ?? null,
    p_physical_address: payload.physicalAddress ?? null,
  });
  if (error) throw error;
  const mapped = mapDistributor(data);
  cacheEntity('distributor', mapped);
  return mapped;
}

/**
 * @endpoint RPC set_distributor_status(p_distributor_id, p_status) — admin-only
 *   SECURITY DEFINER (0060). Flips the distributor + its branches + its agents
 *   between 'active'/'inactive'; on 'inactive' also detaches every subscriber
 *   under its agent tree (agent_id -> NULL, is_active untouched → self-onboarded).
 *   Since 0080 the detach is JOURNALLED and reactivate REPLAYS it: branch/agent
 *   statuses and every detached agent_id are restored to their pre-deactivate
 *   values (rows re-onboarded during the inactive window are left alone).
 * @param {string} id
 * @param {'active'|'inactive'} status
 * @returns {Promise<{id:string,status:string,branchesUpdated:number,agentsUpdated:number,subscribersDetached:number}>}
 * @scope Admin only — the RPC RAISEs for any other app_role.
 */
export async function setDistributorStatus(id, status) {
  if (!IS_SUPABASE_ENABLED) {
    return { id, status, branchesUpdated: 0, agentsUpdated: 0, subscribersDetached: 0 };
  }
  const { data, error } = await supabase.rpc('set_distributor_status', {
    p_distributor_id: id,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

/**
 * @endpoint RPC get_platform_overview() — admin-only TRUE platform totals (0050;
 *   `byChannel` split added in 0058).
 * @description Unlike get_entity_metrics_rollup('country','ug') (which counts
 *   subscribers via the agent tree and so misses employer-onboarded ones), this
 *   counts EVERY subscriber regardless of acquisition channel, and returns the
 *   distributor/employer counts + the channel breakdown the admin Summary needs.
 *   The `byChannel` object splits subscribers/active/inactive/aum/contributions/
 *   withdrawals across distributor (agent_id), employer (employer_id) and direct
 *   (neither) — it powers the admin Platform Overview data-scope filter. The three
 *   channels sum exactly to the un-split totals.
 * @returns {Promise<{totalSubscribers:number, subscribersViaDistributor:number,
 *   subscribersViaEmployer:number, subscribersDirect:number, activeSubscribers:number,
 *   inactiveSubscribers:number, distributors:number, employers:number, branches:number,
 *   agents:number, aum:number, totalContributions:number, totalWithdrawals:number,
 *   byChannel:{distributor:Object, employer:Object, direct:Object}}>}
 * @scope Admin only — the RPC RAISEs for any other app_role.
 */
export async function getPlatformOverview() {
  if (!IS_SUPABASE_ENABLED) {
    // Emergency mock fallback — reuse the mock country rollup for the network
    // numbers; the employer channel isn't tracked in this service's mock, so
    // everything is reported as the distributor channel (acceptable for the
    // rollback path; getEmployerGeoRollup's mock is empty to stay consistent).
    const rollup = await getEntityMetricsRollup('country', ['ug']);
    const c = rollup?.ug ?? {};
    const total = c.totalSubscribers ?? 0;
    const active = Math.round(total * ((c.activeRate ?? 0) / 100));
    const inactive = Math.max(0, total - active);
    const aum = c.aum ?? 0;
    const contributions = c.totalContributions ?? 0;
    const withdrawals = c.totalWithdrawals ?? 0;
    const zeroChannel = { subscribers: 0, active: 0, inactive: 0, aum: 0, contributions: 0, withdrawals: 0 };
    return {
      totalSubscribers: total,
      subscribersViaDistributor: total,
      subscribersViaEmployer: 0,
      subscribersDirect: 0,
      activeSubscribers: active,
      inactiveSubscribers: inactive,
      distributors: 1,
      employers: 1,
      branches: c.totalBranches ?? 0,
      agents: c.totalAgents ?? 0,
      aum,
      totalContributions: contributions,
      totalWithdrawals: withdrawals,
      byChannel: {
        distributor: { subscribers: total, active, inactive, aum, contributions, withdrawals },
        employer: { ...zeroChannel },
        direct: { ...zeroChannel },
      },
    };
  }
  const { data, error } = await supabase.rpc('get_platform_overview');
  if (error) throw error;
  return data ?? {};
}

/**
 * @endpoint RPC get_employer_geo_rollup() — admin-only employer-channel subscriber
 *   aggregates placed on the region/district map (0058).
 * @description Employers are not part of the agent→branch→district→region tree, so
 *   get_entity_metrics_rollup excludes them below country level. This resolves each
 *   employer's free-text `district` to a real district (by name) → region and returns
 *   `byRegion` / `byDistrict` aggregates keyed by the SAME region_id / district.id the
 *   entity tree uses, plus a per-district employer leaf list (for the district drill-
 *   down "Employers" tab). Unmatched district text buckets under `'unmapped'`.
 * @returns {Promise<{byRegion:Object<string,{subscribers:number,active:number,aum:number,employers:number}>,
 *   byDistrict:Object<string,{subscribers:number,active:number,aum:number,employers:number,
 *   list:Array<{id:string,name:string,subscribers:number,active:number,aum:number}>}>}>}
 * @scope Admin only — the RPC RAISEs for any other app_role.
 */
export async function getEmployerGeoRollup() {
  if (!IS_SUPABASE_ENABLED) {
    // Rollback path: no employer-channel geography in the mock (kept empty so it
    // stays consistent with getPlatformOverview's all-distributor mock).
    return { byRegion: {}, byDistrict: {} };
  }
  const { data, error } = await supabase.rpc('get_employer_geo_rollup');
  if (error) throw error;
  return data ?? { byRegion: {}, byDistrict: {} };
}

/** All-zero employer-activity shape — the rollback/mock fallback (and a safe
 *  default while the query resolves). Mirrors the trend keys TimePeriodCard reads. */
const EMPTY_EMPLOYER_ACTIVITY = Object.freeze({
  dailyContributions: 0, prevDailyContributions: 0,
  weeklyContributions: 0, prevWeeklyContributions: 0,
  monthlyContributions: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  dailyWithdrawals: 0, prevDailyWithdrawals: 0,
  weeklyWithdrawals: 0, prevWeeklyWithdrawals: 0,
  monthlyWithdrawals: 0, prevMonthlyWithdrawals: 0,
  newSubscribersToday: 0, prevNewSubscribersToday: 0,
  newSubscribersThisWeek: 0, prevNewSubscribersThisWeek: 0,
  newSubscribersThisMonth: 0, prevNewSubscribersThisMonth: 0,
  topEmployer: null,
});

/**
 * @endpoint RPC get_employer_activity_rollup() — admin-only employer-channel
 *   Today/Week/Month activity (new members, contributions, withdrawals) +
 *   topEmployer (0059).
 * @description Employers sit outside the agent tree, so get_entity_metrics_rollup
 *   excludes them. This returns the SAME trend-key contract (so the shared
 *   TimePeriodCard renders it unchanged), filtered to employer-tagged subscribers
 *   and anchored on _demo_now(), plus `topEmployer {name, contribution}`. Powers
 *   the Platform Overview "Employers" scope trends strip.
 * @returns {Promise<Object>} the trend object (zeros + null topEmployer when empty).
 * @scope Admin only — the RPC RAISEs for any other app_role.
 */
export async function getEmployerActivityRollup() {
  if (!IS_SUPABASE_ENABLED) {
    // Rollback path: no employer-channel time-series in the mock (kept all-zero
    // so the card renders without crashing, consistent with the other employer
    // mocks above).
    return { ...EMPTY_EMPLOYER_ACTIVITY };
  }
  const { data, error } = await supabase.rpc('get_employer_activity_rollup');
  if (error) throw error;
  return data ?? { ...EMPTY_EMPLOYER_ACTIVITY };
}

// ─── Mock-fallback shims (used when IS_SUPABASE_ENABLED === false) ─────────
// These mirror the original mock behaviour just well enough to keep the
// rollback flag flipping the app back to a working state. They INTENTIONALLY
// do NOT recreate the per-session _entityOverrides map — the rollback is for
// emergency-demo continuity, not feature parity with the old prototype's
// edit-and-see-it-persist trick.

function mockCreateBranch(data) {
  return {
    id: `b-new-${Date.now()}`,
    ...data,
    status: 'active',
    metrics: EMPTY_METRICS,
  };
}

/**
 * Set an agent's status ('active' | 'inactive'). Branch admins can UPDATE their
 * own agents directly under RLS (`agents_update_branch`, migration 0007), so no
 * dedicated RPC is required — and the login gate (api/auth/verify-otp) already
 * reads `agents.status`, so a deactivated agent is blocked from signing in.
 * @endpoint UPDATE agents SET status = $2 WHERE id = $1
 */
export async function setAgentStatus(id, status) {
  if (!IS_SUPABASE_ENABLED) return mockSetAgentStatus(id, status);
  const { data, error } = await supabase
    .from('agents')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  const mapped = mapAgent(data);
  cacheEntity('agent', mapped);
  return mapped;
}

function mockSetAgentStatus(id, status) {
  const existing = getEntityById('agent', id);
  return existing ? { ...existing, status } : null;
}

function mockCreateAgent(data) {
  return {
    id: `a-new-${Date.now()}`,
    parentId: data.branchId,
    ...data,
    status: 'active',
    metrics: EMPTY_METRICS,
  };
}

function mockUpdateBranch(id, updates) {
  const existing = getEntityById('branch', id);
  return existing ? { ...existing, ...updates } : null;
}

// Re-export the data sources we still touch via the mock fallback so static
// analysis flags any future drift. (No callers; the imports above keep the
// fallback shims honest.)
export const _mockSources = { COUNTRY, REGIONS, DISTRICTS, BRANCHES, AGENTS, DISTRIBUTORS };
