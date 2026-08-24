# Platform audit — what we found, in plain language

**Universal Pensions Uganda demo platform · audited 2026-08-23, verified 2026-08-24**

This was a report-only audit covering the whole platform — database, backend, all six role
dashboards, and the frontend. Nothing in the product was changed. We restored the paused database,
signed into every role through the real UI, screenshotted 333 screens, and had every serious finding
independently re-checked by reviewers whose job was to *disprove* it. What follows is written for a
decision, not for engineers — the technical detail is in `FINDINGS.md`.

**The totals: 8 Critical, 25 High, 76 Medium, 68 Low, 44 Info (221 findings).** One finding was
refuted in verification and set aside.

## The one-line verdict

The platform demos well on the happy path, but it has **several problems that would visibly embarrass a
rep in a live demo or show wrong money** — the worst is that a rep literally cannot finish onboarding a
new member — plus a cluster of **test data that has leaked into the real demo database** and is now
showing up on the screens reps actually present. None are hard to fix; the most urgent are small,
one-line changes.

## What is solid

- **Login security is genuinely strong.** We tried to forge, tamper, and downgrade the login tokens
  eight different ways — every attempt was rejected. You cannot fake being an admin.
- **The tenant walls mostly hold.** Across ~1,000 database permission checks, one distributor cannot
  read another distributor's data through the normal app.
- **The money math is correct where it counts.** Every member's balance reconciles to their units ×
  the published fund price. The arithmetic itself is right.
- **The test suite is honest** about what it covers, and the app is fast to build.

## The things to fix before the next demo (the 8 Criticals)

1. **The insurance certificate button is dead for everyone.** Click "Download certificate" on any
   policy — a blank tab opens and a toast tells you to allow pop-ups (which are already allowed).
   Insurance is a headline feature; this fails 100% of the time. *One-line fix.* (A24-001)

2. **The agent onboarding wizard cannot be completed.** A rep who walks a new saver through the full
   sign-up wizard hits a "Couldn't save / Not saved" screen at the final step, every time, on every
   browser. The mock ID scanner returns the *same* national ID number for everyone, and the database
   rejects the second one as a duplicate. Onboarding a member live is impossible. (A11-002)

3. **Switching roles in the same tab shows the previous role's money.** Sign in as admin (2.45-billion
   platform total), then — without "Log out" — sign in as a distributor: the distributor's dashboard
   shows the admin's 2.45-billion instead of their own. Another tenant's money on screen. *One-line
   fix.* (A22-001)

4. **The main demo employer's balances are 61% fake test money.** "Nile Breweries Demo Ltd" — the
   employer every rep shows — has a roster balance that is mostly leftover automated-test data. Its
   dashboard also shows "total contributions" as 182.7M in one place and 15.7M in another, on the same
   screen. The numbers a rep points at are not real and don't agree with each other. (A06-001, A14-001,
   A14-002)

5. **The agent's commission page shows test leftovers as real payments**, with two different
   "outstanding" figures at once (10,000 in the banner, 20,000 in the tile below). (A05-002, A11-001)

6. **One distributor can pay out another distributor's commissions.** The settlement action never
   checks who owns the agents being paid. (A05-001)

*(Findings 4 and 5 each show up on two different screens — the employer test-money and agent
commission problems were each caught independently by two reviewers, which is why the Critical count is
8 but the distinct problems are ~6.)*

## The pattern underneath half the findings: test data in the live database

The single biggest theme is that the automated end-to-end tests **write into the real demo database
and don't fully clean up after themselves**. That one root cause produces at least five separate
symptoms reps can see: fake "E2E Branch" rows under the main distributor, 1,824 orphaned transactions,
the fake employer balances above, the fake commission rows, and junk rows sitting at the top of the
admin review queues. Fixing the test teardown (and pointing the tests at a throwaway database, not the
live one) removes a whole column of this report at once.

## Two landmines that would destroy the demo entirely

- **`npm run seed` wipes the live database** — 5,064 members, 29,027 transactions — with no
  confirmation and no backup, because the only database URL on the machine points at the live project.
  One mistaken command ends the demo permanently.
- **The database silently switched itself off.** The free-tier database auto-pauses after a week idle,
  and the "keep-alive" monitor pings a health check that deliberately never touches the database — so
  it cannot prevent the pause. That is exactly why the platform was found dark when this audit began.
  A rep opening the demo cold gets a blank, data-less screen until someone manually restarts it.

## Money-engine sharp edges (not visible today, but real)

The contribution and withdrawal functions don't fully validate their inputs: a specially crafted call
can create money from nothing (a negative split leg), or poison every balance on the platform with a
"NaN" that can only be repaired with direct database surgery. These need a direct API call to trigger,
so a normal user won't hit them — but they are one motivated tester away, and the fix is a few lines of
input validation the code should have anyway.

## How much work is this?

| Lane | What | Size |
|---|---|---|
| **Before the next demo** | The 5 visible failures + the 2 landmines | Mostly S (one-liners); ~2 are M |
| **Next sprint** | Remaining correctness + input validation + doc corrections | Mixed S/M |
| **Deferred** | Polish, accessibility, dead code, copy | Batchable |

Full sequencing with effort sizes is in `REMEDIATION-BACKLOG.md`.

## Coverage and limitations (completeness critic)

**What was fully covered and verified.** All 26 specialist reviews ran (database schema, RLS,
privileges, money engine, commissions, data integrity, API/auth, contracts, infra, all 7 role
walkthroughs, design, mobile/PWA, desktop, accessibility, performance, state, copy, frontend security,
tests, docs). Every Critical and High finding (38 of them) was re-checked by an independent reviewer
told to refute it; 70 were confirmed, 4 down-graded, 1 refuted. 333 screenshots span every role at
mobile and desktop widths. No Critical or High finding rests on an assertion — each carries a command
and its output, or a screenshot.

**What was thinner than ideal.**
- **The 769–1023px "dead band"** (where the code says neither mobile nor desktop) was flagged and
  spot-checked, not exhaustively shot at every route.
- **Lighthouse performance numbers** were approximated from build output and network traces rather than
  full Lighthouse runs on every page.
- **The full 925-cell RLS matrix** was proven by role-simulation over the policy set, not by 925
  individual HTTP probes; the cross-tenant leak probes (the ones that matter) were run directly.
- **Two areas were deliberately not executed against production** to honour report-only: the
  X-Forwarded-For rate-limit bypass was proven locally but not confirmed on the live Render deployment
  (it would require writing to the shared DB), and no NAV snapshot was ever published against live.

**One honesty note about this audit's own footprint.** Reproducing the findings required some writes to
the shared live database. All test rows were removed and the database restored to its exact starting
counts, with two documented exceptions folded into the findings themselves: 285 employer-run
transactions (left in place *as* the evidence for the test-data-leak findings, because hand-reversing
them risked the wrong-money errors the audit exists to catch) and one 25,000-shilling contribution on
one member. Full ledger: `00d-live-write-ledger.md`. No product code, schema, or configuration was
changed; `git status` shows only the audit folder and one test dependency.
