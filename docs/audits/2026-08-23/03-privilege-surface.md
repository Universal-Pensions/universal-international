# A03 · Privilege & Grants Surface

**Scope:** Establish exactly what an unauthenticated (`anon`) caller can invoke, and prove each
case is intentional or a hole. Cites `docs/audits/2026-08-23/00-baseline.md` (ground truth) and
`00d-live-write-ledger.md`. **DB:** `ilkhfnoyxlxwqadebnkp` (live), PostgreSQL 17.6. Queries via
direct `psql` as `postgres`, and via PostgREST (`/rest/v1/...`) as `anon` using the public anon key.

> **Round 2 note.** This supersedes the round-1 file preserved at
> `docs/audits/2026-08-23/round1-backup/03-privilege-surface.md`. Every check was re-run from
> scratch. The material improvement this round is on **A03-001**: I added a read-only proof that
> the RPC's *own* branch-selection SELECT resolves to a real live victim row, so the only
> unobserved step is the unconditional `UPDATE` inside that branch. No committed writes were made
> (see §Integrity) — the one end-to-end `BEGIN…ROLLBACK` reproduction was blocked by the auto-mode
> write classifier before it executed, exactly as it was in round 1.

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 89 live functions · 4 sequences · 1 view · 37 tables · 2 build bundles (dist/, dist-server/) |
| Artifacts examined | 89 functions · 4 sequences · 1 view · 37 tables · dist/ + dist-server/ |
| Coverage | 100% of the 8 defined checks |
| Checks defined | 8 |
| Checks executed | 8 |
| Checks passed / failed / blocked | 7 / 1 / 0 |
| Findings C / H / M / L / I | 0 / 1 / 0 / 2 / 3 |
| Evidence commands run | 21 |
| Excluded as demo-scope | 3 (no rate-limit/SMS-OTP gate on `create_subscriber_from_signup` flood; duplicate-phone accumulation on `is_demo_signup=true` rows; nonce-idempotency replay returning the prior id) |
| Blocked, with reason | 1 partial — auto-mode write classifier blocked the single `BEGIN…ROLLBACK` reproduction of A03-001's `UPDATE`, so it was not observed firing end-to-end; substituted with live `prosrc` + read-only branch-selection proof + `anon` EXECUTE (A03-001 confidence = **plausible**, deterministic). |

### Domain metrics (required by spec)
| Metric | Value |
|---|---|
| Functions probed | 89 |
| Anon-executable count | **13** (exactly baseline §5.2: 3 intentional grants + 10 trigger fns; **zero** extras) |
| Anon calls that performed **unexpected** work | **0** (10/10 trigger fns refused; the 3 grants perform work only by design) |
| Intentional-grant abuse cases run / that performed unexpected work | 9 run / **0** |
| Bundle secret hits (service_role key / JWT secret value) | **0** in dist/ and dist-server/ |

---

## Check 1 — anon EXECUTE surface (PASS)

`has_function_privilege('anon', oid, 'EXECUTE')` over all 89 live `public` functions:

```
psql -c "SELECT count(*) total,
  count(*) FILTER (WHERE has_function_privilege('anon',p.oid,'EXECUTE')) anon,
  count(*) FILTER (WHERE has_function_privilege('authenticated',p.oid,'EXECUTE')) auth,
  count(DISTINCT p.proname) distinct_names
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f';"
=> 89|13|87|89
```

Exactly **13** anon-executable; 89 OIDs for 89 names (zero overloads). The 13, verbatim:

```
psql -c "SELECT p.proname, pg_get_function_identity_arguments(p.oid), prosecdef, pg_get_function_result(p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f' AND has_function_privilege('anon',p.oid,'EXECUTE')
 ORDER BY (pg_get_function_result(p.oid)='trigger'), p.proname;"
=>
create_subscriber_from_employer_invite | payload jsonb, p_token text, p_nonce text | DEFINER | text
create_subscriber_from_signup          | payload jsonb, p_nonce text               | DEFINER | text
get_employer_invite                    | p_token text                              | DEFINER | jsonb
block_inactive_employer_run            | ()                                        | DEFINER | trigger
block_inactive_employer_subscriber     | ()                                        | DEFINER | trigger
block_inactive_employer_subscriber_update | ()                                     | DEFINER | trigger
guard_mass_subscriber_detach           | ()                                        | DEFINER | trigger
trg_branches_default_distributor       | ()                                        | DEFINER | trigger
trg_distributors_enforce_editable_cols | ()                                        | INVOKER | trigger
trg_subscribers_after_insert           | ()                                        | DEFINER | trigger
trg_subscribers_enforce_editable_cols  | ()                                        | INVOKER | trigger
trg_transactions_contribution          | ()                                        | DEFINER | trigger
trg_transactions_withdrawal            | ()                                        | DEFINER | trigger
```

