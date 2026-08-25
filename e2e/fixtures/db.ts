// E2E Supabase admin client + DB verification helpers.
//
// !!! SECURITY !!! ----------------------------------------------------------
// This file uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS. It MUST be
// imported ONLY from Node-side Playwright fixtures and spec files — never
// from code that runs inside `page.evaluate(...)` or any browser context.
// Specs themselves run in Node, so importing this module at the top of a
// spec is safe. Do NOT pass the client (or its results) into a browser
// callback in a way that exposes the key.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';
// Used only by findChildTableListDrift() below (a manual/on-demand drift
// check, not part of any hot path). Static import — this project is ESM
// ("type": "module" in package.json), matching scripts/seed-supabase.mjs's
// proven `import pg from 'pg'` pattern; a runtime `require('pg')` would not
// reliably work under real ESM execution. `pg` is already a project
// dependency (see scripts/seed-supabase.mjs) — no package.json change.
import pgDefault from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

let cachedClient: SupabaseClient | null = null;

export function getAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new Error('VITE_SUPABASE_URL is required for E2E DB verification. Check .env.local.');
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for E2E DB verification. Check .env.local.');
  }
  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

export const supabaseAdmin = getAdminClient();

/**
 * Returns the count of rows matching `where`. Canonical implementation —
 * `rowExists` is a thin boolean wrapper over this. Uses PostgREST
 * `count: 'exact', head: true` so no rows travel over the wire (the
 * `Content-Range` header carries the count).
 */
export async function countWhere(table: string, where: Record<string, unknown>): Promise<number> {
  let query = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(where)) {
    query = query.eq(k, v as never);
  }
  const { count, error } = await query;
  if (error) throw new Error(`countWhere ${table}: ${error.message}`);
  return count ?? 0;
}

/** Returns true if at least one row matches `where`. Wraps `countWhere`. */
export async function rowExists(table: string, where: Record<string, unknown>): Promise<boolean> {
  return (await countWhere(table, where)) > 0;
}

/** Returns the first row matching `where`, or null. */
export async function getRow<T = Record<string, unknown>>(
  table: string,
  where: Record<string, unknown>,
): Promise<T | null> {
  let query = supabaseAdmin.from(table).select('*');
  for (const [k, v] of Object.entries(where)) {
    query = query.eq(k, v as never);
  }
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new Error(`getRow ${table}: ${error.message}`);
  return data as T | null;
}

/**
 * This project's Supabase instance caps every PostgREST response body at
 * 1000 rows server-side (`db-max-rows`), REGARDLESS of a larger `.limit()`
 * or `.range()` requested by the client — verified live during this fix's
 * own in-process verification: an unfiltered `subscriber_balances` fetch
 * (5,060 rows) silently returned only 1000, `.limit(5000)` on the same table
 * also returned exactly 1000, and `.range(0,4999)` also returned exactly
 * 1000 (while `.range(1000,1999)` correctly returned the NEXT 1000 — i.e.
 * paging via `.range()` works, a single large request does not).
 */
const POSTGREST_MAX_ROWS = 1000;

/**
 * Fetches every row a query would match, paging past POSTGREST_MAX_ROWS via
 * repeated `.range()` calls. `buildQuery(from, to)` should build the filtered
 * query and apply `.range(from, to)` to it (see call sites below) — this
 * function does not attach `.select()`/filters itself so any composed query
 * shape can be paginated with it.
 *
 * Why this exists: `assertNoSubscriberOrphans`'s per-table orphan probes
 * (`transactions` alone is ~30k rows) and `subscribersMissingBalance`'s
 * unfiltered branch both fetch a full table's `subscriber_id`/`id` column
 * with no filter — without paging, EVERY one of those probes was silently
 * checking only an arbitrary first-1000-rows slice of tables that can exceed
 * that, which is worse than not probing at all (it reports "clean" with
 * false confidence). This was a pre-existing gap in the original 9-table
 * version of assertNoSubscriberOrphans, not something introduced by A06-010's
 * additions — caught and fixed here because this fix already rewrites every
 * call site in that function.
 */
async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + POSTGREST_MAX_ROWS - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    if (page.length < POSTGREST_MAX_ROWS) break;
    from += POSTGREST_MAX_ROWS;
  }
  return all;
}

