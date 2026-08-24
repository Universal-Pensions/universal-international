# NEW FINDING · A21-101 — PostgREST silently caps every response at 1000 rows

**Not in the 221.** Found 2026-08-25 by `P0-e2e-fixtures` while verifying its own probes.

**Severity: Low–Medium (latent).** Deliberately not filed higher — measured, no production code
path is currently truncated. See "What is actually at risk" below.

## The behaviour

This project enforces a hard `db-max-rows=1000`. It is **not overridable from the client** — a
larger `.limit()` or `.range()` is silently clamped, with no error and no warning:

```
GET /rest/v1/subscriber_balances?select=subscriber_id              -> 1000 rows
GET /rest/v1/subscriber_balances?select=subscriber_id&limit=5000   -> 1000 rows
SELECT count(*) FROM subscriber_balances                           -> 5060
```

Only repeated `.range()` paging gets the rest (`.range(1000,1999)` correctly returns the next
block). A caller that does not page believes it received everything.

## Where it already caused a real bug

`e2e/fixtures/db.ts`'s `assertNoSubscriberOrphans` forward-probes were silently reading only the
first 1000 rows of tables holding up to 29,313. The new reverse-orphan probe reported **56 false
positives instead of the real 4** before this was found. Fixed with a `fetchAllRows` pagination
helper and live-verified.

## What is actually at risk in production — measured, not assumed

15 unbounded selects on large tables exist in `src/services/`. Every one was measured against
live, and **none currently exceeds the cap**:

| Query scope | Max rows today |
|---|---|
| transactions per subscriber | 116 |
| members per employer | 21 |
| commissions per agent | 12 |
| subscribers per agent | 12 |
| platform-wide run-linked contributions (`getEmployerContributions`) | 178 |

The one path that *does* exceed it — the distributor/admin subscriber list — **already pages
correctly** (`src/services/entities.js:455`, `PAGE_SIZE = 1000`, looping to `total`). This is
consistent with A21-001's own evidence (`content-range 0-999/4602`, 6 requests), so A21-001 is
correct and needs no revision.

## Why it is still worth recording

1. **It is silent.** Nothing errors. A query that crosses 1000 rows starts returning wrong
   answers, and any client-side `SUM` over the result becomes quietly wrong. On a money screen
   that is a wrong figure with no symptom.
2. **`getEmployerContributions()` (`src/services/employer.js:559`) has no `employer_id` filter at
   all** — it selects every run-linked contribution platform-wide and relies entirely on RLS for
   scoping. That is safe today at 178 rows, and Phase 1 made this function the canonical source
   for the employer dashboard's headline figure. But it means the headline money number is one
   RLS change and one growth spurt away from being both cross-tenant and truncated.
3. Demo data is small. Real data would not be.

## Suggested fix — Phase 6 (`P6-perf`), alongside A21-001

- Add an explicit `employer_id` filter to `getEmployerContributions()` rather than depending on
  RLS alone. Defence in depth, and it makes the cap irrelevant for that path.
- Reuse `entities.js`'s existing paging helper anywhere a select can plausibly cross 1000 rows,
  or move the aggregate server-side into an RPC so the sum is computed in Postgres.
- Better: **prefer bounded RPCs over client-side aggregation** for any figure shown as money.
  `entities.js:625`'s own comment already says as much — "per-subscriber contribution/withdrawal
  totals are aggregates over `transactions` and need their own bounded RPC."
