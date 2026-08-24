# Restore drill — Phase 0 deliverable

**Run:** 2026-08-25 · **Operator:** Claude (remediation programme Phase 0, `P0-rollback`)
**Status: PASSED.** Phase 2's recovery gate is satisfied.

> The plan's wording is deliberate: *"prove it restores into a scratch Postgres — the drill is
> the deliverable, not the dump."* A dump nobody has restored is a hope, not a backup. This
> file is the proof.

## Deviation from the plan

The plan specified a **Postgres 17 container**. Docker is not installed on this machine
(`which docker` → not found; no colima/podman/lima either). The drill instead used a
**freshly-initialised local PostgreSQL 18.3 cluster** in the session scratchpad, on port 5433,
isolated from the two pre-existing Homebrew clusters (which have no usable superuser role).

Live is **PostgreSQL 17.6**. A 17 → 18 restore is forward-compatible and is the direction
`pg_restore` supports; the reverse would not be. This deviation does not weaken the proof.

## What was captured

```
# live row-count manifest
psql "$SUPABASE_DB_URL" -tAF"|" -c "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false,true,'')))[1]::text::bigint
  from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE' order by table_name;"

# dump
/opt/homebrew/opt/postgresql@18/bin/pg_dump -Fc --no-owner --no-acl \
    --schema=public -f live-public.dump "$SUPABASE_DB_URL"
```

Artefact lives **outside the repo** (it contains live member data):

```
/private/tmp/claude-501/-Users-shubhang/b27ec2e1-6146-468e-bdff-78bb7ca40ecb/scratchpad/p0-snapshot/live-public.dump 2.5M
path: /private/tmp/claude-501/-Users-shubhang/b27ec2e1-6146-468e-bdff-78bb7ca40ecb/scratchpad/p0-snapshot/
```

## Restore

The dump is `--schema=public` only, so Supabase's `auth` schema is absent. RLS policies
reference `auth.jwt()`; without a stub, **108 policy statements fail to restore** and you get a
database with data but *no row-level security* — a silent, dangerous half-restore. The drill
therefore creates an `auth` stub first. **Any real recovery must do the same.**

```sql
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true),'')::jsonb $$;
create or replace function auth.uid()  returns text language sql stable as $$ select auth.jwt() ->> 'sub'  $$;
create or replace function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
-- roles anon / authenticated / service_role must exist too
```

Then:

```
createdb  -h 127.0.0.1 -p 5433 -U postgres ug_restore_drill
pg_restore -h 127.0.0.1 -p 5433 -U postgres -d ug_restore_drill --no-owner --no-acl live-public.dump
```

## Proof — live vs restored

| | live (`ilkhfnoyxlxwqadebnkp`, PG 17.6) | restored (scratch, PG 18.3) |
|---|---|---|
| tables in `public` | 37 | 37 |
| total rows | 99265 | 99265 |
| RLS policies on `public` | 109 | 109 |

**Manifest diff — the actual gate:**

```
$ diff manifest-live.txt manifest-drill.txt
(no output — the two manifests are identical)
```

### Per-table counts (both sides identical)

| table | rows |
|---|---|
| `access_requests` | 5 |
| `agent_referrals` | 0 |
| `agents` | 2046 |
| `branches` | 321 |
| `claims` | 1907 |
| `commission_config` | 3 |
| `commissions` | 5001 |
| `contact_submissions` | 0 |
| `contribution_run_uploads` | 33 |
| `contribution_runs` | 9 |
| `contribution_schedules` | 5022 |
| `custody_transfers` | 9 |
| `demo_personas` | 9 |
| `distributors` | 3 |
| `districts` | 136 |
| `employer_invites` | 4 |
| `employers` | 8 |
| `entity_detach_log` | 0 |
| `entity_status_log` | 66 |
| `insurance_policies` | 2731 |
| `money_nonces` | 10 |
| `nav_snapshots` | 1246 |
| `nominee_claims` | 9 |
| `nominees` | 24388 |
| `notifications` | 14 |
| `regions` | 4 |
| `settlement_batches` | 7 |
| `settlement_uploads` | 157 |
| `subscriber_balances` | 5060 |
| `subscriber_balances_pre_nav` | 5060 |
| `subscriber_insurance_products` | 1473 |
| `subscriber_signup_uploads` | 98 |
| `subscribers` | 5064 |
| `subscribers_unit_value_pre_nav` | 5064 |
| `transactions` | 29313 |
| `users` | 48 |
| `withdrawals` | 4937 |

## What this does and does not prove

**Proven.** Every row in every `public` table survives a dump/restore cycle, and all 109 RLS
policies reattach once the `auth` stub exists. If Phase 2's purge deletes the wrong rows, they
can be brought back.

**Not proven — read before relying on this.**

- The dump is `--schema=public`. It does **not** contain `auth.users`, storage objects, Realtime
  config, Edge Functions, or project settings. This is a *data* backup, not a project backup.
- The restore target is a bare Postgres, not a Supabase project. Restoring **into a live Supabase
  project** is a different operation and has not been drilled.
- The dump is a point-in-time snapshot. Anything written to live after it is not in it — so
  re-take it immediately before Phase 2 runs, not from this file's timestamp.
- The free tier has **no point-in-time recovery**. This dump is the only safety net there is.