/**
 * Canonical list of subscriber-FK child tables that share the standard
 * `subscriber_id` column convention. Sourced from
 * `supabase/migrations/0001_initial_schema.sql` plus everything added since
 * (verified live via `information_schema.columns` / `pg_constraint`,
 * 2026-08-25 — audit A06-010).
 *
 * `cleanupSubscriberByPhone` walks this list (as a fallback — see that
 * function for the preferred atomic path) and `assertNoSubscriberOrphans`
 * probes each one explicitly. Both must be updated together when a new
 * subscriber_id-keyed table is added to the schema — `findChildTableListDrift`
 * below can check this list against the live schema on demand.
 *
 * NOT every table with a `subscriber_id` column belongs here — see
 * `SUBSCRIBER_ID_KEYED_TABLE` for the one bespoke exception (a snapshot table
 * keyed on `id`, not `subscriber_id`), which every function below handles
 * explicitly instead.
 */
export const SUBSCRIBER_CHILD_TABLES = [
  'transactions',
  'nominees',
  'subscriber_balances',
  'contribution_schedules',
  'insurance_policies',
  'subscriber_insurance_products',
  'claims',
  'withdrawals',
  'commissions',
  // Added 2026-08-25 — A06-010: three real subscriber_id-FK tables the list
  // omitted despite its own docstring claiming to be exhaustive. Verified
  // live via pg_constraint:
  //   money_nonces      — subscriber_id FK ON DELETE CASCADE, PK is `nonce`
  //   employer_invites  — subscriber_id FK ON DELETE SET NULL, PK is `token`
  //   entity_detach_log — subscriber_id FK ON DELETE CASCADE, PK is `id` (bigint)
  'money_nonces',
  'employer_invites',
  'entity_detach_log',
  // Added 2026-08-25 — A06-010: subscriber_balances_pre_nav is the 0105
  // NAV-migration snapshot table. It has a real `subscriber_id` column (same
  // name/shape as subscriber_balances) but verified live via pg_constraint to
  // carry NO foreign key at all — nothing cascades into or out of it, so it
  // must be swept explicitly. It is a do-not-drop rollback artefact for
  // 0105_nav_backfill.down.sql; deleting a specific TEST subscriber's row out
  // of it (scoped by the exact `ids` resolved from that subscriber's phone,
  // same as every other entry in this list) is correct and cannot reach a
  // real subscriber's snapshot — see the safety note on
  // SUBSCRIBER_ID_KEYED_TABLE below, which applies equally here.
  'subscriber_balances_pre_nav',
] as const;

/**
 * `subscribers_unit_value_pre_nav` (also a 0105 NAV-migration snapshot, also
 * a do-not-drop rollback artefact for 0105_nav_backfill.down.sql) is keyed on
 * `id` — literally the subscriber's own id — NOT `subscriber_id`, and also
 * carries no FK. Verified live: `select id, current_unit_value, ... from
 * subscribers_unit_value_pre_nav` has exactly one row per subscriber that
 * existed at 0105's apply time (2026-08-08), matched on `id = subscribers.id`.
 *
 * Appending this table name to SUBSCRIBER_CHILD_TABLES above would make every
 * generic `.in('subscriber_id', ids)` call in this file target a column that
 * does not exist on it (PostgREST 42703) — every table in that array is
 * assumed to share the `subscriber_id` column. So it is excluded from the
 * array on purpose and handled explicitly, everywhere, via `.in('id', ids)`.
 *
 * SAFETY (why a test-subscriber delete against this table can never touch a
 * real subscriber's snapshot): every caller in this file resolves the `ids`
 * it deletes with STRICTLY from `subscribers WHERE phone = <the phone the
 * caller passed in>` (see `cleanupSubscriberByPhone`) — never a wildcard,
 * LIKE pattern, or bulk predicate. A row in this table can only be deleted if
 * its `id` is already in that exact-match set, so the blast radius is
 * identical to (not broader than) the blast radius `cleanupSubscriberByPhone`
 * already had against every other child table before this fix.
 */
export const SUBSCRIBER_ID_KEYED_TABLE = 'subscribers_unit_value_pre_nav' as const;

const CLEANUP_RPC_NAME = 'e2e_delete_subscriber_tree';

/**
 * True if `error` looks like "the RPC does not exist yet" — i.e. migration
 * 0113_e2e_subscriber_cleanup_rpc.sql (authored, NOT applied to live — see
 * A04-010) has not been run against this database yet. Exported (not just
 * used inline) so it can be unit-exercised in isolation with a fabricated
 * error shape without touching the live DB.
 */
