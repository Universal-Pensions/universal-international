# A26 Adversarial Verification — Documentation Accuracy

**Verifier stance:** refute by default. Reproduced every critical/high against the live
Singapore DB (`ilkhfnoyxlxwqadebnkp`) and the working tree from a clean state; spot-checked
four mediums. A26 has no critical findings, four highs, five mediums, three lows, three infos.
No writes were performed (all repros are reads/greps). **Result: 0 refuted, 3 highs confirmed
as-is, 1 high severity-adjusted, 4 mediums confirmed. No demo-scope exclusions.**

## HIGH findings

### A26-001 — "docs claim RLS blocks direct client writes; it does not" → CONFIRMED (high)
Three factual pillars, all reproduced:
1. Docs assert it verbatim — `CLAUDE.md:126` "RLS would block it"; `CLAUDE.md:107`;
   `api-contracts.md:9` "no writes — writes always go through RPCs"; `role-permissions.md:250`
   "no client write policies".
2. Shipped frontend writes directly — `grep` shows `.insert/.update/.upsert` (non-rpc) at
   `entities.js` (1065/1101/1133/1185/1411) and `subscriber.js` (1049/1212/1219/1399/1403/1411/1463).
3. RLS does NOT block them — live `pg_policies` shows `transactions_insert_self` (PERMISSIVE,
   `WITH CHECK app_role='subscriber' AND subscriber_id=subscriberId`), plus
   `insurance_policies_insert_self` and `insurance_policies_update_self`. The code comment at
   `subscriber.js:1388` even says "Direct writes are gated by the subscriber's own *_update_self RLS."
   The developers rely on RLS *permitting* the write; the doc claims the opposite.
Not demo-scope (the OUT-OF-SCOPE list never sanctions direct client writes; CLAUDE.md claims they
are impossible). Not guarded. The false claim masks a genuine money-minting surface (A02-001);
`transactions_insert_self` does not restrict `type`/`amount`, so a subscriber JWT can POST a
`contribution` row. High is defensible for a load-bearing false security claim. **CONFIRMED.**

### A26-002 — "api-contracts.md directs applying already-applied migration 0092" → CONFIRMED (high)
`api-contracts.md:240` is the corpus's only DIRECTIVE line and it says "0092 is written but NOT
yet applied — apply it out of band." Refuted three ways live: `_normalize_contribution_config`
and `get_my_employer_funding` (both introduced by 0092) are live; zero employers carry the legacy
`mode` key; the same line's other claims are also false (ledger head is `0108_nominee_claims_seed`,
not "stops at 0084"; 108 forward files, not "0001-0091 live").
Destructive-directive framing verified: 0092 is 6 `CREATE OR REPLACE FUNCTION`s, and both
`submit_employer_contribution_run` and `_normalize_contribution_config` were RE-REPLACED by later
migrations (0093, 0094, 0099, **0102 "all_retirement"**). Re-running 0092 would regress those
functions by four migrations, undoing the documented 100%-retirement rule. **CONFIRMED.**

### A26-003 — "MOCK_NOW documented as 2026-05-26; real value 2026-07-01; two code copies drifted"
→ CONFIRMED on facts, **SEVERITY-ADJUST high → medium**
All facts reproduce: `mockData.js:25 = new Date(2026,6,1)` (2026-07-01); `seed-supabase.mjs:169
= new Date(2026,4,26)` (2026-05-26) under a comment insisting it "MUST mirror" mockData.js;
`invariants.spec.ts:52` repeats the stale anchor; `CLAUDE.md:201`, `BACKEND.md:880`,
`FRONTEND.md:301`, `FRONTEND.md:1412` all print 2026-05-26; `_demo_now()` = 2026-05-18 (third clock).
The audit brief explicitly makes MOCK_NOW drift reportable, so it is IN scope — not refuted.
BUT the blast radius is smaller than "high": the three clocks already disagree in the running live
demo (which works), the seed drift is LATENT (G4 forbids re-seeding; even a re-seed only shifts
cosmetic demo relative-dates — no wrong money, no tenant leak, no live-data invariant violation).
This is documentation drift plus a non-manifesting seed-script self-contradiction. severityShouldBe:
**medium**.

### A26-004 — "role-permissions.md disagrees with the measured RLS matrix in seven places" → CONFIRMED (high)
All seven reproduce against live `pg_policies`:
1. `:340` "distributor | All entities, all levels" — self-contradicts `:49` "its OWN network only".
2. `:348` "Distributor: No scoping applied — all data visible" — self-contradicts `:49`.
3. `:349` "distributors_select USING (true)" — live has only `distributors_select_admin`,
   `distributors_select_self`, `distributors_update_self`.
