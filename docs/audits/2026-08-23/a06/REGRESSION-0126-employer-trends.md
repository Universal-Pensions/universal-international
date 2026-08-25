# REGRESSION — `0126` zeroed the admin "Employers" trends strip

**Found 2026-08-25 while verifying `0131`. Not an audit finding — this programme
caused it.** Severity: demo-visible. Not yet fixed; the fix is a decision for the
user, and the reasoning is below.

---

## What a rep sees

`AdminCountryOverview.jsx:50` → `useEmployerActivityRollup(scope === SCOPES.EMPLOYERS)`
→ `get_employer_activity_rollup()` — the Platform Overview **"Employers" scope
trends strip**. Measured live today, as `admin`:

```
dailyContributions        0        prevDailyContributions        0
weeklyContributions       0        prevWeeklyContributions       202,500
monthlyWithdrawals        0        prevNewSubscribersThisWeek    2
newSubscribersToday       0        prevNewSubscribersThisMonth   4
newSubscribersThisWeek    0
newSubscribersThisMonth   0
topEmployer.contribution  0        topEmployer.name  "Gulu Traders Union"
```

Every **current** window is zero while the **previous** windows still hold data.
On screen that reads as "all employer activity stopped" — and the top-employer
tile names an employer next to a contribution of 0.

## Proof it was `0126`, not pre-existing

A/B measured inside a single rolled-back transaction (`scripts/psql-probe.sh`),
swapping only `public._demo_now()`:

| `_demo_now()` | daily | weekly | newThisMonth | topEmployer |
|---|---|---|---|---|
| `2026-07-01` (live, after `0126`) | **0** | **0** | **0** | **0** |
| `2026-05-18` (before `0126`) | **2,358,000** | **2,463,000** | **1** | **7,179,000** |

The harness confirmed `probe-txn-state: open with writes (safe, will roll back)`
and rolled back; the live clock was re-verified at `2026-07-01 23:59:59+00`
afterwards.

## Why it happened

`0126` was **correct on its own terms**. Audit finding A06-009 was that five
copies of "now" had drifted up to 44 days apart, and `0126` unified
`public._demo_now()` (2026-05-18) onto the JS anchor `MOCK_NOW` (2026-07-01).
That is a real fix and should stand.

What it could not move was the **seeded employer data**, which is anchored the
other way round:

- `src/data/employerSeed.js:203-209` — `RUN_DATES` are **absolute UTC literals**
  (`2026-03-15` … `2026-05-18`), not clock-relative.
- `employerSeed.js:169-172` states the calibration outright: *"Anchored to
  `_demo_now()` (2026-05-18) via days-ago-from-MOCK_NOW (**MOCK_NOW = _demo_now
  + 8d**): day 8 = today/this-week."*

That `+8d` relationship is what `0126` removed — both clocks are now the same
value, so an 8-days-ago member lands in **last** week rather than *this* week,
and every run header sits 44+ days before "this month".

`0126`'s own verification did check the clock move, but against **global
`transactions`** counts. This rollup is **employer-scoped** and reads
`contribution_runs`, a population `0126` never sampled. That is the whole gap.

Live now: `run-005` is `2026-05-18 12:00:00+00`, still labelled *"May 2026
latest"*, while the demo clock reads `2026-07-01`.

## Blast radius

Four RPCs read `_demo_now()`:

| RPC | effect |
|---|---|
| `get_employer_activity_rollup` | **broken** — every current window 0 (above) |
| `get_top_branch` | **changed** — `Ntinda 1,811,690` → `Rubaga 436,054`; a different winner and a 4× smaller figure |
| `get_entity_metrics_rollup` | not established — the probe's JSON path returned null on both sides, so **no claim is made** either way |
| `submit_hospital_cash_claim` | not exercised (a write path; not probed) |

The seeded `t-wd-empe-*` withdrawals in `employerSeed.js` are **absent from
live** (emp-001 has 0 withdrawal rows), so that half is mock-only and not part of
the live symptom.

## Why it is not fixed here

Three routes, none of them safe to take unilaterally:

1. **Revert `0126`.** Cheap and instantly effective — and wrong. It restores the
   44-day JS/SQL split that A06-009 is about, re-breaking a finding this
   programme closed.
2. **Re-seed** (`npm run seed`). Explicitly forbidden by the programme
   guardrails, and destructive: a prior reseed in this project's history was
   recorded as a destructive live operation.
3. **Shift the seeded dates forward in live by migration.** The surgical option,
   but it moves **money-bearing rows' dates** — `contribution_runs.run_at` and
   the transaction legs beneath them — on a free-tier database with **no
   point-in-time recovery**. Shifting headers without their legs desynchronises
   them; shifting both is a wide, reversible-only-by-snapshot operation.

Route 3 is the right one, and it needs the user's explicit go-ahead per the
programme's "one writer to live, approval per action" rule.

## The source fix, separately

Even after live is repaired, `RUN_DATES` will regenerate the defect on the next
legitimate reseed, because they are absolute. They should be derived from
`MOCK_NOW`.

⚠️ **Do not naively make them relative.** `employerSeed.js:198-201` records why
they are absolute: *"EXPLICIT UTC dates at midday (T12:00Z) so `date_trunc('day')`
stays timezone-stable across machines (a MOCK_NOW + local-tz basis dropped the
'today' sample to 05-17 on a UTC+5:30 host)."* A correct fix derives the offsets
from `MOCK_NOW` **in UTC** and keeps the midday-UTC convention — preserving both
properties. The offsets to preserve, measured from the old anchor:

| run | old date | offset from `_demo_now()` |
|---|---|---|
| run-001 | 2026-03-15 | −64d |
| run-002 | 2026-04-15 | −33d |
| run-003 | 2026-05-05 | −13d |
| run-004 | 2026-05-14 | −4d |
| run-005 | 2026-05-18 | 0d (= "today") |

`periodLabel` is currently a hand-written month name and would have to be derived
too, or it drifts out of step with its own date.

## Related

This is the live half of escalation **E23**, previously recorded as BLOCKED
pending A04-003 (NAV pricing). NAV pricing has since shipped (`0103`–`0107`,
`0116`, `0117`), so the ordering dependency is cleared — but the blocker is now
approval and blast radius, not sequencing.