3 intentional grants (text/jsonb-returning) + 10 zero-arg `RETURNS trigger` functions. **No
function is anon-executable that is not on the baseline list.** The `0021` commission family is
absent (Check 3). Cross-check — grant distribution over all 89:

```
psql -c "SELECT has_function_privilege('anon',p.oid,'EXECUTE') anon,
  has_function_privilege('authenticated',p.oid,'EXECUTE') auth, count(*)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f' GROUP BY 1,2 ORDER BY 1,2;"
=> f|f|2   (server-only: _resync_bucket_units, pay_insurance_premium — svc-role only)
   f|t|74  (authenticated-only)
   t|t|13  (the anon surface)   -- 2+74+13 = 89
```

**PASS.**

## Check 2 — actually calling the 13 as anon (PASS; unexpected work = 0)

**10 trigger functions, called as `anon` at the DB layer (assumption → evidence):**
```
for fn in <the 10 trigger fns>; do psql -c "SET ROLE anon; SELECT public.$fn();"; done
=> ERROR:  trigger functions can only be called as triggers   (×10, all 10 identical)
```
All 10 raise identically — **none perform work.** Via PostgREST they are additionally invisible:
```
POST /rest/v1/rpc/trg_transactions_contribution  (anon)  => HTTP 404 PGRST202 "no matches ... in the schema cache"
POST /rest/v1/rpc/guard_mass_subscriber_detach   (anon)  => HTTP 404 PGRST202
```
(PostgREST does not expose zero-arg `RETURNS trigger` functions.)

**3 intentional grants** perform work only as designed — dissected in Check 4. Unexpected anon
work across all 13 = **0**. **PASS** (spec: "any function that PERFORMS WORK as anon is CRITICAL" —
none does).

## Check 3 — commission run-model dead & unreachable (PASS; Info A03-005)

```
psql -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN
  ('open_run','cancel_run','release_run','submit_contribution_run','get_run_branch_breakdown',
   'branch_approve_line','branch_dispute_line','branch_hold_line','branch_approve_all',
   'agent_confirm_commission','agent_dispute_line','approve_dispute','reject_dispute',
   'withdraw_dispute','release_branch','mark_branch_reviewed');"
=> 0
psql -c "SELECT count(*) FROM pg_proc ... WHERE prosrc ILIKE '%commission_runs%' OR prosrc ILIKE '%commission_lines%';"
=> 0
psql -c "SELECT string_agg(relname,', ') FROM pg_class ... relkind='r' AND (relname ILIKE '%run%' OR relname ILIKE '%dispute%');"
=> contribution_runs, contribution_run_uploads    (the live EMPLOYER contribution-run feature — distinct)
```
Zero run/dispute functions, zero live functions referencing `commission_runs`/`commission_lines`,
and the run/dispute tables do not exist. The run-model surface is unreachable from anywhere.

**Info A03-005 (cleanup):** the dead source `supabase/migrations/0021_commission_rpcs_app_role.sql`
(39,576 bytes) remains in the repo; the 16 functions it defines were dropped by
`0029_commission_simplify.sql` and are absent live. It has **no** `.down.sql`.
```
ls -la supabase/migrations/0021_commission_rpcs_app_role.sql => 39576 bytes present
ls supabase/migrations/*0021*.down.sql => (none)
```

## Check 4 — abusing the 3 intentional grants (FINDING A03-001; A03-002, A03-003; Info A03-007)

### 4a. `get_employer_invite` — hardened; benign existence oracle only (Info A03-007)