4. `:341-343` branch/agent/subscriber "(+ read-only of the singleton distributors row)" — no
   distributors policy grants those roles SELECT.
5. `:60-62` "agents/branches still platform-wide pending 0084 (shared *_select_authenticated)" —
   live agents/branches carry per-role scoped SELECTs + a RESTRICTIVE `*_scope_distributor` overlay
   and NO `*_select_authenticated` policy. (Minor author imprecision: two `*_select_authenticated`
   policies DO exist, on `commission_config` and `demo_personas` — but none on agents/branches, so
   the substance holds.)
6. `:315` admin SELECT on `contribution_run_lines` — `to_regclass('public.contribution_run_lines')`
   is NULL (table dropped by 0045); self-contradicts `:211`.
7. `:250` "no client write policies" — refuted by the same `*_insert_self`/`*_update_self` policies
   as A26-001.
This is the authorization contract A02 measured its 1,036-cell matrix against; errors 1-5 under-sell
the scoping work, error 7 masks the write hole. **CONFIRMED.**

## MEDIUM spot-checks (4 of 5)

### A26-005 — "12 of 13 'binding' CLAUDE.md rules have no mechanical enforcement; one already violated" → CONFIRMED
`eslint.config.js` rules block has no `no-restricted-imports`/`no-restricted-syntax` (only
no-console, no-unused-vars, react-refresh, and a11y-forced-to-warn); no stylelint config; no
`.husky`, no lint-staged/pre-commit in package.json; 115 `outline: none` across 72 CSS files;
`src/test` has no `auth.uid` assertion; and anti-pattern §5.6 (every write through a DEFINER RPC)
is already breached by the 11 direct-write sites from A26-001. Facts hold; medium leans generous
for a process-gap but the already-violated §5.6 gives it teeth.

### A26-006 — "every schema/architecture census is stale" → CONFIRMED
Live: 37 tables / 89 fn-names / 70 DEFINER / 109 policies / 10 triggers. Docs: `ARCHITECTURE.md:79`
"28 tables · 5 triggers"; `:80` "40 functions (29 DEFINER + 11 INVOKER)"; `:81` "~90 policies";
`BACKEND.md:37` "29 tables · 8 triggers"; `:38` "53 functions"; `:39/:44` "99 policies" — the latter
framed as "Live census (verified 2026-07-08)". All wrong.

### A26-007 — "ledger head documented as 0076; unjoinability mis-framed as '6 missing rows'" → CONFIRMED
Ledger holds 96 rows, head `0108_nominee_claims_seed`. `BACKEND.md:44/:358` (and :1013/:1015/:1019)
say head is `0076`. `render-operational.md:36` says the ledger "is missing 6 local migrations
(0022/0023/0024/0025/0027/0028)", presupposing a shared key between timestamp-versioned ledger rows
and `0001_*` filenames — A00 §7 establishes the two namespaces share no key, so the framing is an
artifact.

### A26-008 — "qa.md misdescribes its own suite" → CONFIRMED
`flows/` has 18 specs (not "~78-test baseline"); `branch-create-agent` spec (listed at qa.md:14)
does not exist; no real `test.fail(` exists anywhere (the lone grep hit is a comment "on test
failure"), yet qa.md:14 claims distributor-create-branch is "marked test.fail"; `db/` has 4 specs
(qa.md:15 lists 3, omitting deactivate-entities); `CreateBranch.jsx` handleConfirm (line 257, not
253) DOES call `createBranch.mutateAsync` (line 260), so bug #2's "never invokes useCreateBranch" is
stale; qa.md:40 "~2 min total" vs measured 24.4 min / 370 cases.

## Verdicts
| id | severity was | verdict | severity should be |
|---|---|---|---|
| A26-001 | high | CONFIRMED | high |
| A26-002 | high | CONFIRMED | high |
| A26-003 | high | SEVERITY-ADJUST | medium |
| A26-004 | high | CONFIRMED | high |
| A26-005 | medium | CONFIRMED | medium |
| A26-006 | medium | CONFIRMED | medium |
| A26-007 | medium | CONFIRMED | medium |
| A26-008 | medium | CONFIRMED | medium |

No finding refuted. No demo-scope exclusion. No writes performed during verification.