export function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  // PGRST202: PostgREST's "function not found in schema cache" — what
  // supabase-js surfaces for an RPC name with no matching function.
  if (error.code === 'PGRST202') return true;
  // Postgres-level undefined_function, in case the error surfaces from a
  // different layer than PostgREST's schema-cache check.
  if (error.code === '42883') return true;
  return /could not find the function|function .* does not exist/i.test(error.message ?? '');
}

/**
 * Deletes any subscriber rows matching `phone`, plus every row in every
 * subscriber-FK child table (SUBSCRIBER_CHILD_TABLES + the bespoke
 * SUBSCRIBER_ID_KEYED_TABLE). Use in afterEach for signup flow specs that
 * create real DB rows.
 *
 * ATOMICITY (A04-010) — preferred path: a single call to the
 * `e2e_delete_subscriber_tree` SECURITY DEFINER RPC deletes every child row
 * AND the parent `subscribers` row inside ONE Postgres transaction (the
 * function's own implicit transaction), so a crash/timeout/assertion failure
 * between statements can no longer leave a subscriber with no
 * subscriber_balances row — exactly the shape of the 4 live `tst-sub-*`
 * "missing_balance" rows this finding documents
 * (`select ref_id, who from v_reconciliation_exceptions where
 * check_code='missing_balance'`). The RPC still deletes children before the
 * parent (same order as before) — it does NOT lean on `ON DELETE CASCADE`,
 * preserving the original design intent stated below.
 *
 * Migration 0113_e2e_subscriber_cleanup_rpc.sql is AUTHORED but NOT applied
 * to live (Phase 0 commits no live writes — escalated for a human to run).
 * Until it is applied, `supabaseAdmin.rpc(...)` fails with "function not
 * found" (isMissingFunctionError), and this function transparently FALLS
 * BACK to the original non-atomic behaviour — child tables first (respecting
 * FK constraints AND guaranteeing no orphans linger if a cascade is ever
 * dropped — the original design intent, preserved), parent last, as separate
 * PostgREST round-trips. This means the atomicity gap is NOT closed until the
 * migration is applied (see this agent's `escalations`), but nothing
 * regresses in the meantime and the fix activates automatically, with no
 * further code change, the moment the migration lands.
 *
 * Returns the number of subscriber rows deleted.
 */
export async function cleanupSubscriberByPhone(phone: string): Promise<number> {
  const { data: subs, error: subErr } = await supabaseAdmin
    .from('subscribers')
    .select('id')
    .eq('phone', phone);
  if (subErr) throw new Error(`cleanup: subscriber lookup for ${phone}: ${subErr.message}`);
  if (!subs || subs.length === 0) return 0;

  const ids = subs.map((s) => (s as { id: string }).id);

  const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc(CLEANUP_RPC_NAME, {
    p_subscriber_ids: ids,
  });
  if (!rpcErr) {
    return typeof rpcResult === 'number' ? rpcResult : ids.length;
  }
  if (!isMissingFunctionError(rpcErr)) {
    throw new Error(`cleanup: ${CLEANUP_RPC_NAME} RPC: ${rpcErr.message}`);
  }

  // Fallback — the atomic RPC is not deployed yet (migration 0113 pending).
  // eslint-disable-next-line no-console
  console.warn(
    `[e2e/fixtures/db.ts] ${CLEANUP_RPC_NAME} is not deployed yet (migration 0113 pending) — ` +
      'falling back to the non-atomic per-table cleanup. See A04-010.',
  );
  for (const table of SUBSCRIBER_CHILD_TABLES) {
    const { error: childErr } = await supabaseAdmin
      .from(table)
      .delete()
      .in('subscriber_id', ids);
    if (childErr) {
      throw new Error(`cleanup: child delete on ${table}: ${childErr.message}`);
    }
  }
  // Bespoke — keyed on `id`, not `subscriber_id`. See SUBSCRIBER_ID_KEYED_TABLE.
  const { error: uvErr } = await supabaseAdmin
    .from(SUBSCRIBER_ID_KEYED_TABLE)
    .delete()
    .in('id', ids);
  if (uvErr) {
    throw new Error(`cleanup: child delete on ${SUBSCRIBER_ID_KEYED_TABLE}: ${uvErr.message}`);
  }
  const { error: delErr } = await supabaseAdmin.from('subscribers').delete().in('id', ids);
  if (delErr) throw new Error(`cleanup: subscriber delete: ${delErr.message}`);
  return ids.length;
}

