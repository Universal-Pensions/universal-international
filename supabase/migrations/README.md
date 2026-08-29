# Migrations — what's applied, and how to know

**Check it, don't guess:**

```sh
npx dotenv -e .env.local -- node scripts/migration-status.mjs
```

Exit `0` means the repo and the live ledger agree. Exit `1` means drift, and the
output says which direction.

---

## The rule

**Apply migrations with `scripts/apply-migration.mjs` or the Supabase MCP
`apply_migration`.** Both record a row in `supabase_migrations.schema_migrations`
in the same transaction as the SQL. Anything else — a paste into the SQL editor,
a raw `psql` run — applies the change without recording it, and the next person
cannot tell whether it is live.

```sh
npx dotenv -e .env.local -- node scripts/apply-migration.mjs supabase/migrations/0140_thing.sql
```

Write the `.down.sql` at the same time. The 2026-08-26 review counted 25 forward
migrations with no reverse; every one of those is a change that cannot be undone
without writing new SQL under pressure.

---

## What went wrong, so it isn't repeated

Until 2026-08-29 `apply-migration.mjs` applied SQL and **never wrote a ledger
row**. Every migration applied through it was invisible to `supabase migration
list` and to the MCP `list_migrations`. By the time anyone asked "is everything
live?", 48 of 136 migrations had no record, and answering took a 37-way probe of
the live catalog — one bespoke assertion per migration.

Three things came out of that:

1. **`apply-migration.mjs` now records.** One `INSERT`, inside the existing
   transaction, keyed on `name` so re-applying a file never duplicates a row.
2. **The ledger was backfilled** for 36 migrations, each *verified present on
   live by catalog probe* before being recorded — never inferred. They carry
   `created_by = 'backfill-2026-08-29-verified-by-catalog-probe'`.
3. **Two migrations existed only in the database.** `0069_..._scope_guard` and
   `employer_invite_schedule_uses_member_default` had ledger rows and no repo
   file. Both were recovered from `schema_migrations.statements` into
   `0069b_*` and `0102b_*`. **One of them was a security fix** — a JWT
   `app_role`/`branchId` scope guard on a `SECURITY DEFINER` RPC that had let any
   authenticated user read any branch's agent roster. A rebuild from the repo
   would have silently dropped it.

That last one is the argument for the rule: the ledger was the only copy.

---

## Known, deliberate exceptions

| Migration | Status |
|---|---|
| `0130_rls_policy_consolidation` | **Authored, deliberately NOT applied.** Its own header carries a boxed "RECOMMENDED NOT TO BE APPLIED" — adjudication EXCLUDE, upheld: a cross-tenant PII risk for 6–11 ms behind a ~93 ms round trip. Do not apply without overruling that. |
| `0067a_*`, `0067b_*` | Applied under those names; later consolidated in the repo into `0067_employer_multiproduct_insurance`. Same SQL, one file. |
| 16 rows | Recorded before the `NNNN_` prefix convention (`distributor_scope_rls` is `0081_distributor_scope_rls`). The status script matches on the bare name and lists them separately. |

Both exception lists live in `scripts/migration-status.mjs` as `INTENTIONALLY_UNAPPLIED`
and `CONSOLIDATED_INTO`. Add to them only with the reason written down — an
unexplained entry there turns the check back into prose.

---

## What this still does not solve

The ledger answers *"was this applied?"*. It does not make the database
**reproducible**: there is no schema baseline, and at least 13 migrations in the
`0101`–`0139` range are data-dependent (they `UPDATE`/`DELETE`/`INSERT` against
live rows). Replaying from `0001` against an empty database does not yield live.
Fixing that needs a squashed `NNNN_baseline.sql` schema dump — tracked as §2.2 of
the 2026-08-26 review, not urgent, and the cost grows per migration.