Live invite state (4 rows, all `emp-001`, all `pending`, all `expires_at` **in the past** — now =
2026-08-24):
```
psql -c "SELECT token, employer_id, status, expires_at, prefill->>'phone', prefill->>'compensation'
         FROM public.employer_invites ORDER BY created_at DESC;"
=> inv-097aadbd... | emp-001 | pending | 2026-08-14 12:09 | 701234567 | 1000000
   inv-fcad3aa6... | emp-001 | pending | 2026-08-09 19:43 | 700100093 | 1100000
   inv-78bdee14... | emp-001 | pending | 2026-08-09 19:42 | 700100092 | 750000
   inv-7762a032... | emp-001 | pending | 2026-08-09 19:41 | 700100091 | 900000
```
Anon PostgREST abuse:
```
POST /rest/v1/rpc/get_employer_invite {"p_token":"inv-097aadbd...(real, expired)"}
   => HTTP 400 {"code":"P0001","message":"invite expired"}            -- expiry ENFORCED
POST ... {"p_token":"inv-doesnotexist..."} => HTTP 500 {"code":"P0002","message":"invite not found"}
POST ... {"p_token":""}                     => HTTP 500 {"code":"P0002","message":"invite not found"}
POST ... {"p_token":null}                   => HTTP 500 {"code":"P0002","message":"invite not found"}
```
Body reads only `employer_invites` + `employers.name`; no side effects. Expiry and `status<>'pending'`
are both enforced. **Info A03-007:** two harmless issues — (1) distinct error codes (`P0002`
not-found vs `P0001` expired/used) are a token-existence oracle, but tokens are 122-bit random
UUIDs (`gen_random_uuid()`), so enumeration is infeasible; (2) not-found returns **HTTP 500** rather
than 400/404 — minor API-hygiene inconsistency, no security impact.

### 4b. `create_subscriber_from_signup` — validates before writing; 2 hardening gaps

Body (live `prosrc`): `PERFORM _validate_signup_payload(payload)` (line 15) runs **before**
`_insert_subscriber_chain(payload,'a-001')` (line 16), so an invalid payload raises with **no**
write. Anon PostgREST probes (all pre-write raises — subscriber count unchanged at 5064 after):
```
POST /rest/v1/rpc/create_subscriber_from_signup {"payload":{}}
   => HTTP 400 {"code":"P0001","message":"phone is required"}
POST ... {"payload":{"phone":"notaphone"}}
   => HTTP 400 "phone must be a valid Uganda number ...; got: notaphone"
POST ... {"payload":{...valid...,"districtId":"zzz-nope",...}}
   => HTTP 400 "unknown district: zzz-nope"
psql -c "SELECT count(*) FROM public.subscribers;"  => 5064   (unchanged — no rows created by these probes)
```
Reaching the function body proves `anon` EXECUTE. Two gaps in the validation/insert path:

**A03-002 (LOW, confirmed) — the anon signup RPC trusts the client for phone canonicalization.**
`_validate_signup_payload` accepts any phone matching `^(\+?256)?[0-9]{9}$` — including a **bare
9-digit** form — and `_insert_subscriber_chain` stores it **verbatim**:
```
_validate_signup_payload  line 32:  IF v_phone !~ '^(\+?256)?[0-9]{9}$' THEN RAISE ...
_insert_subscriber_chain  line 78:  p_payload ->> 'phone'          -- inserted as-is, no normalization
```
At login the server canonicalizes to `+256XXXXXXXXX` and looks the row up by exact match:
```
api/_lib/phone.ts        toCanonicalUGPhone -> "+256"+local(9)
api/auth/_lib/personas.ts:76  resolveSubscriber: .eq('phone', canonicalPhone)  ... maybeSingle()
api/auth/_lib/personas.ts:118 on no match -> return { entityId: ROLE_DEFAULTS[role] }   // 's-0001'
```
A row stored as bare `799900001` never equals `+256799900001` → `resolveSubscriber` returns null →
login falls through to `ROLE_DEFAULTS.subscriber = 's-0001'`. An account minted via the anon RPC
with a non-canonical phone is **permanently unreachable by its owner**. **Not UI-reachable** —
`src/signup/contribution/ContributionRoute.jsx:78` canonicalizes (`toCanonicalUGPhone`) before
building the payload — so it does **not** break the live demo; it is a server-side hardening gap in
the atomic-write authority (the RPC should canonicalize, not trust the caller). **LOW.**