/**
 * Shared by `assertNoSubscriberOrphans`'s reverse probe (full, unscoped
 * sweep) and `findSubscribersMissingBalanceSince` (run-window-scoped sweep
 * for globalTeardown). Returns every subscriber with NO matching
 * subscriber_balances row.
 *
 * When `sinceIso` is omitted this walks the full `subscribers` table (~5k
 * rows today) and fetches the full `subscriber_balances` id column once
 * rather than building a multi-thousand-item `.in()` filter — PostgREST
 * encodes `.in()` in the URL query string, which a candidate set that large
 * would overflow. When `sinceIso` is given the candidate set is expected to
 * be small (whatever one suite run created), so a scoped `.in()` against
 * exactly those ids is precise and cheap.
 *
 * Both the unfiltered `subscribers` fetch and the unfiltered
 * `subscriber_balances` fetch use `fetchAllRows` — this project's Supabase
 * instance silently caps a single PostgREST response at 1000 rows (see
 * POSTGREST_MAX_ROWS), and both tables exceed that (~5,064 / ~5,060 rows
 * today), so a bare `.select()` here would silently check only an arbitrary
 * first-1000 slice and could both under- AND over-report missing balances.
 */
async function subscribersMissingBalance(
  sinceIso?: string,
): Promise<{ id: string; name: string }[]> {
  const candidates = await fetchAllRows<{ id: string; name: string }>((from, to) => {
    let q = supabaseAdmin.from('subscribers').select('id,name').range(from, to);
    if (sinceIso) q = q.gte('created_at', sinceIso);
    return q;
  });
  if (candidates.length === 0) return [];

  const SCOPED_IN_LIMIT = 200;
  let haveBalance: Set<string>;
  if (sinceIso && candidates.length <= SCOPED_IN_LIMIT) {
    const { data: balRows, error: balErr } = await supabaseAdmin
      .from('subscriber_balances')
      .select('subscriber_id')
      .in('subscriber_id', candidates.map((c) => c.id));
    if (balErr) throw new Error(`subscribersMissingBalance: subscriber_balances: ${balErr.message}`);
    haveBalance = new Set((balRows ?? []).map((r) => (r as { subscriber_id: string }).subscriber_id));
  } else {
    const balRows = await fetchAllRows<{ subscriber_id: string }>((from, to) =>
      supabaseAdmin.from('subscriber_balances').select('subscriber_id').range(from, to),
    );
    haveBalance = new Set(balRows.map((r) => r.subscriber_id));
  }
  return candidates.filter((c) => !haveBalance.has(c.id));
}

/**
 * Post-suite probe: walks every subscriber-FK child table and asserts that
 * no row references a `subscriber_id` that no longer exists in `subscribers`
 * (FORWARD direction — child without parent), AND that every subscriber has a
 * matching `subscriber_balances` row (REVERSE direction — parent without
 * child; added 2026-08-25, A04-010). Throws with a clear message naming each
 * offending table + the orphan count if any are found.
 *
 * NOTE ON CALLERS: this function is currently NOT wired into any hook or spec
 * (verified via grep — zero call sites beyond its own definition). It is a
 * full, UNSCOPED sweep — calling it today would immediately fail on the 4
 * pre-existing live `tst-sub-*` rows with no subscriber_balances row (Phase
 * 2's purge target, not this agent's — see guardrail on live deletes). That
 * is why globalTeardown.ts does NOT call this function directly; it uses the
 * baseline-scoped `findSubscribersMissingBalanceSince` instead (see that
 * file's header for why a scoped baseline is required). This function
 * remains available for a future per-spec or fully-clean-baseline use.
 *
 * Each child table is queried explicitly (rather than via the
 * SUBSCRIBER_CHILD_TABLES loop) so that grep audits + per-table error
 * messages name the exact offending source without indirection.
 */
