# Phase 2 tail — live verification, 2026-08-25

Six findings are closed here. Five of them were **already repaired** by migrations
`0110`/`0111`/`0112`, but those commits never named the finding IDs — and the
progress tracker deliberately derives closure from **commit messages, not agent
self-reports**, so it went on counting them open. This file is the missing
evidence, re-measured against live today rather than taken from the earlier run.

The sixth, `A12-I01`, was genuinely still open and is closed by `0131`.

Everything below was measured against project `ilkhfnoyxlxwqadebnkp` on 2026-08-25.

---

## Already repaired — re-verified today

| Finding | Sev | Audit's number | Live now | Closed by |
|---|---|---|---|---|
| `A04-009` | medium | 1,881 residue rows / 33 `EMP-` refs / 145,372,000 UGX | **0** rows, **0** refs | `0110` |
| `A06-001` | **critical** | 61% of emp-001 roster balance was E2E money | roster now **81,386,524 UGX**, no residue | `0110` |
| `A14-002` | **critical** | duplicate of A06-001 on the employer surface | same measurement | `0110` |
| `A06-006` | medium | 4 abandoned E2E fixtures on Admin Reconciliation | **0** `tst-sub-*` / `s-e2e-*` rows | `0112` |
| `A15-003` | medium | duplicate of A06-006 | same measurement | `0112` |

```sql
-- A04-009: no EMP- residue transactions remain
select count(*) from public.transactions where txn_ref like 'EMP-%';                    -- 0

-- A04-009: none of the 33 frozen residue refs survive
select count(distinct txn_ref) from public.transactions
 where txn_ref in ('EMP-d7980790', ... , 'EMP-f6de2f1a');                                -- 0

-- A06-001 / A14-002: emp-001 roster balance
select sum(b.total_balance) from public.subscriber_balances b
  join public.subscribers s on s.id = b.subscriber_id where s.employer_id = 'emp-001';   -- 81,386,524

-- A06-006 / A15-003: the E2E fixture subscribers
select count(*) from public.subscribers
 where id like 'tst-sub-%' or id like 's-e2e-%';                                         -- 0
```

**Money invariant re-checked at the same moment** (this is the one that matters —
a purge that leaves balances inconsistent is worse than the residue):

```sql
select count(*) from public.subscriber_balances;                                          -- 5059
select count(*) from public.subscriber_balances
 where total_balance = retirement_balance + emergency_balance;                            -- 5059
select sum(total_balance) from public.subscriber_balances;                                -- 2,354,879,446
```

5059 / 5059. No drift.

---

## `A12-I01` — closed today by `0131`

Two E2E-leftover branch rows in `d-kampala`:

```
b-new-1785700420016  "E2E Branch 1785700415857"  d-001  created 2026-08-02
b-new-1785753024670  "E2E Branch 1785753020590"  d-001  created 2026-08-03
```

### What made this less trivial than it looks

`branches` is referenced by three foreign keys, and **two of them are `ON DELETE
SET NULL`**:

| constraint | column | delete rule |
|---|---|---|
| `agents_branch_id_fkey` | `agents.branch_id` | `RESTRICT` |
| `commissions_branch_id_fkey` | `commissions.branch_id` | **`SET NULL`** |
| `settlement_batches_branch_id_fkey` | `settlement_batches.branch_id` | **`SET NULL`** |

`SET NULL` is the exact mechanism that destroyed the provenance of 1,824 of
`A04-009`'s orphan transactions: the parent went, the FK quietly nulled, and the
rows became unattributable. Had either table referenced these branches, deleting
them would have severed real links **and the undo could not have restored the
association** — the snapshot only holds `branches` rows.

Measured before deleting — all four clear, including the non-FK breadcrumb:

| reference | rows |
|---|---|
| `agents.branch_id` | 0 |
| `commissions.branch_id` | 0 |
| `settlement_batches.branch_id` | 0 |
| `users.entity_id` (no FK exists on this) | 0 |

`0131` re-asserts all four as a guard, so the migration aborts rather than guesses
if any of them is non-zero when it actually runs.

### Frozen ids, not a name prefix

