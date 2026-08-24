# NEW FINDING · A02-101 — blanket table grants to `anon` and `authenticated`

**Not in the 221.** Found 2026-08-25 during Phase 3 pre-flight. The audit's only two TRUNCATE
mentions (A04-003, A09-003) are about the seed script, not about grants.

**Severity: Medium.** Deliberately *not* filed as Critical — see "Honest exploitability" below.
It is a hardening gap that removes a whole layer of defence, not a live hole.

## Measured

```sql
select count(distinct table_name) from information_schema.role_table_grants
where table_schema='public' and grantee='anon' and privilege_type='TRUNCATE';
--  35        (of 37 public base tables)
```

`anon` and `authenticated` both hold `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES,
TRIGGER` on essentially every table — including `transactions`, `subscriber_balances`,
`commissions`, `nav_snapshots` and `money_nonces`.

This is the shape left behind by Supabase's default
`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`.

## Why it matters even though RLS is on

**RLS does not apply to `TRUNCATE`.** This is documented Postgres behaviour, not a subtlety:
row-level security filters rows for `SELECT`/`INSERT`/`UPDATE`/`DELETE`. `TRUNCATE` is a
table-level DDL-ish operation and is gated *only* by the table grant. Every RLS policy this
platform has — and A02/A03 spend 12 findings hardening them — provides **zero** protection
against a `TRUNCATE`.

So the RLS work in Phase 3 is being done on a table whose privilege floor is "anyone may empty
this entirely".

## Honest exploitability — why this is Medium, not Critical

Checked, rather than assumed:

- **PostgREST exposes no TRUNCATE verb.** There is no HTTP request that reaches it. The grant is
  not reachable through the API as it stands today.
- **`DELETE` *is* reachable** via `DELETE /rest/v1/<table>` — but unlike TRUNCATE it **is** gated
  by RLS, so it is mitigated by the existing policies (and by Phase 3's work on them).
- **No anon-executable `SECURITY INVOKER` function truncates anything.** Of the 13 functions
  `anon` may execute, 11 are `SECURITY DEFINER` (they run as owner, so the anon grant is not what
  authorises them) and the 2 `INVOKER` ones are the `trg_*_enforce_editable_cols` column guards.

So: not exploitable today. It becomes exploitable the moment anyone adds a `SECURITY INVOKER`
function that truncates, or any other path that executes SQL in the caller's context — and the
failure would be total and instant, with RLS offering nothing.

## Suggested fix — owner `P3-rls-writes` (Phase 3, migration in the 0117–0118 range)

Revoke the privileges nothing uses, keeping what PostgREST genuinely needs:

```sql
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;
```

⚠️ **Verify before applying, do not paste this blind:**

1. `TRIGGER` may be load-bearing — confirm nothing relies on the client role creating triggers
   (it almost certainly does not, but check).
2. `REFERENCES` is needed to create FKs against a table; migrations run as `postgres`, not as
   `anon`, so revoking should be safe — confirm.
3. The `ALTER DEFAULT PRIVILEGES` line only affects objects created **afterwards** and only those
   created by the role that runs it. Without it, the next migration re-grants the same mess.
4. Decide `INSERT`/`UPDATE`/`DELETE` separately and carefully — those *are* used by the app
   through RLS, and A02-001 shows the INSERT path is already too permissive. That is
   `P3-rls-writes`'s existing job; this finding is only about the privileges that RLS cannot
   police at all.

## Related, already proven

`docs/audits/2026-08-23/a02/` — A02-001 was reproduced live the same day: a subscriber JWT
inserted a fabricated 999,000,000 UGX contribution straight into `transactions` via the
`transactions_insert_self` policy, whose `WITH CHECK` constrains `subscriber_id` but places no
constraint whatsoever on `amount`, `type` or `status`. Balance went 110.93 units / 174,314 UGX →
635,849 units / 999,174,314 UGX. Rolled back.