export async function assertNoSubscriberOrphans(): Promise<void> {
  // Fetch the full set of live subscriber IDs once. The seeded demo table is
  // ~5k rows; transactions (probed below) is the real ~30k-row table.
  // fetchAllRows pages past this project's 1000-row-per-response cap
  // (POSTGREST_MAX_ROWS) — a bare `.select()` here would silently check
  // liveIds against only an arbitrary first-1000 slice of subscribers.
  const subRows = await fetchAllRows<{ id: string }>((from, to) =>
    supabaseAdmin.from('subscribers').select('id').range(from, to),
  );
  const liveIds = new Set(subRows.map((r) => r.id));

  const offenders: { table: string; orphanCount: number; sampleIds: string[] }[] = [];

  function reportOrphans(table: string, ids: string[]) {
    const orphans = ids.filter((id) => !liveIds.has(id));
    if (orphans.length > 0) {
      offenders.push({
        table,
        orphanCount: orphans.length,
        sampleIds: Array.from(new Set(orphans)).slice(0, 5),
      });
    }
  }

  /**
   * Fetches every `subscriber_id` value from `table` (paginated — see
   * fetchAllRows) and reports any that are not in `liveIds`. Kept as an
   * explicit named call per table (rather than a loop over an array) so grep
   * audits + this function's own per-table doc comments still name the exact
   * offending source without indirection — same rationale the file has
   * always used, now paginated correctly.
   */
  async function probeSubscriberIdColumn(table: string): Promise<void> {
    const rows = await fetchAllRows<{ subscriber_id: string | null }>((from, to) =>
      supabaseAdmin.from(table).select('subscriber_id').range(from, to),
    );
    // Nullable in some tables (e.g. employer_invites.subscriber_id is ON
    // DELETE SET NULL) — a NULL is "not yet linked to a subscriber", not an
    // orphan, so it is never reported.
    const ids = rows.map((r) => r.subscriber_id).filter((id): id is string => id !== null);
    reportOrphans(table, ids);
  }

  await probeSubscriberIdColumn('transactions');
  await probeSubscriberIdColumn('nominees');
  await probeSubscriberIdColumn('subscriber_balances');
  await probeSubscriberIdColumn('contribution_schedules');
  await probeSubscriberIdColumn('insurance_policies');
  await probeSubscriberIdColumn('subscriber_insurance_products');
  await probeSubscriberIdColumn('claims');
  await probeSubscriberIdColumn('withdrawals');
  await probeSubscriberIdColumn('commissions');
  // Added 2026-08-25 — A06-010: the three tables the list was missing.
  await probeSubscriberIdColumn('money_nonces');
  await probeSubscriberIdColumn('employer_invites');
  await probeSubscriberIdColumn('entity_detach_log');
  // Added 2026-08-25 — A06-010: 0105 NAV snapshot table (no FK).
  await probeSubscriberIdColumn('subscriber_balances_pre_nav');

  // Bespoke — keyed on `id`, not `subscriber_id` (SUBSCRIBER_ID_KEYED_TABLE).
  const unitValuePreNavRows = await fetchAllRows<{ id: string }>((from, to) =>
    supabaseAdmin.from(SUBSCRIBER_ID_KEYED_TABLE).select('id').range(from, to),
  );
  reportOrphans(SUBSCRIBER_ID_KEYED_TABLE, unitValuePreNavRows.map((r) => r.id));

  if (offenders.length > 0) {
    const summary = offenders
      .map(
        (o) =>
          `${o.table} (${o.orphanCount} orphan rows; sample subscriber_id=${o.sampleIds.join(', ')})`,
      )
      .join('; ');
    throw new Error(
      `assertNoSubscriberOrphans: found orphan rows in ${offenders.length} table(s): ${summary}`,
    );
  }

  // REVERSE probe — added 2026-08-25, A04-010: a subscriber with NO
  // subscriber_balances row (parent survives, required child is missing).
  // The forward probes above are structurally blind to this shape — they can
  // only ever find a child pointing at a dead parent, never a parent with a
  // dead/missing child. This is exactly the live shape behind the 4
  // `tst-sub-*` "missing_balance" reconciliation exceptions.
  const missingBalance = await subscribersMissingBalance();
  if (missingBalance.length > 0) {
    const sample = missingBalance.slice(0, 5).map((s) => `${s.id} (${s.name})`);
    throw new Error(
      `assertNoSubscriberOrphans: found ${missingBalance.length} subscriber(s) with NO ` +
        `subscriber_balances row (reverse orphan — A04-010); sample: ${sample.join(', ')}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// globalTeardown leak-sweep probes
// ─────────────────────────────────────────────────────────────────────────
// Every probe below is scoped to rows created SINCE a caller-supplied
// `sinceIso` (the run's baseline — see e2e/global-teardown.ts for how that
// timestamp is computed and why). None of these throw on what they find —
// they report counts + samples, and e2e/global-teardown.ts decides whether
// to fail the run. Kept in db.ts (not global-teardown.ts) so the query logic
// lives next to the rest of this file's DB verification helpers, consistent
// with its existing role.

type LeakProbeResult = { count: number; sampleIds: string[] };

/**
 * Employer-run transactions whose `contribution_run_id` is NULL — the exact
 * shape A06-002 produced (cleanup deleted the `contribution_runs` header
 * before the transactions referencing it; `ON DELETE SET NULL` erased the
 * link). Scoped to `source = 'employer'` deliberately: `source = 'own'`
 * transactions legitimately have a NULL contribution_run_id for the ~27.8k
 * ordinary member-initiated contributions/withdrawals that were never part
 * of any employer run (verified live — `own` + null-run-id is the vast
 * majority of the whole ledger), so that predicate alone cannot discriminate
 * leaked rows from normal ones. A broken run's `own`-leg (staff contribution)
 * rows share the same `txn_ref` as its flagged `employer`-leg row and will
 * turn up next to it under manual investigation.
 */
export async function findOrphanedEmployerTransactionsSince(sinceIso: string): Promise<LeakProbeResult> {
  const { data, error, count } = await supabaseAdmin
    .from('transactions')
    .select('id,txn_ref', { count: 'exact' })
    .eq('source', 'employer')
    .is('contribution_run_id', null)
    .gte('created_at', sinceIso)
    .limit(5);
  if (error) throw new Error(`findOrphanedEmployerTransactionsSince: ${error.message}`);
  return {
    count: count ?? 0,
    sampleIds: (data ?? []).map((r) => `${(r as { id: string }).id} (${(r as { txn_ref: string }).txn_ref})`),
  };
}

/** `settlement_batches` rows carrying the test-only `E2E-` txn_ref prefix. */
export async function findLeakedSettlementBatchesSince(sinceIso: string): Promise<LeakProbeResult> {
  const { data, error, count } = await supabaseAdmin
    .from('settlement_batches')
    .select('id,txn_ref', { count: 'exact' })
    .like('txn_ref', 'E2E-%')
    .gte('created_at', sinceIso)
    .limit(5);
  if (error) throw new Error(`findLeakedSettlementBatchesSince: ${error.message}`);
  return {
    count: count ?? 0,
    sampleIds: (data ?? []).map((r) => `${(r as { id: string }).id} (${(r as { txn_ref: string }).txn_ref})`),
  };
}

/** `subscribers` rows carrying the `tst-sub-` fixture-id prefix. */
export async function findLeakedTestSubscribersSince(sinceIso: string): Promise<LeakProbeResult> {
  const { data, error, count } = await supabaseAdmin
    .from('subscribers')
    .select('id,name', { count: 'exact' })
    .like('id', 'tst-sub-%')
    .gte('created_at', sinceIso)
    .limit(5);
  if (error) throw new Error(`findLeakedTestSubscribersSince: ${error.message}`);
  return {
    count: count ?? 0,
    sampleIds: (data ?? []).map((r) => `${(r as { id: string }).id} (${(r as { name: string }).name})`),
  };
}

/**
 * `settlement_uploads` is a bare idempotency ledger (columns: nonce, result,
 * created_at only — no owner column to filter on), so ANY row created during
 * the run window that is still present at teardown means the owning spec's
 * own nonce-scoped cleanup did not run or did not match.
 */
export async function findLeakedSettlementUploadsSince(sinceIso: string): Promise<LeakProbeResult> {
  const { data, error, count } = await supabaseAdmin
    .from('settlement_uploads')
    .select('nonce', { count: 'exact' })
    .gte('created_at', sinceIso)
    .limit(5);
  if (error) throw new Error(`findLeakedSettlementUploadsSince: ${error.message}`);
  return {
    count: count ?? 0,
    sampleIds: (data ?? []).map((r) => (r as { nonce: string }).nonce),
  };
}

/**
 * Run-window-scoped twin of the reverse probe in `assertNoSubscriberOrphans`
 * — subscribers created during this run with no subscriber_balances row
 * (the A04-010 shape). Baseline-scoped so it does NOT trip on the 4
 * pre-existing live `tst-sub-*` rows (Phase 2's purge target).
 */
export async function findSubscribersMissingBalanceSince(sinceIso: string): Promise<LeakProbeResult> {
  const missing = await subscribersMissingBalance(sinceIso);
  return {
    count: missing.length,
    sampleIds: missing.slice(0, 5).map((s) => `${s.id} (${s.name})`),
  };
}

/**
 * BONUS — extends A25-004's own suggested fix (a `globalTeardown` sweep of
 * `id LIKE 'tst-%' OR name ~* '^(TST|E2E)'`) to `branches`, the table its
 * live evidence actually named ("E2E Branch 1785700415857" etc., attached to
 * d-001). A25-004 itself is owned by a later phase (P7-tests) and also needs
 * an `expect(error).toBeNull()` pass over 8 spec files this fix's write-set
 * does not include — this probe does not close that finding, it only makes
 * sure this suite cannot grow the same class of leak silently going forward,
 * using the mechanism this fix already owns. Baseline-scoped like every
 * other probe here, so it does NOT trip on the 3 pre-existing leaked
 * branches (dated 2026-08-02/03, predating this remediation).
 */
export async function findLeakedTestBranchesSince(sinceIso: string): Promise<LeakProbeResult> {
  const { data, error, count } = await supabaseAdmin
    .from('branches')
    .select('id,name', { count: 'exact' })
    .gte('created_at', sinceIso)
    .or("id.like.b-new-%,name.ilike.TST%,name.ilike.E2E%")
    .limit(5);
  if (error) throw new Error(`findLeakedTestBranchesSince: ${error.message}`);
  return {
    count: count ?? 0,
    sampleIds: (data ?? []).map((r) => `${(r as { id: string }).id} (${(r as { name: string }).name})`),
  };
}

/**
 * Drift guard for SUBSCRIBER_CHILD_TABLES (A06-010) — queries the LIVE
 * schema directly over a raw `pg` connection on `SUPABASE_DB_URL` (same
 * approach as `scripts/seed-supabase.mjs`; `pg` is already a project
 * dependency, no package.json change needed) for every base table in
 * `public` with a `subscriber_id` column, and diffs that against the
 * hand-maintained list above.
 *
 * NOT part of any hot path — cleanupSubscriberByPhone / assertNoSubscriberOrphans
 * never call this, so it adds zero cost/risk to normal spec runs. It exists
 * so a future migration that adds a new subscriber_id-keyed table can be
 * caught by re-running this manually (or wiring it into a dedicated
 * regression spec — outside this fix's write-set, e2e/specs/ is not owned
 * here) instead of silently repeating A06-010.
 *
 * `pg` ships no bundled TypeScript types and `@types/pg` is not installed
 * (package.json is outside this fix's write-set); e2e/*.ts is not
 * type-checked by any current script (A25-006), so this does not break
 * anything, but a minimal local shape is declared here rather than reaching
 * for a blanket `any`.
 */
export async function findChildTableListDrift(): Promise<{ missing: string[]; extra: string[] }> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    throw new Error('findChildTableListDrift: SUPABASE_DB_URL is required (local-only — see .env.local).');
  }
  const { Client } = pgDefault as unknown as {
    Client: new (config: { connectionString: string }) => {
      connect(): Promise<void>;
      query<T>(sql: string): Promise<{ rows: T[] }>;
      end(): Promise<void>;
    };
  };
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(
      `select c.table_name
         from information_schema.columns c
         join information_schema.tables t
           on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public'
          and c.column_name = 'subscriber_id'
          and t.table_type = 'BASE TABLE'
          and c.table_name <> 'subscribers'`,
    );
    const live = new Set(rows.map((r) => r.table_name));
    const known = new Set<string>(SUBSCRIBER_CHILD_TABLES);
    const missing = [...live].filter((t) => !known.has(t)).sort();
    const extra = [...known].filter((t) => !live.has(t)).sort();
    return { missing, extra };
  } finally {
    await client.end();
  }
}

/**
 * Returns a function that restores a commission row's `status` (and the
 * settlement stamp columns `paid_date` / `paid_amount` / `txn_ref`) to the
 * values captured here.
 *
 * Post-0029 the commission lifecycle is the two-state `due → paid` model
 * (the run/dispute/hold/confirm columns were dropped by migration 0029), so a
 * snapshot only has to capture those four columns. Internal helper for the
 * settlement-flow fixtures below.
 */
type CommissionRestoreSnapshot = {
  status: string;
  paid_date: string | null;
  paid_amount: number | null;
  txn_ref: string | null;
};

async function snapshotCommission(commissionId: string): Promise<CommissionRestoreSnapshot> {
  const { data, error } = await supabaseAdmin
    .from('commissions')
    .select('status,paid_date,paid_amount,txn_ref')
    .eq('id', commissionId)
    .maybeSingle();
  if (error) throw new Error(`snapshotCommission(${commissionId}): ${error.message}`);
  if (!data) throw new Error(`snapshotCommission(${commissionId}): row not found`);
  return data as CommissionRestoreSnapshot;
}

async function restoreCommission(
  commissionId: string,
  snapshot: CommissionRestoreSnapshot,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('commissions')
    .update(snapshot)
    .eq('id', commissionId);
  if (error) {
    throw new Error(`restoreCommission(${commissionId}): ${error.message}`);
  }
}

/**
 * Handle returned by `seedDueCommissionForFixture`. `cleanup()` restores the
 * row(s) to their pre-seed state — call it from `afterAll`/`afterEach` so
 * reruns are idempotent.
 */
export type CommissionFixtureHandle = {
  /** IDs of the commission rows the fixture touched. */
  commissionIds: string[];
  /** Restores each touched row's pre-seed status / settlement-stamp fields. */
  cleanup: () => Promise<void>;
};

/**
 * Ensure at least `minCount` `due` commissions exist for the given agent, so a
 * settlement-flow spec has dues to settle regardless of the seed window or a
 * prior run that already paid them off. Strategy:
 *
 *  1. If the agent already has >= `minCount` rows with `status='due'`, return a
 *     no-op handle (nothing disturbed).
 *  2. Otherwise pick the most-recently-paid rows and flip them back to `due`
 *     (clearing `paid_date`/`paid_amount`/`txn_ref`), snapshotting each so
 *     `cleanup()` restores the exact prior state.
 *  3. If the agent has fewer than `minCount` commissions in total, throw — the
 *     spec author should `npm run seed` rather than have the fixture invent
 *     unrelated rows that would violate the UNIQUE(agent_id, subscriber_id)
 *     constraint from migration 0017.
 *
 * Used by the settlement-flow spec to guarantee a settleable `due` slice. The
 * dispute/run fixtures this replaced were retired with the 0029 simplification
 * (no `released`/`disputed` states survive the two-state collapse).
 */
export async function seedDueCommissionForFixture(
  agentId: string,
  minCount = 1,
): Promise<CommissionFixtureHandle> {
  // Step 1: short-circuit if enough due rows already exist.
  const { count: dueCount, error: countErr } = await supabaseAdmin
    .from('commissions')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('status', 'due');
  if (countErr) {
    throw new Error(`seedDueCommissionForFixture: count ${agentId}: ${countErr.message}`);
  }
  if ((dueCount ?? 0) >= minCount) {
    return { commissionIds: [], cleanup: async () => {} };
  }

  // Step 2: flip the shortfall from paid → due, newest-paid first.
  const need = minCount - (dueCount ?? 0);
  const { data: candidates, error: candErr } = await supabaseAdmin
    .from('commissions')
    .select('id')
    .eq('agent_id', agentId)
    .eq('status', 'paid')
    .order('paid_date', { ascending: false, nullsFirst: false })
    .limit(need);
  if (candErr) {
    throw new Error(`seedDueCommissionForFixture: candidates ${agentId}: ${candErr.message}`);
  }
  if (!candidates || candidates.length < need) {
    throw new Error(
      `seedDueCommissionForFixture: agent ${agentId} has too few commissions to reach ` +
        `${minCount} due rows — re-run \`npm run seed\` before invoking this fixture`,
    );
  }

  const snapshots: { id: string; snap: CommissionRestoreSnapshot }[] = [];
  for (const c of candidates) {
    const id = (c as { id: string }).id;
    const snap = await snapshotCommission(id);
    const { error: updErr } = await supabaseAdmin
      .from('commissions')
      .update({ status: 'due', paid_date: null, paid_amount: null, txn_ref: null })
      .eq('id', id);
    if (updErr) {
      throw new Error(`seedDueCommissionForFixture: flip ${id}: ${updErr.message}`);
    }
    snapshots.push({ id, snap });
  }

  return {
    commissionIds: snapshots.map((s) => s.id),
    cleanup: async () => {
      for (const { id, snap } of snapshots) {
        await restoreCommission(id, snap);
      }
    },
  };
}
