# The CI database

## What was wrong

CI's four Supabase secrets pointed at project **`zengmiugieqjqzaccbqe`** —
*"Uganda dashboard (inactive)"*, the Tokyo project abandoned in the 2026-06-05
cutover. Its last migration is `20260603173045`.

So every Playwright E2E run for roughly three months executed against a database
with none of the distributor scoping, none of the NAV pricing and none of forward
dealing.

| | Live `ilkhfnoyxlxwqadebnkp` | CI's target `zengmiugieqjqzaccbqe` |
|---|---|---|
| Region | Singapore | Tokyo |
| `transactions.source` | yes | **no** |
| `branches.distributor_id` | yes | **no** |
| `fund_dealing_config` | yes | **no** |
| Last migration | 0161 | 3 June 2026 |
| Subscribers | 5,060 | 30,001 (the pre-cutover bloat) |

That reproduces the three CI errors exactly:

```
findOrphanedEmployerTransactionsSince: column transactions.source does not exist
seed branch: Could not find the 'distributor_id' column of 'branches' in the schema cache
paid commissions missing paid_amount
```

Identical failures appear on `97d36e2` and `95f6d28`, so this long predates
forward dealing.

**Two things follow, and the second is easy to miss.** The suite has validated
nothing for months — and the 43-entry allowlist at
`docs/audits/2026-08-23/a25/baseline-failures.txt` is mostly an artefact of the
wrong database rather than a record of real bugs. Regenerate it, or the gate goes
on forgiving the wrong things.

Also note `.github/workflows/test.yml` claims the DB invariants "run against the
live `ilkhfnoyxlxwqadebnkp` project". That was never true. Fix the comment.

## Why CI does not get production credentials

This is not hypothetical. During the unitization work the E2E suite leaked real
money into the live database **twice** — 30,000 UGX of pending contributions and
a 50,000 UGX cost-basis change, both against real seeded members, both repaired
from `_pre_unitization_balances`. The specs are written to roll back and there is
a leak sweep in `e2e/global-teardown.ts`, and it still happened.

The leak sweep is also why the delta gate fails the job on *out-of-test* errors
(`scripts/e2e-delta.mjs:260-265`). That is the gate working, not a nuisance:
its header records that a run which leaked rows into production once passed both
gates. **Do not weaken it.**

## State as of 2026-09-01 — Tokyo is being REMOVED, not rebuilt

An earlier version of this runbook said to rebuild `zengmiugieqjqzaccbqe` as the
CI database, because CI's secrets already pointed there so no rotation would be
needed. **That advice is withdrawn.** Keeping a project named *"Uganda dashboard"*
that is not the Uganda dashboard is what caused this in the first place: anyone
opening the Supabase console looking for this repo's database finds the dead one,
because until 2026-09-01 the live project was called `Pension dashbaord` —
misspelled, and not obviously this product. It is now `Uganda dashbaord 1`
(the typo survived the rename); the durable identifier is the ref
`ilkhfnoyxlxwqadebnkp`, never the name.

The project has been emptied and **paused**, and holds nothing: 0 auth users,
0 identities, 0 storage buckets, 0 storage objects, 0 public tables, 0 functions,
0 migration records. Deleting it loses nothing. Deletion is dashboard-only:

> Supabase -> project `zengmiugieqjqzaccbqe` -> Settings -> General -> Delete project

Rename the live project at the same time. The typo plus the name collision is the
entire trap.

## Nothing in the product depended on it

Verified six ways on 2026-09-01, before removal:

| Check | Result |
|---|---|
| Repo, every file type | Only docs and comments — no code, no config |
| Shipped frontend (56 assets, 3.1 MB) | 0 references; exactly one Supabase host, the live one |
| Render API | Authenticated a bcrypt hash that exists only in the live `users` table |
| Render logs since 2026-08-25 | No mention of the old host |
| `.env.local` | Resolves to the live project |
| The old project itself | Empty on every schema, `auth` and `storage` included |

The one consumer was CI, whose four secrets were last set 2026-05-27 — nine days
before the cutover.

## Choosing a CI database

Two honest options:

1. **A dedicated CI project.** Create one, *name it for CI*, run
   `scripts/setup-ci-database.mjs` and then the seed against it, and repoint the
   four secrets. Costs one rotation; CI never holds production credentials.
2. **Point CI at live.** No new project, but the E2E suite then mutates
   production on every PR — and it leaked into live twice during the unitization
   work, which is why option 1 is recommended.

`scripts/setup-ci-database.mjs` is target-agnostic either way: it takes
`SUPABASE_DB_URL` from the environment, refuses the production ref without
`--force`, and applies the 157 migrations one transaction each so a failure can
be resumed with `--from`.

## Finishing it

1. Point the four GitHub secrets at whichever database you chose —
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_JWT_SECRET`. All four were last set 2026-05-27, nine days before the
   cutover, which is why they still named Tokyo.
2. Run the E2E suite.
3. **Regenerate `baseline-failures.txt` from scratch.** Every surviving entry
   should be a real known bug with a reason next to it. The current file cannot
   be trusted — it was frozen against a schema three months out of date.
4. Correct the `.github/workflows/test.yml:230` comment.

## How you will know it worked

The three errors above disappear, and `[global-teardown] leak sweep clean` shows
in the job log. If the delta gate still reports out-of-test errors, the teardown
is failing to run — treat that as blocking, because it is the only thing standing
between the E2E suite and someone's money.
