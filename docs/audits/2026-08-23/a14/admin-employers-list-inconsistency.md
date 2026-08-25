# NEW — the admin employers list and the employer's own dashboard disagree

**Found 2026-08-25**, routed from `P3-escalation-owners` while it closed E25.
Not one of the 221 audit findings. Demo-visible.

> ## ✅ RESOLVED 2026-08-25 — option 2, relabel rather than recompute
>
> `ViewEmployers.jsx`'s tile now reads **"Paid in by members"** instead of
> "Contributed", with a `title` spelling out the difference, and the header
> summary matches. No figure moved.
>
> Option 1 (make the admin list run-linked) was **not** taken, for the reason
> below: it would render "Contributed: 0" for six of eight employers. Both
> numbers were always correct — the label was what made them look
> contradictory.

---

## The measurement

`src/admin-dashboard/employers/ViewEmployers.jsx:155` renders
`e.totalContributions` under the label **"Contributed"**, straight from
`get_all_employers_metrics` with **no override** (`employer.js` —
`return data ?? []`).

Measured live, as `admin`:

| employer | admin list "Contributed" | run-linked (employer's own dashboard) |
|---|---|---|
| Nile Breweries Demo Ltd (`emp-001`) | **62,397,000** | **14,590,000** |
| Mbarara Dairy Co-op (`emp-002`) | 21,300,000 | **0** |
| Gulu Traders Union (`emp-003`) | 15,300,000 | **0** |
| Jinja Steel Mills (`emp-004`) | 27,555,000 | **0** |
| Mbale Coffee Collective (`emp-005`) | 12,240,000 | **0** |
| Wakiso Agro Ltd (`emp-006`) | 15,292,500 | **0** |
| Lira Cotton Ginnery (`emp-007`) | 13,560,000 | **0** |

`0049_admin_role.sql:267` sums **every** `t.type = 'contribution'` row for the
employer's members. Run-linked counts only legs carrying a
`contribution_run_id`. The gap is members' **personal top-ups**.

## Why this is now visible

`A14-001` was a high-severity finding about exactly this arithmetic, and it was
fixed — **on the employer's own surfaces** (`surface:` Overview, Runs, Analytics;
`roles_affected: ['employer']`). The admin's cross-employer list was never in its
scope and still reads the raw RPC.

So the fix created a **cross-role** disagreement where there used to be a
consistent (if wrong) number: an admin opens the employers list, sees Nile
Breweries at 62.4M, clicks into that employer, and sees 14.59M. Two clicks,
4.3x apart, same company.

A14-001's own evidence anticipated the shape of this: *"Systemic: psql shows
emp-002..007 have metrics totals 12-27M but 0 run-linked."*

## Why the obvious fix is wrong

Mirroring `getEmployerMetrics`'s override into `getAllEmployersMetrics` would
make the admin list run-linked — and **six of the seven employers would render
0**, because their seeded contributions are all personal top-ups with no payroll
run behind them. A list of employers showing "Contributed: 0" for six of eight
rows is a worse demo than an inconsistent one, and it would look like the purge
broke something.

This is the same trap recorded earlier in this programme: a Phase 2 estimate
nearly reported the employer dashboard would "drop to zero", and that turned out
to be a bad predicate rather than a real effect. The number being smaller is not
the same as the number being right.

## Options

A14-001's own `suggested_fix` already offers the two directions, and the second
is the one that fits here:

1. **Make the admin list run-linked.** Consistent, and zeroes six employers.
   Only defensible alongside a data fix that gives those employers real payroll
   runs — which is the *same* seeded-data problem as
   `../a06/REGRESSION-0126-employer-trends.md`, and blocked on the same approval.
2. **Relabel, don't recompute.** *"Relabel/split ... so members' personal top-ups
   (`contribution_run_id` NULL) are not counted as employer run funding."* On the
   admin list the tile is labelled "Contributed", which is defensible for
   *all member contributions* — it just must not read as employer payroll
   funding. Making the label explicit (e.g. "Member contributions") removes the
   contradiction without changing a single figure or zeroing anything.

**Recommendation: option 2**, and it is cheap. Option 1 should wait until the
seeded employers have payroll runs, at which point both surfaces agree naturally.

## The other half — `insuredCount`

`get_all_employers_metrics` also carries the raw `WHERE ip.status = 'active'`
count that E25 just replaced with `deriveCoverStatus` on the single-employer
path. Measured live: **0 self-funded lapsed employer-roster policies**, so it is
**latent, not visibly wrong today** — the same verdict E25 reached. It will drift
on the first lapse. Fixing it means resolving each employer's roster
(`getEmployees` per employer, N+1 across 7 employers) or correcting `0049`'s SQL;
the SQL route is cleaner and is the one to take when option 1 or 2 above is
decided, so both changes land together rather than touching this function twice.
