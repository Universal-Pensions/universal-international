The repo has **9** tests that call themselves invariant or contract guards. They split cleanly into
two populations with opposite epistemic value.

| # | Test | Reads | Proves |
|---|---|---|---|
| 1 | `src/test/jwt-claim-contract.test.js` | `supabase/migrations/*.sql` **text** | text |
| 2 | `src/test/employer-split-contract.test.js` | migration text + `src/utils/contributionModel.js` | text (+ real JS) |
| 3 | `src/test/login-identity-contract.test.js` | migration text | text |
| 4 | `src/test/nav-pricing-contract.test.js` | migration text | text |
| 5 | `src/data/__tests__/insurance-premium-invariant.test.js` | JS constants only | real JS behaviour |
| 6 | `e2e/specs/db/invariants.spec.ts` | **live Postgres** (service role) | deployed behaviour |
| 7 | `e2e/specs/db/rls-isolation.spec.ts` | **live Postgres** | deployed behaviour |
| 8 | `e2e/specs/db/money-idempotency.spec.ts` | **live Postgres** | deployed behaviour |
| 9 | `e2e/specs/db/deactivate-entities.spec.ts` | **live Postgres** | deployed behaviour |

Tests 1–4 are the false-confidence set. Two independent proofs.

**Proof A — they never open a connection.** The *only* occurrence of the string `supabase` in all
four files is a filesystem path:

```
$ grep -n "supabase\|createClient\|SUPABASE\|pg_proc\|psql\|fetch(" src/test/*contract*.test.js
src/test/jwt-claim-contract.test.js:18:const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');
src/test/login-identity-contract.test.js:34:const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');
src/test/employer-split-contract.test.js:31:const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');
src/test/nav-pricing-contract.test.js:17:// Like the sibling contract tests, this parses supabase/migrations/*.sql and
src/test/nav-pricing-contract.test.js:26:const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');
```

They pass with the database **paused**, **restored to a different snapshot**, or pointed at another
project entirely. Every one of the 25 assertions catalogued below "would still pass if the database
were wrong", because the database is not an input.

**Proof B — their own resolver cannot tell a deployed function from a dropped one.**
`docs/audits/2026-08-23/a25/proof-text-vs-live.mjs` re-implements `latestDefinitionOf()` verbatim
from `employer-split-contract.test.js` and feeds it the 19 function names A00 proved exist in
migration text but have **zero OIDs live**:

```
$ node docs/audits/2026-08-23/a25/proof-text-vs-live.mjs
=== (a) the contract tests' own resolver on functions that DO NOT EXIST LIVE ===
  RESOLVED  agent_confirm_commission               -> 0021_commission_rpcs_app_role.sql (1391 chars …)
  RESOLVED  submit_contribution_run                -> 0042_signup_writeflow_hardening.sql (7891 chars …)
  RESOLVED  update_employee_contribution_config    -> 0035_employer_rpcs.sql (1257 chars …)
  … 19 lines …
  => 19/19 phantom functions get a full "newest definition" from the same helper the contract tests use.
```

Had `0029` dropped `submit_employer_contribution_run` instead of the `0021` family, the
employer-split contract test would still be green — it would have happily asserted the allocation
rules of a function nobody can call.

**What the DB actually says today.** For completeness the same script re-ran all 25 assertions
against the LIVE `pg_get_functiondef()` bodies instead of the file text. All 14 functions exist,
each with exactly one OID, and **25/25 assertions agree** — text and deployment currently match:

| test | assertions | text | live | diverging |
|---|---|---|---|---|
| `nav-pricing-contract` | 17 | 17 pass | 17 pass | 0 |
| `employer-split-contract` | 5 | 5 pass | 5 pass | 0 |
| `login-identity-contract` | 3 | 3 pass | 3 pass | 0 |
| **total** | **25** | **25** | **25** | **0** |

So the guards are not *lying* right now. The finding is that they have **no mechanism to notice**
if they started to — which is exactly the failure mode their own header comments describe
(0095 silently un-shipping 0090 via `CREATE OR REPLACE`). A migration-text grep cannot catch a
`CREATE OR REPLACE` that was never applied, an `apply_migration` run against the wrong project, a
hand-edit over `psql`, or a restore to an older snapshot — and A00 proved the ledger cannot be
diffed against the files either, so nothing else in the repo covers that hole.

**Two smaller defects in the same set:**

* `jwt-claim-contract.test.js:45` filters `f.endsWith('.sql')` — it therefore asserts over the 86
  `.down.sql` files too, while its three siblings deliberately filter them out
  (`!f.endsWith('.down.sql')`). For this one rule that is harmless, but the inconsistency means the
  four "sibling" tests do not actually share a corpus.
* None of tests 1–4 requires any environment, so unlike the `e2e/specs/db/**` set they can never be
  "silently skipped" — but equally they can never be *made* to prove behaviour by adding a secret.

**Remedy.** Keep the text greps (they are a genuinely useful pre-merge check on the migration a
developer is writing), but add a *behavioural* twin under `e2e/specs/db/`. It is ~40 lines:
`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n … where p.proname = $1`, then
run the identical regex battery against `prosrc`/`functiondef` and additionally assert
`count(oid) = 1` per name. That single spec would have caught the 0095 regression on the day it
deployed, and it inherits the `§15-M1` executed-not-skipped guard for free.
