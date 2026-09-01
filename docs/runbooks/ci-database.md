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

## Building the database

Either create a fresh project, or rebuild the Tokyo one. Rebuilding it is the
cheaper path in one specific way — CI's secrets already point there, so no
secret rotation is needed — but it currently holds 394 MB and 30,001 subscribers
from before the cutover, and that dataset is what filled its disk in the first
place. Drop the public schema before applying anything.

The organization is on the **free plan** and a project costs **$0/month**, but
the free tier caps active projects and two already exist, so a third may need one
paused first.

```bash
# 1. Apply every migration, in order. 157 files.
SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  node scripts/setup-ci-database.mjs

# 2. Seed it — same URL.
SUPABASE_DB_URL='...' node scripts/seed-supabase.mjs
```

The script refuses to run against `ilkhfnoyxlxwqadebnkp` unless given `--force`,
takes its URL from the environment rather than reading `.env.local` (which is the
owner's live-dev config and must not be touched for this), and wraps **one
transaction per migration** so a failure part-way can be resumed:

```bash
node scripts/setup-ci-database.mjs --dry-run          # list, connect to nothing
node scripts/setup-ci-database.mjs --from=0147_...sql # resume
```

## Finishing it

1. Point the four GitHub secrets at the CI project —
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_JWT_SECRET`. All four were last set 2026-05-27, before the cutover.
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
