# Rollback procedure

**Written:** 2026-08-25 · **Verified against:** the live projects, this tree, and a proven
restore drill. Facts that could NOT be verified from this machine are marked ⚠️ **UNVERIFIED**
— do not treat them as checked.

This exists because the remediation programme for the 2026-08-23 audit performs irreversible
deletes against live production data on a Supabase **free tier with no point-in-time recovery**,
and applies migrations to a database that **has no staging twin**. Applying a migration here
*is* a production deploy.

There are four independent things that can need rolling back. They roll back differently.

---

## 1. Frontend (Vercel)

Auto-deploys from `main`. Merging to `main` **is** shipping.

- Project `uganda-dashboard` — `prj_RseGQ3f8Xdvn4Q46A5G2ALdTYJdg`, team `team_AIl9Olm7YGltQwEVo8EpuKtp`
- **The `vercel` CLI is NOT installed on this machine.** `vercel rollback` is therefore not
  available without installing it first (`npm i -g vercel`). The dashboard path below needs no
  install and is the primary route.

**Dashboard route (primary):** Vercel → project `uganda-dashboard` → *Deployments* → pick the
last known-good production deployment → **⋯ → Promote to Production**. This re-points the alias
at an already-built artefact; it does not rebuild, so it is fast and cannot fail on a build error.

**Record the rollback target BEFORE you ship, not after.** The programme's rule is that each
phase's ledger row names the *prior* production deployment id. Get it from the Deployments list
(or `vercel ls uganda-dashboard` once the CLI is installed) immediately before merging.

⚠️ **UNVERIFIED:** the plan states ~17 prior production deployments are retained. The Vercel MCP
token is expired and the CLI is absent, so this could not be confirmed from here. Check the
Deployments tab before relying on a specific depth of history.

**Verify a rollback landed** with `web_fetch_vercel_url` plus a CSS-hash check — *not* curl
hash-probes, which have previously given false confidence on this project.

---

## 2. Backend (Render)

Service `uganda-dashboard-api` — `srv-d8bc20mgvqtc73afh16g`, region `singapore` (**immutable**).

`render.yaml` sets `autoDeployTrigger: off`, so a push to `main` does **not** ship the backend.
Deploys are manual.

> **`npm run deploy:api` ONLY MOVES FORWARD.** It triggers a new build from the current branch.
> It is not an undo. Reaching for it to "put things back" ships whatever is in the tree now.

**To roll back:** Render dashboard → service → *Events* / *Deploys* → choose the last good deploy
→ **Rollback**. Render redeploys that commit's build.

⚠️ Note `render.yaml` is the *blueprint*, not necessarily the *running* service configuration —
audit finding **A09-006** records that these have drifted, which means a blueprint-driven
rebuild may not reproduce what is actually running. Reconciling them is Phase 6 (`P6-infra-live`).
Until that lands, treat the Render dashboard as the source of truth, not this file and not
`render.yaml`.

---

## 3. Database — migrations

**22 migrations are forward-only.** They have no `.down.sql` and cannot be reverted by file:

```
0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0015 0017
0018 0019 0020 0021 0027 0028
```

All of them are numbered **≤ 0028**, and **every migration from 0029 upward has a `.down.sql`**.
(The plan phrased this as "≤0028 are forward-only", which is right as an upper bound but not
literally true of every file in that range — 0016 and 0022–0026 do have downs.)

### ⚠️ Four down-migrations are booby-trapped

`0042`, `0043`, `0072` and `0089`'s `.down.sql` files each `CREATE OR REPLACE` the trigger
function `public.trg_transactions_contribution` with the body current when they were written,
which hardcodes:

```sql
v_unit_price NUMERIC := 1000;
```

The **live** body has not done that since NAV pricing shipped (0103–0106, 2026-08-08). It reads
the published fund NAV:

```sql
v_unit_price := public.nav_for_date(COALESCE(NEW.date::date, CURRENT_DATE));
```

Running any of those four files silently reverts NAV pricing. Every subsequent contribution
would buy units at the dead 1,000 UGX price, corrupting units, `subscriber_balances` and
platform AUM — with **no error raised**. It also drops the later `LEAST()`/`GREATEST()` guards
that keep unit balances from going negative.

Each of those four files now carries a loud guard header. **Read it before running the file.**

### The rule that prevents this class of bug

`CREATE OR REPLACE FUNCTION` is a **whole-body replace**. It does not merge. So:

> For any `CREATE OR REPLACE FUNCTION`, capture the down body **from the live database** before
> the forward migration applies — never retype it from an older migration file.

```sql
SELECT pg_get_functiondef('public.<function_name>'::regproc);
```

This is not theoretical. `0095` clobbered `0090`'s persona write exactly this way and shipped to
production (2026-08-07), landing approved employers in the wrong tenant.

**Never run `supabase db push` against live.** The `supabase_migrations` ledger versions rows as
**timestamps**, not `0001_*` prefixes, so it is structurally unjoinable to the filenames and a
version-level diff will lie to you. Establish applied state by **introspecting live objects**.

---

## 4. Database — data

The free tier has **no point-in-time recovery**. A `pg_dump` you have actually restored is the
only safety net that exists.

**The drill is proven.** See `docs/audits/2026-08-23/a25/restore-drill.md` — 37 tables,
99,265 rows, byte-identical manifest, 109/109 RLS policies reattached.

```bash
# 1. manifest first — counts are the thing you diff afterwards
psql "$SUPABASE_DB_URL" -tAF'|' -c "
  select table_name,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', table_name), false,true,'')))[1]::text::bigint
  from information_schema.tables
  where table_schema='public' and table_type='BASE TABLE' order by table_name;" > manifest-live.txt

# 2. dump
pg_dump -Fc --no-owner --no-acl --schema=public -f live-public.dump "$SUPABASE_DB_URL"
```

**Restoring needs an `auth` schema stub first.** The dump is `--schema=public`, so Supabase's
`auth` schema is absent — and 108 RLS policies reference `auth.jwt()`. Without the stub they all
fail to restore and you end up with a database that has the data but **no row-level security**:
a silent half-restore that looks fine. The stub is in the drill transcript.

**Per-repair recovery.** Every destructive Phase 2 transaction must first do:

```sql
CREATE TABLE public.<t>_pre_purge_20260824 AS
SELECT * FROM <t> WHERE <the exact purge predicate>;
```

mirroring what `0105` did with `_pre_nav`, and ship a committed `unpurge.sql`. Those tables join
the do-not-drop list. Re-take the dump **immediately before** the purge runs — a snapshot from
hours earlier is missing whatever a rep demoed in between.

---

## Order of operations for an emergency

1. **Stop the bleeding** — promote the last good Vercel deployment. Fastest, no build.
2. **Assess the database.** Frontend rollback does not undo a migration or a delete.
3. **Revert the migration** — only after capturing the live function bodies, and only if it has
   a `.down.sql`, and only after reading its guard header.
4. **Restore data** from the pre-purge tables (`unpurge.sql`) if the loss is scoped, or from the
   dump if it is not.
5. **Render last** — it does not auto-deploy, so it is rarely the thing that broke.