**A03-003 (LOW, confirmed) — no length cap on subscriber text fields.** `name`, `phone`, `nin`,
`occupation`, `email` are all `text` with **no** `character_maximum_length`, and neither the
validator nor the chain caps length:
```
psql -c "SELECT column_name, data_type, character_maximum_length FROM information_schema.columns
         WHERE table_schema='public' AND table_name='subscribers'
         AND column_name IN ('name','phone','nin','occupation','email');"
=> name|text|   email|text|   phone|text|   nin|text|   occupation|text|     (all max_length = NULL)
```
`_insert_subscriber_chain` writes `p_payload ->> 'fullName'|'phone'|'nin'` verbatim. Round-1
observed a 1 MB `name` persist through this exact anon path (`00d`/round-1 §4b B6a); this round the
reproduction write was classifier-blocked, so the finding is **code-confirmed**, not re-reproduced.
An unauthenticated caller can bloat a `text` column without bound. DoS-adjacent; the *rate-limit*
absence is EXCLUDED (demo), the *unbounded field size* is a real server-side gap. **LOW.**

Also observed (EXCLUDED — demo scope, documented in `_insert_subscriber_chain`): the insert forces
`is_demo_signup = TRUE`, and the phone unique index is `subscribers_phone_unique_non_demo_idx …
WHERE (is_demo_signup = false)`, so self-signup rows deliberately bypass phone uniqueness (duplicate
phones accumulate). This is intended demo behavior (`resolveSubscriber` newest-wins comment).

### 4c. `create_subscriber_from_employer_invite` → **A03-001 (HIGH, plausible-deterministic)**

**Finding: the invite-completion RPC is not bound to the phone the employer invited.** anon has
EXECUTE; the invite **token is the only gate**. Live `prosrc` (verbatim, key lines):
```
15:  v_phone_norm := right(regexp_replace(COALESCE(payload ->> 'phone',''),'[^0-9]','','g'),9);   -- CALLER-controlled
16:  SELECT id, employer_id INTO v_existing_id, v_existing_emp FROM public.subscribers
17:   WHERE right(regexp_replace(COALESCE(phone,''),'[^0-9]','','g'),9) = v_phone_norm
18:   ORDER BY created_at DESC LIMIT 1;
20:  IF v_existing_id IS NOT NULL AND v_existing_emp IS NOT NULL THEN RAISE ... 'already belongs';
22:  ELSIF v_existing_id IS NOT NULL THEN
23:    UPDATE public.subscribers SET employer_id = v_inv.employer_id WHERE id = v_existing_id;   -- RE-TAG
24:    v_new_id := v_existing_id;
...
77:  UPDATE public.subscribers                                  -- runs for EVERY non-raising branch
78:     SET compensation = COALESCE(NULLIF(v_inv.prefill ->> 'compensation','')::numeric, 0)
79:   WHERE id = v_new_id;
```
The function keys entirely on **`payload->>'phone'` (attacker-controlled)** and **never** compares
it to the phone the invite was minted for. Proof the invited phone is never consulted — `prefill`
is referenced **exactly once** in the whole body, at line 78, reading `compensation` only:
```
psql -c "SELECT (prosrc ~* 'prefill[^;]*phone')::int, regexp_count(prosrc,'prefill')
         FROM pg_proc ... WHERE proname='create_subscriber_from_employer_invite';"
=> 0 | 1        -- zero prefill-phone references; prefill mentioned once total
# and that one line:
=> 78:   SET compensation = COALESCE(NULLIF(v_inv.prefill ->> 'compensation','')::numeric, 0)
```
**Read-only proof the re-tag branch resolves to a real victim.** Running the RPC's *own*
branch-selection SELECT (lines 15–18) for an arbitrary caller phone `715408207` returns a real,
unaffiliated live subscriber (`s-0006`, `employer_id IS NULL`):
```
psql -c "WITH payload AS (SELECT '715408207'::text AS caller_phone)
  SELECT s.id, s.employer_id FROM public.subscribers s, payload
   WHERE right(regexp_replace(COALESCE(s.phone,''),'[^0-9]','','g'),9)
       = right(regexp_replace(payload.caller_phone,'[^0-9]','','g'),9)
   ORDER BY s.created_at DESC LIMIT 1;"
=> s-0006 | (null)      -- v_existing_id NOT NULL, v_existing_emp NULL  =>  branch 22-24 (the UPDATE) fires
```
Because `v_existing_id IS NOT NULL AND v_existing_emp IS NULL`, control enters branch 22–24, whose
body is an **unconditional** `UPDATE subscribers SET employer_id = v_inv.employer_id`, followed by
the unconditional compensation overwrite at 77–79. Blast radius:
```
psql -c "SELECT count(*) FILTER (WHERE employer_id IS NULL) eligible,
                count(*) FILTER (WHERE employer_id IS NOT NULL) would_raise
         FROM public.subscribers WHERE phone IS NOT NULL AND phone <> '';"
=> 5006 | 58      -- 5006 unaffiliated real subscribers are re-tag-eligible via any one valid token
```
**Consequences for a holder of any single valid, non-expired invite token** (invite links are copied
out over SMS/WhatsApp, so the token is a shareable secret, not an authenticated session):
- Supply the phone of **any existing unaffiliated subscriber** → that real row is silently
  `UPDATE`d into the invite's employer (branch 22–24) **and** its `compensation` overwritten with
  the invite's prefill value (line 77–79). The victim is re-homed into an employer that never
  invited them and appears on that employer's roster.