The predicate is an explicit two-id list, **not** `name LIKE 'E2E%'` — the same
reasoning `0110` records for `EMP-`. A name prefix is not a residue marker;
nothing stops a rep creating a branch called "E2E Demo", and a `LIKE` delete
would take it out silently.

### After

| | before | after |
|---|---|---|
| Kampala branch rows | 10 | **8** |
| Kampala `district_branch_count` | 8 | 8 |
| branches total | 320 | **318** |

`district_branch_count` was already 8, so those two rows were **already excluded
from the "#3 of 8" chip**. Removing them brings the row count into line with the
number the UI has been showing all along — **no displayed figure changes.**

Snapshot: `public.branches_e2e_pre_purge_20260825` (2 rows, RLS enabled, FORCE,
`anon`/`authenticated` revoked). Undo: `0131_purge_e2e_branches.down.sql`,
which restores **verbatim from the snapshot** — never recomputed. `0110`'s
recovery originally recomputed balances and the round trip came back
2,022,125 UGX (0.08%) off; a snapshot is the only faithful restore.

---

## Found while verifying: one ERROR-level advisor finding, now closed (`0132`)

Checking that `0131` had not added an advisor finding surfaced one that was
already there: **`public.nav_fixture_rollback_0117` had RLS disabled** and was
`SELECT`able by `anon` and `authenticated`. It was the only one of 47 tables in
`public` without RLS.

`0127` had swept the recovery snapshots by **name pattern**
(`%_pre_purge_%`, `%_wd_sign_fix_%`, `%_pre_nav`). This table matches none of the
three — and `0127`'s standing guard keys on the *same three patterns*, so the
guard shared the blind spot with the sweep it was meant to police.

**The first fix attempt was wrong and the guard caught it.** Broadening the name
list to include `%snapshot%` matched `public.nav_snapshots` — the live NAV
publication table the whole platform reads. Because the guard *asserts* rather
than auto-revoking, it aborted instead of silently revoking `SELECT` on a
business-critical table.

The right discriminator turned out to be **policies, not names**:

| table | RLS | policies | verdict |
|---|---|---|---|
| `nav_snapshots` | on | **1** | deliberate — stays readable |
| every recovery table | on | **0** | denies everything already |
| `nav_fixture_rollback_0117` | **off** | 0 | wide open — the actual hole |

So `0132` states two universal invariants that need no name list at all:

1. every table in `public` has RLS enabled;
2. a table governed by **no policy** must not be API-readable.

It also revoked four **inert** grants (`contribution_run_uploads`, `money_nonces`,
`settlement_uploads`, `subscriber_signup_uploads`) — RLS-on/zero-policy tables
whose `anon`/`authenticated` `SELECT` does nothing today but goes live the moment
anyone adds a permissive policy. Verified 0 client `.from()` references across
`src/`, `server/` and `api/`; all four are reached only through
`SECURITY DEFINER` RPCs, which bypass grant and RLS alike.

### Verified after applying

```
tables in public                          47
RLS disabled                               0
policy-less AND api-readable               0
nav_snapshots still readable (1 policy)  true
nav_fixture_rollback_0117 api-readable   false
```

Role-simulated live probe (`scripts/psql-probe.sh`), as subscriber `s-100117`:

```
latest_nav()            1585.88     <- the real NAV read path, unaffected
own balance readable    1
```

as `anon`:

```
ERROR: permission denied for table nav_fixture_rollback_0117
```

Supabase advisors, security: **0 ERROR, 0 CRITICAL** (86 lints: 18 INFO
`rls_enabled_no_policy` — the deliberate deny-all recovery posture — and 68 WARN
`*_security_definer_function_executable`, previously adjudicated).

`0117_nav_fixtures.down.sql` reads this table as owner/`service_role`, which
bypasses RLS, and is unaffected.

---

## Rollback

| migration | undo |
|---|---|
| `0131` | `supabase/migrations/0131_purge_e2e_branches.down.sql` — restores both rows verbatim from `branches_e2e_pre_purge_20260825`; aborts if the snapshot is missing, holds ≠ 2 rows, or the rows are already live. |
| `0132` | `supabase/migrations/0132_secure_nav_rollback_and_universal_rls_guard.down.sql` — re-disables RLS and restores the grants. **Reverting re-opens an ERROR-level finding**; nothing requires it. |