- Supply a fresh phone → a brand-new subscriber is created tagged to that employer for a person the
  employer never invited (branches 25+/42+).

**Current exploitability:** all 4 live invites are **expired**, so it is not exploitable against the
live clock *this instant*; **any employer minting a new invite (a routine demo action) opens a 7-day
window.** This is a cross-entity data mutation gated only by a shareable token.

**Evidence limitation (honest).** I proved (a) `anon` EXECUTE; (b) the exact live branch logic; (c)
`prefill.phone` is never referenced; (d) the RPC's own selection SELECT resolves to a real
`employer_id IS NULL` victim, so the deterministic branch taken is the re-tag `UPDATE`. I did **not**
observe the `UPDATE` row-change commit, because the single `BEGIN … ROLLBACK` reproduction — which
would have written nothing permanent — was **blocked by the auto-mode write classifier before it
ran** (see §Blocker; same block hit round 1). The branch body is unconditional, so the outcome is
determined by the inputs I proved; confidence is therefore **plausible (deterministic)**, one step
short of confirmed. **Severity HIGH** — an unauthenticated-with-token caller mutates and
re-associates an existing subscriber row and corrupts its compensation; not CRITICAL because it
needs a live token plus deliberate misuse and shows no passive wrong-money on a happy-path demo.

**Fix direction:** in the re-tag and create branches, bind completion to the invited phone —
`right(regexp_replace(v_inv.prefill->>'phone','[^0-9]','','g'),9) = v_phone_norm` — and reject a
payload phone that differs from the invite's.

## Check 5 — sequence grants (PASS; Info A03-004)

```
psql -c "SELECT c.relname, has_sequence_privilege('anon',c.oid,'USAGE'),
  has_sequence_privilege('anon',c.oid,'UPDATE'), COALESCE(array_to_string(c.relacl::text[],' '),'(owner only)')
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S';"
=> commission_id_seq        | anon usage=t update=t | anon=rwU authenticated=rwU service_role=rwU
   subscriber_id_seq        | anon usage=t update=t | anon=rwU authenticated=rwU service_role=rwU
   entity_detach_log_id_seq | anon usage=f update=f | postgres/service_role only   (revoked 0080)
   entity_status_log_id_seq | anon usage=f update=f | postgres/service_role only   (revoked 0080)
```
The two `*_log` sequences are correctly revoked. `commission_id_seq` and `subscriber_id_seq` retain
the **Supabase-default** `anon/authenticated = rwU` (`nextval`/`setval`). **Info A03-004 — blast
radius nil:** PostgREST exposes only tables/views/functions, never `nextval`/`setval`, and `anon`
has no direct SQL channel; the signup `nextval` runs inside `SECURITY DEFINER` functions as the
owner, so the anon grant is both redundant and unreachable. Nothing granted to anon/authenticated
beyond these defaults and the two explicit revokes. **PASS.**

## Check 6 — `v_reconciliation_exceptions` unreachable (PASS)

```
psql -c "SELECT relname, has_table_privilege('anon',oid,'SELECT'),
  has_table_privilege('authenticated',oid,'SELECT'), has_table_privilege('service_role',oid,'SELECT')
  FROM pg_class ... WHERE relname='v_reconciliation_exceptions';"
=> v_reconciliation_exceptions | anon=f | authenticated=f | service_role=t
curl /rest/v1/v_reconciliation_exceptions?select=*&limit=1   (anon key)
=> HTTP 401 {"code":"42501","message":"permission denied for view v_reconciliation_exceptions"}
```
The only view in `public`; `anon`=false, `authenticated`=false, only `service_role`/`postgres` read.
Unreachable by both anon and authenticated, proven at the privilege layer and live via PostgREST.
**PASS.**

## Check 7 — bundle secret scan (PASS; counts only, per G2)

Fresh `npm run build` (exit 0) and `npm run build:api` (exit 0), then literal `grep -F` for the
**actual** service-role key value and JWT-secret value (sourced from `.env.local` into shell vars,
**never printed**), plus the env-var-name strings and any `eyJ` literal:

| Location | service_role **key value** | JWT **secret value** | `SUPABASE_SERVICE_ROLE` str | `service_role` str | `eyJ` literals |
|---|---|---|---|---|---|
| `dist/` (client) | **0** | **0** | **0** | **0** | 4 raw = **2 unique** = header+payload of the single **public anon key** |
| `dist-server/` (Node) | **0** | **0** | 6 | **0** | 0 |

Detail:
- The 2 unique `eyJ` strings in `dist/` are the two segments of one JWT; decoding the payload segment
  yields `"role":"anon"` — the **public anon key**, required by the browser Supabase client, public
  by design. `grep -F "$SERVICE_ROLE_KEY" dist => 0` confirms the service-role key is **not** baked in.
- The 6 `dist-server/` `SUPABASE_SERVICE_ROLE` hits are the **env-var name** (`process.env.SUPABASE_SERVICE_ROLE_KEY`,
  read at runtime); `grep 'SUPABASE_SERVICE_ROLE' dist-server | grep -c eyJ => 0` confirms no line
  carries a baked value. The `JWT_RE`/`sentryScrub` references (28 total) are a JWT-**redaction**
  guard, not a token.

**Zero** service-role-key or JWT-secret values in either bundle. **PASS.**

## Check 8 — no blanket anon REVOKE; RLS blast radius (PASS; Info A03-006)

No blanket `REVOKE SELECT ON ALL TABLES … FROM anon` (or `REVOKE ALL ON ALL TABLES`) anywhere in
`supabase/migrations/`. Only **targeted** revokes: `users` (`0081`), `entity_detach_log` +
`entity_status_log` (`0080`), `v_reconciliation_exceptions` (`0096`), plus function-EXECUTE revokes
(`0086`). So **34 of 37 tables grant `anon` SELECT**, each gated by RLS alone — and every one has
RLS **enabled AND forced**:
```
psql -c "SELECT c.relrowsecurity rls_enabled, c.relforcerowsecurity rls_forced, count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND has_table_privilege('anon',c.oid,'SELECT') GROUP BY 1,2;"
=> t | t | 34        -- all 34 anon-readable tables are RLS enabled + forced
```
Live proof the RLS gate holds for anon on the crown-jewel tables (PostgREST anon reads leak **no**
tenant rows):
```
subscribers          => HTTP 401  "permission denied for function subscriber_agent_id"   (RLS predicate calls a DEFINER helper anon can't run)
transactions         => HTTP 401  "permission denied for function subscriber_..."
commissions          => HTTP 401  "permission denied for function distributor_..."
subscriber_balances  => HTTP 401  "permission denied for function subscriber_agent_id"
agents               => HTTP 401  "permission denied for function subscriber_..."
distributors         => HTTP 401  "permission denied for function current_..."
branches             => HTTP 401  "permission denied for function current_..."
employers            => HTTP 200  []   (policy yields zero rows for anon)
```
**Blast-radius assessment (Info A03-006):** because every anon-SELECT table has RLS **enabled**,
*dropping* a policy yields default-deny (an **availability** failure — the demo shows empty data),
**not** a leak. A confidentiality leak would require RLS to be **DISABLED** on a table, or a
permissive `USING (true)` policy to be added. The RLS-only posture (no table-grant backstop) is
standard Supabase; recorded as an architectural observation, not a defect. **PASS.**

---

## Blocker (G10)

The single `BEGIN … ROLLBACK` end-to-end reproduction of A03-001 (mint a fresh pending invite for a
*different* employer whose prefill phone differs from the caller's, `SET LOCAL ROLE anon`, call the
RPC, observe `s-0006` re-tagged, then `ROLLBACK`) was **denied by the auto-mode write classifier
before executing** ("Blocked by fast classifier"). It writes nothing permanent by construction, but
the classifier blocks write-shaped SQL on the `psql`/Bash channel regardless. I did **not** re-route
it through `mcp__supabase__execute_sql`, because that channel could auto-commit the statements and a
committed write would be a genuine report-only (G1) violation — the same class of accident recorded
in `00d-live-write-ledger.md`. **Coverage shortfall:** A03-001's literal `UPDATE` row-change was not
observed committing; it is proven up to (and including) the deterministic branch selection, so
confidence is **plausible (deterministic)**, not confirmed. Read-only `psql`, PostgREST, and builds
were unaffected — all other checks ran fully.

## Integrity — no committed writes (no cleanup needed)

Every probe this round was a read, a validation-failure raise (pre-write), or a classifier-blocked
write. Post-run state equals baseline §6 exactly:
```
psql -c "SELECT (SELECT count(*) FROM subscribers), (SELECT count(*) FROM subscriber_balances),
  (SELECT count(*) FROM employer_invites), (SELECT count(*) FROM employer_invites WHERE token LIKE 'inv-a03%'),
  (SELECT employer_id FROM subscribers WHERE id='s-0006'), (SELECT compensation FROM subscribers WHERE id='s-0006');"
=> 5064 | 5060 | 4 | 0 | (null) | 0
```
No fixture invite persisted (the write was blocked before it ran), no fixture subscriber created,
victim `s-0006` untouched (`employer_id` NULL, `compensation` 0). **No product code, SQL, migration,
or config was changed** — only this file under `docs/audits/2026-08-23/` and the sanctioned build
artifacts (`dist/`, `dist-server/`) regenerated by `npm run build` / `build:api`.

---

## Traceability
| Check | Disposition |
|---|---|
| 1. Evaluate anon EXECUTE for all 89; verify 13 = 3 grants + 10 triggers; report extras | **PASS** — exactly 13, zero extras; `0021` family absent |
| 2. Call all 13 as anon; prove 10 triggers raise "…only be called as triggers"; any anon work = CRITICAL | **PASS** — 10/10 raise; 3 grants work by design; unexpected anon work = 0 |
| 3. Confirm commission run-model unreachable; record dead 0021 text | **PASS** + **Info A03-005** (dead `0021_commission_rpcs_app_role.sql`, no `.down.sql`) |
| 4. Abuse the 3 intentional grants hard | **FINDING A03-001** (invite not phone-bound → cross-tenant re-tag + compensation overwrite) + **A03-002** (no phone canonicalization → login misroute) + **A03-003** (unbounded field size); **Info A03-007** (get_employer_invite existence oracle + 500-on-not-found) |
| 5. Sequence grants beyond the two explicit revokes | **PASS** + **Info A03-004** (2 ID seqs retain Supabase-default anon `rwU`; blast radius nil) |
| 6. `v_reconciliation_exceptions` unreachable by anon + authenticated | **PASS** — privileges + live 401 |
| 7. Bundle secret scan (dist/ + dist-server/), counts only | **PASS** — 0 service-role/JWT-secret values; only the public anon key + a scrub regex |
| 8. No blanket REVOKE SELECT FROM anon; RLS blast radius | **PASS** + **Info A03-006** (34 tables RLS-only; dropped-policy = deny, not leak) |
