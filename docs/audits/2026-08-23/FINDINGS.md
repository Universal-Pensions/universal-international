# FINDINGS — Universal Pensions Uganda platform audit (complete)

**Audit 2026-08-23, verified & synthesised 2026-08-24.** Phases 0–4 (database, backend, cross-cutting, all 7 role walkthroughs, frontend quality). Report-only — no product code changed.

Critical/High findings carry an adversarial verification verdict (verifiers instructed to *refute*).

## Summary

| Severity | Count |
|---|---|
| 🔴 CRITICAL | 8 |
| 🟠 HIGH | 25 |
| 🟡 MEDIUM | 76 |
| ⚪ LOW | 68 |
| 🔵 INFO | 44 |
| **Total** | **221** |

1 finding (A06-007) was REFUTED in verification → `SPECULATIVE.md`.


## 🔴 CRITICAL (8)

### A05-001 · apply_settlement has no tenancy check — any distributor can settle another distributor's agents' commissions
- **Severity/Confidence:** critical / confirmed
- **Agent/Category/Surface:** A05 / tenancy / rpc
- **Location:** `public.apply_settlement (live) · supabase/migrations/0032_fix_settlement_apply.sql:130`
- **Roles:** distributor, admin, agent, branch
- **Impact:** A distributor can mark another distributor's commissions paid, stamp them with a payment reference that distributor never issued, emit commission_settled notifications into the victim's agents and branches, and write a settlement_batches row into the victim's branch. The victim's dashboards then show money as settled that was never paid. The write is invisible to its author (RLS blocks the read-back) and unattributable for the victim. Every commission READ was tenant-bounded by the 0081-0089 series; the one write that moves money was not.
- **Repro:** 1) Sign in as distributor d-001 (or d-002). 2) Open Commissions -> Download template. 3) Add one row for an agent owned by the OTHER distributor (e.g. a-780 for d-001), with any Amount Paid. 4) Upload the file. The confirm modal shows 'Settle 1 agent · 0 lines' with a plain (non-caution) Confirm button — no mismatch, no skip. 5) Confirm. The foreign agent's oldest due commissions flip to paid and a settlement_batches row lands in the other distributor's branch.
- **Evidence:** psql -f t_rls2.sql (run under SET LOCAL ROLE authenticated so RLS is active, then RESET ROLE to read back; whole txn ROLLBACK):
  BEGIN; SELECT count(*) FROM commissions WHERE agent_id='a-001' AND status='due';  -> baseline_a001_due | 21
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"app_role":"distributor","distributorId":"d-002","sub":"d-002","role":"authenticated"}';
  SELECT public.apply_settlement('[{"agentId":"a-001","amountPaid":12000,"paymentRef":"A05-XTEN-PROOF","paymentDate":"2026-08-23"}]'::jsonb,'a05-xten-proof');
   -> d002_settles_a001 | {"skipped": [], "totalPaid": 10000, "linesSettled": 2, "agentsSettled": 1}
  RESET ROLE;
  SELECT id, agent_id, branch_id, amount, status, paid_amount, txn_ref FROM commissions WHERE txn_ref='A05-XTEN-PROOF';
   -> c-0000
- **Suggested fix (NOT applied):** Add an ownership predicate inside apply_settlement's per-row loop, mirroring 0087: IF v_role='distributor' AND NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.id=v_agent_id AND a.branch_id IN (SELECT public.distributor_branch_ids())) THEN skip with reason 'not_your_agent'; CONTINUE; END IF. Add 'not_your_agent' to SETTLEMENT_SKIP_REASONS (src/utils/settlement.js:60) and pre-block in CommissionPanel confirmSummary any row whose agentId is absent from pendingMap. · effort S
- **Verification:** CONFIRMED — Reproduced live under BEGIN..ROLLBACK: a JWT claiming app_role=distributor/distributorId=d-002 settled a-001's commissions, though a-001 is owned by d-001 (branch b-bui-001). apply_settlement's body checks only v_role IN ('distributor','admin') with no predicate tying the agent to the caller's distributor; it is SECURITY DEFINER + GRANT EXECUTE aut

### A05-002 · Agent demo persona's Commissions page shows Playwright test residue as real payment history, with two contradictory outstanding-balance figures
- **Severity/Confidence:** critical / confirmed
- **Agent/Category/Surface:** A05 / data-integrity / ui
- **Location:** `src/agent-dashboard/pages/CommissionsDesktop.jsx:206 · src/agent-dashboard/pages/commissions/CommissionsParts.jsx:123 · live rows in public.settlement_batches`
- **Roles:** agent
- **Impact:** Three separate wrongnesses on one headline demo screen: (1) the banner says UGX 10K outstanding while the tile directly beneath says UGX 20K / 4 awaiting payout; (2) rows 1-3 are leaked Playwright artifacts from 2026-08-02/03 with zero backing commission rows, presented as the agent's payment history with machine-generated references; (3) row 4 claims 9 lines / UGX 45K while the EARNED tile says UGX 35K / 7 commissions paid. A rep opening the agent persona's Commissions tab lands on this.
- **Repro:** 1) Sign in as the agent demo persona a-001 (phone +256700000001, password Demo1234, any 6-digit OTP). 2) Open Commissions. 3) Read the partial-settlement banner (UGX 10K outstanding) against the OWED tile (UGX 20K) immediately below it. 4) Scroll to Settlement history and read rows 1-3: E2E-PARTIAL-<epoch-ms> references. 5) Compare row 4 (MM-SEED-0001, 9 lines, UGX 45K) with the EARNED tile (UGX 35K, 7 commissions paid).
- **Evidence:** Headless Chromium with e2e/.auth/agent.json (persona a-001, the documented demo agent), http://localhost:5173/dashboard/commissions, 1440x1000, clean baseline state (5001 commissions, a-001 = 4 due / 7 paid):
  Commissions
  UGX 55K earned and owed · 64% settled
  Your last settlement was partial
  UGX 5K paid against UGX 15K due — UGX 10K is still outstanding (ref sb-09258a3b9cc94064be51e0a6f0a04fa5).
  Ask for reason
  EARNED  UGX 35K    OWED  UGX 20K    SETTLED  64%
  Earned 7 commissions paid 35K / Owed 4 awaiting payout 20K
  HISTORY  Settlement history
  #  PAID         REFERENCE                   LINES  DUE AT THE TIME  PAID    STATUS
  1  3 Aug 2026   E2E-PARTIAL-1785752804482   1      UGX 15K          UGX 5K  PARTIAL
  2  2 Aug 2026   E2E-PARTIAL-1785700815516   1      UGX 10K    
- **Suggested fix (NOT applied):** Delete the three orphan E2E-PARTIAL-* settlement_batches rows and their notifications; re-run the settlement seed so sb-seed-0001 matches the lines it actually flipped; move the createdBatchIds registration in the E2E afterEach to look the batch up by txn_ref BEFORE the assertions rather than after; point the settlement specs at a dedicated fixture agent instead of the a-001 demo persona. · effort S
- **Verification:** CONFIRMED — Verified at the data layer that drives the UI. a-001 carries settlement_batches rows with E2E-PARTIAL-.../E2E-FULL-... refs and zero backing paid commissions; the 2026-08-02/03 rows pre-date this audit (genuine persistent residue), and two more dated 2026-08-24 have since appeared (ongoing leak). The agent history table reads settlement_batches so 

### A06-001 · 61% of the default employer persona's roster balance is uncleaned E2E test money
- **Severity/Confidence:** critical / confirmed
- **Agent/Category/Surface:** A06 / data-integrity / employer dashboard (emp-001 / Nile Breweries Demo), subscriber transaction history for empe-* members, platform AUM
- **Location:** `public.transactions (txn_ref LIKE 'EMP-%'), public.subscriber_balances for employer_id='emp-001'`
- **Roles:** employer, admin, distributor, subscriber
- **Impact:** emp-001 is Nile Breweries Demo Ltd: the default employer persona (dp-e-001 / +256700000031) AND ROLE_DEFAULTS.employer, i.e. the employer every rep demos and every unrecognised employer login falls back into. 120,292,000 of its 197,491,903 UGX roster balance (60.9%) is fabricated by 33 uncleaned E2E contribution runs. Per-head it holds 9.40M UGX against 3.70M for the next employer. Every one of its 19 members shows the SAME payroll run repeated 33 times in their transaction list, with four identical 210,000/105,000/40,000 triples on 2026-07-30 alone. Platform-wide, 121,567,000 UGX (5.0% of the 2,450,226,487 UGX AUM) is test residue, growing by ~3.6M UGX per suite run. This is wrong money on the headline demo screen.
- **Repro:** 1) Log in as employer +256700000031 / Demo1234 (emp-001, Nile Breweries Demo) 2) Open any member (e.g. empe-001) and scroll their transaction history 3) Observe the same employer payroll triple (own 210,000 / employer 105,000 / insurance 40,000) repeated on 2026-07-30, 2026-07-31, 2026-08-01… 4) Compare the employer's total AUM tile against any other employer's per-member average
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select type, source, count(*), sum(amount)::bigint from public.transactions where txn_ref like 'EMP-%' and created_at > timestamptz '2026-07-27 14:26:07+00' group by 1,2 order by 1,2;"
contribution|employer|627|60146000
contribution|own|627|60146000
insurance_premium|employer|627|25080000

$ psql ... -c "select s.employer_id, count(*), sum(b.total_balance)::bigint from public.subscribers s join public.subscriber_balances b on b.subscriber_id=s.id where s.employer_id is not null group by 1 order by 3 desc;"
emp-001|21|197491903
emp-004|8|33833117
emp-002|7|25926552
emp-003|6|18524479
emp-006|6|18267018
emp-007|5|16490925
emp-005|5|14696106

$ psql ... -c "select count(*), count(*) filter (where txn_ref like 'EMP-%'), sum(amount)::bigint from pub
- **Suggested fix (NOT applied):** Delete the E2E residue: DELETE FROM public.transactions WHERE txn_ref LIKE 'EMP-%' AND created_at > '2026-07-27 14:26:07+00' (1,881 rows), then rebuild subscriber_balances for the emp-001 roster from the surviving ledger (or reseed the 21 empe-* members). Fix the leak first (A06-002) or it returns on the next suite run. Consider pointing the E2E employer-run spec at a dedicated throwaway employer instead of emp-001. · effort M
- **Verification:** CONFIRMED — All EMP- residue (1,881 rows) belongs solely to emp-001; contribution legs sum to 120,292,000 fabricated UGX against a 197,491,903 roster balance (60.9%); per-head emp-001 9,404,376 vs ~4.2M next. emp-001 is the default employer persona and each member's transaction list shows the payroll triple repeated ~33x — a rep scrolling a member history sees

### A11-001 · Agent Commissions shows E2E test residue as real settlement history + two contradictory outstanding figures (verifies + escalates A05-002)
- **Severity/Confidence:** critical / confirmed
- **Agent/Category/Surface:** A11 / wrong-money / agent /dashboard/commissions
- **Location:** `src/agent-dashboard/pages/CommissionsPage.jsx:124 (SettlementMismatchBanner) + settlement-history table; live public.settlement_batches`
- **Roles:** agent, distributor
- **Impact:** A rep opening the agent's headline Commissions tab sees fabricated payment history and two conflicting 'outstanding' totals (banner UGX 15K vs tile UGX 20K) in one frame — visibly wrong money on a demo.
- **Repro:** 1) Sign in as agent a-001 (/distributors -> Agent -> 700000001 -> any 6-digit code) 2) Open /dashboard/commissions 3) Observe the partial-settlement banner (UGX 15K outstanding) directly above the OWED tile (UGX 20K), and 5 E2E-* rows in Settlement history
- **Evidence:** Signed in via UI as a-001. On-screen (screenshots/agent/commissions-1440.png, commissions-375.png): banner 'UGX 5K paid against UGX 20K due — UGX 15K is still outstanding (ref sb-8598ef12...)' sits directly above tile 'OWED UGX 20K · 4 awaiting'. Settlement history lists 6 rows, 5 of them E2E-PARTIAL/E2E-FULL artifacts. SQL: `psql "$SUPABASE_DB_URL" -c "select id,txn_ref,line_count,pending_total,paid_amount,to_char(paid_date,'YYYY-MM-DD') from settlement_batches where agent_id='a-001' order by created_at;"` returns sb-seed-0001|MM-SEED-0001|9|45000|45000|2026-07-16 ; four E2E-PARTIAL/E2E-FULL rows incl. two NEW ones dated 2026-08-24 (E2E-FULL-1787558947624 4/20000, E2E-PARTIAL-1787558955623 1/pending20000/paid5000). A05-002 captured 4 batches; it is now 6 — the residue accretes each Playwr
- **Suggested fix (NOT applied):** Delete the five E2E-* settlement_batches (and their notifications) from live; make distributor-apply-settlement.spec register cleanup ids by txn_ref BEFORE its assertions; point settlement specs at a dedicated fixture agent, not the a-001 demo persona. (DB fix owned by A05.) · effort S
- **Verification:** CONFIRMED — corroborates A05-002 (CONFIRMED Wave C); settlement residue on agent screen

### A11-002 · Agent onboarding wizard cannot complete — final create RPC returns 409 (mock OCR's constant NIN collides with a unique index), trapping the rep on a 'Not saved' screen
- **Severity/Confidence:** critical / confirmed
- **Agent/Category/Surface:** A11 / demo-blocker / agent /dashboard/onboard (OnboardKycFlow + OnboardingComplete)
- **Location:** `api/kyc/id-ocr.ts:46 (constant nin 'CF92018AB3CD45') -> public.create_subscriber_from_agent_onboard -> unique index ux_subscribers_nin; UI src/agent-dashboard/onboarding/OnboardingComplete.jsx`
- **Roles:** agent
- **Impact:** The flagship 'watch an agent enrol a new member' demo completes ~30s of KYC + schedule + pay, then hard-fails at save and strands the rep on an error card with no forward action. Succeeds at most once ever, and the winning NIN row already exists permanently on the demo agent's own roster. Reconciles the baseline agent-onboard-subscriber:109 failure on both desktop engines.
- **Repro:** 1) Sign in as agent a-001; go to /dashboard/onboard 2) Answer the 5 awareness points; upload any >=20KiB front/back ID 3) Walk review->nira->otp(1234)->liveness->aml->beneficiaries->consent, then set a plan and Pay 4) OnboardingComplete fires create_subscriber_from_agent_onboard -> 409; screen shows 'Couldn't save … / Not saved', both action buttons disabled
- **Evidence:** `npx playwright test flows/agent-onboard-subscriber.spec.ts --project=chromium` => 'create_subscriber_from_agent_onboard RPC must succeed / Expected: 200 Received: 409'. Root cause SQL: `select id,name,agent_id,nin from subscribers where nin='CF92018AB3CD45'` => s-100117|Namukasa Sarah Kintu|a-001|CF92018AB3CD45 (created 2026-08-07); `select indexdef from pg_indexes where indexname='ux_subscribers_nin'` => CREATE UNIQUE INDEX ... ON subscribers(nin) WHERE nin IS NOT NULL. The ID-OCR mock returns this same NIN every time. OnboardingComplete.jsx sets status='error' -> title 'Couldn't save Namukasa's record', Record 'Not saved', 'Try again' re-issues the same 409, and BOTH 'Onboard another' and 'Close' are disabled while status!=='success'. Screenshot screenshots/agent/onboard-wizard-409-fail
- **Suggested fix (NOT applied):** Make the mock ID-OCR mint a fresh NIN per call (or per session), OR have create_subscriber_from_agent_onboard upsert-by-NIN in the demo flow, OR delete s-100117 AND randomise the mock — deleting alone only defers the collision to the next onboard. · effort S
- **Verification:** CONFIRMED — id-ocr.ts:47 hardcodes nin CF92018AB3CD45; ux_subscribers_nin unique; 1 subscriber already holds it → 2nd onboard 409s. This is the deterministic agent-onboard test failure.

### A14-002 · E2E test residue displayed as live data across the employer demo dashboard (reproduces A06-001 on the employer surface)
- **Severity/Confidence:** critical / confirmed
- **Agent/Category/Surface:** A14 / data-integrity / Employer dashboard — every emp-001 money surface (Overview, Employees roster, member detail, Runs, Analytics)
- **Location:** `public.transactions / subscriber_balances / contribution_runs (live data); mechanism owned by A06-002`
- **Roles:** employer
- **Impact:** emp-001 is the ROLE_DEFAULTS.employer fallback every unrecognised employer login lands on — the employer a rep demos. A prospect is shown fake balances (61% test money), a contribution run literally named 'E2E Run 1785753040826', a wrong 'next contribution' figure, and duplicate transactions dated today.
- **Evidence:** psql: sum(total_balance) for emp-001 = 197,491,903 UGX, of which txn_ref LIKE 'EMP-%' contribution residue = 120,292,000 (60.9%). empe-001: 99 EMP-% contribution rows = 12,810,000 of a 24,471,589 balance (52%). Runs history table top row (on screen) = 'E2E Run 1785753040826'; Overview NeedsAttention shows 'Last run · E2E Run 1785753040826'. Member-detail history shows identical UGX 210,000/105,000 pairs dated 23-24 Aug 2026 (today). psql: 171 EMP-% rows stamped 2026-08-24, newest 08:10 today — residue still growing during the audit. Screenshots: HEADLINE-employees-roster-1440.png, HEADLINE-member-empe-001-1440.png, runs-1440.png, index-1440.png.
- **Suggested fix (NOT applied):** Purge txn_ref LIKE 'EMP-%' residue + the E2E contribution_runs row from live demo data; make the E2E employer-run suite target a throwaway employer or clean up its own child transactions (the run header is deleted but child txns are orphaned with contribution_run_id nulled). Mechanism/cleanup owned by A06-002. · effort M
- **Verification:** CONFIRMED — reproduces A06-001 (CONFIRMED Wave C) on employer surface; emp-001 61% EMP-% residue

### A22-001 · Cross-tenant cache bleed: login never clears the React Query cache, so an in-SPA role switch shows the previous role's RLS-scoped money
- **Severity/Confidence:** critical / confirmed
- **Agent/Category/Surface:** A22 / state-cache-bleed / auth / react-query cache
- **Location:** `src/contexts/AuthContext.jsx:56-66 (login; contrast logout queryClient.clear() at :91)`
- **Roles:** admin, distributor, employer, branch, agent, subscriber
- **Impact:** Distributor d-002 (Busoga; ~27 branches / ~0.2B) renders the platform total UGX 2.45B across 321 branches — another tenant's money — because login sets token/user but never clears the query cache (only logout does). 0 refetch + 1 doc-load proves the new role read the prior role's cached rollup. Wrong money and cross-tenant data displayed in a live demo whenever a rep signs into a second role in the same tab without clicking Log out and without a hard reload.
- **Failure scenario:** admin session cached get_entity_metrics_rollup(country,[ug]) with platform-wide data → login as d-002 does not clear cache → d-002 dashboard reads the cached platform rollup and displays UGX 2.45B / 321 branches instead of its RLS-scoped figures.
- **Repro:** 1) Open one browser tab; sign in as admin at /admin (see UGX 2.45B / 321 branches) 2) Browser-back to a landing page (SPA nav, no full reload) 3) Open the Distributor landing and sign in as d-002 WITHOUT clicking Log out 4) Distributor hero shows the admin platform totals (UGX 2.45B / 321 branches), not d-002's Busoga scope
- **Evidence:** node docs/audits/2026-08-23/scratch/a22b-13-admin-to-dist-bleed.mjs → 'A) ADMIN: UGX 2.45B … 321 branches … 5,064' then 'B) DISTRIBUTOR d-002 after switch: 1 region · 321 branches … UGX 2.45B Across 1 region · 321 branches … 5,001 | rollup(country,[ug]) reqs phase B: 0 | doc loads total: 1' with stored session distributorId:d-002. Sanctioned path clean: a22-01-bleed.mjs shows Log out → token null, admin refetches (2 rollup calls). Screenshot scratch/a22b-admin-to-dist-bleed.png.
- **Suggested fix (NOT applied):** Call queryClient.clear() (or removeQueries) inside AuthContext.login as well as logout — clear the cache on any identity change. · effort S
- **Verification:** CONFIRMED — All three lenses hold. REPRODUCE: AuthContext.login (src/contexts/AuthContext.jsx:56-66) sets token+user but never clears the query cache; only logout (:91) calls queryClient.clear(). Both the admin hero (AdminOverview.jsx:127) and the distributor hero (DistributorOverview.jsx:132) call useEntityMetrics('country','ug') -> identical cache key ['enti

### A24-001 · Insurance policy certificate can never open — window.open(..., 'noopener') always returns null
- **Severity/Confidence:** critical / confirmed
- **Agent/Category/Surface:** A24 / broken-feature / subscriber dashboard (Policies) + signup activation step
- **Location:** `src/signup/contribution/insurancePolicyCertificate.js:436`
- **Roles:** subscriber
- **Impact:** A rep demoing insurance — a headline platform feature — clicks any of the three "Download certificate" buttons on the subscriber Policies page (or the same button at the end of signup) and gets a blank tab plus an error message that blames the browser for a setting that is already correct. The certificate never renders. Deterministic on Chromium and WebKit, every viewport, and broken since the feature shipped on 2026-05-25 (three months).
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local; set +a 2) node docs/audits/2026-08-23/a24-cert-e2e.mjs   # signs in as s-0001, opens /dashboard/policies, clicks 'Download certificate' 3) Observe: 3 certificate buttons, a blank popup opens, and the toast 'Please allow pop-ups for this site' appears — the certificate never renders 4) node docs/audits/2026-08-23/a24-winopen-probe.mjs   # proves window.open('','_blank','noopener,noreferrer') === null on chromium AND webkit
- **Evidence:** Per the HTML spec, window.open() returns null when the feature string contains 'noopener'. Code: `const win = window.open('', '_blank', 'noopener,noreferrer'); if (!win) return false;` so openPolicyCertificate() ALWAYS returns false.

$ node docs/audits/2026-08-23/a24-winopen-probe.mjs
chromium {"withNoopener":"NULL","withoutFeatures":"window","sameOriginWrite":"OK","popupOrigin":"http://localhost:5173","canReadOpenerLocalStorage":"yes"}
webkit   {"withNoopener":"NULL","withoutFeatures":"window","sameOriginWrite":"OK","popupOrigin":"http://localhost:5173","canReadOpenerLocalStorage":"yes"}

End-to-end repro in the real UI as subscriber s-0001 on /dashboard/policies:
$ node docs/audits/2026-08-23/a24-cert-e2e.mjs
page text sample: ... Life cover | UGX 1,000,000 cover | Active | PREMIUM | UG
- **Suggested fix (NOT applied):** Drop `noopener` from the feature string — it is meaningless for an about:blank document you must then write into: `window.open('', '_blank')`. Keep the `if (!win) return false` guard for the genuine pop-up-blocked case. Add an e2e assertion that a second page actually opens. Note the coupling: once fixed, the popup is same-origin with the opener (proved above), so the escaping discipline in A24-007 becomes load-bearing. · effort S
- **Verification:** CONFIRMED — Reproduced from a clean state and end-to-end in the live UI. Root cause is real: src/signup/contribution/insurancePolicyCertificate.js:436 calls window.open('', '_blank', 'noopener,noreferrer') then `if (!win) return false`; per the HTML spec a noopener feature string makes window.open() return null, so openPolicyCertificate() always returns false 


## 🟠 HIGH (25)

### A02-001 · Subscriber JWT can mint arbitrary money by POSTing straight to /rest/v1/transactions
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A02 / rls-write-policy-too-broad / database/RLS + PostgREST
- **Location:** `policy transactions_insert_self on public.transactions (trigger transactions_after_insert_contribution -> public.trg_transactions_contribution)`
- **Roles:** subscriber, agent, branch, distributor, admin
- **Impact:** Any logged-in demo subscriber can set their own balance to any number (UGX 1,386,092 -> 1,001,386,092 in the proof; units 882 -> 637,257). The fabricated money propagates upward into the agent portfolio, branch/distributor rollups and the admin AUM KPI, so OTHER roles' dashboards display wrong money. It also bypasses money_nonces idempotency and can fabricate an agent commission row. Withdrawal rows work the same way in reverse (W03 sub INSERT own withdrawal txn -500,000 || OK || 1). The policy exists only to support one narrow path -- src/services/subscriber.js:1411 inserts a type='premium' marker on insurance renewal, which fires neither trigger. Scored high under this audit's rubric ('a write can corrupt or duplicate data'); it is the top-priority item here and would be critical on a production deployment.
- **Repro:** 1) Log into the demo as any subscriber (phone + any 6-digit OTP). 2) Read the JWT from localStorage key 'upensions_token' in devtools. 3) POST to ${VITE_SUPABASE_URL}/rest/v1/transactions with headers apikey=<anon key from the bundle>, Authorization: Bearer <that JWT>, body {id:'<any new id>', subscriber_id:'<your own id>', type:'contribution', amount:1000000000, date:<now>, status:'settled', method:'mobile_money', txn_ref:'X', source:'own'}. 4) Reload the subscriber dashboard: the balance is now +1,000,000,000 UGX and the same figure appears in the admin AUM KPI.
- **Evidence:** policy: WITH CHECK ((auth.jwt() ->> 'app_role') = 'subscriber' AND subscriber_id = (auth.jwt() ->> 'subscriberId')) -- constrains WHO the row belongs to but not WHAT KIND of row it is. trigger: CREATE TRIGGER transactions_after_insert_contribution AFTER INSERT ON public.transactions FOR EACH ROW WHEN ((new.type = 'contribution'::text)) EXECUTE FUNCTION trg_transactions_contribution().\n\npsql proof (fully rolled back):\n$ psql "$SUPABASE_DB_URL" -X -q -At -F' || '\nBEGIN;\nSELECT 'BEFORE (as postgres)', total_balance, retirement_balance, emergency_balance, units FROM subscriber_balances WHERE subscriber_id='s-0001';\n  BEFORE (as postgres) || 1386092 || 1108874 || 277218 || 882.0745314258030892\nSET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims','{\"sub\":\"s-0001\",\"ro
- **Suggested fix (NOT applied):** Narrow the policy to the one shape the app needs: WITH CHECK (... AND type = 'premium' AND amount >= 0 AND source = 'own'). Or drop transactions_insert_self entirely and route the renewal marker row through the existing pay_insurance_premium SECURITY DEFINER RPC. · effort S
- **Verification:** CONFIRMED — Reproduced live (rolled back): a subscriber JWT (SET ROLE authenticated + request.jwt.claims app_role=subscriber, subscriberId=s-0001) INSERTing a type='contribution' row fires trg_transactions_contribution and credits subscriber_balances 1,411,092 -> 1,001,411,092 UGX (units 897.98 -> 637,273). The transactions_insert_self WITH CHECK constrains on

### A02-002 · Subscriber can rewrite their own insurance cover, premium and status to anything (insurance_policies + subscriber_insurance_products)
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A02 / rls-write-policy-too-broad / database/RLS + PostgREST
- **Location:** `policies insurance_policies_update_self, sip_update_self, sip_insert_self, insurance_policies_insert_self on public.insurance_policies / public.subscriber_insurance_products`
- **Roles:** subscriber, agent, employer, admin
- **Impact:** A subscriber can grant themselves unlimited life/health/funeral cover at zero premium and flip status to 'active' with nothing paid, directly falsifying the insurance-premium invariant (self-pay insurance = ANNUAL only) and the 0072 save-to-cover state machine. The Insurance Statement report, the agent subscriber-detail policy chips and the employer Insurance page then show cover that was never funded. This is wrong money in the insurance ledger.
- **Repro:** 1) Log into the demo as any subscriber. 2) PATCH ${VITE_SUPABASE_URL}/rest/v1/insurance_policies?subscriber_id=eq.<own id> with the localStorage JWT and body {"cover":500000000,"premium_monthly":0,"status":"active","funded_by":"self"}. 3) Open Settings > Insurance cover and the Insurance Statement report: unlimited cover, zero premium, status Active.
- **Evidence:** Neither table has an editable-column trigger (unlike subscribers and distributors, which do -- verified: SELECT tgname FROM pg_trigger returns only branches_default_distributor, distributors_enforce_editable_cols, subscribers_after_insert, subscribers_enforce_editable_cols, subscribers_guard_mass_detach, trg_block_inactive_employer_subscriber(_update), transactions_after_insert_contribution, transactions_after_insert_withdrawal). authenticated holds a full table-level UPDATE grant on both. The USING/WITH CHECK only pin subscriber_id.\n\npsql probes (all inside BEGIN ... ROLLBACK):\nC12 sub sets insurance_policies.cover=500000000 || OK || 1\nC13 sub sets insurance_policies.premium_monthly=0 || OK || 1\nC14 sub sets insurance_policies.status='active', funded_by='self' || OK || 1\nC15 sub set
- **Suggested fix (NOT applied):** Revoke UPDATE on the business columns of both tables from authenticated/anon and route the two real app paths -- renewal (src/services/subscriber.js:1399-1404) and upgrade/downgrade -- through the existing fund_insurance_products / pay_insurance_premium DEFINER RPCs. Alternatively add a trg_*_enforce_editable_cols BEFORE UPDATE trigger mirroring the one already on subscribers. · effort M
- **Verification:** CONFIRMED — Reproduced live (rolled back): a subscriber JWT UPDATE on insurance_policies set cover 1,000,000 -> 500,000,000, premium_monthly 2,000 -> 0, status='active', funded_by='self' (1 row), and flipped 2 subscriber_insurance_products rows to status='active'. Confirmed there is NO editable-column trigger on either table (trigger enumeration empty for both

### A03-001 · Anon invite-completion RPC is not bound to the invited phone → cross-tenant subscriber re-tag + compensation overwrite via a shareable token
- **Severity/Confidence:** high / plausible
- **Agent/Category/Surface:** A03 / authz-tenant-isolation / database-rpc
- **Location:** `public.create_subscriber_from_employer_invite (prosrc lines 15-24, 77-79)`
- **Roles:** employer, subscriber
- **Impact:** A holder of any single valid, non-expired invite token (invite links are shared over SMS/WhatsApp) can supply the phone of any of 5006 unaffiliated live subscribers and silently re-home that real subscriber into an employer that never invited them (they appear on that employer's roster) AND overwrite their monthly compensation with the invite's prefill value; or create a brand-new subscriber tagged to that employer for a person never invited. All 4 live invites are currently expired (not exploitable this instant), but any employer minting a new invite (a routine action) opens a 7-day window. Cross-entity data mutation gated only by a shareable token, no authenticated session required.
- **Repro:** 1) psql: confirm has_function_privilege('anon', 'public.create_subscriber_from_employer_invite(jsonb,text,text)'::regprocedure, 'EXECUTE') = t 2) psql: read prosrc; confirm regexp_count(prosrc,'prefill')=1 and (prosrc ~* 'prefill[^;]*phone')=false 3) psql (read-only): WITH payload AS (SELECT '<any-unaffiliated-subscriber-phone>' AS caller_phone) SELECT s.id, s.employer_id FROM subscribers s, payload WHERE right(regexp_replace(s.phone,'[^0-9]','','g'),9)=right(regexp_replace(payload.caller_phone,'[^0-9]','','g'),9) ORDER BY created_at DESC LIMIT 1  -> returns a real row with employer_id NULL (branch 22-24 = UPDATE) 4) End-to-end (BLOCKED by write classifier this session; deterministic): mint a pending invite for employer B whose prefill.phone differs, then POST /rest/v1/rpc/create_subscriber_from_employer_invite {payload:{phone:<victim phone>}, p_token:<invite>, p_nonce:null} as anon -> victim.employer_id becomes B and victim.compensation is overwritten
- **Evidence:** anon has EXECUTE (has_function_privilege('anon',oid,'EXECUTE')=t). Live prosrc keys entirely on payload->>'phone' (caller-controlled, line 15) and looks up an existing subscriber by that phone (lines 16-18); branch 22-24 runs an UNCONDITIONAL `UPDATE subscribers SET employer_id = v_inv.employer_id WHERE id = v_existing_id`, then lines 77-79 unconditionally overwrite compensation with v_inv.prefill->>'compensation'. Proof the invited phone is never consulted: `SELECT (prosrc ~* 'prefill[^;]*phone')::int, regexp_count(prosrc,'prefill')` => `0 | 1` (prefill referenced once, at line 78, reading compensation only). Read-only proof the branch resolves to a real victim: running the RPC's own selection SELECT for caller phone '715408207' => `s-0006 | (null)` (employer_id IS NULL => re-tag branch f
- **Suggested fix (NOT applied):** In the re-tag and create branches, bind completion to the invited phone: require right(regexp_replace(v_inv.prefill->>'phone','[^0-9]','','g'),9) = v_phone_norm, and reject a payload phone that differs from the phone the invite was minted for. · effort S
- **Verification:** CONFIRMED — Reproduced end-to-end in a rolled-back transaction. The author's write repro was classifier-blocked (confidence 'plausible'); I executed it and it is deterministic — confidence should be upgraded to 'confirmed'. Severity high is correct: a write corrupts data across tenant boundaries AND overwrites money. anon has EXECUTE and the function is SECURI

### A04-001 · make_contribution accepts NaN / Infinity / unbounded amounts; NaN irrecoverably poisons units and every AUM figure on the platform
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A04 / input-validation / RPC
- **Location:** `public.make_contribution:19`
- **Roles:** subscriber, admin, distributor, employer, agent, branch_admin
- **Impact:** units and invested are themselves poisoned, and nothing in the system ever recomputes them — publish_nav_snapshot derives total_balance = round(units * price), so NaN propagates forever. One poisoned member makes SUM(units) and SUM(total_balance) NaN, so get_nav_overview returns aum: NaN and unitsInIssue: NaN, and EVERY AUM surface on the platform (admin overview, distributor and branch rollups, league tables, employer metrics) renders NaN. Unlike the publish-side variant this is NOT recoverable from inside the app — only direct SQL can repair it. The shipped UI cannot trigger it (JSON.stringify(NaN) -> null, which the NULL guard rejects; src/services/subscriber.js:824 passes p_amount straight through with no Number.isFinite check), so reachability requires a direct RPC call; PostgREST casts a JSON string to the parameter type, making {"p_amount":"NaN"} the plausible vector. That HTTP leg was deliberately not executed because it would commit.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"app_role\":\"subscriber\",\"subscriberId\":\"s-0004\",\"role\":\"authenticated\"}',true); SELECT public.make_contribution('probe','NaN'::numeric,80,'MTN'); RESET ROLE; SELECT total_balance,units,invested FROM subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;" 3) Observe NaN | NaN | NaN, then confirm the post-ROLLBACK re-read is unchanged
- **Evidence:** The sole amount guard in the live body is `IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'`. In PostgreSQL `NaN <= 0` is FALSE (NaN sorts above every other numeric), so it does not fire.

All probes inside BEGIN…ROLLBACK on s-0004:
======== G5 contribution amount = NaN
 {"id":"tx-s-0004-adhoc-29ba8243b0aa41f18e2f6ba1eac1c8c2","amount":"NaN","splitEmergency":"NaN","splitRetirement":"NaN"}
 total_balance | retirement_balance | emergency_balance | units | invested
 NaN           | NaN                | NaN               | NaN   | NaN
======== G6 contribution amount = Infinity
 {"amount":"Infinity","splitEmergency":"NaN","splitRetirement":"Infinity"}
======== G7 contribution amount = 1e30
 accepted = 1000000000000000000000000000000
 total_balance 100000000000
- **Suggested fix (NOT applied):** Replace the guard with a shared validator: `IF p_amount IS NULL OR p_amount <= 0 OR p_amount = 'NaN'::numeric OR p_amount = 'Infinity'::numeric OR p_amount > 100000000 THEN RAISE EXCEPTION ... END IF;` and apply the same to request_withdrawal, pay_insurance_premium, fund_insurance_products and submit_employer_contribution_run. Add `CHECK (total_balance = total_balance AND units = units)` (a NaN trap) plus non-negativity CHECKs on subscriber_balances — the table currently has zero CHECK constraints. · effort S
- **Verification:** CONFIRMED — make_contribution's only amount guard (line 19, p_amount <= 0) cannot fire for NaN because Postgres sorts NaN above every numeric. Reproduced through the REAL RPC as a subscriber JWT inside BEGIN...ROLLBACK: all subscriber_balances columns for s-0004 went NaN. Reachability holds: the function is EXECUTE-granted to `authenticated` and the in-body ro

### A04-002 · request_withdrawal validates only that the split legs SUM to the amount, so a negative leg creates money in the retirement bucket
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A04 / wrong-money / RPC
- **Location:** `public.request_withdrawal:65-69`
- **Roles:** subscriber
- **Impact:** (-100000) + 200000 = 100000 passes the sum check, and the member's RETIREMENT balance rises by 100,000 UGX on a withdrawal — money created from nothing. Simultaneously the buckets stop summing to the total (break 65,764), so the member's dashboard shows Retirement 636,943 + Savings 0 against Total 571,179. total_balance and units stay mutually consistent (363.484 x 1571.4 = 571,179), so the units x NAV reconciliation would not catch it and v_reconciliation_exceptions' split_mismatch check would flag only the symptom. Not reachable through WithdrawPage.jsx (which never sends explicit splits) — requires a direct RPC call.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"app_role\":\"subscriber\",\"subscriberId\":\"s-0004\",\"role\":\"authenticated\"}',true); SELECT public.request_withdrawal('probe',100000,NULL,'x','MTN',-100000,200000); RESET ROLE; SELECT total_balance,retirement_balance,emergency_balance FROM subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;" 3) Observe retirement_balance rise from 536943 to 636943 on a withdrawal
- **Evidence:** Live body lines 65-69 are the only validation on the explicit splits:
  IF v_split_ret IS NOT NULL AND v_split_emg IS NOT NULL
     AND (v_split_ret + v_split_emg) <> p_amount THEN RAISE EXCEPTION ...
Neither leg is checked for sign or against its own bucket. trg_transactions_withdrawal then computes GREATEST(0, retirement_balance - v_ret_take); with v_ret_take negative that ADDS to the bucket.

Probe inside BEGIN…ROLLBACK on s-0004 (pre: total 671179 / ret 536943 / emg 134236):
======== S1 explicit splits that SUM to the amount but one leg is NEGATIVE
 SELECT public.request_withdrawal('A04-S1', 100000, NULL, 'x', 'MTN', -100000, 200000)
 accepted = 100000
 total_balance | retirement_balance | emergency_balance | invariant_break | units
 571179        | 636943             | 0              
- **Suggested fix (NOT applied):** Add to the same IF block: `IF v_split_ret < 0 OR v_split_emg < 0 THEN RAISE EXCEPTION 'split legs must be non-negative' USING ERRCODE='P0001'; END IF;` and a per-bucket sufficiency check against the FOR UPDATE-locked balance row (v_split_ret <= retirement_balance AND v_split_emg <= emergency_balance). This fix also closes A04-004. · effort S
- **Verification:** CONFIRMED — request_withdrawal validates only that the two explicit splits SUM to the amount (body lines 65-69); no per-leg sign or bucket check. trg_transactions_withdrawal line 31 does GREATEST(0, retirement_balance - v_ret_take), so a negative v_ret_take ADDS to the retirement bucket. Reproduced through the REAL RPC inside BEGIN...ROLLBACK: retirement rose 

### A04-003 · A reseed leaves units at the dead 1,000 UGX price and zeroes bucket units; the next NAV publish inflates AUM 57% and zeroes every member's retirement pot
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A04 / wrong-money / seed / money engine
- **Location:** `scripts/seed-supabase.mjs:78`
- **Roles:** admin, subscriber, employer, distributor, agent, branch_admin
- **Impact:** total_balance +57.1%, retirement_balance -100% (to exactly 0), emergency_balance +686%, invested 0. Across 5,060 members: platform AUM inflates ~57% with no money in, EVERY member's retirement savings read zero, every shilling becomes withdrawable 'emergency' money, and all growth figures collapse to 0% (get_nav_overview's avgGrowthPct filters on invested > 0, which no row would satisfy). subscribers.current_unit_value also reverts to the seed's random 950-1050 while the register says 1,571.40, so the '@ X/unit' line is wrong too. Even before any publish the reseed alone breaks the units x NAV == total_balance invariant by 57% for every row, and the admin NAV page's own projectedAum = unitsInIssue x typedPrice (AdminNavDesktop.jsx:131-133) sits 57% above the AUM tile beside it. This becomes CRITICAL the moment anyone reseeds — and 0105's header calls the NAV publish 'the live demo moment'.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -c "BEGIN; UPDATE subscriber_balances SET units = round((total_balance/1000)*100)/100, retirement_units = DEFAULT, emergency_units = DEFAULT, invested = DEFAULT WHERE subscriber_id='s-0004'; UPDATE subscriber_balances SET total_balance = round(units*1571.40), retirement_balance = round(retirement_units*1571.40), emergency_balance = round(units*1571.40)-round(retirement_units*1571.40) WHERE subscriber_id='s-0004'; SELECT total_balance, retirement_balance, emergency_balance FROM subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;" 3) Observe 1054692 | 0 | 1054692 versus the real 671179 | 536943 | 134236
- **Evidence:** Three measured facts. (1) scripts/seed-supabase.mjs:74-83 `const UNIT_PRICE = 1000; function unitsFromBalance(netBalance){return Math.round(((netBalance ?? 0)/UNIT_PRICE)*100)/100;}`. (2) `nav_snapshots` is absent from the seed's TRUNCATE list (scripts/seed-supabase.mjs:361-397) and the seed never inserts into it, so the register keeps saying 1,571.40. (3) The subscriber_balances insert (:639-658) writes only subscriber_id/retirement_balance/emergency_balance/total_balance/units; information_schema shows the omitted columns default to 0: `retirement_units|numeric|NO|0`, `emergency_units|numeric|NO|0`, `invested|numeric|NO|0`.

Reproduced against live inside BEGIN…ROLLBACK on s-0004, writing the seed shape then applying publish_nav_snapshot's revaluation arithmetic VERBATIM (0106 body lines
- **Suggested fix (NOT applied):** Either (a) have the seed derive units from public.latest_nav() instead of the 1,000 literal and write retirement_units/emergency_units/invested (units x bucket ratio, and invested = total_balance so growth starts at 0%), or (b) add nav_snapshots to the TRUNCATE list and reseed a flat 1,000 register so the two stay consistent. Option (a) is preferable — it keeps the 5-year price history 0105 built. Either way add a post-seed assertion that abs(total_balance - round(units * latest_nav())) <= 1 and retirement_units + emergency_units = units for every row. · effort S
- **Verification:** CONFIRMED — All three seed facts verified in source: UNIT_PRICE=1000 with unitsFromBalance (units=total/1000); nav_snapshots is never truncated or inserted by the seed (grep NO MATCH); the subscriber_balances seed insert writes only 5 columns and the omitted retirement_units/emergency_units/invested all default to 0. publish_nav_snapshot lines 72-79 set retire

### A05-003 · settlement_batches.paid_amount / line_count do not equal the lines they flipped — 25,000 UGX and 5 lines of settlement are unbacked in live data
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A05 / data-integrity / db
- **Location:** `public.settlement_batches (live rows sb-seed-0001, sb-aaa8b141…, sb-3da879ed…, sb-09258a3b…)`
- **Roles:** agent, branch, distributor, admin
- **Impact:** The settlement ledger claims 75,000 UGX / 15 lines paid while the commission rows account for only 50,000 UGX / 10 lines. Four of five live batches are wrong. The distributor's Commissions panel shows SETTLED 50K / 10 paid while the agent's settlement history for the same agent totals 60K — the two roles disagree about how much has been paid out. No constraint, trigger, or periodic check would catch this.
- **Repro:** 1) Run the reconciliation query above against the live DB. 2) Observe 4 of 5 rows where claimed_lines/claimed_paid exceed actual_lines/actual_paid. 3) Cross-check: distributor Commissions panel reads SETTLED 50K / 10 paid; agent a-001 settlement history totals UGX 60K over 4 rows.
- **Evidence:** psql "$SUPABASE_DB_URL" -X -q -c "select b.id, b.txn_ref, b.agent_id, b.line_count claimed_lines, b.paid_amount claimed_paid, (select count(*) from commissions c where c.txn_ref=b.txn_ref and c.agent_id=b.agent_id and c.status='paid') actual_lines, (select coalesce(sum(c.paid_amount),0) from commissions c where c.txn_ref=b.txn_ref and c.agent_id=b.agent_id and c.status='paid') actual_paid from settlement_batches b order by b.created_at;"
                 id                  |          txn_ref          | agent_id | claimed_lines | claimed_paid | actual_lines | actual_paid
-------------------------------------+---------------------------+----------+---------------+--------------+--------------+-------------
 sb-seed-0001                        | MM-SEED-0001              | a-001    |        
- **Suggested fix (NOT applied):** Repair the five rows (drop the three orphan E2E batches; recompute sb-seed-0001 from the lines that actually carry MM-SEED-0001). Add the reconciliation query above to the /qa harness as an invariant that must return zero mismatching rows. · effort S
- **Verification:** CONFIRMED — Live reconciliation confirms settlement_batches do not equal the commission lines they flipped. Gap has grown since A05 (measured 25K/5 lines) to 50K/10 lines unbacked, because more E2E residue accrued. Four+ live batches have zero backing paid commissions for their (txn_ref, agent_id). No constraint or trigger catches it; distributor and agent rol

### A05-004 · Re-uploading the same settlement file settles another tranche against the same payment reference — the nonce is minted per file-pick
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A05 / replay / rpc
- **Location:** `src/dashboard/commissions/CommissionPanel.jsx:358 (nonce minted in handleUploadFile) and :324 (input reset so the same file can be re-picked) · public.apply_settlement (no txn_ref uniqueness)`
- **Roles:** distributor, admin, agent, branch
- **Impact:** One real UGX 5,000 payment settled UGX 15,000 of commission across three batches carrying an identical payment reference, and emitted 6 commission_settled notifications. Nothing in the schema, the RPC, or the UI treats a repeated txn_ref as suspicious. The confirm modal's 'amount mismatch' line is indistinguishable from a legitimate partial payment under the documented INFORM-NOT-BLOCK semantics, so the duplicate is never flagged.
- **Repro:** 1) Sign in as distributor d-001. Open Commissions. 2) Upload a settlement CSV paying one agent a partial amount (e.g. UGX 5,000 against 20,000 pending). Confirm. 3) Without changing anything, pick the SAME file again and Confirm. 4) Repeat once more. Three settlement_batches rows now exist with the identical Payment Reference and 3x the money settled.
- **Evidence:** psql "$SUPABASE_DB_URL" -X -q -f t_replay.sql (all inside BEGIN..ROLLBACK, claims app_role=distributor/distributorId=d-001):
 due_before | 4 | 20000
 submit1            | {"skipped": [], "totalPaid": 5000, "linesSettled": 1, "agentsSettled": 1}
 replay_same_nonce  | {"skipped": [], "totalPaid": 5000, "linesSettled": 1, "agentsSettled": 1}
 batches_after_same_nonce | 1        <-- same-nonce replay IS a no-op (passes)
 replay_new_nonce   | {"skipped": [], "totalPaid": 5000, "linesSettled": 1, "agentsSettled": 1}
 replay_new_nonce_2 | {"skipped": [], "totalPaid": 5000, "linesSettled": 1, "agentsSettled": 1}
 batches_after_new_nonces:
  sb-c6ad8744b81c49e9a6a821bc53072cc2 | a-001 | 20000 | 5000 | 1 | A05-REPLAY-REF | a05-nonce-1
  sb-8498bec4575b4cd1ab11b8ecf198deca | a-001 | 15000 | 5000 | 1 
- **Suggested fix (NOT applied):** Add CREATE UNIQUE INDEX … ON settlement_batches (agent_id, txn_ref) WHERE txn_ref IS NOT NULL, or derive the nonce from a hash of the normalised row set so the same file always yields the same nonce. Replace the test.fixme placeholder with a real replay spec asserting settlement_batches gains exactly one row across two submits. · effort S
- **Verification:** CONFIRMED — Reproduced live under BEGIN..ROLLBACK: same nonce twice is a no-op (idempotent via settlement_uploads), but three calls with new nonces and the same paymentRef settled three separate 5K tranches (15K total, 6 notifications) against one payment reference. Nonce is minted per file-pick (CommissionPanel.jsx:358) and e.target.value='' (:324) lets the i

### A05-005 · Two rows for the same agent in one settlement upload settle that agent twice in a single call
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A05 / replay / rpc
- **Location:** `public.apply_settlement (FOR v_row IN SELECT jsonb_array_elements(p_rows) with no per-agent grouping) · src/utils/settlement.js:170 normalizeUploadedRows (no dedupe by agentId)`
- **Roles:** distributor, admin, agent, branch
- **Impact:** A distributor who appends a correction row instead of editing the template in place pays the agent twice. The nonce cannot help — it is one RPC invocation. Worse, the response reports agentsSettled: 2 for a single agent, so the success toast (CommissionPanel.jsx:372) reads 'Settled 2 agents' and the confirm modal's agentCount (:503, pendingUpload.rows.length) also says 2. There is no signal anywhere that it is the same agent twice.
- **Repro:** 1) Download the settlement template as distributor d-001. 2) Duplicate one agent's row so the file lists the same Agent ID twice, each with an Amount Paid. 3) Upload and Confirm. Two settlement_batches rows are written for that one agent and the toast reads 'Settled 2 agents'.
- **Evidence:** Client-side (node u/rt2.mjs, real production parse path):
  duplicate-agent-rows :: ok=true missing=[] accepted=[{"agentId":"a-001","amountPaid":5000,"paymentRef":"R1","paymentDate":""},{"agentId":"a-001","amountPaid":5000,"paymentRef":"R1","paymentDate":""}] skipped=[]
Server-side (psql -f t_dupe.sql, BEGIN..ROLLBACK, one RPC call with the agent listed twice):
  dupe_rows | {"skipped": [], "totalPaid": 10000, "linesSettled": 2, "agentsSettled": 2}
  batches | sb-370be86ba4974cf9835d00cb9de30ee5 | a-001 | 95000 | 5000 | 1
  batches | sb-11fbd8c1141c4fb79caed9ca14458a93 | a-001 | 90000 | 5000 | 1
  lines  | 2 | 10000
  notifs | 4
- **Suggested fix (NOT applied):** Aggregate p_rows by agentId before the loop (SELECT agentId, sum(amountPaid) … GROUP BY agentId) or reject a duplicated agentId with a new 'duplicate_agent' skip reason; mirror the de-duplication in normalizeUploadedRows so the confirm modal counts distinct agents. · effort S
- **Verification:** CONFIRMED — Reproduced live under BEGIN..ROLLBACK: one RPC call with a-001 listed twice returned agentsSettled:2/linesSettled:2/totalPaid:10000 and wrote two batches for the same agent. normalizeUploadedRows (src/utils/settlement.js) does not dedupe by agentId and the loop FOR v_row IN SELECT jsonb_array_elements(p_rows) has no per-agent grouping, so a distrib

### A06-002 · E2E contribution-run cleanup orphans 1,824 transactions on a premise the schema refutes
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A06 / test-hygiene / e2e suite / live database
- **Location:** `e2e/specs/flows/employer-contribution-run.spec.ts:55-81`
- **Roles:** employer, admin, distributor
- **Impact:** 33 employer contribution runs have been executed against live; only 1 contribution_runs header survives and only 57 of 1,881 transactions still carry a contribution_run_id. Deleting the header triggers ON DELETE SET NULL, which erases the exact column that would have identified the rows for cleanup — so 1,824 transactions are now permanently unattributable and cannot be removed by any query the test could run. Each suite run adds ~57 more rows and ~3.6M UGX of fake AUM (see A06-001). The nonce ledger has grown to 33 rows because its cleanup targets a non-existent column and swallows the error; settlement_uploads (153) and subscriber_signup_uploads (98) show the same pattern.
- **Repro:** 1) npx playwright test e2e/specs/flows/employer-contribution-run.spec.ts 2) psql: select count(*) from public.transactions where txn_ref like 'EMP-%'  -- grows by 57 each run 3) psql: select count(*) from public.contribution_run_uploads  -- grows by 1 each run, never shrinks
- **Evidence:** e2e/specs/flows/employer-contribution-run.spec.ts:66-71 (verbatim):
      // Employer-source transactions stamped by this run carry source='employer';
      // there is no run_id FK on transactions, so we scope by the run's window is
      // not reliable — instead delete the run rows + their lines (the ledger rows
      // are demo-scope residue, consistent with the settlement spec's discipline).
      await supabaseAdmin.from('contribution_runs').delete().in('id', runIds);

The premise is false:
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.transactions'::regclass;"
transactions_agent_id_fkey|FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
transactions_contribution_run_id_fkey|FOREIGN KEY 
- **Suggested fix (NOT applied):** In the afterEach, delete transactions BEFORE the run header, scoped by the FK that exists: await supabaseAdmin.from('transactions').delete().in('contribution_run_id', runIds). Drop the contribution_run_lines delete (dead table). Clean contribution_run_uploads by the nonce actually returned by the run submission, not by a non-existent employer_id column, and stop swallowing the error — assert it. Add an assertNoRunResidue() post-suite probe alongside assertNoSubscriberOrphans. · effort S
- **Verification:** CONFIRMED — The cleanup comment's premise ('no run_id FK on transactions') is false — transactions_contribution_run_id_fkey exists with ON DELETE SET NULL, so deleting the run header nulls the only column that could identify the rows. 33 refs / 1,881 rows / only 57 retain contribution_run_id. contribution_run_lines does not exist (0). contribution_run_uploads 

### A06-003 · Seed's stale MOCK_NOW mirror pushes every contribution schedule 36 days too far out; weekly savers are next due in 8 weeks
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A06 / clock-drift / subscriber Schedule page (/dashboard/save/schedule), branch-admin overdue backlog, agent member detail
- **Location:** `scripts/seed-supabase.mjs:166-177 (comment + const MOCK_NOW) vs src/data/mockData.js:25`
- **Roles:** subscriber, agent, branch
- **Impact:** The over-shift breaks each schedule's own frequency, which is visible on the first screen a subscriber demo opens. s-0004 is a WEEKLY saver whose next payment is 57 days after the seed ran; s-0002 (the save-to-cover demo persona) is a MONTHLY saver next due in 44 days. 610 of 701 weekly savers and 391 of 2,102 monthly savers are due further out than their frequency allows. The same over-shift lands on seed-supabase.mjs:751-752, which writes every one of the 1,473 subscriber_insurance_products rows with policy_start 2026-03-04 / renewal 2027-03-04 instead of the intended 2026-01-27 / 2027-01-27.
- **Repro:** 1) Log in as subscriber +256711000004 (s-0004, a weekly saver) 2) Open /dashboard/save/schedule 3) Read 'Weekly' next to a next-due date of 22 Sep 2026 — 8 weeks out
- **Evidence:** The seed's comment is now false.
scripts/seed-supabase.mjs:166-169 (verbatim):
  // MOCK_NOW MUST mirror src/data/mockData.js (`new Date(2026, 4, 26)` = 2026-05-26).
  // If that constant moves, update this to match (kept in sync deliberately — the
  // seed can't import a live binding without re-evaluating the whole mock module).
  const MOCK_NOW = new Date(2026, 4, 26); // 2026-05-26 — mirror of mockData.MOCK_NOW
src/data/mockData.js:21-25 (verbatim):
  // Rolled forward 2026-07-01 (per ADR-006 and CLAUDE.md §10b — slide forward
  // when relative dates start looking stale; previous anchor 2026-05-26 was ~5
  // weeks stale). ...
  export const MOCK_NOW = new Date(2026, 6, 1); // 2026-07-01

Arithmetic: mockData.js:357-361 -> nextDueOffsetDays = randInt(1,30); nextDue = MOCK_NOW + offset
- **Suggested fix (NOT applied):** Set scripts/seed-supabase.mjs:169 to new Date(2026, 6, 1) and update the comment, OR (better) remove the duplicated constant entirely: export MOCK_NOW from a tiny dateless module that both mockData.js and the seed import, so it cannot drift again. Then reseed. Add a unit assertion that the seed's anchor === mockData's anchor so the next roll-forward fails loudly. · effort S
- **Verification:** CONFIRMED — Seed MOCK_NOW=new Date(2026,4,26) (2026-05-26) is stale vs mockData new Date(2026,6,1) (2026-07-01); the seed's own mirror comment is now false. Over-shift lands 4,137 schedules in 2026-09; s-0004 (weekly) due 2026-09-22. Schedule page reads the DB value (subscriber.js:284/1062) so it is demo-visible. Drift between MOCK_NOW copies is explicitly in-

### A06-004 · Agent and subscriber surfaces disagree on 1,284 members' policy status (Active vs Expired)
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A06 / correctness / agent member detail vs subscriber Policies page
- **Location:** `src/services/agent.js:26-35 (buildAgentPolicies) vs src/utils/policies.js:56-60 (derivePolicyStatus)`
- **Roles:** agent, subscriber
- **Impact:** For 1,284 members (47% of the seeded population) an agent sees 'Life cover · Active' while the member's own dashboard says 'Life cover · Expired', on the same day, from the same row. A rep who demos the agent view and then the member view of the same person shows two contradictory answers. Because the count depends on which of the three live clocks a surface reads, the number of disagreeing members is itself clock-dependent (1,143 / 1,284 / 1,473).
- **Repro:** 1) Log in as agent +256700000001 (a-001) and open a member whose life renewal_date < 2026-07-01 (e.g. s-0003) 2) Note 'Life cover · Active' in the held-cover panel 3) Log in as that member (subscriber) and open Policies 4) Note 'Life cover · Expired' for the same policy row
- **Evidence:** Two code paths derive 'is this cover active?' from the same rows and disagree.

src/utils/policies.js:56-60 (subscriber's own Policies page) derives BY DATE:
  export function derivePolicyStatus({ renewalDate }, now) {
    const renew = toDate(renewalDate);
    if (!renew) return 'active';
    return renew.getTime() >= now.getTime() ? 'active' : 'expired';
  }
...with `now` supplied by src/services/subscriber.js:145 as currentTime() = MOCK_NOW = 2026-07-01.

src/services/agent.js:26-35 (agent member detail) reads the STORED FLAG:
  function buildAgentPolicies(lifeIns, productRows) {
    const out = [];
    if (lifeIns && lifeIns.status === 'active' && Number(lifeIns.cover) > 0) {
      out.push({ product: 'life', status: 'active' });
    }
...and src/services/agent.js:174 selects 'insuranc
- **Suggested fix (NOT applied):** Make buildAgentPolicies call derivePolicyStatus from src/utils/policies.js with the same injected `now` the subscriber path uses, instead of trusting insurance_policies.status. Alternatively add a DB sweep that flips status to 'expired' when renewal_date passes (the codebase already has such a sweep for the 'building' state per migration 0072) — but the shared-derivation fix removes the clock dependency entirely. · effort S
- **Verification:** CONFIRMED — Two live code paths disagree: policies.js derivePolicyStatus derives active/expired by date with injected now (subscriber.js:145 = currentTime()/MOCK_NOW 2026-07-01), while agent.js buildAgentPolicies trusts the raw insurance_policies.status flag (agent.js:174 selects status). 1,284 active-flagged policies have renewal_date < 2026-07-01, so the age

### A06-005 · create_employer / create_distributor ignore the identity-write failure, so a new tenant's owner signs in to Nile Breweries
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A06 / multi-tenancy / admin '+ New Employer' / '+ New Distributor' doors; sign-in
- **Location:** `public.create_employer / public.create_distributor (PERFORM public.register_login_identity(...))`
- **Roles:** admin, employer, distributor
- **Impact:** The admin '+ New Employer' / '+ New Distributor' forms return success while silently creating an entity with no sign-in binding. Its owner then signs in and lands inside emp-001 (Nile Breweries) or d-001 with write access to that tenant's roster, and nothing errors anywhere — the exact failure mode the codebase's own login-identity-contract test header describes as having 'shipped to production twice' (0079/0090, 0095/0101). The 0101 fix moved the write into register_login_identity but did not make the two admin callers check its result. src/test/login-identity-contract.test.js cannot catch this: it only greps the newest migration definition for the string 'register_login_identity', never that the caller inspects the return value. approve_access_request IS protected.
- **Repro:** 1) Sign in as admin +256700000099 / Demo1234 2) Admin -> Employers -> '+ New Employer'; enter contact phone +256700000031 (already emp-001's owner phone) 3) Save — the form reports success and a new employer appears in the list 4) psql: select count(*) from public.demo_personas where entity_id = '<new id>'  -- 0 5) Sign in as employer on +256700000031 — you land in Nile Breweries Demo, not the new employer
- **Evidence:** register_login_identity returns NULL and writes NOTHING when (phone, role) is already bound elsewhere:
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -v ON_ERROR_STOP=0 <<'SQL'
BEGIN;
select id, phone, role, entity_id from public.demo_personas where phone='+256700000031' and role='employer';
select coalesce(public.register_login_identity('+256700000031','employer','emp-A06-PROBE','Probe Co',null), '(NULL RETURNED — identity NOT written)');
ROLLBACK;
SQL
dp-e-001|+256700000031|employer|emp-001
(NULL RETURNED — identity NOT written)

Only one of the three callers checks the return:
$ psql ... -c "select p.proname||' :: '||l from pg_proc p join pg_namespace n on n.oid=p.pronamespace, lateral unnest(string_to_array(p.prosrc, E'\n')) l where n.nspname='public' and l ilike '%register_login_identity%'
- **Suggested fix (NOT applied):** Change create_employer and create_distributor from PERFORM to `v_bound := public.register_login_identity(...); IF v_bound IS NULL THEN RAISE EXCEPTION ... USING ERRCODE='P0001'; END IF;` (same shape approve_access_request already uses). Then extend src/test/login-identity-contract.test.js with an assertion that each provisioning function's body contains an IS NULL guard on the call's result, not just the call. · effort S
- **Verification:** CONFIRMED — register_login_identity returns NULL (writes nothing) when the phone is already bound; create_employer and create_distributor call it via PERFORM (return ignored), while only approve_access_request guards with IF v_bound IS NULL THEN RAISE. create_employer's own comment documents 'create still succeeds' on NULL. Real inconsistency and multi-tenancy

### A09-001 · Keepalive monitor cannot see or prevent the Supabase auto-pause that takes the demo down
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A09 / availability-monitoring / infra/ci
- **Location:** `.github/workflows/keepalive.yml:29-31 + server/index.ts:110-116`
- **Roles:** all
- **Impact:** Supabase free tier auto-paused after ~7 idle days (last activity 2026-08-11, discovered paused 2026-08-23). The only scheduled monitor pings an endpoint that is deliberately I/O-free and therefore generates zero Postgres activity, so it can neither defer the pause nor detect it: 200 of 200 runs reported success while the demo was unusable. A rep opening the demo cold sees shell chrome, zero data and 503 on every /api/* call, with no in-product explanation, until a human with Supabase dashboard access clicks restore (~2 min, 6 failed /readyz polls first).
- **Repro:** 1) Leave the Supabase project idle for ~7 days (the GHA keepalive keeps pinging /healthz throughout) 2) Observe: `gh run list --workflow=keepalive.yml` shows 100% success 3) Open https://uganda-dashboard.vercel.app and sign in as any persona 4) Frontend renders with zero data; every /api/* call returns 503; /readyz returns {"ok":false,"code":"not_ready"} 5) Only a manual Supabase restore recovers it (~120 s)
- **Evidence:** $ cat .github/workflows/keepalive.yml (line 29-31)
          code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
            "https://uganda-dashboard-api.onrender.com/healthz")

$ sed -n '110,116p' server/index.ts
app.get('/healthz', cors(corsOptions), (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
});
(comment at :95-97: "Must remain I/O-free so a misconfigured Supabase deploy still surfaces as `service up, env wrong` rather than a network outage (G16)")

$ gh run list --workflow=keepalive.yml --limit 200 --created 2026-08-18..2026-08-23 --json conclusion,createdAt | python3 ...
runs in 2026-08-18..2026-08-23: 200
conclusions: Counter({'success': 200})
- **Suggested fix (NOT applied):** Point keepalive.yml:31 at /readyz instead of /healthz (one line). /readyz performs one cheap read against commission_config, so the ping both generates the DB activity that defers the pause and turns red when the DB is unreachable. Alternatives: a second GHA cron running `psql "$SUPABASE_DB_URL" -c 'select 1'` (needs a prod credential added to GitHub, weaker), or Supabase Pro at $25/mo (removes auto-pause and adds PITR, also closing A09-003). · effort S
- **Verification:** CONFIRMED — keepalive.yml:21-22 pings /healthz, which server/index.ts:110-116 serves with zero Postgres I/O (comment :95-97 mandates I/O-free). The DB-touching probe /readyz is NOT the one the cron hits, so the 10-min ping generates no DB activity and can neither defer nor detect the Supabase 7-day-idle free-tier pause (baseline §1 records the project auto-pau

### A09-002 · Playwright E2E job times out on every push to main, so the §15-M1 db guard has never executed and nothing gates production
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A09 / ci-gating / infra/ci
- **Location:** `.github/workflows/test.yml (job `e2e`, timeout-minutes: 20; steps "Run Playwright full matrix" and "Assert db/ specs actually executed … (§15-M1)")`
- **Roles:** all
- **Impact:** The full Playwright matrix needs >24.4 min at --workers=1 (baseline §10) and playwright.config.ts:52 sets `retries: CI ? 1 : 0`, so CI is strictly slower than that against a 20-minute job ceiling. The job is cancelled every time and every subsequent step is skipped: the guard written specifically to catch silently-skipped RLS / money-idempotency / schema-invariant specs has run ZERO times in 41 attempts, and the HTML report and traces are never uploaded either (`if: ${{ !cancelled() }}` is false on a timeout). With main unprotected, no rulesets, and Vercel auto-deploying on push, bd637f6 shipped to production on a cancelled pipeline — as did all 40 pushes before it. This is why the 30 deterministic Playwright failures in baseline §10 reached production unnoticed. Zero green CI runs of any kind in the last 60 runs.
- **Repro:** 1) gh run list --workflow=test.yml --limit 60 --json conclusion,event → 41/41 push runs 'cancelled' 2) gh api repos/shubhang1992/uganda-dashboard/actions/jobs/93757067117 → full-matrix step cancelled at 18m50s, §15-M1 step skipped 3) Repeat for runs 30809969527, 30154831059, 27422831333 → identical (cancelled / m1=skipped) spanning 2026-06-12 to 2026-08-11
- **Evidence:** $ gh api repos/shubhang1992/uganda-dashboard/actions/jobs/93757067117 --jq '...'
{"completed":"2026-08-11T11:19:42Z","conclusion":"cancelled","name":"Playwright E2E","started":"2026-08-11T10:59:26Z","steps":[...
 {"n":"Run Playwright full matrix (main post-merge — chromium + webkit, smoke + flow + regression + db)","c":"cancelled","s":"2026-08-11T11:00:49Z","e":"2026-08-11T11:19:39Z"},
 {"n":"Assert db/ specs actually executed (not silently skipped) (§15-M1)","c":"skipped"},
 {"n":"Upload Playwright HTML report","c":"skipped"},
 {"n":"Upload Playwright traces + screenshots on failure","c":"skipped"}]}

$ <sweep of every push-to-main run in the last 60 workflow runs> | awk '{print $2, $3}' | sort | uniq -c
  41 cancelled m1=skipped

$ gh api repos/shubhang1992/uganda-dashboard/branches/main
- **Suggested fix (NOT applied):** Split e2e into its own job or raise timeout-minutes to >=45; move the §15-M1 assertion BEFORE the full-matrix step (or into its own always-run job) so it executes regardless; change both artifact uploads from `if: ${{ !cancelled() }}` to `if: always()`. Consider a branch-protection rule on main requiring lint-and-unit at minimum. · effort M
- **Verification:** CONFIRMED — test.yml e2e job timeout-minutes:20; push path runs full `npx playwright test --workers=1` with retries:1 (playwright.config.ts:51); baseline §10 clocks 24.4 min > ceiling. The HEAD commit itself proves the mechanism: run 31484332571 (headSha bd637f6) e2e job cancelled, full-matrix step 11:00:49->11:19:39 then cancelled, job total 20m16s = the 20-m

### A09-003 · `npm run seed` TRUNCATEs the live demo database with no confirmation and no backup
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A09 / data-destruction-risk / scripts
- **Location:** `package.json ("seed") -> scripts/seed-supabase.mjs:335-365`
- **Roles:** all
- **Impact:** The only SUPABASE_DB_URL present in .env.local points at the LIVE Singapore project. A single `npm run seed` irreversibly destroys 5,064 subscribers, 29,027 transactions and 5,001 commissions with no prompt, no --yes flag, no project-ref assertion, and no restore path on the Supabase free tier. Every demo fails afterwards until a full reseed. This has already happened once (change-set audit 2026-06-16 recorded a destructive live reseed). Script was READ ONLY, never executed, per G4.
- **Repro:** 1) Inspect package.json: `seed` resolves SUPABASE_DB_URL from .env.local, which points at the live project ilkhfnoyxlxwqadebnkp 2) Inspect scripts/seed-supabase.mjs:359-365 — TRUNCATE ... RESTART IDENTITY CASCADE executes unconditionally after BEGIN 3) grep for any confirmation/argv/env guard: none exists 4) (Not executed — G4)
- **Evidence:** $ python3 -c "...json.load(open('package.json'))['scripts']..."
seed: dotenv -e .env.local -- node scripts/seed-supabase.mjs

$ sed -n '325,375p' scripts/seed-supabase.mjs
    //  ⚠️  DESTRUCTIVE RESET — TRUNCATE … RESTART IDENTITY CASCADE  ⚠️
    //  ‼️  ONLY SAFE against the fresh, empty demo project this script is run
    //      against. It is HUMAN-RUN ONLY and will irrecoverably destroy ALL
    //      data in these tables … There is no undo.
    console.log('• TRUNCATE (destructive reset)…');
    await client.query(`
      TRUNCATE TABLE
        regions, districts, branches, agents, subscribers, subscriber_balances,
        contribution_schedules, insurance_policies, nominees, transactions,
        claims, withdrawals, commission_config, commissions, …

$ grep -nE "DELETE|TRUNCATE|c
- **Suggested fix (NOT applied):** Require an explicit `--yes-destroy <project-ref>` argument that must match the ref parsed out of SUPABASE_DB_URL before the TRUNCATE runs, or gate the TRUNCATE block on SEED_ALLOW_TRUNCATE=1. Turns a keystroke into a deliberate decision at near-zero cost. · effort S
- **Verification:** CONFIRMED — package.json seed = `dotenv -e .env.local -- node scripts/seed-supabase.mjs`; the script runs TRUNCATE TABLE regions,districts,branches,agents,subscribers,subscriber_balances,transactions,... RESTART IDENTITY CASCADE with no argv/confirm/env/project-ref guard (grep matched only a MOCK_NOW comment at line 161). .env.local's SUPABASE_DB_URL targets t

### A10-001 · All Transactions and Annual Tax Statement reports show no data / all zeros in live mode (currentSubscriber never carries transactions)
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A10 / correctness / subscriber /dashboard/reports/all-transactions and /dashboard/reports/annual-statement
- **Location:** `src/services/subscriber.js:488 (getCurrentSubscriber select omits transactions) + mapSubscriberRow (no transactions key); consumers AllTransactions.jsx:81, AnnualStatement.jsx:20`
- **Roles:** subscriber
- **Impact:** Two of the five named subscriber reports render empty; the Annual TAX STATEMENT reports UGX 0 contributions (and its CSV literally exports 'Contributions 2026,0') for a member who contributed UGX 1.4M. Systematic across every live subscriber. Borderline critical on the wrong-money CSV; presents as an empty-state on screen.
- **Repro:** 1) Sign in as any subscriber (live Supabase mode) 2) Open /dashboard/reports/all-transactions -> '0 of 0 transactions' 3) Open /dashboard/reports/annual-statement -> 'No statement yet' 4) Export either CSV -> blank / all zeros
- **Evidence:** psql: s-0001 has 11 transactions (9 contributions=1,400,137; 1 premium=24,000; 1 withdrawal). node scratch/a10-tx-empty.mjs: ALL-TX screen '0 of 0 transactions | MONEY IN — | NET —'; ANNUAL screen 'No statement yet.'; ACTIVITY control (useSubscriberTransactions) 'THIS YEAR UGX 1,376,137 | ↑UGX 1.4M in'. annual-statement CSV = 'Contributions 2026,0 | ... | Net inflow,0'; AllTransactions CSV = header only, 0 data rows. Persists past 12s; mapSubscriberRow keys dump has no 'transactions'. Screens a10-alltx-empty-d.png, a10-annual-zeros-d.png.
- **Suggested fix (NOT applied):** Point AllTransactions and AnnualStatement at useSubscriberTransactions(sub.id) (as ActivityPage/WithdrawalsHistory already do), or add a transactions field to getCurrentSubscriber + mapSubscriberRow. · effort S
- **Verification:** CONFIRMED — getCurrentSubscriber .select omits transactions; s-0001 has 11 txns → reports read empty

### A11-005 · Agent member detail shows 'Life cover · Active' for members whose own dashboard shows 'Expired' (verifies A06-004 on the agent surface)
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A11 / data-integrity / agent /dashboard/subscribers/:id (INSURANCE block)
- **Location:** `src/services/agent.js:26-35 (reads stored status flag) vs src/utils/policies.js:56-60 (recomputes from MOCK_NOW); live public.insurance_policies`
- **Roles:** agent, subscriber
- **Impact:** An agent tells a member their life cover is active when the member's own app says it lapsed — contradictory cover status across roles in live demo data.
- **Repro:** 1) Sign in as agent a-001; open /dashboard/subscribers/s-0003 2) See INSURANCE 'Life cover ACTIVE' though renewal_date is 2026-04-16 (< MOCK_NOW 2026-07-01)
- **Evidence:** On-screen for s-0003 Patrick Nsubuga (a-001 roster): 'INSURANCE  Life cover ACTIVE  Hospital cash ACTIVE  Funeral cover ACTIVE' (screenshots/agent/subscriber-detail-s0003-full-1440.png). SQL: `select ip.subscriber_id,s.name,ip.status,to_char(ip.renewal_date,'YYYY-MM-DD') from insurance_policies ip join subscribers s on s.id=ip.subscriber_id where s.agent_id='a-001' and ip.status='active' and ip.renewal_date<date '2026-07-01'` => s-0009 (2025-01-17), s-0010 (2025-09-19), s-0003 (2026-04-16). s-0003's renewal 2026-04-16 < MOCK_NOW 2026-07-01, so the subscriber page derives 'Expired' from the same row. 3 such members on a-001; 1284 platform-wide (A06-004).
- **Suggested fix (NOT applied):** Have the agent policy view derive status from renewal_date via the same clock as the subscriber page (or reconcile the stored status flag), so both roles agree. DB fix owned by A06-004. · effort M
- **Verification:** CONFIRMED — corroborates A06-004 (CONFIRMED Wave C) on agent surface

### A13-001 · Distributor Reports route unreachable on every viewport below 1024px; Menu 'Reports' tile and both routed report screens are dead
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A13 / broken-route / distributor mobile shell (375-1023px)
- **Location:** `src/contexts/DashboardNavContext.jsx:92 (missing !isDesktop guard on distributor arm); redirect at :110-116; orphans src/dashboard/mobile/ReportsMobile.jsx, ReportViewMobile.jsx, DistributorMobileShell.jsx:55-56, tile DistributorHubMobile.jsx:96`
- **Roles:** distributor
- **Impact:** On any sub-1024 viewport (phone, tablet-portrait, small laptop window) a distributor taps 'Reports / Download data' and nothing happens; ReportsMobile, ReportViewMobile and all 11 report views are unreachable. A whole feature is dead on a supported viewport.
- **Repro:** 1) Sign in as distributor d-001 (+256700000021, any 6-digit code) at 375px 2) Tap Menu -> tap the 'Reports' tile 3) Observe bounce to /dashboard (Home) instead of the reports screen 4) Deep-link /dashboard/reports and /dashboard/reports/contributions -> both settle at /dashboard
- **Evidence:** Real-UI sign-in as d-001 at 375px (a13-01-dist-mobile.mjs): Menu shows 'Reports Download data' tile (menu-375.png); TAP -> URL settles http://localhost:5173/dashboard, screen is Home dashboard 'Welcome back... UGX 1.95B', Home tab active (reports-tile-tap-375.png). Deep-link /dashboard/reports -> settled url /dashboard; /dashboard/reports/contributions -> /dashboard. Band boundary (a13-09-viewband.mjs): 'W=768: bottomTabBar=1 mapRail=0 -> shell=MOBILE | /dashboard/reports settles=/dashboard' ; 'W=1024: shell=DESKTOP | /dashboard/reports settles=/dashboard (panel opens)'. So entire 375-1023 band is dead; desktop >=1024 panel works.
- **Suggested fix (NOT applied):** const usesReportsPanel = (role === 'distributor' || role === 'branch') && !isDesktop;  Add a 375px E2E asserting /dashboard/reports renders ReportsMobile. · effort S
- **Verification:** CONFIRMED — DashboardNavContext.jsx:92 exactly as pre-registered in 00b; distributor arm has no !isDesktop guard

### A14-001 · "Total contributions" computed from two irreconcilable sources; same screen shows figures differing up to 11.6x, and Runs page states a provably false total
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A14 / correctness / Employer Overview (/dashboard), Runs (/dashboard/runs), Analytics (/dashboard/analytics)
- **Location:** `src/services/employer.js getEmployerContributions() (run-linked) vs get_employer_metrics RPC (all contributions); src/employer-dashboard/desktop/OverviewDesktop.jsx:159 (Hero) vs :184/:192 (leg tiles)`
- **Roles:** employer
- **Impact:** On the primary employer dashboard and the Runs funding screen, the headline money figure contradicts its own breakdown; '6 runs · UGX 182,689,000 pension funded' is falsifiable by adding the six rows shown above it. A prospect who checks the arithmetic sees it does not add up.
- **Evidence:** On the Overview the Hero 'TOTAL CONTRIBUTIONS TO DATE · EMPLOYEE + EMPLOYER' = UGX 182,689,000 (get_employer_metrics) while the two leg tiles directly below sum to 9.8M + 5.9M = 15.7M (getEmployerContributions, run-linked) — an 11.6x gap on one screen. Runs page: 'FUNDED TO DATE UGX 182.7M' and footer ' 6 runs · UGX 182,689,000 pension funded' while the run-history table lists 6 runs summing to 19,294,000. Systemic: psql shows emp-002..007 have metrics totals 12-27M but 0 run-linked (Hero shows millions, tiles/Runs show 0). Even clean of residue emp-001 = 62.4M metrics vs 11.8M runs. Aborting get_employer_metrics via Playwright route.abort makes the Hero fall back to UGX 15,734,000, which reconciles with the tiles — proving 182.7M is the anomalous source. Screenshots: index-1440.png, runs-
- **Suggested fix (NOT applied):** Feed the Overview Hero, Runs 'funded to date', and Analytics 'total contributions' from the same run-linked source the leg tiles/Contributions page use (Sum of contribution_runs), or relabel/split get_employer_metrics so members' personal top-ups (contribution_run_id NULL) are not counted as employer run funding. All four surfaces must read one source. · effort M
- **Verification:** CONFIRMED — get_employer_metrics 182,689,000 vs run-linked 15,734,000 = 11.6x gap on one screen, both sums verified by psql

### A15-001 · Mobile subscriber detail shows every member's Balance / Contributions / Withdrawals as "—" though the member holds real money
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A15 / correctness / admin (shared with distributor, branch) — mobile shell
- **Location:** `src/dashboard/mobile/SubscriberDetailMobile.jsx:11-12,73-75 (root cause: services/entities.js getEntity SELECT '*' with no balance embed + mapSubscriber totalContributions/totalWithdrawals never sourced)`
- **Roles:** admin, distributor, branch
- **Impact:** WRONG/MISSING MONEY on a supported viewport. A rep on a phone tapping any member to show their savings sees Balance/Contributions/Withdrawals all '—' for members holding millions, on the admin, distributor AND branch dashboards. The list says 24.5M; the detail says nothing. Borders critical for a live phone demo.
- **Repro:** 1) At 375px sign in as admin (admin-001) via /admin/login 2) Go to Subscribers, tap 'Brian Okello' (or open /dashboard/subscribers/empe-001) 3) Observe Balance —, Contributions —, Withdrawals — while the list row and desktop both show UGX 24.5M
- **Evidence:** DB: `psql ... "SELECT id,name,total_balance FROM subscribers s JOIN subscriber_balances b ON b.subscriber_id=s.id WHERE id IN ('empe-001','s-0001')"` -> empe-001|Brian Okello|24471589 ; s-0001|Carol Obua|1411092. UI @375 (scratch/a15-08 list-click path AND a15-07 cold deep-link): DETAIL @0.8s and @5s both render `BALANCE — CONTRIBUTIONS — WITHDRAWALS —` for empe-001 (list shows 24.5M) and s-0001. Desktop is correct (a15-09: `BALANCE UGX 24.5M TOTAL CONTRIBUTIONS UGX 22.4M`). formatUGX(0) returns '—' (utils/currency.js:32). Screenshots screenshots/admin/m-subscriber-detail-fromlist-375.png, m-subscriber-detail-375.png, desktop-subscriber-detail-1440.png.
- **Suggested fix (NOT applied):** In SubscriberDetailMobile render formatUGX(sub.totalBalance) for Balance and add the same id-bounded lifetime fetch the desktop ViewSubscribers already uses for contributions/withdrawals; and/or have getEntity('subscriber', id) embed subscriber_balances(total_balance) so cold deep-links populate. · effort M
- **Verification:** CONFIRMED — SubscriberDetailMobile reads sub.totalContributions; getEntity SELECT * (entities.js:235) no balance join; empe-001 really holds 24,471,589 → shows —

### A25-004 · E2E teardown leaks fixture rows into the LIVE demo DB, incl. 'E2E Branch' rows under d-001
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A25 / test-hygiene / e2e
- **Location:** `e2e/specs/db/rls-isolation.spec.ts:216-217; e2e/specs/db/deactivate-entities.spec.ts:163-169; e2e/specs/flows/distributor-apply-settlement.spec.ts:108-109 (19 fire-and-forget deletes across 8 spec files)`
- **Roles:** distributor, admin, subscriber
- **Impact:** A sales rep signs in as d-001 (the primary demo distributor) and its branch list shows fabricated rows literally named 'E2E Branch 1785700415857'. This is the source of the 4-row subscribers-vs-subscriber_balances gap (invariant M1). Root cause: every teardown delete is fire-and-forget and none checks the returned PostgREST error, so a refused delete reports green.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT id,name,distributor_id,created_at FROM branches WHERE id LIKE 'b-new-%' OR name ~* '^(E2E|TST)' ORDER BY created_at;"
- **Evidence:** Live this session: psql "$SUPABASE_DB_URL" -c "SELECT id,name,distributor_id,created_at FROM branches WHERE id LIKE 'b-new-%' OR name ~* '^(E2E|TST)'" -> b-new-1785700420016|E2E Branch 1785700415857|d-001|2026-08-02, b-new-1785753024670|E2E Branch 1785753020590|d-001|2026-08-03, tst-branch-msc7w8vm|TST throwaway branch. And subscribers probe -> 5 leaked rows (tst-sub-tree/emp/retag-msc7vzsc, tst-sub-tree-msd3855c, s-e2e-emp-foreign-1785752999757), all dated 2026-08-02/03. Detail in a25/fixture-leak.md.
- **Suggested fix (NOT applied):** 1) expect(error).toBeNull() on every teardown delete. 2) A globalTeardown sweep of id LIKE 'tst-%' OR name ~* '^(TST|E2E)' that FAILS the run if it deleted anything (leak detector). 3) A returns-to-baseline count(*) assertion in globalSetup/globalTeardown. 4) Manually purge the 8 existing leaked rows from the demo DB (left in place here per report-only scope; they are the finding evidence). · effort M
- **Verification:** CONFIRMED — Directly reproduced against the live DB. The E2E suite has leaked fixture rows into the live demo database: 3 branches (incl. two named 'E2E Branch ...' attached to d-001, the primary demo distributor, dated 2026-08-02/03 and thus pre-dating this audit) and 5 test subscribers, 4 of which have no subscriber_balances row. This is exactly the 4-row su

### A26-001 · Four documents assert that RLS blocks direct client writes; it does not, and the shipped frontend writes directly
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-security-claim / docs
- **Location:** `CLAUDE.md:126 (§7.3), CLAUDE.md:107 (§5 anti-pattern 6), docs/api-contracts.md:9, docs/role-permissions.md:250`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** The false claim is load-bearing, not cosmetic. A02 derived expected=DENY for all 666 write cells of its 1,036-cell RLS matrix from these exact lines (02-rls-matrix.md:93-97 cites BACKEND.md:46/:601 and role-permissions.md:250). Any future reviewer reading CLAUDE.md §7.3 will conclude the client write surface is closed and skip auditing it. The documentation is the contract a security audit measured against, and the contract is aspirational rather than descriptive.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) sed -n '126p' CLAUDE.md 3) sed -n '9p' docs/api-contracts.md 4) grep -rn '\.insert(\|\.update(\|\.upsert(' src/services/*.js | grep -v 'rpc(' 5) sed -n '1411,1414p' src/services/subscriber.js 6) cross-check docs/audits/2026-08-23/02-rls-matrix.md §5 (13 direct-write successes)
- **Evidence:** CLAUDE.md:126 reads: "All writes flow through SECURITY DEFINER RPCs ... never write directly to a table from the client. RLS would block it". docs/api-contracts.md:9 reads: "PostgREST direct table reads governed by row-level security policies (no writes - writes always go through RPCs)".

$ grep -rn '\.insert(\|\.update(\|\.upsert(' src/services/*.js | grep -v 'rpc('
src/services/entities.js:1065:    .insert(row)
src/services/entities.js:1101:    .insert(row)
src/services/entities.js:1133:    .update(row)
src/services/entities.js:1185:    .update(row)
src/services/entities.js:1411:    .update({ status })
src/services/subscriber.js:1049:      .update(patch)
src/services/subscriber.js:1212:        .upsert({ subscriber_id: id, ...patch }, { onConflict: 'subscriber_id' })
src/services/subscrib
- **Suggested fix (NOT applied):** Replace the assertion with the intent plus a pointer to measured reality. CLAUDE.md:126 -> "Writes are *supposed* to flow through SECURITY DEFINER RPCs. As of 2026-08-23 RLS does NOT block direct client writes on every table - see docs/audits/2026-08-23/02-rls-matrix.md §5 (13 direct-write successes). Do not rely on 'RLS would block it' as a security argument." Equivalent edits for CLAUDE.md:107, api-contracts.md:9 and role-permissions.md:250 are drafted verbatim in DOC-CORRECTIONS.md §2, §6 and §8. · effort S
- **Verification:** CONFIRMED — All three factual pillars reproduce. Docs assert RLS blocks direct client writes verbatim (CLAUDE.md:126, :107; api-contracts.md:9; role-permissions.md:250). The shipped frontend writes directly (11 non-rpc .insert/.update/.upsert sites in entities.js and subscriber.js). And RLS explicitly PERMITS those writes: live pg_policies shows transactions_i

### A26-002 · api-contracts.md instructs an agent to apply migration 0092 to live; it is already applied
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-destructive-directive / docs
- **Location:** `docs/api-contracts.md:240`
- **Roles:** employer, admin
- **Impact:** This is the only line in the entire documentation corpus that is a DIRECTIVE rather than a description, and it directs a destructive action against live demo data: re-running a config-rewriting migration over 8 employer rows and every tagged member's funding config. 0092 introduced _normalize_contribution_config and rewrote submit_employer_contribution_run; 0093 then backfilled the retired mode/employerMatchPct keys out of every row. Re-applying 0092 on top of 0093's output is untested. The line also mis-states the applied range (0001-0091 vs 0001-0108) and the ledger head (0084 vs 0108_nominee_claims_seed).
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) sed -n '240p' docs/api-contracts.md 3) psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('_normalize_contribution_config','get_my_employer_funding');" 4) psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM employers WHERE default_contribution_config ? 'mode';" 5) psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT version||' '||name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1;"
- **Evidence:** docs/api-contracts.md:240 reads: "| Migrations | 0001-0092 | ... **Applied state:** 0001-0091 are live on the Singapore DB (the tracked supabase_migrations ledger stops at 0084; 0085-0091 were applied directly against the project). WARNING: 0092_unified_contribution_config is written but NOT yet applied - apply it out of band, never via supabase db push |"

Refuted three independent ways against live:

$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('_normalize_contribution_config','get_my_employer_funding');"
_normalize_contribution_config
get_my_employer_funding

$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM employers WHERE default_contribution_config ? 'mode';"
0

$ 
- **Suggested fix (NOT applied):** Replace row 240 entirely: "| Migrations | 0001-0108 | supabase/migrations/*.sql. Applied state: all 108 are live on the Singapore DB; the ledger head is 0108_nominee_claims_seed. WARNING: the ledger versions rows as TIMESTAMPS, not 0001_* prefixes - do not attempt a version-level diff, and never run supabase db push against live. |" Full text in DOC-CORRECTIONS.md §6. · effort S
- **Verification:** CONFIRMED — api-contracts.md:240 is the corpus's only directive and it instructs applying 0092 'out of band'. Refuted live: _normalize_contribution_config and get_my_employer_funding (both introduced by 0092) are live; zero employers carry the legacy 'mode' key; ledger head is 0108_nominee_claims_seed not 0084; 108 forward files not '0001-0091 live'. Destructi

### A26-004 · docs/role-permissions.md disagrees with the measured RLS matrix in seven places, twice contradicting itself
- **Severity/Confidence:** high / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-authorization-contract / docs
- **Location:** `docs/role-permissions.md:60-62, :250, :315, :340, :341-343, :348, :349`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** This file is the platform's authorization contract and A02 built the `expected` column of its 1,036-cell matrix from it, so every wrong row silently degrades the RLS audit that reads it. Errors 1-5 describe the platform as MORE OPEN than it is, which under-sells the 0081-0094 distributor-scoping work a reviewer would otherwise verify. Error 7 errs the other way, describing the write surface as locked down when it is not - the dangerous direction. Errors 1, 2 and 6 contradict other lines in the same document, so a reader cannot resolve them without querying the DB.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) sed -n '49p;60,62p;250p;315p;340,343p;348,349p' docs/role-permissions.md 3) psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT policyname||' | '||cmd FROM pg_policies WHERE schemaname='public' AND tablename='distributors' ORDER BY policyname;" 4) psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT to_regclass('public.contribution_run_lines');" 5) psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT tablename||'|'||policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('agents','branches') ORDER BY 1;" 6) cross-check docs/audits/2026-08-23/02-rls-matrix.md §1.1 pivot and §5
- **Evidence:** Seven disagreements against docs/audits/2026-08-23/02-rls-matrix.md §1.1 and live pg_policies:

1. :340 "distributor | All entities, all levels" vs A02 measured d-001 at 4605/5064 subscribers, 1872/2046 agents, 291/321 branches. SELF-CONTRADICTION: :49 of the same file says "Visibility (since 0081): its OWN network only".
2. :348 "Distributor: No scoping applied - all data visible." SELF-CONTRADICTION with :49.
3. :349 "All authenticated roles read distributors: distributors_select USING (true)". Live:
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT policyname||' | '||cmd FROM pg_policies WHERE schemaname='public' AND tablename='distributors' ORDER BY policyname;"
distributors_select_admin | SELECT
distributors_select_self | SELECT
distributors_update_self | UPDATE
4. :341/:342/:343 b
- **Suggested fix (NOT applied):** :340 -> "distributor | Its OWN network only (branches.distributor_id -> agents.branch_id -> subscribers.agent_id) | Own-network commissions | All 11 reports, network-scoped". :348 -> describe the three DEFINER helpers (distributor_branch_ids/agent_ids/subscriber_ids) across 12 tables plus the RESTRICTIVE *_scope_distributor overlays. :349 -> "Only admin and the owning distributor read distributors: distributors_select_admin + distributors_select_self (0081)". :341-343 -> delete the parentheticals and note that no non-admin role can read distributors (A02-007). :60-62 -> "Closed by 0084 + 0094". :315 -> drop contribution_run_lines. :250 -> append the measured-reality warning. Full text in DOC-CORRECTIONS.md §8. · effort M
- **Verification:** CONFIRMED — All seven disagreements reproduce against live pg_policies. distributors has only *_select_admin/*_select_self/*_update_self (refutes :349 'distributors_select USING(true)' and the :341-343 'read of the singleton distributors row' for branch/agent/subscriber). contribution_run_lines does not exist (refutes :315; table dropped by 0045). agents/branc


## 🟡 MEDIUM (76)

### A02-003 · contribution_schedules.insurance_funding_mode and the accrual counters are directly writable by the subscriber (spec check 7 violated)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A02 / column-grant-too-broad / database/grants + RLS
- **Location:** `column grant UPDATE(insurance_funding_mode, insurance_premium_accrued, insurance_premium_target, retirement_pct, emergency_pct, ...) ON public.contribution_schedules TO authenticated, with policy contribution_schedules_update_self`
- **Roles:** subscriber
- **Impact:** The spec explicitly requires contribution_schedules.insurance_funding_mode to be rejected; it is not. A subscriber can flip the funding mode, zero or inflate the accrual counter and re-split retirement/emergency percentages outside the RPC that owns those invariants, so the schedule shown in the demo can disagree with what the RPC believes. Bounded, because the sweep in trg_transactions_contribution also requires v_emg_bal >= v_target -- real money must be in emergency_balance, so cover cannot be conjured from the counter alone.
- **Repro:** 1) Log into the demo as any subscriber. 2) PATCH ${VITE_SUPABASE_URL}/rest/v1/contribution_schedules?subscriber_id=eq.<own id> with the localStorage JWT and body {"insurance_funding_mode":"save_to_cover","insurance_premium_accrued":99999999}. 3) The write succeeds (200) even though fund_insurance_products is the only sanctioned door for that field.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -c "select column_name from information_schema.column_privileges where table_schema='public' and table_name='contribution_schedules' and grantee='authenticated' and privilege_type='UPDATE' order by 1;"\namount\ncontribution_indexation_pct\nemergency_pct\nfrequency\ninclude_insurance\ninsurance_choice_made\ninsurance_funding_mode\ninsurance_premium_accrued\ninsurance_premium_target\ninsurance_savings_pct\nlast_indexed_at\nnext_due_date\nretirement_pct\nsubscriber_id\nupdated_at\n\nContrast with the correctly-locked-down subscribers table:\n$ psql ... -c "select column_name from information_schema.column_privileges where table_schema='public' and table_name='subscribers' and grantee='authenticated' and privilege_type='UPDATE' order by 1;"\nconsent_at\nemai
- **Suggested fix (NOT applied):** REVOKE UPDATE (insurance_funding_mode, insurance_premium_accrued, insurance_premium_target, insurance_savings_pct, insurance_choice_made, include_insurance, subscriber_id) ON public.contribution_schedules FROM authenticated, anon; -- the same pattern already applied to public.subscribers. · effort S
- **Verification:** CONFIRMED — Spot-check confirmed. authenticated holds UPDATE column privileges on insurance_funding_mode, insurance_premium_accrued, insurance_premium_target, retirement_pct, emergency_pct, insurance_savings_pct, etc. on contribution_schedules, verbatim as reported. The contrast with subscribers (column-locked to consent_at/email/name/occupation/phone) proves 

### A02-004 · Subscriber can create withdrawals and nominees rows directly, bypassing request_withdrawal and its balance/nonce checks
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A02 / rls-write-policy-too-broad / database/RLS + PostgREST
- **Location:** `policies withdrawals_insert_self, nominees_insert_self, nominees_update_self, nominees_delete_self`
- **Roles:** subscriber, agent, branch, distributor, admin
- **Impact:** A withdrawal request created this way skips request_withdrawal's balance check, bucket validation and nonce idempotency, yet it lands in the agent / branch / distributor / admin withdrawal queues and in the Withdrawals & Payouts report as a genuine payout request. Nominee shares can be set so they do not sum to 100. Same-tenant only -- cross-tenant inserts and deletes are correctly denied.
- **Repro:** 1) Log into the demo as any subscriber. 2) POST ${VITE_SUPABASE_URL}/rest/v1/withdrawals with the localStorage JWT and body {id:'x1', subscriber_id:'<own id>', amount:250000, bucket:'emergency', reason:'test', status:'processing', date:'<today>'} -- succeeds regardless of the actual emergency balance. 3) Open the distributor Withdrawals & Payouts report: the fabricated request is listed.
- **Evidence:** psql probes (all inside BEGIN ... ROLLBACK):\nR04 sub INSERT own withdrawals row (250,000 UGX, bucket=emergency) || OK || 1\nR05 sub INSERT withdrawals for s-0002 || ERROR || new row violates row-level security policy for table "withdrawals"\nR06 sub INSERT own nominee || OK || 1\nR07 sub INSERT nominee for s-0002 || ERROR || new row violates row-level security policy for table "nominees"\nR08 sub DELETE s-0002 nominees || OK || 0\nmatrix cells: subscriber|nominees|UPDATE|ALLOWED|3 ; subscriber|nominees|DELETE|ALLOWED|3 ; subscriber|nominees|INSERT|ALLOWED-RLS-PASSED (duplicate key value violates unique constraint "nominees_subscriber_id_type_unique")\n\nStatement used: INSERT INTO withdrawals (id,subscriber_id,amount,bucket,reason,status,date) VALUES ('a02-probe-w1','s-0001',250000,'emerg
- **Suggested fix (NOT applied):** Drop withdrawals_insert_self (the app already calls the request_withdrawal DEFINER RPC). Keep the three nominee policies only if useUpdateNominees genuinely writes the table directly; otherwise drop them and add a nominee RPC that enforces the 100% share invariant. · effort S
- **Verification:** CONFIRMED — Spot-check confirmed. withdrawals_insert_self (INSERT) and nominees_insert_self/update_self/delete_self policies exist. Reproduced (rolled back): a subscriber JWT INSERTed an own withdrawals row (250,000 UGX, bucket=emergency, status=processing) successfully; 0 rows persisted after ROLLBACK. Bypasses request_withdrawal balance/bucket/nonce checks a

### A02-005 · agent / branch / distributor can create and edit their own hierarchy rows directly, bypassing the creation RPCs (BACKEND.md says this is impossible)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A02 / doc-vs-live-contract-mismatch / database/RLS + docs
- **Location:** `policies subscribers_insert_agent, agents_insert_branch, agents_update_branch, branches_insert_distributor, branches_update_distributor, distributors_update_self; contradicted by docs/BACKEND.md:46, docs/BACKEND.md:601, docs/role-permissions.md:250`
- **Roles:** agent, branch, distributor
- **Impact:** No isolation failure -- every success is tenant-correct and every cross-tenant attempt is denied. The defect is that three docs assert clients cannot write these tables at all, and the next contributor will trust the doc. A row created this way skips the RPC's validation (NIN/phone/district checks in create_subscriber_*, create_branch's district FK check, create_agent's shape) while still firing trg_subscribers_after_insert, producing a half-formed but plausible-looking subscriber. subscribers.phone uniqueness is the only backstop and it did hold.
- **Repro:** 1) Log into the demo as agent a-001 (phone +256700000001). 2) POST ${VITE_SUPABASE_URL}/rest/v1/subscribers with the localStorage JWT and body {id:'x', name:'X', phone:'+256799990001', agent_id:'a-001', is_active:true} -- succeeds, with no NIN, district or KYC field. 3) The new subscriber appears in the agent's roster with balances auto-created by trg_subscribers_after_insert.
- **Evidence:** docs/BACKEND.md:601 states: 'One SELECT policy per table, no client write policies -- every write goes through a 0035 SECURITY DEFINER RPC.' docs/role-permissions.md:250 repeats it: 'Writes go through the employer SECURITY DEFINER RPCs (0044/0048/0056/0062; no client write policies)'. The live database disagrees.\n\npsql probes (all inside BEGIN ... ROLLBACK):\nW09 agent INSERT subscriber under a-001 || OK || 1        (fires trg_subscribers_after_insert)\nW10 agent INSERT subscriber under a-042 || ERROR || new row violates row-level security policy for table "subscribers"\nW12 branch INSERT agent in b-kam-015 || OK || 1\nW13 branch INSERT agent in b-mba-290 || ERROR || new row violates row-level security policy for table "agents"\nW15 branch UPDATE own agents || OK || 5\nW14 branch UPDATE 
- **Suggested fix (NOT applied):** Pick one: either drop the six write policies so the DEFINER RPCs are the only door, or correct docs/BACKEND.md:46, :601 and docs/role-permissions.md:250 to describe what actually exists. Do not leave the doc and the database disagreeing. · effort M
- **Verification:** CONFIRMED — Spot-check confirmed with a citation caveat. Client write policies do exist on the hierarchy tables (subscribers_insert_agent/update_self, agents_insert_branch/update_branch, branches_insert_distributor/update_distributor, distributors_update_self). Reproduced (rolled back): agent a-001 INSERTed a subscriber under its own agent_id (OK), while the c

### A04-004 · request_withdrawal with bucket='emergency' for more than the emergency balance clamps the bucket at 0 but debits the full total, so the two buckets stop summing to the total
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A04 / wrong-money / RPC
- **Location:** `public.request_withdrawal:54-60`
- **Roles:** subscriber
- **Impact:** The member's dashboard shows Retirement 536,943 + Savings 0 against Total savings 271,179 — the two buckets sum to almost double the headline total, two contradictory money figures on one screen. total_balance and units remain mutually consistent (172.5716 x 1571.4 = 271,179), so the units x NAV reconciliation cannot detect it. The W6 control proves the trigger's own emergency-first fallback path is correct, isolating the defect to the p_bucket branch of the RPC. WithdrawPage.jsx:68,76,77 caps the amount at the selected bucket's balance, so the shipped UI cannot produce it — this needs a direct RPC call or a stale client.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"app_role\":\"subscriber\",\"subscriberId\":\"s-0004\",\"role\":\"authenticated\"}',true); SELECT public.request_withdrawal('probe',400000,'emergency','x','MTN',NULL,NULL); RESET ROLE; SELECT total_balance,retirement_balance,emergency_balance,(retirement_balance+emergency_balance-total_balance) AS break FROM subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;" 3) Observe break = 265764
- **Evidence:** Live body lines 54-60 turn p_bucket='emergency' into `v_split_ret := 0; v_split_emg := p_amount;` with no check against the emergency balance. The only balance guard (line 46) compares p_amount against total_balance, not the bucket. trg_transactions_withdrawal then does GREATEST(0, emergency_balance - v_emg_take) while debiting total_balance by the full ABS(amount).

Probe inside BEGIN…ROLLBACK on s-0004 (emergency holds only 134,236):
======== W5 withdraw 400000 from bucket=emergency
 accepted = 400000
 total_balance | retirement_balance | emergency_balance | bucket_sum | invariant_break | units
 271179        | 536943             | 0                 | 536943     | 265764          | 172.57162405
======== W6 same amount, bucket = NULL (trigger emergency-first fallback) — CONTROL
 total_bal
- **Suggested fix (NOT applied):** In the p_bucket branch, read the locked balance row's bucket columns and RAISE when p_amount exceeds the named bucket, e.g. `IF p_bucket = 'emergency' AND p_amount > v_emergency_balance THEN RAISE EXCEPTION 'withdrawal of % exceeds the emergency balance %'`. Same for 'retirement'. Covered by the same fix as A04-002. · effort S
- **Verification:** CONFIRMED — Spot-check. request_withdrawal with p_bucket='emergency' routes the full amount to the emergency leg (lines 54-60) with no check against emergency_balance; the trigger clamps the bucket at 0 (GREATEST) but debits total by the full ABS(amount). Reproduced: withdraw 400000 from an emergency bucket holding 134236 left retirement untouched (536943) whi

### A04-005 · publish_nav_snapshot's p_unit_price <= 0 guard AND the unit_price > 0 CHECK constraint both pass NaN/Infinity; with confirmMove the entire book goes NaN
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A04 / input-validation / RPC
- **Location:** `public.publish_nav_snapshot:18-20`
- **Roles:** admin
- **Impact:** All 5,060 subscriber_balances rows go NaN in one statement and the register itself stores a NaN price, so every AUM surface on the platform reads NaN. It IS recoverable — units and retirement_units survive untouched, so publishing a valid price restores the book — which is why this is medium rather than high. Admin-gated. The NaN price is stopped without confirmMove only because a previous published price exists to compute a move against; on an empty or single-row register that incidental protection disappears.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"app_role\":\"admin\",\"role\":\"authenticated\"}',true); SELECT public.publish_nav_snapshot(CURRENT_DATE,'NaN'::numeric,'UPU-BAL','admin_manual',true); RESET ROLE; SELECT count(*) FILTER (WHERE total_balance='NaN'::numeric) FROM subscriber_balances; ROLLBACK;" 3) Observe 5060 NaN rows, then confirm the post-ROLLBACK register is still 1242 published / 4 pending
- **Evidence:** Live body lines 18-20: `IF p_unit_price IS NULL OR p_unit_price <= 0 THEN RAISE EXCEPTION 'unit price must be greater than zero'`. NaN <= 0 is FALSE in PostgreSQL, and the table constraint `nav_snapshots_unit_price_check CHECK ((unit_price > (0)::numeric))` also passes because NaN > 0 is TRUE.

Probes inside BEGIN…ROLLBACK (0 and -5 correctly rejected; NaN not):
======== P2 unit_price = 0    -> ERROR: unit price must be greater than zero
======== P3 unit_price = -5   -> ERROR: unit price must be greater than zero
======== P3b unit_price = NaN, confirm=false -> ERROR: price move of %NaN from 1571.4 on 2026-08-08 needs confirmation   (stopped only INCIDENTALLY, by the move gate)
======== P9 unit_price = NaN, confirm=TRUE
 {"aum":"NaN","navDate":"2026-08-24","revalued":true,"unitPrice":"NaN",
- **Suggested fix (NOT applied):** Extend the guard to `IF p_unit_price IS NULL OR p_unit_price <= 0 OR p_unit_price = 'NaN'::numeric OR p_unit_price = 'Infinity'::numeric OR p_unit_price > 1000000 THEN RAISE ...`, and tighten the table constraint to `CHECK (unit_price > 0 AND unit_price = unit_price AND unit_price < 'Infinity'::numeric)` so the register cannot store a non-finite price by any route. · effort S
- **Verification:** CONFIRMED — Spot-check. publish_nav_snapshot's p_unit_price<=0 guard and the table CHECK both pass NaN (NaN>0 is TRUE). unit_price=0 and -5 are correctly rejected; NaN with confirm=true is accepted and drives all 5060 subscriber_balances rows to NaN with a NaN register price. medium is correct because units/retirement_units survive, so publishing a valid price

### A04-006 · Four unrelated down-migrations CREATE OR REPLACE the contribution trigger with the hardcoded 1,000 unit price, silently reverting NAV pricing
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A04 / migration-safety / migrations
- **Location:** `supabase/migrations/0089_per_distributor_commission_rate.down.sql:22`
- **Roles:** subscriber, admin, employer
- **Impact:** Rolling back any of four migrations that have nothing to do with NAV (0042 signup hardening, 0043 employer link, 0072 insurance save-to-cover, 0089 per-distributor commission) silently reverts the money engine to the flat 1,000 UGX price — no error, no version check, no guard. Every subsequent contribution would then buy 57% more units per shilling than it paid for, and the next NAV publish would restate that member's balance upward accordingly. This is the identical CREATE OR REPLACE clobber pattern that produced the project's own 0095-over-0090 login-identity regression.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) grep -n 'CREATE OR REPLACE FUNCTION public.trg_transactions_contribution' supabase/migrations/0089_per_distributor_commission_rate.down.sql 3) sed -n '22p' supabase/migrations/0089_per_distributor_commission_rate.down.sql   # v_unit_price NUMERIC := 1000;
- **Evidence:** Forward path is clean — 0 live functions match the hardcoded price:
$ psql -At -c "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ~ 'v_unit_price\s*(NUMERIC|numeric)?\s*:=\s*1000';"
(0 rows)
The live trg_transactions_contribution opens with `v_unit_price := public.nav_for_date(COALESCE(NEW.date::date, CURRENT_DATE));` (line 20) and request_withdrawal uses `public.latest_nav()` (line 27). 0038's copy sits in submit_contribution_run, a member of the 0021 family A00 §5.1 proved is not live; 0043's copy was superseded by 0072/0089/0104.

Down path (per-file counts, no down-migration was executed — G6):
0042_signup_writeflow_hardening.down: 1 trg_contrib CREATE-OR-REPLACE | 4 unit_price refs | 0 req_wd
0043_subscriber_employer_lin
- **Suggested fix (NOT applied):** Add a guard header to each affected down-migration: a DO block that RAISEs if the NAV migrations are applied, e.g. `IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='nav_for_date') THEN RAISE EXCEPTION '0089.down would clobber 0104 NAV pricing — revert 0104-0107 first'; END IF;`. Longer term, stop re-emitting whole function bodies in down files for functions the file did not originally create. · effort M
- **Verification:** CONFIRMED — Spot-check (parse-only, G6 respected). Forward path is clean: 0 live functions hardcode v_unit_price:=1000. Each of the four unrelated down-migrations (0042, 0043, 0072, 0089) contains exactly one CREATE OR REPLACE FUNCTION public.trg_transactions_contribution whose body declares v_unit_price NUMERIC := 1000 and credits units as NEW.amount / v_unit

### A04-007 · NAV is 16 days stale and the 'Delayed NAV updation' counter cannot see it — it counts only pre-seeded pending rows, so 11 unpriced weekdays are invisible
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A04 / stale-data / admin NAV page
- **Location:** `public.get_admin_attention (nav_late CTE)`
- **Roles:** admin
- **Impact:** Three compounding problems on the money-headline screen. (1) The NAV page reads 'As at 8 August 2026' on 24 August — a 16-day-old price on a fund that supposedly prices daily. (2) delayedNav says 4 while 11 weekdays have NO nav_snapshots row at all, so nothing creates a pending row per weekday and the fund can go unpriced indefinitely without the alert ever moving. (3) All 4 flagged pending days (2026-08-04..07) sit BEHIND the newest published day (2026-08-08), so publishing one returns revalued:false and cannot move AUM — I confirmed this in probe P5. 0105's header calls publishing a pending day 'the live demo moment: it moves AUM and every member's growth at once'; that script no longer works. The 4 pending rows also carry a stale unit_price of 1000.00, a latent trap if any path ever flips status without going through the RPC.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -At -c "set local role authenticated; select set_config('request.jwt.claims','{\"app_role\":\"admin\",\"role\":\"authenticated\"}',true); select jsonb_pretty(public.get_nav_overview('UPU-BAL') - 'series');" 3) Observe lastPublishedDaysAgo 16 against pendingDays 4
- **Evidence:** $ psql -At -c "select jsonb_pretty(public.get_admin_attention());"  (as admin)
  "delayedNav": 4,
  "thresholds": { "navStaleDays": 1, ... }
$ psql -At -c "select jsonb_pretty(public.get_nav_overview('UPU-BAL') - 'series');"
  "currentNav": 1571.4, "currentNavDate": "2026-08-08", "lastPublishedDaysAgo": 16, "pendingDays": 4
The nav_late CTE in get_admin_attention is: SELECT count(*) FROM public.nav_snapshots WHERE status='pending' AND nav_date < v_today.
$ psql -At -c "select count(*) unpriced_weekdays, min(d)::text, max(d)::text from (select d::date d from generate_series(DATE '2026-08-09', CURRENT_DATE, INTERVAL '1 day') d where extract(isodow from d)<6 and not exists (select 1 from nav_snapshots n where n.nav_date=d::date and n.fund_code='UPU-BAL')) q;"
11|2026-08-10|2026-08-24
$ psql -
- **Suggested fix (NOT applied):** Have get_admin_attention compute staleness from the newest PUBLISHED day (CURRENT_DATE - max(nav_date) against the navStaleDays threshold it already defines) rather than counting pre-seeded pending rows, and surface lastPublishedDaysAgo on the attention panel. Separately, re-anchor the demo fixture: publish a fresh NAV for the current week and re-seed pending rows ahead of the newest published day so the 'publish clears the signal and moves AUM' demo works again. · effort M

### A04-008 · v_reconciliation_exceptions checks the shilling split but not the unit ledger, so a broken units invariant is invisible to the admin
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A04 / observability / admin Needs Attention
- **Location:** `public.v_reconciliation_exceptions`
- **Roles:** admin
- **Impact:** units is what prices every member's money — total_balance is derived from it on every NAV publish — yet the only monitored invariant is the shilling split that units produce. A broken unit ledger silently survives until a publish converts it into wrong shillings. A04-002 and A04-004 both corrupt state in ways this view would only partly catch, and subscriber_balances carries no CHECK constraint of any kind to backstop it.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select count(*) filter (where coalesce(retirement_units,0)+coalesce(emergency_units,0)<>units) as broken from subscriber_balances;" 3) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select check_code, count(*) from public.v_reconciliation_exceptions group by 1;" 4) Compare: 1 broken unit row, 0 unit-level exceptions reported
- **Evidence:** The live view definition (pg_get_viewdef) has exactly five branches: missing_balance, split_mismatch (abs(retirement_balance + emergency_balance - total_balance) > 1), orphan_subscriber, orphan_run, agent_mismatch. There is NO check for retirement_units + emergency_units <> units, none for total_balance <> round(units * latest_nav()), none for negatives, and none for NaN.

Proof that the gap is live and real:
$ psql -At -F'|' -c "select check_code, count(*) from public.v_reconciliation_exceptions group by 1 order by 1;"
agent_mismatch|3
missing_balance|4
(no unit-level branch fires)
$ psql -At -F'|' -c "select count(*) filter (where coalesce(retirement_units,0)+coalesce(emergency_units,0)<>units) from subscriber_balances;"
1
The one broken row (s-0005, gap 6.363752068219 units = exactly 10
- **Suggested fix (NOT applied):** Add two branches to v_reconciliation_exceptions: unit_split_mismatch (abs(retirement_units + emergency_units - units) > 0.000001) and nav_mismatch (abs(total_balance - units * public.latest_nav()) > 1), plus a negative/NaN branch. Back them with CHECK constraints on subscriber_balances for non-negativity and NaN. · effort S

### A04-009 · 33 leftover E2E employer contribution runs (1,881 rows, 145.37M UGX) permanently inflate live AUM, growing ~3.7M every full-suite run
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A04 / test-hygiene / live data
- **Location:** `e2e / public.submit_employer_contribution_run`
- **Roles:** admin, employer, distributor
- **Impact:** 120,292,000 UGX (4.9% of live AUM) is E2E-generated money that no member ever paid, and it is arithmetically indistinguishable from real demo data because the trigger applied it correctly. Every full-suite execution adds another +3,718,000 UGX permanently. The employer dashboard's headcount-weighted metrics and the admin AUM tile both drift upward on every CI run. CORRECTS 00d-live-write-ledger.md, which records this as '114 transactions rows, txn_ref = EMP-c4642919' — that ref actually holds 57 rows, the 114 was two runs, and the true population is 33 runs.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select txn_ref, min(date)::text, count(*), sum(amount) from transactions where txn_ref like 'EMP-%' group by 1 order by 2;"
- **Evidence:** $ psql -At -F'|' -c "select count(distinct txn_ref) runs, count(*) rows, sum(amount) ugx from transactions where txn_ref like 'EMP-%';"
33|1881|145372000
$ psql -At -F'|' -c "select type, count(*), sum(amount) from transactions where txn_ref like 'EMP-%' group by 1;"
contribution      |1254|120292000
insurance_premium | 627| 25080000
$ psql -At -F'|' -c "select round(100.0*(select sum(amount) from transactions where txn_ref like 'EMP-%' and type='contribution')/(select sum(total_balance) from subscriber_balances),3);"
4.909
Runs are dated 2026-07-30 through 2026-08-24, 57 rows each. FIVE landed during this audit: EMP-a2d4d427 (2026-08-23 09:43), EMP-c4642919 (09:50), EMP-1bd291a9 (2026-08-24 07:54), EMP-f516defb (08:02), EMP-b4a27020 (08:10).
- **Suggested fix (NOT applied):** Extend the E2E fixture to record the txn_ref returned by submit_employer_contribution_run and delete its transactions rows (plus the contribution_runs row) in afterEach, and add an assertNoLeftoverRuns() post-suite probe alongside assertNoSubscriberOrphans. Separately, decide whether the 33 existing runs should be swept before the next demo — they are internally consistent, so a plain delete would desync subscriber_balances and must be paired with a rebalance. · effort M
- **Verification:** CONFIRMED — Spot-check (read-only). Live transactions carry 33 distinct EMP- txn_refs / 1881 rows / 145,372,000 UGX, split contribution 1254 rows/120,292,000 and insurance_premium 627/25,080,000 — matches the finding exactly. This is E2E-generated money never paid by any member, inflating live AUM ~4.9%. medium appropriate.

### A04-010 · Four leftover E2E subscribers named 'TST tree member' / 'TST retag probe' surface on the admin Needs Attention panel during a live demo
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A04 / test-hygiene / admin Needs Attention
- **Location:** `e2e/fixtures/db.ts:100-127`
- **Roles:** admin
- **Impact:** A rep opening the admin Needs Attention panel during a demo sees four reconciliation exceptions literally named 'TST retag probe' and 'TST tree member'. This is also the whole of the 5,064 vs 5,060 baseline gap. The rows carry zero transactions and zero balances so they cannot affect any money reconciliation, but they inflate every subscriber headcount by 4.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select ref_id, who from public.v_reconciliation_exceptions where check_code='missing_balance';" 3) Sign in as admin-001 / Demo1234 and open the Needs Attention panel
- **Evidence:** $ psql -At -F'|' -c "select kind,check_code,ref_id,who from public.v_reconciliation_exceptions where check_code='missing_balance' order by ref_id;"
user|missing_balance|tst-sub-emp-msc7vzsc|TST employer member
user|missing_balance|tst-sub-retag-msc7vzsc|TST retag probe
user|missing_balance|tst-sub-tree-msc7vzsc|TST tree member
user|missing_balance|tst-sub-tree-msd3855c|TST tree member
$ psql -At -c "select jsonb_pretty(public.get_admin_attention());"  (as admin)
  "reconciliation": { "total": 7, "userWise": 4, "transactionWise": 3 }
Cause: e2e/fixtures/db.ts::cleanupSubscriberByPhone deletes every SUBSCRIBER_CHILD_TABLES row first (including subscriber_balances) and the parent subscribers row LAST; an abort between the two leaves exactly this shape. assertNoSubscriberOrphans probes only th
- **Suggested fix (NOT applied):** Reverse the deletion order in cleanupSubscriberByPhone (parent last is correct for FKs only if the whole thing is one transaction — wrap it in a single RPC or transaction so it is atomic), and add a reverse probe to assertNoSubscriberOrphans that flags subscribers with no subscriber_balances row. Delete the four existing tst-sub-* rows before the next demo. · effort S
- **Verification:** CONFIRMED — Spot-check (read-only). v_reconciliation_exceptions shows exactly 4 missing_balance rows named TST employer member / TST retag probe / TST tree member x2, and subscribers (5064) minus subscriber_balances (5060) equals that 4-row gap — the whole of the baseline discrepancy. These surface on the admin Needs Attention panel during a demo. medium appro

### A04-011 · The idempotency nonce is claimed AFTER the money write with ON CONFLICT DO NOTHING, so two concurrent same-nonce calls both apply the contribution
- **Severity/Confidence:** medium / plausible
- **Agent/Category/Surface:** A04 / idempotency / RPC
- **Location:** `public.make_contribution:23-28,62-66`
- **Roles:** subscriber
- **Impact:** Under READ COMMITTED neither concurrent session sees the other's uncommitted nonce row at line 24, and nothing at line 40 can collide because the transaction id is a fresh uuid — so both write a transactions row. The subscriber_balances upsert in the trigger serialises the two but does not de-duplicate: DO UPDATE SET balance = balance + EXCLUDED.balance re-reads the winner's committed row and adds its own delta on top. ON CONFLICT DO NOTHING at line 63 then silently swallows the second nonce. Net effect: one nonce row, the contribution applied TWICE. The nonce is minted per confirm-sheet specifically to survive a double-tap, which is exactly the scenario that produces two near-simultaneous calls.
- **Repro:** 1) Read the live body: psql "$SUPABASE_DB_URL" -X -At -c "select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='make_contribution';" 2) Note the SELECT at line 24 precedes the transactions INSERT at line 40, and the money_nonces INSERT at line 63 follows it 3) Confirm no constraint links transactions to a nonce: psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.transactions'::regclass;"
- **Evidence:** CONCURRENT EXECUTION WAS NOT PERFORMED — the two-session psql orchestration was denied by the auto-mode permission classifier, so this verdict is derived from the RPC body as the spec directs.

Live body sequence:
  line 24  SELECT result INTO v_prior FROM public.money_nonces WHERE nonce = p_nonce;   -- plain read, NO lock
  line 40  INSERT INTO public.transactions (...)                                        -- MONEY MOVES HERE
  line 63  INSERT INTO public.money_nonces (...) ON CONFLICT (nonce) DO NOTHING;        -- nonce claimed AFTER
request_withdrawal has the identical shape at lines 32-36 / 143-147.

Structural facts measured live:
$ psql -At -F'|' -c "select indexname, indexdef from pg_indexes where schemaname='public' and tablename='money_nonces';"
money_nonces_pkey|CREATE UNIQUE I
- **Suggested fix (NOT applied):** Claim the nonce FIRST and let the unique index arbitrate: `INSERT INTO public.money_nonces (nonce, subscriber_id, kind, result) VALUES (p_nonce, v_subscriber_id, 'contribution', '{}'::jsonb) ON CONFLICT (nonce) DO NOTHING RETURNING nonce INTO v_claimed; IF v_claimed IS NULL THEN SELECT result INTO v_prior ... ; RETURN v_prior; END IF;` then do the money write and UPDATE the nonce row with the real result. Apply the same to request_withdrawal. · effort S

### A05-006 · apply_settlement has no NULL guard on amountPaid — a row with no amount settles the agent's ENTIRE due slice
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A05 / correctness / rpc
- **Location:** `supabase/migrations/0032_fix_settlement_apply.sql:184 (EXIT WHEN v_remaining < v_line.amount) and :150 (v_amount_paid := round((v_row ->> 'amountPaid')::numeric))`
- **Roles:** distributor, admin
- **Impact:** A settlement payload carrying no amount records a full-slice settlement. The current UI filters such rows out (normalizeUploadedRows), so this is not reachable from the settlement upload today — but apply_settlement is GRANT EXECUTE … TO authenticated (0032:318), so every distributor and admin token can call it directly, and migration 0032's own header claims the RPC applies defence-in-depth on the amount. It does not.
- **Repro:** 1) As any authenticated distributor or admin, call the RPC directly: apply_settlement('[{"agentId":"a-001","paymentRef":"X"}]'::jsonb, 'n1') — note the absent amountPaid key. 2) Every due commission for that agent flips to paid and a batch is recorded for the full slice.
- **Evidence:** psql "$SUPABASE_DB_URL" -X -q -f t_null.sql (BEGIN..ROLLBACK; payload has NO amountPaid key at all):
 due_before | 4 | 20000
 SELECT public.apply_settlement('[{"agentId":"a-001","paymentRef":"A05-NULLAMT","paymentDate":"2026-08-23"}]'::jsonb,'a05-nullamt');
  missing_key | {"skipped": [], "totalPaid": 20000, "linesSettled": 4, "agentsSettled": 1}
 due_after | 0 |
 lines | c-00002 | 5000 | paid | 5000 | A05-NULLAMT
 lines | c-00003 | 5000 | paid | 5000 | A05-NULLAMT
 lines | c-00001 | 5000 | paid | 5000 | A05-NULLAMT
 lines | c-01000100 | 5000 | paid | 5000 | A05-NULLAMT
 batch | a-001 | 20000 | 20000 | 4 | A05-NULLAMT
Root cause: with v_remaining NULL, 'EXIT WHEN NULL < amount' evaluates to NULL, which is not TRUE, so the FIFO loop never exits and every due line is stamped paid.
Not reacha
- **Suggested fix (NOT applied):** After the round(), add: IF v_amount_paid IS NULL OR v_amount_paid <= 0 THEN v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('agentId', v_agent_id, 'reason', 'no_amount')); CONTINUE; END IF; · effort S
- **Verification:** CONFIRMED — Spot-check. Reproduced live under BEGIN..ROLLBACK: a payload with no amountPaid key returned linesSettled:4/totalPaid:20000 and zeroed a-001's entire due slice, because EXIT WHEN v_remaining < v_line.amount is skipped when v_remaining is NULL. A05 correctly flags it as not UI-reachable (client filters amount-less rows as no_amount) but directly cal

### A05-007 · Over-payment is silently swallowed — the entered amount above the due total is recorded nowhere and produces no skip or warning
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A05 / correctness / rpc
- **Location:** `supabase/migrations/0032_fix_settlement_apply.sql:203 (batch records v_settled_total; leftover v_remaining discarded)`
- **Roles:** distributor, admin
- **Impact:** A fat-fingered or tampered Amount Paid cell records a smaller settlement than the distributor believes they paid, with no server-side signal. Because `skipped` is empty the post-settlement result panel (CommissionPanel.jsx:1030) shows nothing and the toast reports the server's total, so the discrepancy is never surfaced after the fact. Under-payment has a deliberate INFORM-NOT-BLOCK story; over-payment has no equivalent. The only guard is the advisory pre-submit 'amount mismatch' line in the confirm modal.
- **Repro:** 1) As distributor d-001, upload a settlement file entering 10x an agent's pending amount. 2) Confirm past the amount-mismatch warning. 3) The batch records only the allocated total; the difference is not recorded anywhere and `skipped` is empty.
- **Evidence:** psql "$SUPABASE_DB_URL" -X -q -f t_dupe.sql (second transaction, BEGIN..ROLLBACK):
 due_before | 19 | 95000
 overpay | {"skipped": [], "totalPaid": 95000, "linesSettled": 19, "agentsSettled": 1}
 batch | a-001 | pending_total 95000 | paid_amount 95000 | line_count 19
 due_after | 0
Entered 200,000; recorded 95,000; the remaining 105,000 exists nowhere and `skipped` is empty.
The client accepts a 10x tampered cell too (node u/rt.mjs): '6c tampered-10x-and-negative :: accepted=[{"agentId":"a-001","amountPaid":200000,"paymentRef":"MM-A05-RT","paymentDate":"2026-08-23"}] skipped=[{"agentId":"a-042","reason":"no_amount"}]'.
- **Suggested fix (NOT applied):** Either cap and report — add a skip entry {reason:'overpaid', unallocated:<remainder>} when v_remaining > 0 after the loop — or persist the entered amount on settlement_batches alongside the allocated one so the two can be reconciled later. · effort S

### A05-008 · Seeded settlement batches are stamped with the wrong branch, so the b-kam-015 demo branch persona is told UGX 45,000 was paid while its own Commissions page shows 0 paid and a 0% settlement rate
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A05 / data-integrity / ui
- **Location:** `scripts/seed-supabase.mjs:1108-1109 (branchId hardcoded to b-kam-015 / b-mba-290) · live settlement_batches + notifications rows`
- **Roles:** branch, agent
- **Impact:** settlement_batches RLS scopes by branch_id, so a batch belonging to an agent in Buikwe Central is routed to the Kampala Central branch dashboard and notification feed, and never reaches the branch that actually earned it. The demo branch persona sees UGX 45,000 'Commission settled' one click from its landing page while its own commission ledger reports 0 paid / 0% settled — contradictory money attributed to a branch that made no payout. The body is also unformatted ('UGX 45000') where every RPC-generated notification writes 'UGX 5,000' (0032:212 to_char FM999,999,999,999).
- **Repro:** 1) Sign in as the branch demo persona b-kam-015 (Kampala Central). 2) Open the notification bell on /dashboard: 'Commission settled — UGX 45000 paid for 9 commissions.' 3) Open Commissions: SETTLED THIS CYCLE 0, Paid across 0 agents, SETTLEMENT RATE 0%. 4) Open Analytics: the agent roster does not contain Dorothy Kiiza (a-001), the agent that batch belongs to.
- **Evidence:** psql … -c "select b.id, b.agent_id, b.branch_id, a.branch_id as agent_branch from settlement_batches b join agents a on a.id=b.agent_id where b.branch_id is distinct from a.branch_id;"
 sb-seed-0001|a-001|b-kam-015|b-bui-001
 sb-seed-0002|a-042|b-mba-290|b-buv-007
psql … -c "select status, count(*), sum(amount) from commissions where branch_id='b-kam-015' group by 1;"  -> due|31|155000  (zero paid)
psql … -c "select recipient_role, recipient_id, body, amount, ref_id from notifications where ref_id like 'sb-seed%';"
 agent |a-001    |UGX 45000 paid for 9 commissions.|45000|sb-seed-0001
 branch|b-kam-015|UGX 45000 paid for 9 commissions.|45000|sb-seed-0001
 agent |a-042    |UGX 15000 paid for 3 commissions.|15000|sb-seed-0002
 branch|b-mba-290|UGX 15000 paid for 3 commissions.|15000|sb-seed-
- **Suggested fix (NOT applied):** In scripts/seed-supabase.mjs settlementSeeds, derive branchId from the agent (as the live apply_settlement does at 0032:174) instead of hardcoding it, and route the seeded notification bodies through formatSettlementNotificationBody (src/utils/settlement.js:44) so seeded and live copy match. · effort S
- **Verification:** CONFIRMED — Spot-check. Live read confirms sb-seed-0001 (a-001) is stamped branch b-kam-015 though the agent's branch is b-bui-001, and sb-seed-0002 (a-042) stamped b-mba-290 vs b-buv-007. b-kam-015 (a documented demo branch persona) has 31 due / 0 paid commissions yet receives a 'UGX 45000 paid for 9 commissions' notification and batch routed by branch_id — a

### A05-009 · 0089's down-migration would silently revert NAV pricing — it re-emits trg_transactions_contribution with the hardcoded 1,000 UGX unit price
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A05 / rollback / migration
- **Location:** `supabase/migrations/0089_per_distributor_commission_rate.down.sql:22`
- **Roles:** subscriber, agent, branch, distributor, admin, employer
- **Impact:** Executing 0089's down would reinstate the hardcoded 1,000 UGX unit price and drop the `invested`-column arithmetic 0104 added, silently rolling back the 0103-0107 NAV pricing work and re-breaking every unit/AUM figure. The same hazard applies to every .down.sql in the trg_transactions_contribution chain authored before 0104 (0042, 0043, 0072); 0089 is the one inside A05's scope.
- **Repro:** 1) Diff supabase/migrations/0089_per_distributor_commission_rate.down.sql line 22 against the live pg_get_functiondef of trg_transactions_contribution line 25. 2) The down file pins v_unit_price := 1000; the live body assigns public.nav_for_date(...).
- **Evidence:** grep -n "v_unit_price" supabase/migrations/0089_per_distributor_commission_rate.down.sql
 22:  v_unit_price       NUMERIC := 1000;
 58:    NEW.amount / v_unit_price,
 118:                 units             = units - (v_target / v_unit_price),   -- v_unit_price = 1000
psql … -c "select pg_get_functiondef(oid) from pg_proc where proname='trg_transactions_contribution' and pronamespace='public'::regnamespace;" | grep -n v_unit_price
 8:  v_unit_price       NUMERIC;   -- 0104: the fund NAV, assigned in BEGIN
 25:  v_unit_price := public.nav_for_date(COALESCE(NEW.date::date, CURRENT_DATE));
grep -n "v_unit_price|nav_for_date" supabase/migrations/0104_nav_pricing_rpcs.sql
 78:  v_unit_price       NUMERIC;   -- 0104: the fund NAV, assigned in BEGIN
 95:  v_unit_price := public.nav_for_date(COALES
- **Suggested fix (NOT applied):** Regenerate the affected down files from the live function body at authoring time — the asserted single-match transform technique 0089's own forward migration documents — or mark them 'forward-only, do not execute' and strip the trigger re-emission. · effort M
- **Verification:** CONFIRMED — Spot-check (parse-only per G6). 0089_per_distributor_commission_rate.down.sql:15 re-CREATE OR REPLACEs trg_transactions_contribution with hardcoded v_unit_price NUMERIC := 1000, while the live function assigns v_unit_price := public.nav_for_date(...) (0104's NAV pricing). Executing the down would silently clobber the 0103-0107 NAV work and re-break

### A06-006 · Four abandoned E2E fixtures are 4 of the 7 rows on the Admin Reconciliation screen
- **Severity/Confidence:** medium / confirmed  _(verifier adjusted from high)_
- **Agent/Category/Surface:** A06 / data-integrity / admin Reconciliation screen (public.v_reconciliation_exceptions)
- **Location:** `public.subscribers ids tst-sub-tree-msc7vzsc, tst-sub-emp-msc7vzsc, tst-sub-retag-msc7vzsc, tst-sub-tree-msd3855c`
- **Roles:** admin
- **Impact:** A rep opening Admin -> Reconciliation sees 7 exceptions, 4 of which are named 'TST tree member', 'TST employer member' and 'TST retag probe' — obvious test litter sitting beside the 3 deliberate t-demo-recon-* fixtures that tell the intended story. The reconciliation screen is a credibility feature; showing internal test names on it undermines exactly the point it is meant to make.
- **Repro:** 1) Sign in as admin +256700000099 / Demo1234 2) Open Admin -> Reconciliation 3) Read rows 4-7: 'TST employer member', 'TST retag probe', 'TST tree member' x2
- **Evidence:** This is the 4-row gap the baseline flagged (subscribers 5064 vs subscriber_balances 5060).
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select s.id, s.name, s.phone, s.agent_id, s.employer_id, s.district_id, s.is_demo_signup, s.created_at from public.subscribers s left join public.subscriber_balances b on b.subscriber_id=s.id where b.subscriber_id is null order by s.created_at;"
tst-sub-tree-msc7vzsc|TST tree member|+25679sc7vzsc|||||t|2026-08-02 19:53:06.406768+00
tst-sub-emp-msc7vzsc|TST employer member|+25678sc7vzsc|||||t|2026-08-02 19:53:08.307374+00
tst-sub-retag-msc7vzsc|TST retag probe|+25677sc7vzsc|||||t|2026-08-03 10:29:56.575797+00
tst-sub-tree-msd3855c|TST tree member|+25679sd3855c|||||t|2026-08-03 10:29:56.575797+00

Provenance: is_demo_signup=true, tst-<purpose>-<base36 ms> i
- **Suggested fix (NOT applied):** DELETE FROM public.subscribers WHERE id LIKE 'tst-sub-%' (4 rows; they have no child rows, so no cascade concerns). Also delete the sibling litter: s-e2e-emp-foreign-1785752999757 and branches row tst-branch-msc7w8vm. Then fix the fixture leak: the RLS/tree specs create subscribers directly (not via create_subscriber_from_signup, which writes a balance row) and never remove them — add them to the afterEach that already calls cleanupSubscriberByPhone. · effort S
- **Verification:** SEVERITY-ADJUST — Reproduction confirmed: 4 TST subscribers with no balance row render on v_reconciliation_exceptions as missing_balance beside 3 deliberate t-demo-recon rows (they are the baseline's 4-row subscribers-vs-balances gap). But blast radius is admin-only demo litter, trivially deletable, no wrong money and no feature break — the reconciliation view is fu

### A06-008 · DB invariant #5 is vacuous by 41 days and blind to 21 NULL rows
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A06 / test-coverage / e2e DB invariants guard
- **Location:** `e2e/specs/db/invariants.spec.ts:61 (MOCK_NOW_ISO) and :168-186 (the assertion)`
- **Impact:** Three independent reasons the guard cannot fail. (1) 41 days of slack: the live minimum is 2026-07-06 against a threshold of 2026-05-26, so a regression would have to move next_due_date back more than six weeks before the test notices. (2) It reports 0 while 717 schedules ARE stale — between 10 and 49 days overdue against the wall clock — so the invariant's stated purpose ('every schedule row has a non-stale next_due_date') is unmet in live data and the guard is green. (3) The Supabase .lt('next_due_date', isoDate) filter is SQL '<', so the 21 rows with a NULL next_due_date (empe-001..empe-021) are silently excluded — a schedule with no due date at all is the most stale state possible and the assertion cannot see it. Note the drift between the spec's anchor and mockData's does NOT change the verdict (lt_mockdata is also 0); the vacuity is caused by the 36-day over-shift in A06-003.
- **Evidence:** The assertion: expect(count from contribution_schedules where next_due_date < '2026-05-26').toBe(0)

$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select min(next_due_date), max(next_due_date), count(*) from public.contribution_schedules;"
2026-07-06|2026-10-01|5022

$ psql ... -c "select count(*) filter (where next_due_date < date '2026-05-26') lt_seed_anchor, count(*) filter (where next_due_date < date '2026-07-01') lt_mockdata, count(*) filter (where next_due_date < current_date) lt_today, count(*) filter (where next_due_date is null) null_due from public.contribution_schedules;"
0|0|717|21

$ psql ... -c "select min(current_date - next_due_date), max(current_date - next_due_date), count(*) from public.contribution_schedules where next_due_date < current_date;"
10|49|717
- **Suggested fix (NOT applied):** Import the single shared MOCK_NOW (see A06-003 fix) instead of the local literal. Add a second assertion that catches NULL: expect(count where next_due_date IS NULL).toBe(0) — or make it explicit which rows are legitimately exempt. Tighten the freshness check to assert next_due_date lies within one frequency period of the anchor (a weekly schedule due 57 days out should fail), which is the property the seed actually promises. · effort S
- **Verification:** CONFIRMED — Vacuous guard reproduced. Assertion checks next_due_date < '2026-05-26' == 0, but live min is 2026-07-06 (41-day slack); the Supabase .lt filter also excludes the 21 NULL-due rows; and 717 rows are stale vs wall clock while the guard reads 0.

### A06-009 · A fifth clock, public._demo_now() = 2026-05-18, is live in SQL and 44 days behind the JS anchor
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A06 / clock-drift / admin/distributor/branch metric tiles (today / this week / this month), employer activity rollup, hospital-cash claim submission
- **Location:** `public._demo_now()`
- **Roles:** admin, distributor, branch, employer
- **Impact:** _demo_now() still lands inside the seeded data mass (2026-05 is the peak contribution month at 5,408 rows), so admin/distributor 'this month' tiles are not empty — the anchor was well chosen for the pre-roll-forward seed. But 'today' and 'this week' now read 28 and 29 against 844 and 2,524 for the same labels computed off the same rows by the JS surfaces: a 30x divergence in what two roles are told 'today' means on the same day. Any future roll-forward of mockData.js widens the gap silently, because nothing ties the SQL constant to the JS one.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -c "select public._demo_now();"
2026-05-18 23:59:59+00
$ psql ... -c "select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_demo_now';"
 SELECT '2026-05-18 23:59:59+00'::timestamptz 
$ psql ... -c "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ilike '%_demo_now%' and p.proname<>'_demo_now' order by 1;"
get_employer_activity_rollup
get_entity_metrics_rollup
get_top_branch
submit_hospital_cash_claim

Same window, three clocks:
$ psql ... <<'SQL'
with d as (select public._demo_now() n)
select (select count(*) from public.transactions t, d where t.type='contribution' and t.date >= date_trunc('day', d.n) and t.date < date_trunc('day'
- **Suggested fix (NOT applied):** Either move _demo_now() forward in lockstep with mockData's MOCK_NOW (a one-line migration each roll-forward, with a test asserting the two agree), or — better — replace both with a single anchor read from one place and add a check to the invariants spec that public._demo_now()::date equals the JS MOCK_NOW date. At minimum, update adminAttentionDerive.js:11-16 to name all five clocks and their current values. · effort M
- **Verification:** CONFIRMED — Genuine fifth clock: public._demo_now() is a hardcoded 2026-05-18 23:59:59, 44 days behind the JS MOCK_NOW (2026-07-01) and referenced by four rollup/claim RPCs, so admin/distributor time-window tiles diverge from the JS surfaces. Drift between clock copies is in-scope per baseline.

### A06-010 · SUBSCRIBER_CHILD_TABLES misses three subscriber-FK tables; two of them have no FK at all
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A06 / test-coverage / e2e cleanup contract (cleanupSubscriberByPhone / assertNoSubscriberOrphans)
- **Location:** `e2e/fixtures/db.ts:83-94`
- **Impact:** e2e/fixtures/db.ts:99-105 states the list's purpose verbatim: 'Delete child rows first to respect FK constraints AND to guarantee no orphans linger if cascades are removed on a future migration. Every subscriber-FK child table from the schema appears in SUBSCRIBER_CHILD_TABLES — keep that list authoritative.' That claim is false for three tables. Two of them — subscriber_balances_pre_nav (5,060 rows) and subscribers_unit_value_pre_nav (5,064 rows) — have no FK to subscribers at all, so nothing removes their rows on delete and nothing in the cleanup targets them. Live orphan count is 0 only because no seeded subscriber has been deleted since the NAV cutover; the first such delete leaves permanent orphans, and assertNoSubscriberOrphans (which walks the same 9 tables) will not report them.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -c "select table_name from information_schema.columns where table_schema='public' and column_name='subscriber_id' and table_name not in ('transactions','nominees','subscriber_balances','contribution_schedules','insurance_policies','subscriber_insurance_products','claims','withdrawals','commissions') order by 1;"
employer_invites
entity_detach_log
money_nonces
subscriber_balances_pre_nav
v_reconciliation_exceptions

$ psql ... -c "select c.relname, con.conname, pg_get_constraintdef(con.oid) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('money_nonces','subscriber_balances_pre_nav','subscribers_unit_value_pre_nav','employer_invites','entity_detach_log') and
- **Suggested fix (NOT applied):** Add money_nonces, subscriber_balances_pre_nav and employer_invites to SUBSCRIBER_CHILD_TABLES (and subscribers_unit_value_pre_nav, keyed on `id` not `subscriber_id`). Better: replace the hand-maintained list with a query over information_schema.columns for column_name='subscriber_id', so it cannot drift again. Consider adding FKs to the two pre_nav snapshot tables. · effort S

### A06-011 · The only employer created through the live approval path has an empty config, NULL cadence and a district ID in the district-name field
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A06 / data-integrity / employer dashboard for a newly approved employer; admin employer list
- **Location:** `public.employers id emp-80511f65be7a4656b2bd45b6fad18625 (Uniclusion Uganda)`
- **Roles:** employer, admin
- **Impact:** This is the exact row a rep produces when demoing 'approve an access request -> a new employer appears'. It diverges from every seeded employer in three ways at once: an empty default_contribution_config (no employeePct/employerPct, so the funding setup screen has nothing to show and any contribution run computes zero legs), a NULL payroll_cadence where every other employer is 'monthly', and district holding the district ID 'd-budaka' where every seeded row holds a human name ('Kampala', 'Gulu'). The last one renders 'd-budaka' verbatim wherever employer district is displayed. _assert_contribution_config_shape passes {} because it returns early on absent keys, so nothing flags it.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select id, name, sector, registration_no, contact_name, contact_phone, contact_email, district, payroll_cadence, status, created_at from public.employers order by created_at;"
emp-001|Nile Breweries Demo Ltd|Manufacturing|UG-REG-2019-04412|Patience Namaganda|+256700000031|hr@nilebreweries.demo|Kampala|monthly|active|2026-07-27 14:26:06.958998+00
emp-003|Gulu Traders Union|Wholesale & Retail|UG-REG-2021-003|Christine Lamwaka|+256700000033|hr@gulutraders.demo|Gulu|monthly|active|...
emp-004|Jinja Steel Mills|...|Jinja|monthly|active|...
emp-005|Mbale Coffee Collective|...|Mbale|monthly|active|...
emp-006|Wakiso Agro Ltd|...|Wakiso|monthly|active|...
emp-007|Lira Cotton Ginnery|...|Lira|monthly|active|...
emp-002|Mbarara Dairy Co-op|...|Mbarara|mo
- **Suggested fix (NOT applied):** Have create_employer default default_contribution_config to the standard {"employeePct":10,"employerPct":5,"insuranceEnabled":false} and payroll_cadence to 'monthly' when the caller omits them, and normalise district to the same representation the seed uses (resolve d-<slug> to districts.name, or migrate the seeded rows to IDs — one or the other, consistently). Tighten _assert_contribution_config_shape to require both percentage keys when the object is non-null. · effort S
- **Verification:** CONFIRMED — The only employer created via the live approval path diverges from every seeded employer: empty default_contribution_config {}, NULL/empty payroll_cadence, and district holding the raw ID 'd-budaka' where seeded rows hold human names — the last renders verbatim wherever employer district is shown. Demo-visible on employer dashboard + admin list.

### A07-001 · Sentry scrubber has no NIN redaction pattern
- **Severity/Confidence:** medium / plausible
- **Agent/Category/Surface:** A07 / pii / backend
- **Location:** `server/sentryScrub.ts:31-37`
- **Impact:** A NIN in a KYC error string forwards to Sentry unredacted
- **Evidence:** source: PHONE_RE/JWT_RE/BEARER_RE + SENSITIVE_KEYS present; no NIN pattern
- **Suggested fix (NOT applied):** add NIN_RE + 'nin' to SENSITIVE_KEYS · effort ?

### A09-004 · Enforcing the report-only CSP would break the app's typography three ways and the KYC ID previews; today the policy has no report sink so it collects nothing
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A09 / security-headers / infra/frontend
- **Location:** `vercel.json:11; index.html:41; src/signup/steps/ReviewStep.jsx:303,309`
- **Roles:** all
- **Impact:** The header is currently decorative: a Content-Security-Policy-Report-Only with no reporting endpoint is evaluated and discarded, which is exactly why three real breakages accumulated behind it unnoticed. Flipping to enforcement today would drop the brand typefaces to system fallbacks (blocked stylesheet + blocked woff2 + the inline onload that flips media=print to all never firing) and blank both ID thumbnails on the signup review step.
- **Repro:** 1) curl -sS -D - -o /dev/null https://uganda-dashboard.vercel.app/ → header contains no report-uri/report-to 2) Load https://uganda-dashboard.vercel.app/faq in Chrome and read the network log → fonts.googleapis.com stylesheet + 2 fonts.gstatic.com woff2 requests, none permitted by the served policy 3) Read index.html:41 → inline onload= attribute 4) Read IdUploadStep.jsx:151 + ReviewStep.jsx:303,309 → blob: URL rendered as <img src>, no blob: in img-src
- **Evidence:** $ curl -sS -D - -o /dev/null https://uganda-dashboard.vercel.app/
content-security-policy-report-only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com; connect-src 'self' https://ilkhfnoyxlxwqadebnkp.supabase.co https://uganda-dashboard-api.onrender.com https://*.sentry.io; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
(NO report-uri and NO report-to anywhere in the header)

Browser network log, https://uganda-dashboard.vercel.app/faq (14 requests):
  9. https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:...&family=Inter:... → 200   [violates style-src]
 11. https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50
- **Suggested fix (NOT applied):** Preferred: self-host Plus Jakarta Sans and Inter into public/fonts/, which lets style-src 'self' 'unsafe-inline' and font-src 'self' stand unchanged and removes the inline onload entirely; then only add blob: to img-src and a report sink. Alternative (keep Google Fonts): style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com; add worker-src 'self'; manifest-src 'self'; add report-uri <endpoint>; and replace the media=print/onload link with a plain <link rel="stylesheet">. script-src 'self' with no 'unsafe-eval' is safe — 0 of 135 built chunks contain eval( or new Function(. · effort M
- **Verification:** CONFIRMED — Spot-check. Live header is content-security-policy-report-only with no report-uri/report-to (collects nothing). style-src omits fonts.googleapis.com, font-src is 'self' (omits fonts.gstatic.com), script-src 'self' would block the index.html:39 inline onload= handler, img-src omits blob: so ReviewStep.jsx:303,309 ID previews (URL.createObjectURL) wo

### A09-005 · Frontend Sentry is not configured in production — @sentry/react is tree-shaken out of the shipped bundle entirely
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A09 / observability / infra/frontend
- **Location:** `src/main.jsx:29 (VITE_SENTRY_DSN gate); Vercel project env prj_RseGQ3f8Xdvn4Q46A5G2ALdTYJdg`
- **Roles:** all
- **Impact:** VITE_SENTRY_DSN is unset in Vercel, so Vite replaces the guard with `undefined`, the branch is dead-code-eliminated and the namespace import tree-shakes away — zero occurrences of the string 'sentry' survive in the entry or vendor chunks. Every browser-side crash in production is invisible, including the ones behind the 30 deterministic Playwright failures in baseline §10. ErrorBoundary still renders its fallback so a rep sees a broken panel and nobody is told. The https://*.sentry.io entry in the CSP connect-src is dead weight. (Config itself is correct on both sides: DSN-gated, tracesSampleRate 0.1, sendDefaultPii false, scrubber on beforeSend/beforeBreadcrumb; the two scrubbers were verified byte-equivalent — 13/13 identical keys, 3/3 identical regexes.)
- **Repro:** 1) curl -s https://uganda-dashboard.vercel.app/assets/index-IM_IiCjH.js | grep -c ingest.sentry.io → 0 2) curl the two vendor chunks and grep -oic sentry → 0, 0 3) Conclusion: the DSN-guarded branch was eliminated at build time, so VITE_SENTRY_DSN is unset in Vercel production
- **Evidence:** $ curl -s https://uganda-dashboard.vercel.app/assets/index-IM_IiCjH.js -o /tmp/prodindex.js && grep -c "ingest.sentry.io" /tmp/prodindex.js
0
$ grep -oiE "sentry" /tmp/prodindex.js | wc -l
0
$ for c in vendor-CRnas3xB.js vendor-react-DWMwQj0t.js; do n=$(curl -s https://uganda-dashboard.vercel.app/assets/$c | grep -oic "sentry"); echo "$c sentry-mentions=$n"; done
vendor-CRnas3xB.js sentry-mentions=0
vendor-react-DWMwQj0t.js sentry-mentions=0

$ sed -n '29,38p' src/main.jsx
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: ..., tracesSampleRate: 0.1, sendDefaultPii: false, ... });
}
- **Suggested fix (NOT applied):** Set VITE_SENTRY_DSN (and ideally VITE_SENTRY_RELEASE wired to VERCEL_GIT_COMMIT_SHA) in the Vercel project env for Production, or delete the frontend Sentry code path and the *.sentry.io CSP entry so the docs stop describing observability the deployment does not have. · effort S
- **Verification:** CONFIRMED — Spot-check. Every shipped JS chunk on the live site returns 0 case-insensitive 'sentry' matches; src/main.jsx:5 gates Sentry.init on VITE_SENTRY_DSN which is unset in Vercel, so the branch is dead-code-eliminated and the namespace import tree-shaken. Prod browser crashes are unreported. Medium apt.

### A09-006 · render.yaml is not the applied configuration — the live build command has drifted from the blueprint
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A09 / config-drift / infra/deploy
- **Location:** `render.yaml:25 vs live service srv-d8bc20mgvqtc73afh16g`
- **Roles:** all
- **Impact:** The blueprint the repo presents as infrastructure-as-code does not describe the running service. docs/render-operational.md:199-208 documents disaster recovery as "re-run the Provisioning Checklist — recreate the service from render.yaml", which would produce a DIFFERENT service from the one in production. Builds currently succeed only because NPM_CONFIG_PRODUCTION=false compensates for the missing --include=dev; if that env var is ever dropped the live build silently loses tsc/@types and fails while render.yaml still reads as correct. The comment is also partly wrong: @sentry/node is a prod dependency (correctly — npm prune --omit=dev would otherwise delete it from the runtime).
- **Repro:** 1) mcp__render__get_service srv-d8bc20mgvqtc73afh16g → buildCommand is 'npm ci && npm run build:api && npm prune --omit=dev' 2) sed -n '25p' render.yaml → declares 'npm ci --include=dev && ...' 3) The two differ; the blueprint is not the applied config
- **Evidence:** $ sed -n '25p' render.yaml
    buildCommand: npm ci --include=dev && npm run build:api && npm prune --omit=dev   # G15 — --include=dev required because NODE_ENV=production would otherwise make `npm ci` skip devDeps (@types/*, @vercel/node, tsx, @sentry/* are devDeps)

$ mcp__render__get_service srv-d8bc20mgvqtc73afh16g
"envSpecificDetails": {
  "buildCommand": "npm ci && npm run build:api && npm prune --omit=dev",
  "startCommand": "node dist-server/server/index.js"
}
(also: live has "cache": {"profile": "no-cache"} which render.yaml does not declare; "buildPlan": "starter" vs declared plan: free)
- **Suggested fix (NOT applied):** Re-apply the blueprint so the live buildCommand matches render.yaml (or edit the live command to include --include=dev), and correct the '@sentry/* are devDeps' claim in the comment — only @sentry/react is a devDependency, and that itself is a bug (A09-012). · effort S
- **Verification:** CONFIRMED — Spot-check. Live Render service buildCommand drops the `--include=dev` that render.yaml:23 declares; live buildPlan is 'starter' and cache.profile 'no-cache', neither declared in render.yaml. The blueprint does not describe the running service, so the documented DR path (recreate from render.yaml) would yield a different service. Medium apt.

### A09-007 · Keepalive fires roughly a third as often as its own stated design rationale requires
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A09 / availability-monitoring / infra/ci
- **Location:** `.github/workflows/keepalive.yml:1-11,15`
- **Roles:** all
- **Impact:** The invariant the workflow claims to maintain ('two jittered fires stay <15 min apart') holds for 2 of 199 measured intervals; ZERO fires landed within 10 minutes of each other and the worst gap was 103 minutes. The comment is a false reassurance, and the practical monitoring resolution is up to 103 minutes of undetected downtime regardless of which endpoint is pinged. Note this does NOT currently cause Render spin-down — the instance shows an unbroken 7-day memory series — but it does cap how quickly any outage can be noticed.
- **Repro:** 1) gh run list --workflow=keepalive.yml --limit 200 --created 2026-08-18..2026-08-23 --json createdAt 2) Compute successive gaps: median 35.0 min, mean 37.7 min, max 103.1 min, 197/199 exceed 15 min, 0 are <=10 min
- **Evidence:** $ sed -n '1,15p' .github/workflows/keepalive.yml
# GitHub Actions' cron has 5–15 min real-world jitter; running every 10 min
# widens the margin against Render's 15-min spin-down so two jittered fires
# stay <15 min apart. …
    - cron: '*/10 * * * *'   # every 10 min

$ gh run list --workflow=keepalive.yml --limit 200 --created 2026-08-18..2026-08-23 --json conclusion,createdAt | python3 ...
runs in 2026-08-18..2026-08-23: 200
conclusions: Counter({'success': 200})
gaps min=13.8 med=35.0 mean=37.7 max=103.1 n=199
gaps >15min: 197 of 199
gaps <=10min: 0
- **Suggested fix (NOT applied):** Either correct the comment to the measured reality, or move the ping to an external scheduler with real cadence. keepalive.yml already references cron-job.org / UptimeRobot as a '5-min backup'; the Render log stream shows no evidence one is currently running against a valid path (see A09-010 — a single GET /api/health 404 in 34 hours). · effort S
- **Verification:** CONFIRMED — Spot-check. Last 200 keepalive runs all 'success'; measured inter-run gaps min 13.8 / median 33.9 / mean 37.1 / max 114.2 min, 0 gaps <=10 min and only 5/199 <15 min, refuting the workflow's 'two jittered fires stay <15 min apart' rationale (holds ~2.5% of intervals). Monitoring resolution capped ~114 min; does not currently cause Render spin-down.

### A09-008 · Dependabot security alerts are disabled, and 12 version PRs are wedged behind a red lint gate
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A09 / dependency-management / infra/ci
- **Location:** `repository settings; .github/dependabot.yml`
- **Roles:** all
- **Impact:** No advisory in the tree (3 critical / 12 high / 5 moderate / 3 low) will ever open a security PR. Separately the version PRs that ARE opened cannot merge: the grouped npm PR fails lint on 20 NEW react-hooks/set-state-in-effect errors introduced by the bumped eslint-plugin-react-hooks, not by anything the bumps broke. Dependency maintenance has been fully stalled since 2026-06-09. Actual exposure is nil — none of the 23 advisories is reachable at runtime (see the reachability triage in §10 of the report) — so this is deliberately reported as a process finding, not inflated to high.
- **Repro:** 1) gh api repos/shubhang1992/uganda-dashboard/dependabot/alerts → 403 'Dependabot alerts are disabled for this repository.' 2) gh pr list --state open → 14 open, 12 from dependabot, oldest 2026-06-09 3) gh run view 32104912210 --log-failed → lint fails with 20 errors from the bumped react-hooks plugin
- **Evidence:** $ gh api repos/shubhang1992/uganda-dashboard/dependabot/alerts --jq 'length'
{"message":"Dependabot alerts are disabled for this repository.","documentation_url":"https://docs.github.com/rest/dependabot/alerts#list-dependabot-alerts-for-a-repository","status":"403"}

$ gh pr list --state open --limit 20
35	build(deps): Bump the npm-minor-and-patch group across 1 directory with 27 updates	OPEN	2026-08-11
31	Bump actions/setup-node from 4 to 7	OPEN	2026-07-14
29	Bump actions/cache from 4 to 6	OPEN	2026-06-30
27	Bump actions/checkout from 4 to 7	OPEN	2026-06-23
23	Bump express-rate-limit 7.5.1 -> 8.5.2	OPEN	2026-06-09
... (14 open total, 12 dependabot, oldest 2026-06-09)

$ gh run view 32104912210 --log-failed | tail
> 82 |     setAmountStr('');
     |     ^^^^^^^^^^^^ Avoid calling setState(
- **Suggested fix (NOT applied):** Enable Dependabot alerts in repository settings. Unblock the grouped PR by pinning eslint-plugin-react-hooks to the current major or by fixing the 20 set-state-in-effect errors in a separate, reviewable change. · effort M

### A09-009 · No documented rollback for the frontend or the API, and 22 migrations cannot be reversed at all
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A09 / rollback / infra/deploy
- **Location:** `docs/render-operational.md; docs/ARCHITECTURE.md §deploy; scripts/render-deploy.mjs:15-16; supabase/migrations/`
- **Roles:** all
- **Impact:** With main unprotected and CI never green (A09-002), a bad deploy is likely, yet the recovery procedure for two of the three surfaces exists only as tribal knowledge. `npm run deploy:api` can only ever move FORWARD (tip-of-main), so reverting a bad API deploy requires the undocumented Render dashboard rollback or a git revert + push + hook. The DB floor at 0029 means the initial schema, all RPCs, all RLS policies, the search_path pinning and the security-definer trigger conversion are irreversible by script. docs/BACKEND.md:424 also records a money hazard inside the covered range: reverting 0092 restores 0067's reader and SILENTLY ZEROES the employee contribution leg for any config saved while 0092 was live.
- **Repro:** 1) grep -rn -i rollback CLAUDE.md docs/*.md → no Vercel or Render rollback procedure in current docs 2) Read scripts/render-deploy.mjs:15-16 → deploys tip-of-main only 3) Enumerate supabase/migrations for forward files lacking a sibling .down.sql → 22 files, all below 0029
- **Evidence:** $ grep -rn -i "rollback" CLAUDE.md docs/*.md | grep -v docs/archive
(only DB material + the VITE_USE_SUPABASE 'rollback flag'; the sole Vercel rollback mention lives in the archived docs/audits/2026-04-distributor/rollback-playbook.md:10)

$ sed -n '15,16p' scripts/render-deploy.mjs
// Render's autoDeployTrigger is `off` (CLAUDE.md §1 guardrail), so this is the
// supported way to deploy `main` on demand. It deploys whatever commit is
// currently at the tip of the service's branch (main).

$ sed -n '199,208p' docs/render-operational.md
"No database backup, no log replay, no warm-start cache."

$ echo "forward: $(ls supabase/migrations/*.sql | grep -v '\.down\.sql' | wc -l)  down: $(ls supabase/migrations/*.down.sql | wc -l)"
forward:      108  down:       86
$ for f in supabase/migrations
- **Suggested fix (NOT applied):** Add a short 'Rollback' section to docs/render-operational.md covering (a) Vercel: `vercel rollback <deployment>` or dashboard Promote-to-Production (17 prior production deployments are retained), (b) Render: dashboard rollback to a deactivated deploy, since deploy:api cannot do it, and (c) an explicit statement that migrations below 0029 are forward-only. Down-migrations were parsed, never executed (G6). · effort M

### A10-002 · Insurance settings shows '0 beneficiaries on file' when a beneficiary exists (currentSubscriber never carries nominees)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A10 / correctness / subscriber /dashboard/settings/insurance
- **Location:** `src/subscriber-dashboard/pages/InsurancePage.jsx:65,443 (sub?.nominees?.insurance); root cause mapSubscriberRow has no nominees key`
- **Roles:** subscriber
- **Impact:** The Insurance card says 'Insurance beneficiaries · 0 on file' under copy 'These people receive your life insurance benefit', implying nobody is named, while the Nominees tab and DB show 1. Two subscriber settings screens contradict each other about who receives the death benefit.
- **Repro:** 1) Sign in as s-0001 2) Open /dashboard/settings/nominees -> Insurance tab badge shows 1 3) Open /dashboard/settings/insurance -> 'Insurance beneficiaries 0 on file'
- **Evidence:** psql: nominees s-0001 = pension Robert Kasozi 50, pension Lillian Namutebi 50, insurance Samuel Babirye 100. node scratch/a10-benef-discrepancy.mjs: 'NOMINEES page — Insurance count: 1' but 'INSURANCE page — beneficiaries "on file": 0'. InsurancePage reads sub.nominees.insurance which is undefined->[] because currentSubscriber never selects/maps nominees. Screens a10-insurance-settings-d.png, a10-nominees-d.png.
- **Suggested fix (NOT applied):** Read useSubscriberNominees(sub.id) inside InsurancePage (as NomineesPage does), or map nominees onto the currentSubscriber object. · effort S

### A11-003 · Desktop agent home shows scheduled monthly-equivalent (UGX 331K) but labels it 'What members saved this month'; mobile shows actual collected (UGX 291K)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A11 / misleading-data / agent /dashboard (home) desktop vs mobile
- **Location:** `src/agent-dashboard/home/HomeDesktop.jsx:183-185 (summary.monthly, context 'What members saved this month') + agentHomeSummary.js:18 (monthlyEquivalent); vs HomeMobile.jsx:82-83,144 (collected)`
- **Roles:** agent
- **Impact:** Same 'this month' metric reads UGX 40K apart between phone and laptop, and the desktop caption presents a projection as realised savings.
- **Evidence:** Desktop home 'MONTHLY CONTRIBUTIONS UGX 331K · What members saved this month' (home-1440.png); mobile home 'This month UGX 291K · Collected · 10 payments' (home-375.png); Contributions page 'TOTAL RECEIVED UGX 290,855 · 10 payments · June 2026' (contributions-1440.png). SQL actual: `select count(*),sum(amount) from transactions t join subscribers s on s.id=t.subscriber_id where s.agent_id='a-001' and t.type='contribution' and t.date>=date '2026-06-01' and t.date<date '2026-07-01'` => 10|290855. Sum of monthlyEquivalent over a-001 schedules ≈ 331,333 — matching the desktop 331K, i.e. the scheduled expectation, not savings.
- **Suggested fix (NOT applied):** On desktop use the actual collected figure (as mobile does) for a 'saved this month' tile, or relabel 331K as 'Expected monthly (from schedules)'. · effort S

### A11-004 · Agent Settings renders a malformed phone with a double country code (+256 256 711 443975)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A11 / formatting / agent /dashboard/settings (both viewports)
- **Location:** `src/agent-dashboard/pages/SettingsDesktop.jsx:14-20,120 and SettingsPage.jsx:15,101`
- **Roles:** agent
- **Impact:** A garbled phone number on the agent Settings page — a surface reps show during onboarding/handover.
- **Evidence:** Settings header shows 'Dorothy Kiiza  +256 256 711 443975' at 1440 (settings-1440.png) and 375 (settings-375.png); Profile page shows the correct '+256711443975' (profile-1440.png). The local formatPhone groups the full 12-digit stored '256711443975' as '256 711 443975' and the JSX prepends a literal '+256 '. Before the agents query resolves it falls back to the login phone and renders '+256 256 700 000001'. The correct helper formatUGPhone (utils/phone.js) parses the local part but is not used here.
- **Suggested fix (NOT applied):** Replace the local formatPhone + literal '+256 ' with formatUGPhone(phone) (utils/phone.js) in both SettingsDesktop.jsx and SettingsPage.jsx. · effort S

### A11-006 · 'Yet to contribute' flashes the entire roster (11) before the contributions query resolves, then settles to the correct 1 — no loading gate on the dependency
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A11 / loading-state / agent /dashboard/yet-to-contribute (and /onboarded-this-month)
- **Location:** `src/agent-dashboard/pages/YetToContributePage.jsx:33-52 (loading = isLoading && subscribers.length===0 ignores useAgentContributions; pendingContributors(subscribers, []) returns all)`
- **Roles:** agent
- **Impact:** The page shows a materially wrong, final-looking count (all members 'yet to contribute') that contradicts the home tile, with no skeleton to signal it is still loading; the baseline documents real cold-start latency that widens the window.
- **Evidence:** Mobile 375, first (cold) navigation captured mid-flash: 'YET TO CONTRIBUTE 11 members … Select all 11' with all 11 listed (yet-to-contribute-375.png), while the home tile says '1'. Timed probe: +300ms empty, +800ms..+5000ms settle to '1 member' (yet-to-contribute-375-settled.png). Desktop settles to 1 too. onboarded-this-month shows a brief '—/Loading' variant of the same gap.
- **Suggested fix (NOT applied):** Gate the list render on the contributions query too (show the skeleton until useAgentContributions has resolved), so the count never renders from an empty contributions array. · effort S

### A12-001 · Branch collections charts drift against the demo clock — wall-clock month labels over MOCK_NOW-anchored data
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A12 / mock-now-drift / branch overview + analytics (desktop & mobile)
- **Location:** `src/branch-dashboard/desktop/OverviewDesktop.jsx:64-72; src/branch-dashboard/analytics/deriveBranchAnalytics.js:47`
- **Roles:** branch
- **Impact:** On any real demo date (always after the frozen MOCK_NOW), the branch collections chart mislabels months by (wall-now − MOCK_NOW) and the headline 'contributions this month' shows a past month's figure. This is the drift-between-MOCK_NOW-copies the audit explicitly flags.
- **Repro:** 1) Sign in as b-kam-015 via /distributors -> Branch tab 2) Open /dashboard (overview) on 24 Aug 2026 3) Read the 'Contributions — last 12 months' x-axis: labels end at 'Aug' but the RPC series ends at May'26 4) Cross-check psql _demo_now() = 2026-05-18 and the May'26 bucket = 1,185,832 = the 'Aug'/'this month' value
- **Evidence:** psql "$SUPABASE_DB_URL" -Atc "SELECT public._demo_now();" -> 2026-05-18 23:59:59+00. Branch 12-month contribution buckets end at May'26 (1,185,832). OverviewDesktop.jsx:66 computes labels with `const now = new Date()` (real 24 Aug 2026), so rendered x-axis is 'Sep Oct ... Jun Jul Aug' — the bar labelled Aug is really May'26 and 'Contributions this month 1.2M' is May's number. grep shows the codebase documents 3 clocks (adminAttentionDerive.js:12-13: _demo_now 2026-05-18, JS MOCK_NOW 2026-05-26, wall clock) and the subscriber dashboard (ContributionsSummary.jsx:25) anchors labels to MOCK_NOW; the branch dashboard does not.
- **Suggested fix (NOT applied):** Pass MOCK_NOW (src/data/mockData.js) as the `now` argument to the label helpers in OverviewDesktop and deriveBranchAnalytics, as ContributionsSummary.jsx/ActivityPage.jsx already do. · effort S

### A12-002 · Agent-detail gender donut prints percentages as a subscriber count ('100 subscribers')
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A12 / data-correctness / branch desktop agent detail
- **Location:** `src/branch-dashboard/desktop/AgentDetailDesktop.jsx:48-52,220`
- **Roles:** branch
- **Impact:** A branch admin drilling into any agent sees a gender card claiming ~100 subscribers regardless of the real count, visibly contradicting the correct 'Subscribers N' tile above it. Donut proportions are correct; only the count label is wrong.
- **Repro:** 1) Sign in as b-kam-015 2) Open /dashboard/agents/a-087 on desktop 3) Compare the 'Subscribers 11' tile with the 'Subscriber gender' card header reading '100 subscribers'
- **Evidence:** Line 52 `total: male + female` where male/female are genderRatio PERCENTAGES; line 220 renders tag `${gender.total} subscribers`. psql: agent a-087 has 7 male + 4 female = 11 subscribers -> genderRatio 64/36 -> sum 100. Rendered d-agentdetail-1440.png: 'SUBSCRIBERS 11 91% active' at top, 'Subscriber gender 100 SUBSCRIBERS Male 64% Female 36%' below — 11 vs 100 on the same page.
- **Suggested fix (NOT applied):** Use metrics.totalSubscribers for the section tag, not the sum of the two percentages. · effort S

### A12-003 · District rank computed from a stale stored score, not the 'recomputed daily' gauge (84 live vs 77 stored)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A12 / data-consistency / branch overview health score + district rank
- **Location:** `src/branch-dashboard/overview/branchOverviewDerive.js (calcScore, live) vs src/branch-dashboard/desktop/OverviewDesktop.jsx:236 (branch.districtRank <- branches.district_rank)`
- **Roles:** branch, distributor
- **Impact:** The branch's live health score (84) would out-rank peers stored at 78/81, but the frozen rank still shows #3. Cross-surface the distributor branch list (ViewBranches.jsx:175/entities.js:113) shows this branch as 77 while its own overview shows 84 — two scores for one branch. The 'RECOMPUTED DAILY' claim is misleading (recomputed per-render, never daily; the ranking score is never recomputed).
- **Repro:** 1) Sign in as b-kam-015 2) Read overview gauge 84 GOOD + '#3 of 8 in district' 3) psql the branches row: stored score 77 drives district_rank 3, not the displayed 84
- **Evidence:** psql "SELECT id,score,rank,district_rank,district_branch_count FROM branches WHERE id='b-kam-015'" -> score 77, district_rank 3, district_branch_count 8. District peers by district_rank: Kawempe 81(#1), Makindye 78(#2), Kampala Central 77(#3). Rendered overview gauge labelled 'RECOMPUTED DAILY' shows 84 GOOD; rank chip shows '#3 of 8 in district'. Live calcScore hand-check = 84; stored = 77.
- **Suggested fix (NOT applied):** Rank branches on the same live score the gauge shows, or drop the 'recomputed daily' claim and stop deriving a rank from a stale branches.score column. · effort M

### A12-005 · Per-agent subscriber list is desktop-only — unreachable on mobile
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A12 / route-parity / branch agent detail -> subscribers
- **Location:** `desktop route BranchDesktopShell.jsx (agents/:agentId/subscribers -> BranchAgentSubscribers); absent in BranchMobileShell.jsx`
- **Roles:** branch
- **Impact:** A branch supervisor on a phone (375, supported viewport) cannot open a specific agent's subscriber list, a capability present on desktop. The agent's subscriber count is still visible on mobile, so it is a degraded capability rather than total loss.
- **Repro:** 1) Sign in as b-kam-015 at 375px 2) Open /dashboard/agents/a-087 -> no 'View subscribers' link 3) Hard-navigate to /dashboard/agents/a-087/subscribers -> bounces to /dashboard
- **Evidence:** Desktop /dashboard/agents/a-087/subscribers renders 'Subscribers 11 · 10 ACTIVE · 5.3M BALANCE' (d-agentsubs-1440.png). Mobile /dashboard/agents/a-087/subscribers FINAL URL = /dashboard (m-agentsubs-375.png shows the overview) — no such route, so the catch-all bounces it. AgentDetailMobile.jsx has only 'Call' + 'Back to team', no subscriber drill (grep: no NavLink to /subscribers).
- **Suggested fix (NOT applied):** Add the agents/:agentId/subscribers route (and a 'View subscribers' affordance in AgentDetailMobile) to BranchMobileShell, mirroring desktop. · effort M

### A14-003 · Expired invites labeled "awaiting sign-up" on Overview & roster, contradicting Pending KYC page ("0 awaiting · 4 lapsed")
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A14 / correctness / Employer Overview (/dashboard), Employees (/dashboard/employees), Pending KYC (/dashboard/pending-kyc)
- **Location:** `src/employer-dashboard/desktop/OverviewDesktop.jsx (Pending KYC tile + NeedsAttention) and EmployeesDesktop.jsx:170 vs PendingKycDesktop.jsx classification`
- **Roles:** employer
- **Impact:** A demo call-to-action ('4 awaiting sign-up — chase them') dead-ends on a page stating there is nothing to chase.
- **Evidence:** psql: all 4 emp-001 employer_invites are status='pending' but expires_at 2026-08-09/08-14 (today 2026-08-24) — all expired. Overview tile 'PENDING KYC 4 · Invited · awaiting sign-up'; NeedsAttention '4 invited · awaiting sign-up'; roster note '4 people invited and awaiting sign-up.' Pending KYC page (correct): '0 awaiting sign-up · 4 lapsed', 'Awaiting 0 / Expired 4', 'None awaiting · No active pending invites right now.' Public /invite/:token for an expired token renders 'Invite unavailable / invite expired' gracefully (no error). Screenshots: pending-kyc-1440.png, index-1440.png, invite-token-375.png.
- **Suggested fix (NOT applied):** Compute the Overview/roster 'pending' figure with the same expires_at split the Pending KYC page uses, or relabel the tile 'invited (incl. lapsed)'. · effort S

### A15-002 · Admin platform hero has no error/retry state; a failed money read renders "—" / 0 subscribers / "Needs work" silently
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A15 / error-state / admin — desktop/mobile shared hero
- **Location:** `AdminOverview/AdminCountryOverview hero reading get_platform_overview (src/services/entities.js:1279) + get_entity_metrics_rollup; no QueryCache.onError in src/main.jsx`
- **Roles:** admin, distributor, branch
- **Impact:** If the admin platform-overview read fails (or during the documented cold-restore window), the hero silently reports a UGX 0 / 0-subscriber 'Needs work' platform with no message and no retry, indistinguishable from a genuinely empty platform. The only 'Metrics unavailable' role=status badge lives on a secondary Summary card in Map view, not the mounted hero. Cross-ref A22-002.
- **Repro:** 1) Sign in as admin, on /dashboard block the get_platform_overview RPC 2) Reload — hero shows —/0/'Needs work' with no error message and no retry
- **Evidence:** scratch/a15-05-hero-fail.mjs: logged in with read working, then page.route('**/rpc/get_platform_overview*', abort) + reload -> hero: `FUNDS UNDER MANAGEMENT — · 0 distributors · 0 employers · CONTRIBUTIONS — · SUBSCRIBERS 0 · 0 active · 0% · AGENTS 0 Across 0 branches · Health Score 0 Needs work`; has 'unavailable': false; has 'retry': false; role=status/alert count: 0. Screenshot screenshots/admin/desktop-hero-read-fail-1440.png.
- **Suggested fix (NOT applied):** Give the shared hero an isError branch (message + Retry that calls refetch()); add a global QueryCache.onError toast so no read fails entirely silently. · effort S

### A15-003 · Reconciliation queue shows leftover test-fixture rows ("TST tree member", "TST retag probe") in the live admin drill
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A15 / data-hygiene / admin — Needs Attention > Reconciliation drill
- **Location:** `v_reconciliation_exceptions -> get_admin_attention reconciliation drill (AdminAttentionDesktop / attention/reconciliation)`
- **Roles:** admin
- **Impact:** An admin drilling into Reconciliation during a demo sees test-harness debris ('TST … probe') in a finance-facing exception queue — a credibility hit and data-hygiene leak into the shared live demo DB. Cross-ref A06 (owns the orphan cleanup).
- **Repro:** 1) Sign in as admin 2) Needs attention card > Reconciliation issues 3) Observe 7 open exceptions, 4 named 'TST tree member'/'TST employer member'/'TST retag probe'
- **Evidence:** `psql ... "SELECT * FROM v_reconciliation_exceptions"` returns 7 rows: 4 orphans tst-sub-tree-msc7vzsc 'TST tree member', tst-sub-emp-msc7vzsc 'TST employer member', tst-sub-retag-msc7vzsc 'TST retag probe', tst-sub-tree-msd3855c (missing_balance) + 3 intended demo rows t-demo-recon-1/2/3 (agent_mismatch). On screen: OPEN EXCEPTIONS 7 with rows literally named 'TST ...' (screenshots/admin/desktop-reconciliation-drill-1440.png, m-attention-reconciliation-375.png). These 4 tst-* rows are exactly the subscribers 5064 vs subscriber_balances 5060 gap.
- **Suggested fix (NOT applied):** Delete the 4 tst-sub-* subscribers left by prior test runs (and any orphaned rows); they should never have been committed to the shared live DB. · effort S

### A16-001 · Mobile public pages (FAQ/Contact/About/Request-access) render with no <h1>; About starts at <h3>
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A16 / accessibility / Public/onboarding — phone shell (<=768px)
- **Location:** `src/pages/landing/mobile/FAQMobile.jsx:26, ContactMobile.jsx:70, AboutMobile.jsx:9, RequestAccessMobile.jsx:87 (rendered by LandingMobileShell)`
- **Roles:** public/anonymous
- **Impact:** On the primary rep-demo viewport (phone), the entire public support surface has no page-title landmark for screen readers, and About violates heading-order (h1/h2 skipped, opens at h3). WCAG 2.4.6 + 1.3.1. Pages remain visually usable, but the automated a11y/heading gate stays red (6 deterministic mobile test failures). Desktop equivalents are correct, so this is a mobile-shell-only regression.
- **Repro:** 1) Open http://localhost:5173/about at 375px width (iPhone UA) 2) Query document headings: no <h1> exists; first heading is <h3> 'About Universal Pensions' 3) Repeat for /faq, /contact, /request-access — none has an <h1> 4) Same routes at 1440px each expose a correct <h1>
- **Evidence:** Command: node docs/audits/2026-08-23/scratch/a16/walk.mjs (Playwright, 375px, iPhone12 UA). Verbatim: '/faq -> h1=NO firstHead=h2:"Frequently asked questions."' ; '/contact -> h1=NO firstHead=h2:"Contact us."' ; '/about -> h1=NO firstHead=h3:"About Universal Pensions" counts={"h1":0,"h2":0,"h3":1,"h4":3}' ; '/request-access -> h1=NO firstHead=h2:"Set up Universal Pensions for your team"' ; '/request-access?type=distributor -> h1=NO firstHead=h2:"Become a Universal Pensions partner"'. Same routes at 1440px all report h1=YES. grep confirms AboutMobile.jsx:9 opens with <h3>About Universal Pensions</h3> then <h4> sub-heads (heading-level skip). 0 console errors / 0 error-boundary on every route. This is the root cause of baseline Playwright failures smoke/landing.spec.ts:20,27,34 on both mobil
- **Suggested fix (NOT applied):** Promote the top heading of each *Mobile screen to <h1> (AboutMobile h3->h1 and demote its sub-sections one level; FAQMobile/ContactMobile/RequestAccessMobile h2->h1). Give AdminLogin and ComingSoon an <h1> too (they lack one at all viewports). · effort S

### A17-001 · Circular avatars violate the standing "no circular avatars" house rule and are internally inconsistent
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A17 / design-system-house-rule / all roles (subscriber/agent/employer/distributor/branch avatars)
- **Location:** `src/subscriber-dashboard/pages/NomineesPage.module.css (.avatar border-radius:50%) + 12 more files`
- **Roles:** subscriber, agent, employer, distributor, branch
- **Impact:** Breaks the user's standing visual taste (feedback_uganda_visual_taste: 'no circular avatars') on screens a rep would show (nominees, member lists, tickets), and the app is self-inconsistent — some avatars circular, others rounded squares.
- **Repro:** 1) Open subscriber dashboard > Account settings > Nominees 2) Observe the RK/LN nominee avatars render as circles
- **Evidence:** grep of 13 CSS modules defines `border-radius:50%`/`var(--radius-full)` on `.avatar`: agent-dashboard/pages/{SubscribersPage,InsuredMembersPage,MessageLauncher,OnboardedThisMonthPage,ContributionsThisMonthPage}.module.css, subscriber-dashboard/pages/{NomineesPage,SettingsPage,SettingsDesktop}.module.css, dashboard/settings/Settings.module.css, employer-dashboard/desktop/ui.module.css, components/{tickets/TicketListRow,Trust,SkeletonRow}.module.css. Confirmed demo-visible: screenshots/subscriber/settings-nominees-d.png renders circular 'RK'/'LN' nominee avatars. Contrast: dashboard/overview/DistributorOverview.module.css uses --radius-sm, agent-dashboard/pages/SettingsPage.module.css uses --radius-md, subscriber-dashboard/pages/AgentPage.module.css uses --radius-xl (rounded squares).
- **Suggested fix (NOT applied):** Standardise .avatar/.avatarInitials on var(--radius-md) (or --radius-sm); remove the 50%/--radius-full avatar rules from all 13 files. · effort M

### A17-002 · Type scale is bypassed: 76 distinct ad-hoc font sizes, 519 of them below the smallest token (sub-12px)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A17 / design-system-type-scale / all dashboards (dense screens)
- **Location:** `src (229 .module.css) vs src/index.css --text-* scale`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** The 11-step --text-* scale is effectively decorative; 9-11.5px body/label text is a legibility risk for the low-literacy Ugandan audience (feedback_plain_language_uganda) and renders on nearly every dense list/detail screen.
- **Evidence:** grep of module CSS: 1172 literal `font-size` declarations vs 1330 tokenised (52.7% adherence) across 76 DISTINCT literal values. Distribution skews below --text-xs (0.75rem=12px): 164x 11px, 103x 12px, 87x 10px, 79x 13px, 73x 10.5px, 71x 11.5px, 27x 9px, plus 97 sub-0.75rem rem values. Total sub-12px declarations = 519 (422 px + 97 rem).
- **Suggested fix (NOT applied):** Map font-sizes to --text-* tokens; set a floor of --text-xs (12px) for anything not a decorative micro-label; collapse the 76 distinct values onto the scale and add a lint rule. · effort L

### A17-003 · Four dashboard BottomSheets declare aria-modal but implement no focus trap — behavioural divergence from the hardened landing copy
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A17 / component-divergence-a11y / mobile bottom sheets (agent/branch/subscriber/employer)
- **Location:** `src/agent-dashboard/shell/BottomSheet.jsx (+ branch/subscriber/employer copies)`
- **Roles:** agent, branch, subscriber, employer
- **Impact:** aria-modal="true" without a focus trap is a false a11y promise on 4 authenticated mobile surfaces (Ask AI / Notifications / Help sheets): keyboard/SR focus escapes into the live background. Also 5-way copy-paste of one primitive with only one copy hardened.
- **Evidence:** The 4 dashboard BottomSheet.jsx copies are byte-identical in code (diff shows comment-only differences) and their .module.css are byte-identical (agent vs subscriber/branch/employer diff exit 0). All 4 render `role="dialog" aria-modal="true"` (grep) but `grep -lE 'inert|FOCUSABLE|focusablesIn'` across the 4 returns nothing — only Escape + scrim-click handlers. The 5th copy src/pages/landing/shell/BottomSheet.jsx (154 lines vs 87) implements a full focus trap (FOCUSABLE/focusablesIn Tab-cycling), sets inert on #root, and returns focus to the trigger. A00 confirmed the repo has no focus-trap utility (0 files).
- **Suggested fix (NOT applied):** Promote the hardened landing BottomSheet to a single shared primitive; delete the 4 shell copies (or import the shared one). · effort M

### A18-001 · iOS Safari zoom-on-focus: dashboard/search/payment inputs render below 16px
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A18 / responsive-mobile / all role dashboards (mobile) + card payment flow
- **Location:** `src/index.css:282 (.input primitive = 14px) + 14 further rules incl. src/components/payment/PaymentMethodPicker.module.css:221`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** On iPhone Safari every text input with computed font-size < 16px triggers automatic zoom-on-focus, so the viewport jerks/zooms each time a rep taps a search box, a sheet form field, or the card-payment fields during a phone demo. Amount-entry and sign-in are unaffected.
- **Repro:** 1) Open any dashboard on an iPhone (or Safari responsive mode < 1024px) 2) Tap a search box, a sheet form field, or the card-number field in the Pay flow 3) Observe the viewport auto-zoom on focus
- **Evidence:** grep -n '--text-' src/index.css shows --text-sm:0.875rem (14px); sed -n '282,285p' src/index.css shows global .input { font-size: var(--text-sm) }. A python parse of src/**/*.module.css found 15 input-element rules < 16px: global .input 14px; PaymentMethodPicker card no./expiry/CVC/name .input 14px; OverlayPanel .searchBarInput 10px; agent/branch/employer/subscriber sheet .input 13px; NomineesPage .input,.select 13px; distributor/branch/employer .search input 14px; branch/distributor .field input 15px; branch .select 12.5px; employer .composer input 13px. MONEY-ENTRY amount heroes are SAFE at 20px (SavePage.module.css:171 .amountInput = var(--text-xl)); sign-in inputs SAFE (PhoneEntry .input=--text-xl, OtpVerify .otpInput=--text-2xl, PasswordEntry .input=--text-base=16px).
- **Suggested fix (NOT applied):** Add a @media (max-width:1023px) bump forcing font-size:16px on the global .input primitive and on .field input / .search input / .composer input / PaymentMethodPicker .input; desktop can keep 14px. · effort S

### A18-002 · 769-1023px dead band renders a stretched phone shell (iPad-portrait width) for all 6 roles
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A18 / responsive-mobile / all 6 role dashboard shells
- **Location:** `src/hooks/useIsDesktop.js:3 (min-width:1024) vs src/hooks/useIsMobile.js:3 (max-width:768); every role shell keys on useIsDesktop()`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** iPad portrait (820/834px, also 810/768) falls in this band, so a rep demoing on an iPad in portrait gets a phone UI stretched across the screen with wasted horizontal space and a stretched bottom tab bar. No breakage/overflow, but a visible degradation on a viewport reps use.
- **Repro:** 1) Sign in as any role 2) Resize the browser to any width 769-1023 (e.g. 820px, iPad portrait) 3) Observe a centered phone column with large empty side gutters and a full-width bottom tab bar
- **Evidence:** deadband-capture.mjs + admin-capture.mjs captured 15 screenshots. Overflow probe: subscriber/distributor/employer/agent @768/1023/1024 and admin/branch @820/1023/1024 all overflowX=false. distributor-1023.png shows a centered ~520-600px phone column with large empty side gutters + full-width bottom tab bar; distributor-1024.png shows the full desktop sidebar-rail layout — a hard jump at the 1024 boundary. admin-820.png, subscriber-1023.png, employer-1023.png confirm the identical gutter pattern for every role. Histogram: shell CSS uses min-width:1024 (aligned to JS) but 51 component-level max-width:768 rules and 16 useIsMobile(768) sites exist under 1024-keyed shells.
- **Suggested fix (NOT applied):** Either add a tablet layout for 769-1023px, or drop the shell breakpoint to min-width:768px so desktop chrome takes over at 768 (matching useIsMobile), collapsing the dead band. · effort M

### A18-003 · Bottom sheets and PaySheet do not lock body scroll; page scrolls behind an open sheet on mobile
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A18 / responsive-mobile / mobile app-bar sheets (Help/Notifications/Ask AI) for all roles + PaySheet money flow
- **Location:** `src/subscriber-dashboard/shell/BottomSheet.jsx (+ agent/branch/employer/landing copies) and src/components/PaySheet.jsx`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** On mobile, touch-dragging on the scrim or sheet edges scrolls the page behind an open Help/Notifications/Ask AI/Pay sheet — a jarring, broken-looking effect during a demo. Inconsistent with Modal.jsx which locks scroll.
- **Repro:** 1) On a phone, open the Notifications or Ask AI sheet from a dashboard app bar 2) Touch-drag on the dimmed scrim area 3) Observe the underlying page scrolling behind the sheet
- **Evidence:** grep for body.style|overflow|touch-action|overscroll in BottomSheet.jsx returns no matches (no scroll lock). BottomSheet.module.css:1-6 .scrim { position:fixed; inset:0; ... } has no touch-action. By contrast Modal.jsx:117-118 sets document.body.style.overflow='hidden' (restored at :163). grep body.style src/components/PaySheet.jsx returns nothing — PaySheet also lacks the lock. The sheet body has overscroll-behavior:contain (BottomSheet.module.css:90) which only prevents chaining out of the sheet, not background scroll behind the scrim.
- **Suggested fix (NOT applied):** Apply the Modal.jsx body-scroll-lock pattern (or a shared useBodyScrollLock hook) to the shared BottomSheet and PaySheet primitives, plus touch-action:none on the scrim. · effort S

### A19-001 · Refresh loses the current view on distributor + admin desktop (reverts to overview)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A19 / unrouted-state-loss / distributor desktop shell, admin desktop shell
- **Location:** `src/dashboard/DashboardShell.jsx:265 + src/contexts/DashboardPanelContext.jsx; src/admin-dashboard/AdminDashboardShell.jsx:312 + src/contexts/AdminPanelContext.jsx:64`
- **Roles:** distributor, admin
- **Impact:** A rep viewing any non-overview rail destination (Commissions, Reports, a Subscribers/Agents list, Distributors, Unit-price, a Needs-attention drill) who reloads the tab is silently dropped back to the National/Platform Overview. Whole-shell dash/map mode also resets to 'dash', so a map district drill (whose id IS in the URL) reloads as a dash-mode summary panel, not the map.
- **Failure scenario:** Distributor rep on the Commissions view presses F5 mid-demo; app reloads to the National Overview with no indication of where they were.
- **Repro:** 1) Log in as distributor (d-001), open /dashboard on desktop (>=1024px) 2) Click the Commissions rail item (note URL stays /dashboard) 3) Reload the tab -> lands on National Overview, not Commissions
- **Evidence:** node scratchpad/a19-repro.mjs (storageState d-001, 1440px): STEP1 URL /dashboard heading 'Universal Pensions Uganda — National'; STEP2 after clicking Commissions URL still /dashboard; STEP3 after reload URL /dashboard, heading back to 'Universal Pensions Uganda — National' (reverted to overview). Admin (scratchpad/a19-repro3.mjs): open Distributors panel -> URL /dashboard; after reload -> heading 'Now viewing National Overview / PLATFORM · NATIONAL OVERVIEW'. Rail/panel selection lives in useState booleans (DashboardPanelContext/AdminPanelContext), none persisted or URL-synced; parsePath re-derives country/map on reload.
- **Suggested fix (NOT applied):** Reflect the active rail destination + mode in the URL (a query param or path segment) and rehydrate panel booleans from it on mount; or persist the last panel/mode to sessionStorage. Report-only. · effort M

### A19-002 · Distributor + admin panel/rail views are not deep-linkable or shareable (all render at /dashboard)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A19 / unrouted-deeplink / distributor desktop shell, admin desktop shell
- **Location:** `src/dashboard/DashboardShell.jsx:354-400; src/admin-dashboard/AdminDashboardShell.jsx:421-460; src/contexts/AdminPanelContext.jsx:64`
- **Roles:** distributor, admin
- **Impact:** Every distributor/admin rail destination shares one URL (/dashboard). A rep cannot paste a colleague a link to 'the Commissions view' or 'the Unit-price page' — the link only reopens the overview. Directly answers the spec's 'can a rep share a URL to a specific view?' -> No.
- **Failure scenario:** Admin wants to send a teammate a direct link to the Unit-price (NAV) page; the only URL available is /dashboard, which opens the overview.
- **Evidence:** node scratchpad/a19-repro.mjs / a19-repro3.mjs: URL is 'http://localhost:5173/dashboard' for the overview, after clicking Commissions, after clicking Reports (distributor), and after opening the Distributors panel (admin) — identical in every case. Only the map geographic drill mirrors to the URL (DashboardNavContext.jsx drillDown -> navigate('/dashboard/regions/:id')).
- **Suggested fix (NOT applied):** Give each rail destination a routed path (or query param) as the four routed shells already do, so views are addressable. Report-only. · effort L

### A19-003 · Browser Back exits the dashboard instead of undoing a panel switch
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A19 / unrouted-history / distributor desktop shell, admin desktop shell
- **Location:** `src/contexts/DashboardPanelContext.jsx (setters push no history); src/dashboard/DashboardShell.jsx:322-343`
- **Roles:** distributor, admin
- **Impact:** Pressing Back after opening a panel does not return to the previous panel — it leaves /dashboard to whatever preceded the SPA entry (about:blank in-harness; the login/landing route in a real session). A rep who hits Back by muscle memory mid-demo lands on a blank/login screen. Same unrouted root cause as the pre-registered distributor-Reports High in 00b.
- **Failure scenario:** Distributor rep drills into Reports, hits browser Back to 'go back to the list', and is instead thrown out of the dashboard onto the login/blank page.
- **Evidence:** node scratchpad/a19-repro.mjs: after opening panels via the rail, 'STEP4 URL after browser BACK: about:blank (was http://localhost:5173/dashboard)'. Panel navigation calls no navigate()/pushState, so no history entry is added per rail click; Back leaves /dashboard entirely.
- **Suggested fix (NOT applied):** Route panel navigation (per A19-002) so Back traverses panel history naturally; or intercept popstate to close the top panel instead of unwinding to the pre-dashboard page. Report-only. · effort L

### A19-004 · Distributor + admin Subscribers (~4,602) / Agents (~2,046) lists defeat their virtualizer in dash mode
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A19 / virtualization-inert / distributor + admin desktop 'Subscribers' and 'Agents' rail panels (dash mode, default)
- **Location:** `src/dashboard/subscriber/ViewSubscribers.jsx:323-327 (getScrollElement: () => bodyRef.current); src/dashboard/agent/ViewAgents.jsx:325-327; src/dashboard/subscriber/ViewSubscribers.module.css:364 (.body flex:1; overflow-y:auto); src/dashboard/DashboardShell.module.css:253 (.dashHost inset:0; overflow-y:auto)`
- **Roles:** distributor, admin
- **Impact:** The default distributor/admin Subscribers view mounts ~4,600 <button> rows (each with an avatar div + several spans -> tens of thousands of DOM nodes) at once; Agents mounts ~2,046. Heavy initial mount and scroll on a demo laptop, and it worsens as the live subscriber count (already 5,064) grows. The virtualizer optimisation is present but silently inert.
- **Failure scenario:** Distributor opens Subscribers on a demo laptop; the browser stutters mounting 4,600 rows and scrolling is janky.
- **Repro:** 1) Log in as distributor (d-001), open /dashboard on desktop 2) Click the Subscribers rail item (dash mode) 3) Inspect the list: document.querySelectorAll('[data-index]').length === 4602 (all rows rendered, not a ~30-row window)
- **Evidence:** node scratchpad/a19-virt.mjs (dash mode, d-001, 1440px): {"totalButtons":4606,"dataIndexRows":4602,"virtualListHeight":"450044px"} — every one of the 4,602 rows is in the DOM. node scratchpad/a19-body.mjs: the virtualizer's scroll element (.body) has clientHeight 450075 == scrollHeight 450075 (unbounded == full content height), while the REAL scroll viewport .dashHost has clientHeight 900, scrollHeight 450474. Because .body is not height-bounded in fullPage layout, @tanstack/react-virtual sees the whole list as visible and windows nothing. ViewAgents uses the identical getScrollElement+.body pattern.
- **Suggested fix (NOT applied):** Point getScrollElement at the actual scroll viewport in fullPage mode (the .dashHost element, e.g. bodyRef.current?.closest('[data-dash-host]')), or give the fullPage .panel/.body a bounded height so .body remains the overflow container. Report-only. · effort M

### A19-005 · Distributor + admin Ask-AI Copilot declares aria-modal but does not trap focus
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A19 / a11y-focus-trap / distributor + admin desktop 'Ask AI' Copilot (DataCopilotPanel)
- **Location:** `src/dashboard/overlay/DataCopilotPanel.jsx:157-161`
- **Roles:** distributor, admin
- **Impact:** Broken aria-modal contract for keyboard and screen-reader users on the two map-theme desktop shells: focus is not contained within the dialog and the background is neither inert nor aria-hidden. Contrast Modal.jsx and EmployerSlidePanel.jsx, which trap correctly, and the four routed-shell copilots, which are correctly non-modal.
- **Failure scenario:** A keyboard user opens the distributor Copilot and Tabs; focus silently lands on the sidebar behind the 'modal', with no visual indication focus left the dialog.
- **Evidence:** Panel renders role="dialog" aria-modal="true" with a backdrop but no Tab handler; inert={!open} only inerts the panel when closed, not the background when open. node scratchpad/a19-repro3.mjs: on open focus is on the INPUT (inDialog:true), but the first Tab escapes — trail: OUT:BODY OUT:A OUT:BUTTON(Collapse menu) OUT:BUTTON(Map view) OUT:BUTTON(Overview) OUT:BUTTON(Branches) ... 'escaped-to-background at Tab #: 1'. Focus walks the entire background sidebar while the modal dialog is open.
- **Suggested fix (NOT applied):** Either add a Tab/Shift+Tab trap + background inert while open (matching Modal.jsx), or drop role=dialog/aria-modal and make it a non-modal side panel like the four routed copilots. Report-only. · effort S

### A20-001 · Public site footer nav links render invisible (1.35:1) on desktop landing pages
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A20 / color-contrast / public landing (/, /employers, /distributors, /admin, /faq, /contact, /about)
- **Location:** `src/components/Footer.module.css .link (interacts with src/index.css:189 a{color:inherit})`
- **Roles:** public
- **Impact:** The entire footer navigation appears blank/broken to any viewer during a demo of the prospect-facing marketing site; total contrast failure for low-vision users.
- **Repro:** 1) Open http://localhost:5173/ at desktop width 2) Scroll to footer 3) Observe the link columns render as dark text on the deep-indigo footer (unreadable)
- **Evidence:** getComputedStyle of footer link 'Subscribers' (playwright, 1440px): color=rgb(47,53,80) bg=rgb(27,26,74) => ratio 1.35:1. axe color-contrast (serious) on /: ._link_1tlk9_42[href="/"] fg=#2f3550 bg=#1b1a4a ratio=1.35 expected=4.5; ._regulatory fg=#5d5e85 bg=#1b1a4a ratio=2.63; ._groupLabel fg=#7a7b9e bg=#1b1a4a ratio=3.98. Intended .link color is lavender rgba(217,220,242,0.55) but routed <Link> anchors inherit body slate --color-slate on the deep-indigo footer.
- **Suggested fix (NOT applied):** Set an explicit light color on .footer a / .link (e.g. var(--color-lavender)) with specificity above the global a{color:inherit}. · effort S

### A20-002 · Widespread AA contrast failures incl. status pills and the green money value on Save/Withdraw
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A20 / color-contrast / 38 role×route surfaces: all dashboard status pills/chips/badges + subscriber Save & Withdraw money screens + public marketing pages
- **Location:** `shared _statusPill/_chg/_rankChip/_headBadge styles; SavePage.jsx/WithdrawPage.jsx _sumValPos; palette tokens in src/index.css`
- **Roles:** subscriber, agent, branch, admin, distributor, employer, public
- **Impact:** Status semantics and a money figure on the two subscriber money screens fall below AA; the green pills recur on every agent/branch/admin table a rep demos.
- **Evidence:** axe color-contrast (serious): 46/108 scans, 38 distinct role×route. Rendered: agent /dashboard/subscribers _statusPill[data-tone=active] fg=#2e8b57 bg=#e2efe7 ratio=3.58 (10px bold, need 4.5); subscriber /dashboard/save & /dashboard/withdraw _sumValPos fg=#2e8b57 bg=#ffffff ratio=4.24 (14px bold, need 4.5). Palette on white: status-warning 2.10, amber 1.67, positive 1.74, accent-mint 1.86, medal-silver 2.56 (all FAIL AA). text-on-indigo is fine: white-on-indigo 13.18:1.
- **Suggested fix (NOT applied):** Use the darker --color-kyc-success #1f6e44 (6.23:1) for green pill/value text, or enlarge/bolden; re-tone amber/mint/silver where used as text. · effort M

### A20-003 · aria-modal dialogs without focus trap/restore (incl. PaySheet payment surface)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A20 / focus-management / subscriber/branch/employer/agent BottomSheets + PaySheet
- **Location:** `src/subscriber-dashboard/shell/BottomSheet.jsx, src/branch-dashboard/shell/BottomSheet.jsx, src/employer-dashboard/shell/BottomSheet.jsx, src/agent-dashboard/shell/BottomSheet.jsx, src/components/PaySheet.jsx`
- **Roles:** subscriber, branch, employer, agent
- **Impact:** Keyboard/SR users tab out of the aria-modal into the inert page behind it, violating the modal contract; on close focus is dropped to <body>; PaySheet cannot be dismissed with Escape.
- **Evidence:** Focus audit (grep role/aria-modal, Escape, focus-trap, restore, .focus()): subscriber/branch/employer/agent BottomSheet all = dialog:yes esc:yes trap:NO restore:NO focus():NO. PaySheet = dialog:yes esc:NO trap:NO restore:NO focus():NO (role="dialog" aria-modal="true", createPortal). Contrast with Modal.jsx (full trap+restore+escape+aria-labelledby) and landing BottomSheet/SignInModal/EmployerSlidePanel (also full) — the logic is copy-pasted with no shared utility, and these 5 drifted.
- **Suggested fix (NOT applied):** Extract Modal.jsx's focus-trap into a shared useFocusTrap hook and apply to every aria-modal surface; add an Escape handler to PaySheet. · effort M

### A20-004 · Closed landing nav drawer keeps focusable children tabbable while aria-hidden
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A20 / aria-hidden-focus / public landing (/, /admin, /distributors, /employers)
- **Location:** `src/pages/landing/shell/LandingMobileShell.jsx (drawer _drawer_oo5s9_110)`
- **Roles:** public
- **Impact:** Keyboard users tab into an off-screen invisible menu (7 controls) that is marked aria-hidden; focus vanishes with no visible target.
- **Evidence:** axe aria-hidden-focus (serious) on /, /admin, /distributors, /employers (chromium). DOM probe: aside[aria-hidden=true] '_drawer' contains 7 focusables ['BUTTON:Close menu','A:Subscribers','A:Employers',...].
- **Suggested fix (NOT applied):** Render the drawer contents only when open, or apply inert / tabindex=-1 to its focusables while closed. · effort S

### A20-005 · Horizontally/vertically scrollable data tables are not keyboard-accessible
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A20 / scrollable-region-focusable / admin & distributor desktop dashboards (tables); landing quotes carousel (mobile); agent onboard list (mobile)
- **Location:** `shared table shell _tableScroll; _quotesScroll (landing); agent /dashboard/onboard <ol>`
- **Roles:** admin, distributor, agent, public
- **Impact:** Clipped table/carousel content is unreachable for keyboard-only users (container scrolls but is not focusable). Low impact for a mouse-using rep; a real blocker for keyboard/SR users.
- **Evidence:** axe scrollable-region-focusable (serious): 17 scans. admin /dashboard,/distributors,/employers,/nav,/network,/nominee-claims,/subscribers,/access-requests,/settings _tableScroll (chromium); distributor /dashboard,/agents,/branches,/commissions,/settings _tableScroll; public / and /distributors _quotesScroll (mobile); agent /dashboard/onboard ol (mobile).
- **Suggested fix (NOT applied):** Add tabindex="0" and an aria-label to the scroll containers (axe's canonical fix). · effort S

### A21-001 · Distributor/admin subscriber list downloads the entire collection client-side (~3.4MB raw / ~6,765 rows into memory)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A21 / efficiency / distributor + admin dashboard (subscriber list screen)
- **Location:** `src/dashboard/subscriber/ViewSubscribers.jsx:251-263; src/services/entities.js:447-517`
- **Roles:** distributor, admin
- **Impact:** On a rep's Ugandan 4G link to Singapore (RTT 0.4-0.6s, ~2-5Mbps) the headline distributor/admin subscriber screen stalls for several seconds fetching the whole dataset; memory holds ~6,765 objects. Renders fine (virtualized) but the transfer is the bottleneck. Demo-visible on a supported viewport.
- **Repro:** 1) cd repo; set -a; . ./.env.local; set +a 2) curl -sX POST localhost:3001/api/auth/verify-otp -d '{"phone":"+256700000021","role":"distributor","otp":"123456"}' -> capture token 3) curl -s "$VITE_SUPABASE_URL/rest/v1/subscribers?select=id,name,...,subscriber_balances(total_balance)" -H "apikey:$ANON" -H "Authorization: Bearer <jwt>" -H 'Range: 0-999' -H 'Prefer: count=exact' -> 206, content-range 0-999/4602, 580,383 bytes
- **Evidence:** Logged in as d-001 via /api/auth/verify-otp, then curled live PostgREST with the distributor JWT. subscribers: content-range 0-999/4602, page0 = 580,383 B raw / 101,615 B gzip in 0.53s -> full set 6 requests (page0 + count HEAD + pages 1-4) ~2.67MB raw / ~467KB gzip. agents: content-range 0-999/1872 -> 3 requests ~147KB gzip. branches: 0-290/291 -> 1 request 13.4KB gzip. TOTAL ~10 PostgREST requests, ~3.4MB raw / ~630KB gzip, ~6,765 rows held in memory on one screen. The correct server-side path getEntityPage/useInfiniteEntityList is dead code (its docstring: 'CURRENTLY UNUSED ... its only caller useInfiniteEntityList has no consumers', entities.js:546-574).
- **Suggested fix (NOT applied):** Wire the list to the already-built getEntityPage server-side paginate+filter+sort path (or scope the read to the drilled entity) instead of pulling all ~4,600 subscriber rows + all agents + all branches for a virtualized viewport. · effort M

### A22-002 · Primary dashboard hero money reads have no error/retry state — a read failure renders 'FUNDS UNDER MANAGEMENT —' / 0 subscribers / 'Health Score 0 Needs work' silently
- **Severity/Confidence:** medium / confirmed  _(verifier adjusted from high)_
- **Agent/Category/Surface:** A22 / error-handling / admin/distributor/branch overview hero
- **Location:** `shared dashboard hero component (renders 'FUNDS UNDER MANAGEMENT') + src/main.jsx:69 (no QueryCache.onError)`
- **Roles:** admin, distributor, branch
- **Impact:** A single failed overview read (network blip on demo wifi, RPC error) turns the admin/distributor home into a fully-zeroed 'Needs work' screen showing '—' for AUM, with no error message and no retry — only a manual page reload recovers. Reads as wrong money during a live demo. The one isError 'Metrics unavailable' badge (AdminCountryOverview.jsx:115) is on a secondary Summary card and never surfaces on the mounted hero.
- **Failure scenario:** get_platform_overview returns 500 → usePlatformOverview throws → component does overview ?? {} then every field ?? 0 → hero renders — / 0 / 'Needs work' with no isError guard on the mounted hero.
- **Repro:** 1) Sign in as admin at /admin 2) Cause get_platform_overview to fail (route-fulfill 500, or a real network drop) 3) Overview hero shows FUNDS UNDER MANAGEMENT —, SUBSCRIBERS 0, Health Score 0 Needs work with no error and no retry
- **Evidence:** node docs/audits/2026-08-23/scratch/a22-19-error-badge-check.mjs → 'admin/get_platform_overview 500: FUM shown "— "; "Metrics unavailable" present: false; retry button: false; role=status/alert: []' and 'distributor/get_entity_metrics_rollup 500: FUM shown "— "; false; false'. a22-06-silent-read-failure.mjs shows admin hero 'FUNDS UNDER MANAGEMENT — … SUBSCRIBERS 0 … Platform Health Score 0 Needs work'. Services throw on error (entities.js:1316, :877) yet the hero swallows to 0.
- **Suggested fix (NOT applied):** Give the shared hero an isError branch (message + Retry calling refetch()); add a global QueryClient QueryCache.onError toast so no read can fail entirely silently. · effort M
- **Verification:** SEVERITY-ADJUST — Defect CONFIRMED verbatim: AdminOverview.jsx:139-148 does platform ?? {} then every field ?? 0 with no isError branch on the mounted hero; formatUGX returns '—' for n<=0 (currency.js:32); scoreQuality(0)='Needs work' (:100); src/main.jsx has no QueryCache.onError. A failed get_platform_overview renders 'Funds under management —', 0 subscribers, 'He

### A22-003 · Mid-session JWT expiry on the direct-Supabase path never re-logs-in; forwardSupabaseAuthError is dead code (0 call sites)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A22 / auth-expiry / supabase data path / session lifecycle
- **Location:** `src/services/supabaseClient.js (forwardSupabaseAuthError / isSupabaseAuthError exported, 0 call sites in the 14 services)`
- **Roles:** admin, distributor, branch, agent, employer, subscriber
- **Impact:** Once the 24h JWT lapses mid-session, every direct-PostgREST read (all dashboards) silently downgrades to the anon key (isJwtExpired treats the expired token as absent) and shows zeros; the user stays 'logged in' with a dead session and no re-login prompt. Only the /api 401 channel and the startup gate handle expiry. Not a live-demo trigger (needs a day-old session), hence medium.
- **Failure scenario:** expired token → isJwtExpired true → fetchWithAuth sends anon key → agents read RLS-denied 401 → no service forwards the auth error → dashboard renders 0 agents / 0 AUM with the stale session still active.
- **Repro:** 1) Sign in as any role 2) Replace localStorage upensions_token with an expired JWT (simulates 24h lapse) 3) Navigate to a tab that fires a Supabase read → dashboard shows 0/empty, user is NOT logged out
- **Evidence:** grep -rn 'forwardSupabaseAuthError|isSupabaseAuthError' src/services src/hooks → only test files reference PGRST301. node docs/audits/2026-08-23/scratch/a22-05-auth-expiry.mjs 4b → responses ['200 districts','200 regions','401 agents'], screen '0 agents · 0 SUBSCRIBERS · 0 AUM', 'token = STILL PRESENT' (no logout). 4a startup gate PASSES (localStorage keys=[], routed to /).
- **Suggested fix (NOT applied):** Call forwardSupabaseAuthError(error) on every .rpc/.from result (or centralise it in fetchWithAuth by inspecting response status) so a PostgREST 401/PGRST301 drives the same logout+redirect as the /api path. · effort M
- **Verification:** CONFIRMED — Spot-check holds. grep -rn forwardSupabaseAuthError across src (excluding supabaseClient.js definition/comments) returns ZERO callers. fetchWithAuth uses liveToken() which treats an expired JWT as absent and falls back to the anon key, so an expired mid-session downgrades direct-PostgREST reads to anon (zeros) with no logout on that path. Author's 

### A22-004 · Raw technical error strings ('TypeError: Failed to fetch', raw Postgres exception text) leak into user toasts on writes; the friendly fallback never wins
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A22 / error-copy / write toasts (money + profile)
- **Location:** `src/subscriber-dashboard/pages/SavePage.jsx:204, WithdrawPage.jsx:142, ProfilePage.jsx:102, src/employer-dashboard/runs/runViews.jsx:361 (pattern addToast('error', err?.message || 'Could not …'))`
- **Roles:** subscriber, employer, admin
- **Impact:** On a flaky demo network a prospect sees 'TypeError: Failed to fetch' (or a raw Postgres exception) on a money action — looks broken and unprofessional. The friendly copy the authors wrote is effectively dead because err.message is never empty.
- **Failure scenario:** network drop on make_contribution → fetchWithAuth throws TypeError → err.message='Failed to fetch' → addToast('error', err.message || fallback) renders 'TypeError: Failed to fetch' to the user.
- **Repro:** 1) Sign in as subscriber, open /dashboard/save (Top up) 2) Drop the network (or 500 make_contribution) and confirm the payment 3) Toast shows the raw string 'TypeError: Failed to fetch' instead of 'Could not complete the top-up.'
- **Evidence:** node docs/audits/2026-08-23/scratch/a22-14-money-writes.mjs → toasts 'unexpected error while executing make_contribution', 'TypeError: Failed to fetch', 'amount must be greater than zero'. a22b-16 / 14 → 'injected server error', 'injected failure (audit A22)'. err.message is always populated by createApiError/supabase, so '|| Could not …' never runs.
- **Suggested fix (NOT applied):** Map known err.code values to friendly copy and default to the fallback for anything unrecognised; never render a bare err.message in a user toast. · effort M
- **Verification:** CONFIRMED — Spot-check holds. All four cited write sites use addToast('error', err?.message || 'Could not …'): SavePage.jsx:204, WithdrawPage.jsx:142, ProfilePage.jsx:102, runViews.jsx:361. A network drop yields err.message='Failed to fetch' (always populated), so the friendly fallback never runs and a money action can toast 'TypeError: Failed to fetch'. Mediu

### A22-005 · Access-request approve/reject does not invalidate adminAttention, so the 'Pending access requests' count stays stale up to 5 minutes
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A22 / stale-cache-invalidation / admin Needs-attention card
- **Location:** `src/hooks/useAccessRequests.js:22-41 (useApproveAccessRequest / useRejectAccessRequest)`
- **Roles:** admin
- **Impact:** Admin approves or denies an access request, then the Needs-attention 'Pending access requests' chip on the home keeps the old count for up to the 5-min staleTime (refetchOnWindowFocus is off) — visibly stale during a demo and inconsistent with the NAV publish flow.
- **Failure scenario:** approve_access_request succeeds → useApproveAccessRequest invalidates accessRequests/platformOverview/entities but not adminAttention → the cached get_admin_attention (staleTime 5min) keeps the pre-approval pendingAccessRequests count on screen.
- **Repro:** 1) Sign in as admin, note the 'Pending access requests' count on the Needs-attention card 2) Go to Access requests, Approve one 3) Return to Overview — the count is unchanged (get_admin_attention not refetched)
- **Evidence:** node docs/audits/2026-08-23/scratch/15-invalidation-probe.mjs → after approve_access_request, refetched=[list_access_requests, get_platform_overview]; on returning to Overview refetched=[]; 'get_admin_attention refetched? false'. get_admin_attention counts pendingAccessRequests (src/services/adminAttention.js:35). usePublishNav (useNav.js:73) correctly invalidates adminAttention; these two do not.
- **Suggested fix (NOT applied):** Add queryClient.invalidateQueries({ queryKey: ['adminAttention'] }) and ['adminAttentionRows'] to both useApproveAccessRequest and useRejectAccessRequest onSuccess. · effort S
- **Verification:** CONFIRMED — Spot-check holds. useApproveAccessRequest invalidates accessRequests/platformOverview/entities but NOT ['adminAttention']; useDenyAccessRequest invalidates only accessRequests (useAccessRequests.js:19-43). useAdminAttention is keyed ['adminAttention'] with staleTime 5min; live get_admin_attention()->>'pendingAccessRequests' = 4, feeding the admin N

### A24-002 · CSP is report-only, reports nowhere, and cannot be enforced as written — 58 violations if flipped on
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A24 / security-headers / whole app (Vercel edge headers)
- **Location:** `vercel.json:11`
- **Roles:** all
- **Impact:** The app's only XSS mitigation is decorative. With no XSS sink today the immediate risk is nil, but anyone who flips the header to enforcing to "turn the CSP on" strips the brand typography from every page including the public landing page — a demo-visible regression — and because no report endpoint exists nobody would have had advance warning.
- **Repro:** 1) curl -s -D- -o /dev/null https://uganda-dashboard.vercel.app/ | grep -i content-security   # note: Report-Only, no report-uri 2) node docs/audits/2026-08-23/a24-csp-enforce-probe.mjs   # replays the same policy as enforcing → 58 violations
- **Evidence:** Three defects in one header. (1) It is Content-Security-Policy-Report-Only, so it blocks nothing. (2) It has NO report-uri and NO report-to directive, so it collects nothing either — inert in both directions. (3) It contradicts the app's own asset origins: `style-src 'self' 'unsafe-inline'` and `font-src 'self'` while index.html:36-38 loads brand typefaces from fonts.googleapis.com / fonts.gstatic.com, and `script-src 'self'` (no 'unsafe-hashes') forbids the inline onload="this.media='all'" attribute on that same <link>.

$ curl -s -D- -o /dev/null https://uganda-dashboard.vercel.app/
content-security-policy-report-only: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com; connect-src
- **Suggested fix (NOT applied):** Add https://fonts.googleapis.com to style-src and https://fonts.gstatic.com to font-src; either move the font <link> off its inline onload (do the media swap from main.jsx) or add 'unsafe-hashes' plus the attribute hash. Add a report-to/report-uri endpoint, watch it for a week, then flip to enforcing. Leave frame-ancestors 'none', base-uri 'self', form-action 'self' and object-src 'none' unchanged — all four are correct. · effort S
- **Verification:** CONFIRMED — All three technical claims verified: (1) header key is Content-Security-Policy-Report-Only so it blocks nothing; (2) no report-uri/report-to directive so it collects nothing; (3) style-src 'self' 'unsafe-inline' + font-src 'self' + script-src 'self' (no 'unsafe-hashes') all contradict the index.html Google Fonts link (fonts.googleapis.com styleshee

### A25-001 · Baseline Playwright suite ships RED with 30 deterministic failures (28 reproduced), not flake
- **Severity/Confidence:** medium / confirmed  _(verifier adjusted from high)_
- **Agent/Category/Surface:** A25 / test-reliability / e2e
- **Location:** `e2e/specs/smoke/subscriber-dashboard.spec.ts; e2e/specs/smoke/landing.spec.ts; e2e/specs/flows/distributor-exports-csv.spec.ts; e2e/specs/flows/agent-onboard-subscriber.spec.ts:109; e2e/specs/regression/map-drill.spec.ts:250`
- **Roles:** subscriber, agent, distributor, public
- **Impact:** The committed baseline fails CI (exit 1) with 30 deterministic failures. 22 land on real mobile device projects and reproduce on BOTH mobile engines -> subscriber dashboard sub-routes and public landing pages do not render on a phone, the exact surfaces a rep demos on mobile. These are real product defects masquerading as a test-health problem.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) cat docs/audits/2026-08-23/a25/flake-diff.txt   # 28 reproduced in both full runs 3) cat docs/audits/2026-08-23/baseline/playwright-full.txt   # 326/30/14 exit 1
- **Evidence:** a25/flake-diff.txt: 'REPRODUCED in both runs -> deterministic defect (28)'; baseline/playwright-full.txt: 326 passed / 30 failed / 14 skipped (exit 1); a25/baseline-failures.txt lists all 30 verbatim. Cluster: subscriber-dashboard 12 (both mobile engines), landing 6 (both mobile engines), distributor-exports-csv 4 (both mobile engines), agent-onboard:109 (chromium+webkit), map-drill:250 (webkit x2), webkit-only signin:78 + signup:116.
- **Suggested fix (NOT applied):** Treat the 28 reproduced failures as product defects and route root-cause to A10/A16/A18/A19 (mobile subscriber-dashboard/landing render; WebKit agent-onboard/map-drill/signin/signup). Do not quarantine as flaky. Get the suite green before it gates merges. · effort L
- **Verification:** SEVERITY-ADJUST — The factual core is confirmed: the committed Playwright baseline is genuinely RED (326/30/14, exit 1), the failures are deterministic not flaky, and mobile-chromium DOES run on PRs (test.yml:125-136) so they land on the merge-gating surface. BUT the severity-driving IMPACT — 'subscriber dashboard sub-routes and public landing pages do not render on

### A25-002 · Mobile E2E coverage is 0-8% for 4 of 6 roles, exactly where the product breaks (mobile runs 7/38 specs but caused 22/30 failures)
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A25 / test-coverage / e2e
- **Location:** `playwright.config.ts:123-134 (mobile-chromium testMatch), :142-154 (mobile-webkit testMatch)`
- **Roles:** admin, branch, distributor, employer, subscriber
- **Impact:** The least-tested surface (7/38 specs on mobile) is simultaneously the most-broken (22/30 baseline failures). Admin NAV publishing, nominee-claims and access-requests have zero mobile E2E coverage; subscriber 'policies' has zero coverage at any viewport.
- **Evidence:** find e2e/specs -name '*.spec.ts' | wc -l -> 38. Both mobile projects testMatch = 7 specs (landing, subscriber-dashboard, agent-dashboard, _health, distributor-exports-csv, subscriber-payment-methods, employer-kyc-nudge). Route-matrix (a25/route-matrix.md) real-device mobile coverage: admin 0/22=0%, branch 0/12, distributor 1/14=7.1%, employer 1/12=8.3%. a25/flake-diff.txt per-spec rollup: 22 of 30 failures are on mobile-chromium/mobile-webkit.
- **Suggested fix (NOT applied):** Expand the two mobile testMatch lists to include each role's home landing and primary sub-routes on at least one mobile engine, prioritising admin NAV-publish and the subscriber dashboard sub-routes that currently fail. · effort M

### A25-003 · Four 'contract' tests grep migration TEXT and never touch the DB, proving text not deployed behaviour
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A25 / false-confidence / unit
- **Location:** `src/test/jwt-claim-contract.test.js; src/test/employer-split-contract.test.js; src/test/login-identity-contract.test.js; src/test/nav-pricing-contract.test.js`
- **Roles:** all
- **Impact:** All 25 assertions pass with the database paused, restored to a different snapshot, or pointed at another project. They cannot detect the exact regression their headers cite (0095 silently un-shipping 0090 via an un-applied CREATE OR REPLACE), a hand-edit over psql, or apply_migration against the wrong project.
- **Evidence:** grep -n 'supabase|createClient|psql|fetch(' src/test/*contract*.test.js -> only MIGRATIONS_DIR filesystem paths. node a25/proof-text-vs-live.mjs -> the tests' own latestDefinitionOf() resolver returns a full 'newest definition' for 19/19 function names that have ZERO OIDs live. Re-running all 25 assertions against live pg_get_functiondef: 25/25 agree today (guards not lying now). Detail a25/contract-tests.md.
- **Suggested fix (NOT applied):** Add one ~40-line behavioural twin under e2e/specs/db/ that runs the identical regex battery against pg_get_functiondef(p.oid) and asserts count(oid)=1 per name; it inherits the CI section 15-M1 executed-not-skipped guard. Keep the text greps as a cheap pre-merge lint on the migration a dev is writing. · effort S

### A25-005 · Money engine's live invariants are essentially unguarded; 2 are violated right now with no test to notice
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A25 / test-coverage / e2e
- **Location:** `e2e/specs/db/invariants.spec.ts (8 assertions, 2 about money); e2e/specs/db/money-idempotency.spec.ts (2 assertions)`
- **Roles:** subscriber, admin
- **Impact:** s-0005 shows a ~10,000 UGX disagreement between two unit figures on the same subscriber screen; 4 subscribers have no balance row. No test in the repo reconciles a balance, a unit count, or a price. (Data-defect ownership is A04/A06; the QA finding is the unguarded class.)
- **Evidence:** psql UNION probe (a25/money-invariants.md): units_total_mismatch|1 (s-0005 units 203.99 vs retirement+emergency 210.35, delta -6.3637), subscribers_without_balance|4. 10 total money-adjacent assertions over 29,027 transactions / 5,060 balances / 1,246 NAV snapshots.
- **Suggested fix (NOT applied):** Add behavioural specs under e2e/specs/db/ for M1 (every subscriber has exactly one balance), M2 (units = retirement_units + emergency_units), M8 (apply_settlement idempotency), M12 (function-deployment contract) first; they inherit the section 15-M1 guard. · effort M
- **Verification:** CONFIRMED — Spot-checked. The live money-invariant violations the finding cites are reproduced exactly, and the QA claim (no test reconciles them) is consistent with the repo. Data-defect ownership is A04/A06; A25's unguarded-invariant-class framing is a valid medium test-coverage finding.

### A25-006 · api/, server/, e2e/ TypeScript (100 files) is not linted at all
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A25 / lint-gap / backend
- **Location:** `eslint.config.js (files globs: src/**/*.jsx and **/*.{js,jsx} — no .ts/.tsx block)`
- **Roles:** all
- **Impact:** no-unused-vars, no-console and react-hooks/* never run over the entire backend or the entire test harness; a whole class of defect is invisible to CI.
- **Evidence:** npx eslint . --format json | (count by ext) -> {cjs:3,mjs:68,js:180,jsx:433}, zero .ts. Unlinted: api/ 48, e2e/ 46, server/ 5, playwright.config.ts 1 = 100 files. Detail a25/lint-type-gaps.md.
- **Suggested fix (NOT applied):** Add a flat-config block: { files: ['api/**/*.ts','server/**/*.ts','e2e/**/*.ts','*.config.ts'], languageOptions:{ parser: tseslint.parser, globals: globals.node }, plugins:{'@typescript-eslint':tseslint.plugin}, extends:[tseslint.configs.recommended], rules:{'no-console':'off'} }. · effort S
- **Verification:** CONFIRMED — Spot-checked. ESLint flat config has no .ts/.tsx block; api/, server/, e2e/ and playwright.config.ts (all TypeScript) are never linted. Confirmed zero .ts files enter the lint run.

### A25-007 · No typecheck script; tsc checks 32 of 100 .ts files and skips all tests + all e2e
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A25 / type-gap / backend
- **Location:** `package.json (no 'typecheck'); server/tsconfig.json (exclude: api/**/*.test.ts, ./**/*.test.ts); no root tsconfig.json`
- **Roles:** all
- **Impact:** 68 of 100 TypeScript files are never type-checked; src/ is never checked even with checkJs. A broken spec type ships forever with no gate.
- **Evidence:** The only tsc is build:api (tsc -p server/tsconfig.json). tsc --listFiles walks 32 files (27 api + 5 server). Never checked: 21 api/*.test.ts + 46 e2e/**/*.ts + playwright.config.ts = 68. ls tsconfig* -> no matches. Detail a25/lint-type-gaps.md.
- **Suggested fix (NOT applied):** Add e2e/tsconfig.json (extends server, include ['**/*.ts','../playwright.config.ts']), add "typecheck": "tsc -p server/tsconfig.json --noEmit && tsc -p e2e/tsconfig.json --noEmit", drop the *.test.ts excludes under --noEmit, run typecheck in the lint-and-unit CI job. · effort S

### A25-009 · All 34 jsx-a11y rules forced to 'warn' and lint has no --max-warnings; 311 a11y warnings hide in a green build
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A25 / lint-gap / frontend
- **Location:** `eslint.config.js (jsxA11yWarnRules = Object.fromEntries(keys.map(r => [r,'warn']))); package.json "lint": "eslint ."`
- **Roles:** all
- **Impact:** The a11y backlog is unbounded: a PR can add 50 more jsx-a11y warnings and CI stays green. a11y blockers accumulate silently.
- **Evidence:** Baseline: 323 warnings, 311 jsx-a11y (96%), npm run lint exits 0. No --max-warnings. Detail a25/lint-type-gaps.md.
- **Suggested fix (NOT applied):** 1) Pin the ceiling now: "lint": "eslint . --max-warnings=323" (ratchet down only). 2) Promote to 'error' the 25 of 34 recommended a11y rules with zero current violations, leaving only the 9 with hits at 'warn'. · effort S

### A25-011 · CI section 15-M1 'executed-not-skipped' guard runs only on push-to-main, not on PRs — the surface that gates merges
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A25 / ci-gap / infra
- **Location:** `.github/workflows/test.yml:148-173 (guard condition: github.event_name == 'push' && github.ref == 'refs/heads/main')`
- **Roles:** all
- **Impact:** A fork PR, or one run while a secret is rotating/unset, silently loses every cross-tenant RLS and money-idempotency guard and still shows a green check — the failure the guard exists to prevent is fully reachable on the merge-gating surface.
- **Evidence:** The PR step deliberately includes e2e/specs/db (comment: catch security/money regressions before merge, section 15-H1), but the guard proving those specs actually executed is push-main-only. All four db specs gate on test.skip(!hasEnv) -> reported as skipped, never expected. Detail a25/ci-guard.md.
- **Suggested fix (NOT applied):** Change the guard step to if: always() (or drop the condition); optionally tighten 'expected < 1' to 'expected < 13' so a partially-skipped db suite is caught, not only a wholly-skipped one. · effort S
- **Verification:** CONFIRMED — Spot-checked. The 'db specs actually executed' guard is gated to push-to-main only, while the PR job runs the db specs (each wrapped in test.skip(!hasEnv)) with no such guard. A fork PR or a run during secret rotation would silently skip every cross-tenant/money-idempotency spec and still report green. Real but conditionally reachable -> medium is 

### A25-012 · Coverage gate is statements-only at 23% (10 points below actual); branch/function/line ungated
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A25 / test-coverage / unit
- **Location:** `vite.config.js (test.coverage.thresholds = { statements: 23 }); no vitest.config.*`
- **Roles:** all
- **Impact:** Tests can be deleted until statement coverage falls to 23% and the gate still passes; branch coverage (already the weakest at 28.95%), function (27.49%) and line coverage have no floor at all. The gate ratchets nothing.
- **Evidence:** a25/coverage-agg.txt threshold check: configured statements 23; measured 32.94; headroom 9.94; branches/functions/lines: NO THRESHOLD CONFIGURED. Byte-identical across coverage-raw.txt and coverage-run2.txt (deterministic).
- **Suggested fix (NOT applied):** Raise statements to the current floor (~32) and add branch/function/line thresholds at measured minus 1, so all four metrics ratchet upward only. · effort S
- **Verification:** CONFIRMED — Spot-checked. The coverage gate configures only a statements threshold (23), with no branch/function/line floor and no separate vitest config. Matches the finding.

### A26-003 · MOCK_NOW documented as 2026-05-26 in four docs; the real value is 2026-07-01, and two code copies drifted 36 days from it
- **Severity/Confidence:** medium / confirmed  _(verifier adjusted from high)_
- **Agent/Category/Surface:** A26 / doc-accuracy-constant-drift / docs
- **Location:** `CLAUDE.md:201, docs/BACKEND.md:880, docs/FRONTEND.md:301, docs/FRONTEND.md:1412 (docs); scripts/seed-supabase.mjs:169, e2e/specs/db/invariants.spec.ts:52 (code copies)`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** The frozen clock existing is by design (demo scope, explicitly excluded); its copies disagreeing is not, and the audit brief singles out MOCK_NOW drift as reportable. scripts/seed-supabase.mjs carries a comment asserting the constant MUST mirror mockData.js and then hardcodes a value 36 days behind it, so the next `npm run seed` writes a ledger anchored 36 days before the anchor every mock-mode surface renders against. Four documents would hand the operator the wrong constant while they debugged that. e2e/specs/db/invariants.spec.ts:52 documents the same stale anchor to future spec authors.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) grep -rn 'MOCK_NOW *=' src/ e2e/ scripts/ 3) sed -n '166,169p' scripts/seed-supabase.mjs 4) sed -n '201p' CLAUDE.md; sed -n '880p' docs/BACKEND.md; sed -n '301p;641p;1412p' docs/FRONTEND.md 5) set -a; . ./.env.local >/dev/null 2>&1; set +a; psql "$SUPABASE_DB_URL" -X -q -At -c 'SELECT public._demo_now();'
- **Evidence:** $ grep -rn 'MOCK_NOW *=' src/ e2e/ scripts/
src/data/mockData.js:25:export const MOCK_NOW = new Date(2026, 6, 1); // 2026-07-01
scripts/seed-supabase.mjs:169:const MOCK_NOW = new Date(2026, 4, 26); // 2026-05-26 - mirror of mockData.MOCK_NOW

$ sed -n '166p' scripts/seed-supabase.mjs
// MOCK_NOW MUST mirror src/data/mockData.js (`new Date(2026, 4, 26)` = 2026-05-26).

$ grep -n 'MOCK_NOW' e2e/specs/db/invariants.spec.ts
52:// Seed anchor - mirrors `MOCK_NOW = new Date(2026, 4, 26)` (2026-05-26) in

Doc claims, all wrong:
CLAUDE.md:201   -> "MOCK_NOW = new Date(2026, 4, 26) (2026-05-26) in src/data/mockData.js"
BACKEND.md:880  -> "MOCK_NOW = new Date(2026, 4, 26) (= 2026-05-26) at src/data/mockData.js:25. The wall-clock date is now past this (2026-06-05)"
FRONTEND.md:301  -> "JS MOCK_NOW 20
- **Suggested fix (NOT applied):** Docs (A26 scope): CLAUDE.md:201 -> "MOCK_NOW = new Date(2026, 6, 1) (2026-07-01) in src/data/mockData.js:25 ... WARNING: two copies have NOT been rolled forward - scripts/seed-supabase.mjs:169 and e2e/specs/db/invariants.spec.ts:52. A third, independent frozen clock public._demo_now() = 2026-05-18 also exists." Same correction at BACKEND.md:880, FRONTEND.md:301 and :1412; reconcile with the already-correct FRONTEND.md:641. Code (seed/data-agent, out of A26 remit): re-sync scripts/seed-supabase.mjs:169 to new Date(2026, 6, 1) or, better, import MOCK_NOW from src/data/mockData.js so the two cannot drift again. Full text in DOC-CORRECTIONS.md §2, §4, §5, §13. · effort S
- **Verification:** SEVERITY-ADJUST — Facts all reproduce and it is IN scope (the brief explicitly makes MOCK_NOW drift reportable), so not refuted. Real MOCK_NOW=new Date(2026,6,1) (2026-07-01); seed-supabase.mjs:169=new Date(2026,4,26) under a comment insisting it MUST mirror mockData.js; invariants.spec.ts:52 repeats it; CLAUDE.md:201, BACKEND.md:880, FRONTEND.md:301, FRONTEND.md:14

### A26-005 · Twelve of CLAUDE.md's thirteen 'binding' rules have no mechanical enforcement; one is already violated
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A26 / process-enforcement-gap / docs
- **Location:** `CLAUDE.md:89-108 (§4 rules 1-6, §5 anti-patterns 1-7); enforcement surface eslint.config.js, absent stylelint config, absent .husky/, .github/workflows/test.yml`
- **Impact:** A change violating §4.1, §5.2, §5.3, §5.4 or §5.6 passes `npm run lint`, `npm test`, `npm run build`, `npm run build:api` and the full CI pipeline. Four of those five hold today by convention alone - one bad merge from silent regression with nothing to catch it - and the fifth (§5.6, 'every database write goes through a SECURITY DEFINER RPC') is already breached in shipped code. The document tells every reader and every agent these rules are binding; they are aspirational. This is the highest-leverage documentation gap in the corpus because it explains how the other findings accumulated.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) sed -n '89,108p' CLAUDE.md 3) cat eslint.config.js 4) ls .stylelintrc* stylelint.config.* 2>/dev/null; ls .husky 2>/dev/null 5) grep -n 'lint-staged\|husky\|pre-commit' package.json 6) grep -rn 'auth.uid' src/test/*.test.js 7) grep -rn '\.insert(\|\.update(' src/services/subscriber.js src/services/entities.js | grep -v 'rpc('
- **Evidence:** CLAUDE.md:1 states the rules are "binding, not advisory". Enforcement surface, measured:

$ grep -n 'rules:' -A 6 eslint.config.js | tail -8
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]|^motion$', destructuredArrayIgnorePattern: '^_' }],
      'react-refresh/only-export-components': ['warn', { ... }],
    },
(no no-restricted-imports, no no-restricted-syntax, no custom rule; the only other block force-downgrades every jsx-a11y rule to 'warn')

$ ls .stylelintrc* stylelint.config.* 2>/dev/null; echo '(none)'
(none)
$ ls .husky 2>/dev/null; grep -n 'lint-staged\|husky\|pre-commit' package.json; echo '(none)'
(none)

Only real gate:
$ grep -n 'it(\|describe(' src/test/jwt-claim-contract.test.js
42:desc
- **Suggested fix (NOT applied):** Immediate (doc): insert after CLAUDE.md:108 an 'Enforcement reality' note naming which rules are mechanically gated and which are prose only - full text drafted in DOC-CORRECTIONS.md §2 last row. Durable (code, separate approval): add an ESLint no-restricted-imports block for §4.1/§5.1 (patterns src/data/mockData and @/data/mockData, scoped to src/**/*.jsx and src/*-dashboard/**), a no-restricted-syntax rule for §5.2, a minimal stylelint config for §5.3/§5.4, and extend src/test/jwt-claim-contract.test.js to also grep migrations for auth.uid(). The four existing src/test/*-contract.test.js specs are the proven template. · effort M
- **Verification:** CONFIRMED — Spot-check. Enforcement surface reproduces empty: eslint.config.js rules block has no no-restricted-imports/no-restricted-syntax (only no-console, no-unused-vars, react-refresh, and jsxA11y forced to warn); no stylelint config; no .husky and no husky/lint-staged/pre-commit in package.json; 115 'outline: none' across 72 CSS files; src/test has no au

### A26-006 · Every schema and architecture census in ARCHITECTURE.md and BACKEND.md is stale by 30-90 percent
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-counts / docs
- **Location:** `docs/ARCHITECTURE.md:23,:32,:52-58,:79,:80,:81,:84-86,:387,:540,:661; docs/BACKEND.md:37,:38,:39,:44,:329,:343,:428,:441,:459,:565,:625,:653,:1036`
- **Impact:** These ASCII boxes and census sentences are what an agent reads to size the system before touching it, and they are quoted downstream. ARCHITECTURE.md at least discloses a May-2026 pin at line 1 and line 9; BACKEND.md:44 claims 'Live census (verified 2026-07-08)', which reads as current authority and is wrong on all five numbers. BACKEND.md:625's '53 functions' understates the live surface by 36 and gives no hint that 20 names present in the migration text (the 0021 commission family, dropped by 0029) are absent from pg_proc entirely.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) sed -n '79,86p' docs/ARCHITECTURE.md; sed -n '37,39p' docs/BACKEND.md 3) psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT 'tables',count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' UNION ALL SELECT 'fn',count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT 'pol',count(*) FROM pg_policies WHERE schemaname='public';" 4) psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal;" 5) ls supabase/migrations/*.sql | grep -v '.down.sql' | wc -l
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT 'tables', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' UNION ALL SELECT 'fn_names', count(DISTINCT proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' UNION ALL SELECT 'definer', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef UNION ALL SELECT 'policies', count(*) FROM pg_policies WHERE schemaname='public';"
tables|37
fn_names|89
definer|70
policies|109
$ psql ... triggers (NOT tgisinternal) -> 10
$ psql ... has_function_privilege('authenticated', oid, 'EXECUTE') -> 87
$ ls supabase/migrations/*.sql | grep -v '.down.sql' | wc -l -> 108
$ ls -d src/*dashboard* src/dashboar
- **Suggested fix (NOT applied):** Refresh both censuses to the measured values and add the unjoinable-ledger warning to the ARCHITECTURE.md migration box. 28 corrections drafted verbatim in DOC-CORRECTIONS.md §3 and §4, including the corrected down-migration accounting (86 downs for 108 forwards; the 22 without are 0001-0015, 0017, 0018, 0019, 0020, 0021, 0027, 0028) and the 0081-supersedes-0075 note for BACKEND.md:653. · effort M
- **Verification:** CONFIRMED — Spot-check. Live census: 37 tables, 89 fn-names, 70 DEFINER, 109 policies, 10 triggers. Docs are stale everywhere: ARCHITECTURE.md:79 '28 tables · 5 triggers'; :80 '40 functions (29 DEFINER + 11 INVOKER)'; :81 '~90 RLS policies'; BACKEND.md:37 '29 tables · 8 triggers'; :38 '53 functions'; :39/:44 '99 RLS policies' -- the last framed as 'Live census

### A26-007 · Migration ledger head documented as 0076 in five places; the ledger's structural unjoinability is documented nowhere and is mis-framed as '6 missing rows'
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-ops-runbook / docs
- **Location:** `docs/BACKEND.md:44, :358, :1013, :1015, :1019; docs/api-contracts.md:240; docs/render-operational.md:36`
- **Impact:** BACKEND.md §16 is the section an operator opens before touching live schema. It reports the head as 0076 when 32 further migrations are applied, and frames the drift as '6 missing rows, since reconciled' when the true state is that ledger and files cannot be diffed by version at all. Anyone acting on the render-operational.md:36 framing would attempt a version-level reconciliation that cannot succeed, and might conclude the schema is behind when it is not - the exact reasoning error the audit plan's own §5 made.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT version||' '||name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;" 3) psql "$SUPABASE_DB_URL" -X -q -At -c 'SELECT count(*) FROM supabase_migrations.schema_migrations;' 4) grep -n '0076' docs/BACKEND.md | head 5) sed -n '36p' docs/render-operational.md
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT version||' '||coalesce(name,'') FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;"
20260811100047 0108_nominee_claims_seed
20260808170000 0107_nav_avg_growth_per_member
20260808160000 0106_nav_publish_where_clause
20260808150000 0105_nav_backfill
20260808140000 0104_nav_pricing_rpcs
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM supabase_migrations.schema_migrations;"
96
$ ls supabase/migrations/*.sql | grep -v '.down.sql' | wc -l
108

BACKEND.md §16 heading at :1013 reads 'Migration ledger - live head 0076, one out-of-band episode (since reconciled) (BL-6)'; :1015 and :1019 repeat 'head ... 0076_subscribers_column_scoped_update (verified 2026-07-08)'. :44 and :358 repeat it.

docs/render-operational
- **Suggested fix (NOT applied):** Replace all five BACKEND.md occurrences with: 'live head 0108_nominee_claims_seed (version 20260811100047), 96 rows. WARNING: the ledger versions rows as TIMESTAMPS while the files are named 0001_*-0108_*; the two namespaces share no key, so a filename-prefix diff reports all 108 as missing. Establish applied state by introspecting live objects (pg_proc.prosrc, pg_policies, information_schema), not by diffing versions.' Rewrite render-operational.md:36 to the same framing. Full text in DOC-CORRECTIONS.md §4 and §10. · effort S
- **Verification:** CONFIRMED — Spot-check. Ledger holds 96 rows and head is 0108_nominee_claims_seed; BACKEND.md:44/:358 (and :1013/:1015/:1019) say head is 0076. render-operational.md:36 frames the drift as 'the live schema_migrations ledger is missing 6 local migrations (0022/0023/0024/0025/0027/0028)', which presupposes a shared key between timestamp-versioned ledger rows and

### A26-008 · .claude/skills/qa.md misdescribes the suite it operates: 13 wrong claims, a 'known bug' that is fixed, a runtime off by 12x, and silence on 30 real failures
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-qa-harness / docs
- **Location:** `.claude/skills/qa.md:12, :14, :15, :16, :28, :40, :146-155, :149, :152, :173, :179`
- **Impact:** /qa is a slash command an agent invokes and then reasons about the result of. Reading this file it will budget 2 minutes for a 24-minute run, hunt for a spec (branch-create-agent) that was never written, re-fix an already-wired CreateBranch panel, miss two whole spec files (deactivate-entities, subscriber-insurance-no-scroll), and - worst - treat 30 reproducible failures as unexpected because the section whose job is enumerating known bugs does not mention them. Every QA pass pays this cost.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) ls e2e/specs/flows/ | wc -l; ls e2e/specs/db/; ls e2e/specs/regression/ 3) find e2e -name '*branch-create-agent*' 4) grep -rn 'test.fail' e2e/specs/ 5) grep -n 'useCreateBranch\|handleConfirm\|mutateAsync' src/dashboard/branch/CreateBranch.jsx 6) grep -rn 'VALID_VIEWS =' src/agent-dashboard/ 7) cross-check docs/audits/2026-08-23/00-baseline.md §10 (326/30/14 of 370, 24.4 min)
- **Evidence:** $ ls e2e/specs/flows/ | wc -l
18
$ find e2e -name '*branch-create-agent*'
(no output - qa.md:14 lists this spec; it does not exist)
$ grep -rn 'test.fail\|test.fixme' e2e/specs/
e2e/specs/regression/empty-states.spec.ts:100:      // Step 4: ALWAYS restore - even on test failure. afterEach would run
e2e/specs/flows/distributor-apply-settlement.spec.ts:426:  test.fixme(
(qa.md:14 and :149 claim distributor-create-branch is marked test.fail - no test.fail exists anywhere)
$ ls e2e/specs/db/
deactivate-entities.spec.ts  invariants.spec.ts  money-idempotency.spec.ts  rls-isolation.spec.ts
(qa.md:15 lists 3; deactivate-entities is undocumented)
$ ls e2e/specs/regression/
employer-kyc-nudge.spec.ts  empty-states.spec.ts  map-drill.spec.ts  modal-escape.spec.ts  subscriber-insurance-no-scroll.spec
- **Suggested fix (NOT applied):** Refresh the coverage map from the tree (18 flows, 4 db, 8 regression, 8 smoke), delete bug #2 and the test.fail annotation, correct bug #5's path to src/agent-dashboard/pages/commissions/commissionsConfig.jsx:14, restate the runtime as ~24 min at --workers=1, drop the two completed roadmap items, and add a 'Currently failing (measured 2026-08-23) - 30 of 370, deterministic' section pointing at 00-baseline.md §10. 13 corrections drafted in DOC-CORRECTIONS.md §12. · effort M
- **Verification:** CONFIRMED — Spot-check. qa.md misdescribes its suite: flows/ has 18 specs (qa.md:12 '~78-test baseline'); the branch-create-agent spec listed at qa.md:14 does not exist; no real test.fail( exists anywhere (the only grep hit is a comment 'on test failure'), yet qa.md:14 claims distributor-create-branch is 'marked test.fail'; db/ has 4 specs (qa.md:15 lists 3, o

### A26-009 · docs/data-model.md field tables diverge from the live schema, and the Employer section opens by stating the retired model in the present tense
- **Severity/Confidence:** medium / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-schema / docs
- **Location:** `docs/data-model.md:5, :48-58, :67, :69, :190-208, :241, :243-254, :294, :406-417, :428-447`
- **Roles:** subscriber, employer, distributor, admin
- **Impact:** The document's stated purpose (line 1) is to stop a reader 'treating a derived or mock-only value as stored truth' - and the Subscriber table does exactly that, presenting mock-object fields as Stored. :241 is the opening paragraph of the Employer section, so a reader who stops there leaves with the pre-0045 standalone-employees model that was dropped three months ago. The missing employers.status column is the field that gates login for a deactivated employer. The 21-table coverage gap contradicts the doc's own scope claim.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) sed -n '5p;67,69p;241p;294p;428p' docs/data-model.md 3) awk -F, -v t=subscribers '$1==t{print $2}' docs/audits/2026-08-23/baseline/columns.csv 4) awk -F, -v t=employers '$1==t{print $2}' docs/audits/2026-08-23/baseline/columns.csv 5) psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT to_regclass('public.employees'), to_regclass('public.contribution_run_lines');" 6) psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT tablename||'|'||policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('employers','employer_invites') ORDER BY 1;"
- **Evidence:** $ awk -F, -v t=subscribers '$1==t{print $2}' docs/audits/2026-08-23/baseline/columns.csv | tr '\n' ' '
id name email phone gender age dob nin occupation agent_id district_id kyc_status is_active is_demo_signup insurance_same_as_pension registered_date consent_at last_contribution_date contribution_history products_held current_unit_value unit_value_as_of created_at employer_id compensation
(doc :190-208 lists parentId and totalWithdrawals - neither is a column, the FK is agent_id - and never mentions dob, nin, occupation, district_id, is_demo_signup, insurance_same_as_pension, consent_at, last_contribution_date, current_unit_value, unit_value_as_of, created_at)

$ awk -F, -v t=employers '$1==t{print $2}' docs/audits/2026-08-23/baseline/columns.csv | tr '\n' ' '
id name sector registration_
- **Suggested fix (NOT applied):** Rewrite :241 to the unified model (staff ARE subscribers tagged via subscribers.employer_id); split the Subscriber field table into 'DB column' vs 'mock-object field' provenance and add the 11 missing columns; add employers.status, contribution_runs.insurance_total, distributors.registration_no; correct the employer_invites policy name and the distributors RLS claim; give '## Contribution Run Line' the same HISTORICAL banner the Employee section has; soften :5's scope claim and point at baseline/columns.csv for the authoritative list. 11 corrections drafted in DOC-CORRECTIONS.md §7. · effort M


## ⚪ LOW (68)

### A02-006 · subscriber_insurance_products has no SELECT policy for branch, distributor, employer or admin -- 1,473 live rows invisible to four roles
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A02 / rls-coverage-gap / database/RLS
- **Location:** `public.subscriber_insurance_products (only 4 policies: sip_select_self, sip_select_agent, sip_insert_self, sip_update_self)`
- **Roles:** branch, distributor, employer, admin
- **Impact:** No user-visible effect today: src/services/employer.js:364 selects only insurance_policies(*), and no admin/distributor rollup RPC reads the table -- 'select proname from pg_proc where pronamespace=public and prosrc ilike ''%subscriber_insurance_products%''' returns only fund_insurance_products, pay_insurance_premium, submit_hospital_cash_claim, update_employer_profile, trg_transactions_contribution, _insert_subscriber_chain. It is a latent gap: the moment anyone adds a multi-product insurance panel for those roles it will silently return [] instead of erroring, so health/funeral cover would be under-reported without any signal.
- **Repro:** 1) psql: BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"admin-001","role":"authenticated","app_role":"admin","adminId":"admin-001"}',true); SELECT count(*) FROM subscriber_insurance_products; ROLLBACK; 2) Returns 0, while the same query as postgres returns 1473.
- **Evidence:** The parallel table insurance_policies (life) has EIGHT policies including insurance_policies_select_admin / _branch / _distributor / _employer. When 0064/0065 split health and funeral cover into subscriber_insurance_products, only the self + agent policies were carried over.\n\n$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select 'sip_rows_total',count(*)::text from subscriber_insurance_products union all select 'sip_rows_for_emp001_staff',count(*)::text from subscriber_insurance_products p join subscribers s on s.id=p.subscriber_id where s.employer_id='emp-001' union all select 'sip_rows_under_d001',count(*)::text from subscriber_insurance_products p join subscribers s on s.id=p.subscriber_id join agents a on a.id=s.agent_id join branches b on b.id=a.branch_id where b.distributor_id='d-00
- **Suggested fix (NOT applied):** Add sip_select_admin / sip_select_branch / sip_select_distributor / sip_select_employer mirroring the four insurance_policies_select_* policies verbatim. · effort S

### A02-007 · distributors is unreadable by subscriber / agent / branch / employer, contradicting docs/role-permissions.md
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A02 / doc-vs-live-contract-mismatch / database/RLS + docs
- **Location:** `public.distributors -- policies distributors_select_admin, distributors_select_self, distributors_update_self; docs/role-permissions.md 'Data Scoping Rules Summary'`
- **Roles:** subscriber, agent, branch, employer
- **Impact:** Doc drift only, today -- no subscriber/agent/branch/employer component reads the table, so nothing is visibly broken. But docs/role-permissions.md is the reference this very audit's 'expected' column was scored against, and four of its role rows are wrong.
- **Repro:** 1) psql: BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"a-001","role":"authenticated","app_role":"agent","agentId":"a-001"}',true); SELECT count(*) FROM distributors; ROLLBACK; 2) Returns 0; docs/role-permissions.md says it should return the singleton row.
- **Evidence:** docs/role-permissions.md states: 'All authenticated roles read distributors: distributors_select USING (true) lets the singleton row resolve for every dashboard''s Operated by ... attribution', and the per-role table lists 'read-only of the singleton distributors row' for subscriber, agent and branch. Migration 0081 replaced that with admin-only + distributor-self.\n\npsql probes:\nR41 subscriber SELECT distributors || OK || 0\nR42 agent SELECT distributors || OK || 0\nR43 branch SELECT distributors || OK || 0\nR39 employer SELECT distributors || OK || 0\nX04d d-001 reads d-002 distributor row || OK || 0\nLive: distributor sees 1 (own), admin sees 3.\n\nCallers checked: grep -rn "useEntity('distributor'" src/ returns only src/dashboard/settings/Settings.jsx:37, src/dashboard/overview/Distr
- **Suggested fix (NOT applied):** Correct the four role rows in docs/role-permissions.md, or restore a narrow distributors_select_attribution policy (id + name only) if the 'Operated by ...' line is still wanted on the non-distributor shells. · effort S

### A02-008 · anon reads of 15 tables return HTTP 401 naming an internal helper function instead of an empty result set
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A02 / error-handling / database/grants + PostgREST
- **Location:** `missing EXECUTE grant to anon on public.subscriber_agent_id(), public.current_distributor_id(), public.distributor_branch_ids()`
- **Roles:** anon
- **Impact:** Fail-closed -- no data leaks, and tables whose policies contain no helper (money_nonces, settlement_uploads, ...) correctly return HTTP 200 []. But the response leaks internal schema identifiers and a literal 'GRANT ...' hint to unauthenticated callers, and it is a 401 rather than an empty set: src/services/supabaseClient.js:131-137 (isSupabaseAuthError) treats status === 401 as token expiry and forwardSupabaseAuthError() clears the auth keys and forces a logout+redirect to '/'. Not reproduced end-to-end because no current anon code path reads these tables (the landing/signup flow only reads districts/regions and calls the three anon-granted RPCs), so the logout interaction is reasoned, not observed.
- **Repro:** 1) curl -s -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" "$VITE_SUPABASE_URL/rest/v1/subscribers?select=id&limit=2" 2) Returns HTTP 401 {"code":"42501","message":"permission denied for function subscriber_agent_id"} rather than 200 [].
- **Evidence:** $ node a02_http.mjs\nA1 anon GET districts :: HTTP 200 :: [{"id":"d-buikwe"}, {"id":"d-bukomansimbi"}]\nA2 anon GET subscribers :: HTTP 401 :: {"code":"42501","details":null,"hint":null,"message":"permission denied for function subscriber_agent_id"}\nA3 anon GET transactions :: HTTP 401 :: {"code":"42501","message":"permission denied for function subscriber_agent_id"}\nA4 anon GET money_nonces :: HTTP 200 :: []\nA5 anon GET entity_status_log :: HTTP 401 :: {"code":"42501","hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.entity_status_log TO anon;","message":"permission denied for table entity_status_log"}\nA6 anon GET users :: HTTP 401 :: {"code":"42501","hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.users TO ano
- **Suggested fix (NOT applied):** Either GRANT EXECUTE ON FUNCTION public.subscriber_agent_id(), public.current_distributor_id(), public.distributor_branch_ids() TO anon so anon reads return [] uniformly, or REVOKE the table-level grants from anon on those 15 tables so the denial is uniform and says nothing about the schema. · effort S

### A03-002 · Anon signup RPC trusts the client for phone canonicalization; a non-canonical phone makes the created account unreachable at login (falls to s-0001 default)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A03 / input-validation / database-rpc
- **Location:** `public._validate_signup_payload:32 + public._insert_subscriber_chain:78; api/auth/_lib/personas.ts:76,118`
- **Roles:** subscriber
- **Impact:** An account minted directly via the anon RPC with a bare/non-canonical phone is permanently unreachable by its owner — every login lands on the s-0001 demo default. NOT reachable through the demo UI: src/signup/contribution/ContributionRoute.jsx:78 canonicalizes via toCanonicalUGPhone before calling the RPC, so a live demo is not broken. Server-side hardening gap in the atomic-write authority only.
- **Repro:** 1) psql: read _validate_signup_payload (regex accepts bare 9-digit) and _insert_subscriber_chain:78 (stores payload->>'phone' verbatim) 2) psql: read api/auth/_lib/personas.ts resolveSubscriber (.eq('phone', canonicalPhone)) and ROLE_DEFAULTS.subscriber='s-0001' 3) Conclude: a subscriber row with a non-canonical phone can never be resolved at login
- **Evidence:** _validate_signup_payload line 32 accepts `^(\+?256)?[0-9]{9}$` (bare 9-digit allowed); _insert_subscriber_chain line 78 inserts `p_payload ->> 'phone'` verbatim. Login canonicalizes: api/_lib/phone.ts toCanonicalUGPhone -> '+256'+local9; api/auth/_lib/personas.ts:76 resolveSubscriber does .eq('phone', canonicalPhone).maybeSingle(); :118 on no match returns ROLE_DEFAULTS[role] = 's-0001'. A row stored as bare '799900001' never equals '+256799900001'. Anon PostgREST probe reaches the body (proving EXECUTE) and validation raises pre-write with subscriber count unchanged at 5064.
- **Suggested fix (NOT applied):** Canonicalize the phone inside the RPC (store +256XXXXXXXXX) rather than trusting the caller-supplied form, so the stored value always matches the login lookup. · effort S
- **Verification:** CONFIRMED — Spot-check. Code confirmed on both sides: the anon signup RPC accepts a bare 9-digit phone and stores it verbatim, while login always canonicalizes to +256 before the equality lookup, so a non-canonical stored row can never be resolved and falls to the s-0001 default. Correctly scoped low and correctly noted as NOT demo-reachable (ContributionRoute

### A03-003 · No length cap on subscriber text fields; anon signup RPC persists unbounded field values
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A03 / input-validation / database-rpc
- **Location:** `public._insert_subscriber_chain (INSERT INTO subscribers, fullName/phone/nin verbatim); subscribers.name/phone/nin/occupation/email columns`
- **Roles:** subscriber
- **Impact:** An unauthenticated caller (anon EXECUTE on create_subscriber_from_signup) can store arbitrarily large text values in subscriber rows, bloating the table without bound. DoS-adjacent. The rate-limit/OTP absence is EXCLUDED as demo scope; the unbounded field size is a distinct server-side gap.
- **Repro:** 1) psql: SELECT column_name, character_maximum_length FROM information_schema.columns WHERE table_name='subscribers' AND column_name IN ('name','phone','nin','occupation','email') -> all NULL (no cap) 2) psql: read _insert_subscriber_chain -> inserts payload->>'fullName'|'phone'|'nin' with no length check
- **Evidence:** information_schema.columns: subscribers.name/email/phone/nin/occupation are all data_type=text with character_maximum_length = NULL (no cap). Neither _validate_signup_payload nor _insert_subscriber_chain caps length; the chain writes `p_payload ->> 'fullName'|'phone'|'nin'` verbatim. Round-1 (00d / round1-backup §4b B6a) observed a 1,000,009-char name persist through this exact anon path; the write reproduction was classifier-blocked this round so the finding is code-confirmed, not re-reproduced.
- **Suggested fix (NOT applied):** Add explicit length guards in _validate_signup_payload (e.g. name/nin/occupation <= reasonable bounds) or column-level constraints on subscribers text fields. · effort S
- **Verification:** CONFIRMED — Spot-check. Confirmed: the five subscriber text columns have no length cap and the anon insert chain writes them verbatim. Correctly scoped low (DoS-adjacent, no demo/tenant impact).

### A04-012 · MIN_CONTRIBUTION / MIN_WITHDRAW of 5,000 and the zero-decimal UGX rule are client-only; the RPCs accept 1 UGX and 0.004 UGX
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A04 / validation / RPC
- **Location:** `src/constants/savings.js:12-13`
- **Roles:** subscriber
- **Impact:** A 1 UGX contribution passes, and a fractional amount persists a sub-shilling balance (671179.004) that every currency formatter would then have to round for display, breaking the zero-decimal invariant the codebase states explicitly. Note the sub-shilling case also mis-splits: round(0.004 * 80/100) = 0, so the whole amount lands in the emergency bucket rather than 80/20. Only reachable by a direct RPC call — the UI enforces both minimums.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -c "BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims','{\"app_role\":\"subscriber\",\"subscriberId\":\"s-0004\",\"role\":\"authenticated\"}',true); SELECT public.make_contribution('probe',0.004,80,'MTN'); RESET ROLE; SELECT total_balance FROM subscriber_balances WHERE subscriber_id='s-0004'; ROLLBACK;" 3) Observe 671179.004
- **Evidence:** src/constants/savings.js:11-13 declares `export const MIN_CONTRIBUTION = 5_000; export const MIN_WITHDRAW = 5_000;` and src/utils/finance.js:95-97 states 'UGX is a zero-decimal currency: the platform never stores sub-shilling amounts.' Neither is enforced server-side — the RPCs check only `p_amount <= 0`.

Probes inside BEGIN…ROLLBACK on s-0004:
======== G3 contribution amount = 1  -> accepted_amount = 1
======== G4 contribution amount = 0.004
 {"amount":0.004,"splitEmergency":0.004,"splitRetirement":0}
 total_balance 671179.004 | emergency_balance 134236.004 | units 427.121709321950900287768869
======== W4 withdrawal 4999  -> accepted = 4999
======== POST-ROLLBACK RE-READ: 671179 | 536943 | 134236 | 427.1217067764500730
- **Suggested fix (NOT applied):** Add `IF p_amount < 5000 THEN RAISE EXCEPTION 'amount is below the 5,000 UGX minimum' USING ERRCODE='P0001'; END IF;` and `IF p_amount <> round(p_amount) THEN RAISE EXCEPTION 'amount must be whole shillings'; END IF;` to make_contribution and request_withdrawal, so the constants in src/constants/savings.js have a server-side counterpart. · effort S

### A04-013 · request_withdrawal writes a POSITIVE transactions.amount while all 5,402 historical withdrawal rows are negative
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A04 / data-consistency / ledger
- **Location:** `public.request_withdrawal:77-83`
- **Roles:** subscriber, admin
- **Impact:** Balances are unaffected — trg_transactions_withdrawal defensively uses ABS(NEW.amount) — and the read path normalises too (src/services/subscriber.js:339 maps withdrawals to -Math.abs, and src/utils/finance.js:143 txDisplayAmount forces the sign by type). The live aggregate RPCs I checked (get_platform_overview, get_entity_metrics_rollup) also use SUM(ABS(amount)) for withdrawals. So the impact today is confined to any consumer that sums the raw signed column — a psql export, an ad-hoc report, or a future aggregate written without the ABS. But the stated invariant 'withdrawals are stored negative' is now false, and 0105's backfill walk depends on it (it branches on r.amount >= 0), so a re-run of that walk would treat this row as a contribution.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select id, amount, date, txn_ref from transactions where type='withdrawal' and amount>0;"
- **Evidence:** $ psql -At -F'|' -c "select status, sign(amount) as sgn, count(*), sum(amount) from transactions where type='withdrawal' group by 1,2 order by 1,2;"
paid|-1|3731|-39105087
processing|-1|1191|-12415196
processing|1|1|5000        <-- the one runtime-created row
settled|-1|480|-186671255
$ psql -x -c "select * from transactions where type='withdrawal' and amount>0;"
id tx-s-100117-wd-9d3276ed45564b3caead81d55fca579b | amount 5000 | date 2026-08-07 11:46:10 | txn_ref WD-965239 | bucket emergency
The RPC inserts `p_amount` (positive) at lines 77-83; the seed writes negatives. 0105's own header states 'Withdrawals are stored NEGATIVE'.
$ psql -At -F'|' -c "select 'signed', sum(amount) from transactions where type='withdrawal' union all select 'abs', -sum(abs(amount)) from transactions where type
- **Suggested fix (NOT applied):** Change request_withdrawal to insert -ABS(p_amount) so the runtime path matches the 5,402 historical rows and 0105's documented convention, or add a CHECK constraint `CHECK (type <> 'withdrawal' OR amount <= 0)` to make the invariant enforceable. Fix the one existing positive row at the same time. · effort S

### A04-014 · The admin publish form computes the price move against currentNav while the RPC computes it against the price preceding p_nav_date; for a back-dated publish the two disagree
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A04 / ui-server-mismatch / admin NAV page
- **Location:** `src/admin-dashboard/nav/AdminNavDesktop.jsx:128-130`
- **Roles:** admin
- **Impact:** For any back-dated publish the confirm dialog quotes a different move, a different baseline price and a different baseline date than the RPC actually used, and the >10% confirm gate can fire on one side but not the other. The server gate is authoritative so nothing unsafe gets through, but the admin is shown a figure that is not the one being evaluated — on the screen whose entire job is to make a price change legible before it revalues 5,060 members.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) sed -n '128,133p' src/admin-dashboard/nav/AdminNavDesktop.jsx 3) Sign in as admin-001 / Demo1234, open the Unit price page, set the date to 2026-08-05 and the price to 1600, and compare the on-screen move with the RPC's changePct
- **Evidence:** Client (AdminNavDesktop.jsx:128-130):
  const movePct = priceIsUsable && d?.currentNav ? ((typedPrice - d.currentNav) / d.currentNav) * 100 : null;
  // d.currentNav is the NEWEST published price, regardless of the date being published
Server (publish_nav_snapshot live body lines 30-36):
  SELECT unit_price, nav_date INTO v_prev_price, v_prev_date FROM public.nav_snapshots
   WHERE fund_code = p_fund_code AND status = 'published' AND nav_date < p_nav_date
   ORDER BY nav_date DESC LIMIT 1;
  v_move := round(((p_unit_price - v_prev_price) / v_prev_price) * 100, 4);
Measured divergence — publishing 2026-08-05 at 1600 (probe P5, rolled back):
  server returned "changePct": 2.2351, "previousUnitPrice": 1565.02, "previousNavDate": "2026-08-03"
  client would have shown (1600 - 1571.4)/1571.4 = 
- **Suggested fix (NOT applied):** Derive the baseline client-side from the loaded register rows the page already has: find the newest published row with navDate < formState.navDate and compute movePct against that, falling back to currentNav only when the form date is today. The rows are already in history.data.rows (the same source duplicateRow uses at :137-140), so this needs no extra round-trip. · effort S

### A04-015 · The NAV publish form's default date uses UTC, so between 00:00 and 03:00 East Africa Time it defaults to yesterday
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A04 / timezone / admin NAV page
- **Location:** `src/admin-dashboard/nav/AdminNavDesktop.jsx:110`
- **Roles:** admin
- **Impact:** An admin publishing between midnight and 3am EAT gets the form pre-filled with yesterday's date. If a price for yesterday already exists the publish silently CORRECTS it rather than adding today's, and because a newer row may exist the RPC returns revalued:false — the book is not repriced and the toast says 'Today's prices are unchanged because a newer price is already published.' The same offset makes the future-date guard reject a legitimate same-day publish during that window. The server's own guard uses CURRENT_DATE in the database's timezone, so client and server can disagree about what 'today' is.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) sed -n '110,120p' src/admin-dashboard/nav/AdminNavDesktop.jsx 3) node -e "const d=new Date('2026-08-24T01:30:00+03:00'); console.log('UTC slice:', d.toISOString().slice(0,10), '| Kampala:', new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala'}).format(d));" 4) Prints 'UTC slice: 2026-08-23 | Kampala: 2026-08-24'
- **Evidence:** src/admin-dashboard/nav/AdminNavDesktop.jsx:110
  const todayIso = new Date().toISOString().slice(0, 10);
Used at :116 to seed the form's navDate and at :182 as the future-date guard:
  navDate: todayIso,
  if (formState.navDate > todayIso) { setFormError('You cannot set a price for a day that has not happened yet.'); return; }
Uganda is UTC+3 with no DST, so for the first three hours of every local day toISOString() yields the previous calendar date.
- **Suggested fix (NOT applied):** Derive the date in the Africa/Kampala zone rather than UTC, e.g. new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(new Date()), which yields an ISO-shaped YYYY-MM-DD directly. Apply the same helper anywhere else the app compares a user-entered date against 'today'. · effort S

### A05-010 · The agent's partial-settlement banner shows an internal 34-character batch UUID instead of the human payment reference
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A05 / copy / ui
- **Location:** `src/agent-dashboard/pages/commissions/CommissionsParts.jsx:149 (and the mailto body at :132)`
- **Roles:** agent
- **Impact:** A 34-character opaque identifier is surfaced to a low-literacy agent audience and pasted into the 'Ask for reason' support mailto, where back-office staff would also have to translate it. The batch already carries a human payment reference that is displayed one section below in the Settlement history table.
- **Repro:** 1) Sign in as agent a-001 and open Commissions. 2) Read the partial-settlement banner: it cites 'ref sb-09258a3b9cc94064be51e0a6f0a04fa5'. 3) Compare with the Settlement history table below, which shows the readable reference E2E-PARTIAL-1785752804482 for the same batch.
- **Evidence:** Rendered on /dashboard/commissions as persona a-001 (screenshot a05-agent-commissions-desktop.png):
  'UGX 5K paid against UGX 15K due — UGX 10K is still outstanding (ref sb-09258a3b9cc94064be51e0a6f0a04fa5).'
Code: `— {formatUGX(shortfall)} is still outstanding (ref {batch.id}).` — batch.id, not batch.txnRef. The same row's txn_ref is 'E2E-PARTIAL-1785752804482' (production shape: 'MM-…'), which is what a mobile-money payer would recognise.
- **Suggested fix (NOT applied):** Render batch.txnRef in the banner and the mailto body, falling back to batch.id only when txnRef is null. · effort S

### A05-011 · parseAmount misparses formula and scientific-notation money cells into plausible-looking amounts, and returns 0 in violation of its own contract
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A05 / correctness / ui
- **Location:** `src/utils/finance.js:110-122`
- **Roles:** distributor, admin
- **Impact:** A spreadsheet cell that Excel stored as a formula string, or a value in scientific notation, becomes a real settlement amount (UGX 11, UGX 19) rather than being rejected as unparseable — a distributor would never notice the difference between 11 and a rejected row. The 0 return reaches the RPC and is skipped as amount_too_low, so nothing breaks today, but the documented contract is violated. The accepted '=cmd|calc' Agent ID is the classic spreadsheet formula-injection shape.
- **Repro:** 1) Put =1+1 in the 'Amount Paid (UGX)' cell of a settlement template and upload it. 2) The row is accepted with amountPaid 11 rather than skipped as no_amount.
- **Evidence:** node u/rt2.mjs (direct probes of the shipped function):
  parseAmount("=1+1")             = 11
  parseAmount("1e9")              = 19
  parseAmount("0.4")              = 0
  parseAmount("UGX 20,000")       = 20000
  parseAmount("20 000")           = 20000
  parseAmount("4999.6")           = 5000
  parseAmount("lots")             = null
  parseAmount("-5") / ("0") / ("") = null
The `[^\d.-]` strip at :117 turns '=1+1' into '11' and '1e9' into '19'. The `n <= 0` guard at :120 runs BEFORE Math.round, so 0.4 survives it and the function returns 0 despite documenting 'a whole-UGX integer > 0'.
Related, same parse path (node u/rt.mjs): '6c3 formula-injection :: accepted=[{"agentId":"=cmd|calc","amountPaid":11,…}]'.
- **Suggested fix (NOT applied):** Reject any cell that is not cleanly numeric after stripping only currency symbols and group separators (validate with a strict regex instead of character-class deletion); move the positivity check after Math.round so 0.4 returns null. · effort S

### A05-012 · A commission rate of 0 is accepted and generates UGX 0 commission rows instead of no commission
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A05 / correctness / rpc
- **Location:** `supabase/migrations/0089_per_distributor_commission_rate.sql:107 (IF p_rate < 0 OR p_rate > v_rate_max) · trg_transactions_contribution (IF v_commission_rate IS NOT NULL)`
- **Roles:** distributor, admin, agent
- **Impact:** An operator who legitimately configures 'no commission' gets a ledger full of UGX 0 due lines, inflating every 'N commissions owed' count and every agent's record count on the Commissions surfaces. Not present in live data (all 5001 rows are 5000 UGX).
- **Repro:** 1) As distributor d-001 call set_commission_rate(0). 2) Create a subscriber under one of that distributor's agents and post their first contribution. 3) A commission row is created with amount 0 and status due.
- **Evidence:** psql "$SUPABASE_DB_URL" -X -q -f t_rate2.sql (BEGIN..ROLLBACK):
 zero_rate_allowed | 0
 rate_for_bui      | 0
psql "$SUPABASE_DB_URL" -X -q -f t_zero.sql (BEGIN..ROLLBACK; set cfg-d-001 rate to 0, create a subscriber under a-001, insert a contribution):
        phase         |     id     | agent_id | subscriber_id | amount | status
 ----------------------+------------+----------+---------------+--------+--------
  zero_rate_commission | c-01000122 | a-001    | a05-zero-sub  |      0 | due
The trigger's guard is IF v_commission_rate IS NOT NULL — 0 is not NULL, so a zero-value row is inserted.
- **Suggested fix (NOT applied):** Either reject p_rate = 0 in set_commission_rate with a clear message, or change the trigger guard to IF v_commission_rate IS NOT NULL AND v_commission_rate > 0. · effort S

### A05-013 · Re-assigning a subscriber to a different agent generates a second commission for the same subscriber
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A05 / correctness / db
- **Location:** `public.trg_transactions_contribution (dedupe guard keyed on subscriber_id AND agent_id) · ux_commissions_agent_subscriber`
- **Roles:** agent, distributor, admin
- **Impact:** The 'exactly one commission per onboarding' invariant is keyed on (subscriber, agent) rather than on subscriber, so a re-assignment plus a contribution pays a second 5,000 UGX onboarding commission for the same member. Latent: no UI path in the repo re-assigns agent_id (0060's deactivation sets it to NULL, which is safe), and live data has zero subscribers with more than one commission.
- **Repro:** 1) Take a subscriber that already has a commission under agent A. 2) UPDATE subscribers SET agent_id = <agent B> for that subscriber (any role other than subscriber). 3) Insert another contribution. A second commission row is created under agent B.
- **Evidence:** psql "$SUPABASE_DB_URL" -X -q -f t_second_contrib.sql (BEGIN..ROLLBACK):
 before               | 1        (s-0004 has one commission)
 after_second_contrib | 1        <-- a SECOND contribution under the SAME agent creates nothing (correct)
 after_reassign:
  c-00004    | a-001 | b-bui-001 | s-0004 | 5000 | paid
  c-01000106 | a-042 | b-buv-007 | s-0004 | 5000 | due    <-- second commission after UPDATE subscribers SET agent_id='a-042'
Guard text (live pg_get_functiondef): IF NOT EXISTS (SELECT 1 FROM public.commissions WHERE subscriber_id = NEW.subscriber_id AND agent_id = v_agent_id).
trg_subscribers_enforce_editable_cols blocks agent_id edits only when app_role='subscriber' (IF v_role IS DISTINCT FROM 'subscriber' THEN RETURN NEW).
Live data: psql … -c "select count(*) from (select subsc
- **Suggested fix (NOT applied):** If a subscriber may only ever generate one onboarding commission, key the guard (and the unique index) on subscriber_id alone; otherwise document the re-assignment case explicitly and gate agent_id changes behind an RPC that decides whether a new commission is owed. · effort M

### A06-012 · Six of eight employers and distributor d-003 have no sign-in path
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A06 / data-integrity / sign-in / demo_personas
- **Location:** `public.demo_personas vs public.employers, public.distributors`
- **Roles:** employer, distributor, admin
- **Impact:** Each of those employers has a real contact_phone in the employers table (+256700000032..37), so a rep who reads the phone off the admin employer list and tries to sign in as that employer lands on emp-001 (Nile Breweries) via ROLE_DEFAULTS, silently, inside the wrong tenant. Same for d-003 -> d-001. This is the documented demo fallback rather than a regression, but it means the ROLE_DEFAULTS path is the NORMAL path for six of eight employers, which is precisely the condition A06-005 exploits.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select 'employer', e.id, e.name from public.employers e where not exists (select 1 from public.demo_personas p where p.role='employer' and p.entity_id=e.id) union all select 'distributor', d.id, d.name from public.distributors d where not exists (select 1 from public.demo_personas p where p.role='distributor' and p.entity_id=d.id);"
employer|emp-002|Mbarara Dairy Co-op
employer|emp-003|Gulu Traders Union
employer|emp-004|Jinja Steel Mills
employer|emp-005|Mbale Coffee Collective
employer|emp-006|Wakiso Agro Ltd
employer|emp-007|Lira Cotton Ginnery
distributor|d-003|Karamoja Pilot Network

$ psql ... -c "select id, phone, role, entity_id, label from public.demo_personas order by role, id;"
dp-a-001|+256700000001|agent|a-001|Default agent (Kampal
- **Suggested fix (NOT applied):** Seed a demo_personas row for every employer and distributor the seed creates (the seed already knows their contact phones), so 'sign in as this employer' works for any row the admin list shows. If some are deliberately login-less, mark them in the admin UI so a rep does not try. · effort S

### A06-013 · 39 of 54 users rows carry no entity_id
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A06 / data-hygiene / public.users
- **Location:** `api/auth/verify-otp.ts:67-99 (upsertUser)`
- **Roles:** admin
- **Impact:** Not a functional defect — these are login breadcrumbs, not broken provisioning, and the 0101 identity contract holds live (approve_access_request / create_employer / create_distributor all call register_login_identity; the one approved access_request has matching users AND demo_personas rows with the correct entity_id; all 9 demo_personas have a matching users row; zero dangling entity_id). But the table is now 72% noise, which makes any future audit of sign-in identity harder to read and hides real anomalies like the +256700000011 collision.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select role, count(*) from public.users where entity_id is null group by 1 order by 2 desc;"
subscriber|13
admin|12
distributor|6
employer|4
branch|2
agent|2

Cause — api/auth/verify-otp.ts:67-99 upserts a users(phone, role) row on EVERY sign-in with no entity_id:
  .from('users').upsert(patch, { onConflict: 'phone,role' })

They are inert: subscriber logins resolve via subscribers.phone (api/auth/_lib/personas.ts:76-88), non-subscriber logins via demo_personas (ibid. :96-110); neither reads users.entity_id.

No dangling references:
$ psql ... -c "select u.id, u.role, u.entity_id from public.users u where u.entity_id is not null and ((u.role='agent' and not exists (select 1 from public.agents a where a.id=u.entity_id)) or (u.role='branch' and n
- **Suggested fix (NOT applied):** Prune users rows with NULL entity_id that carry no password_hash and have never been used for a real persona, or stop writing the row until an entity is resolved. If the row is needed for password storage, at least stamp the resolved entity_id from the same resolution the JWT uses. · effort S

### A06-014 · request_withdrawal writes a positive amount against a negative seed convention
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A06 / data-integrity / transactions ledger
- **Location:** `public.request_withdrawal (INSERT INTO public.transactions ... 'withdrawal', p_amount, ...)`
- **Roles:** subscriber
- **Impact:** Every live demo withdrawal writes a row whose sign contradicts the 4,936 seeded rows. Balances stay correct (the trigger uses ABS) and every known reader normalises, so nothing is currently wrong on screen — but any future consumer that does a plain SUM(amount) over the ledger will count a withdrawal as an inflow, and the mixed convention makes hand-inspection of the ledger misleading.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -c "select count(*) from public.transactions where type='withdrawal' and amount > 0;"
1
$ psql ... -c "select id, subscriber_id, amount, date, status, method, bucket, txn_ref, created_at from public.transactions where type='withdrawal' and amount>0;"
tx-s-100117-wd-9d3276ed45564b3caead81d55fca579b|s-100117|5000|2026-08-07 11:46:10.825511+00|processing|Airtel Money|emergency|WD-965239|2026-08-07 11:46:10.825511+00
(all 4,936 seeded withdrawal rows are negative; src/data/employerSeed.js:284 writes `amount: -Math.abs(amount)`)

The RPC body (pg_proc.prosrc, verbatim):
  INSERT INTO public.transactions (
    id, subscriber_id, type, amount, date, status, method,
    txn_ref, bucket, split_retirement, split_emergency, source
  ) VALUES (
    v_tx_id, v_subscr
- **Suggested fix (NOT applied):** Insert -p_amount (or -ABS(p_amount)) in request_withdrawal so runtime rows match the seed, and keep the ABS defences in place. Add an invariant to e2e/specs/db/invariants.spec.ts: zero withdrawal transactions with amount > 0, zero contribution transactions with amount <= 0. · effort S

### A06-015 · 21 employer-member contribution schedules have amount = 0 and a NULL next_due_date
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A06 / data-integrity / subscriber Schedule page for employer-channel members
- **Location:** `public.contribution_schedules for empe-001 .. empe-021`
- **Roles:** subscriber, employer
- **Impact:** An employer-channel member's Schedule screen has a 0 UGX amount and no next due date, because their money arrives through the employer payroll run rather than a personal schedule. That is arguably correct domain-wise, but the row exists and renders, so the member sees an empty/zero schedule rather than an explanatory employer-funded state. It also makes these 21 rows invisible to the only guard that checks schedule freshness.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select count(*) filter (where retirement_pct + emergency_pct <> 100) bad_split, count(*) filter (where amount is null) null_amt, count(*) filter (where amount <= 0) nonpos_amt, count(*) filter (where next_due_date is null) null_due, count(*) from public.contribution_schedules;"
0|0|21|21|5022

$ psql ... -c "select subscriber_id, frequency, amount, retirement_pct, emergency_pct, include_insurance, insurance_choice_made, next_due_date, insurance_funding_mode, updated_at from public.contribution_schedules where next_due_date is null order by subscriber_id;"
empe-001|monthly|0|80|20|f|f||pay_now|2026-07-27 14:26:06.958998+00
empe-002|monthly|0|80|20|f|f||pay_now|2026-07-27 14:26:06.958998+00
... (empe-003 .. empe-021, identical)

These are exactly
- **Suggested fix (NOT applied):** Either do not create a contribution_schedules row for employer-funded members (and have the Schedule page render an 'Your employer pays on your behalf' state when none exists), or populate next_due_date from the employer's payroll_cadence so the screen shows the real next payroll date. Whichever is chosen, make invariant #5 assert the NULL count explicitly. · effort S

### A06-016 · Mass-detach guard passes 50-row batches unjournalled
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A06 / correctness / public.subscribers UPDATE path
- **Location:** `public.guard_mass_subscriber_detach (v_threshold constant integer := 50)`
- **Roles:** admin, distributor
- **Impact:** The trigger is AFTER UPDATE ... FOR EACH STATEMENT with threshold '> 50', so 101 statements of 50 rows each would detach all 5,001 subscriber->agent links without tripping it. The 0060 incident was a single 5,003-row statement, so the guard does close the observed hole; this is a documented limitation rather than a regression, but it is worth recording that the protection is per-statement, not cumulative.
- **Evidence:** The guard DOES fire on both legs (this is the good news, tested and rolled back):
$ psql "$SUPABASE_DB_URL" -X -q -At -c "select count(*) from public.subscribers where agent_id is not null;"
5001
$ psql ... -v ON_ERROR_STOP=0 <<'SQL'
BEGIN;
UPDATE public.subscribers SET agent_id = NULL WHERE id IN (SELECT id FROM public.subscribers WHERE agent_id IS NOT NULL ORDER BY id LIMIT 60);
ROLLBACK;
SQL
ERROR:  mass agent detach blocked: 60 of 60 rows unjournalled — use set_distributor_status()
CONTEXT:  PL/pgSQL function guard_mass_subscriber_detach() line 20 at RAISE
$ psql ... -c "select count(*) from public.subscribers where agent_id is not null;"
5001

Employer leg too:
BEGIN; UPDATE public.subscribers SET employer_id = NULL WHERE employer_id IS NOT NULL; ROLLBACK;
ERROR:  mass employer detach
- **Suggested fix (NOT applied):** Optionally add a cumulative check: if the count of unjournalled detaches within a short window (say entity_detach_log-less agent_id nulls in the last 5 minutes) exceeds a budget, raise. Lower-cost alternative: document the per-statement scope in the trigger comment so a future reader does not assume cumulative protection. · effort M

### A06-017 · E2E entity residue across six tables, including a branch invisible to every distributor
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A06 / data-hygiene / admin branch list, admin subscriber list, entity status log
- **Location:** `public.branches tst-branch-msc7w8vm; public.subscribers s-e2e-emp-foreign-1785752999757; public.entity_status_log; public.contribution_run_uploads / settlement_uploads / subscriber_signup_uploads`
- **Roles:** admin, distributor
- **Impact:** Test litter is visible on admin surfaces: 'TST throwaway branch' appears in the branch list with a NULL distributor_id, making it the one branch of 321 that belongs to no distributor and is therefore invisible to every distributor-scoped rollup while still counting in country totals. 'E2E Foreign Member (RLS probe)' appears in unscoped subscriber lists. entity_status_log is 100% E2E rows (64 of 64), one pair never restored. Three idempotency-nonce ledgers grow monotonically (33 / 153 / 98) because none of them is ever cleaned.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select b.id, b.name, b.district_id, b.status, b.created_at, b.distributor_id, (select count(*) from public.agents a where a.branch_id=b.id) agents from public.branches b where b.distributor_id is null;"
tst-branch-msc7w8vm|TST throwaway branch|d-buikwe|active|2026-08-02 19:53:04.628663+00||0

$ psql ... -c "select id,name,phone,agent_id,employer_id,district_id,kyc_status,is_active,is_demo_signup,created_at from public.subscribers where id like 's-e2%';"
s-e2e-emp-foreign-1785752999757|E2E Foreign Member (RLS probe)|+2567000099907|||||complete|t|f|2026-08-03 10:30:00.004968+00

$ psql ... -c "select 'subscribers', count(*) from public.subscribers where id like 'tst-%' or id like 's-e2e%' union all select 'branches', count(*) from public.branches
- **Suggested fix (NOT applied):** DELETE the tst-* branch and the s-e2e-* subscriber (both have no dependent rows). Add nonce-ledger and entity_status_log cleanup to the relevant afterEach blocks (the deactivate-entities spec already knows the scope_id it created). Consider a scheduled purge of rows older than N days in the three *_uploads tables. · effort S

### A07-002 · agent-referral unauthenticated service-role INSERT (input-capped)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A07 / security / backend
- **Location:** `api/kyc/agent-referral.ts:118-140`
- **Impact:** stored-XSS source (render sink is A24); storage-spam bounded
- **Evidence:** no agentId field; phone canonicalised; all fields length-capped; writeLimiter 5/min
- **Suggested fix (NOT applied):** ensure render side escapes · effort ?

### A07-004 · Rate limiter IP-spoofable via X-Forwarded-For in no-proxy deployment (local only; prod trust-proxy:1 mitigates)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A07 / security / backend
- **Location:** `server/index.ts:88 trust proxy:1`
- **Impact:** local dev bypass; prod fragile if hop count changes
- **Evidence:** local: 12 rotating-XFF POSTs all 200, never 429; prod likely safe (Render single-hop appends real IP)
- **Suggested fix (NOT applied):** pin limiter keyGenerator to trusted source + assert hop count · effort ?

### A09-010 · /healthz and /readyz are registered before morgan, so all health and readiness traffic is invisible in the logs
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A09 / observability / api
- **Location:** `server/index.ts:110 and :128 (routes) vs :196-197 (app.use(morgan(...)))`
- **Roles:** all
- **Impact:** You cannot tell from the log stream whether the keepalive is running or whether /readyz has been failing — precisely the two signals needed to diagnose A09-001. Separately, that single 404 shows something external is polling /api/health, a path that does not exist (the 16 mounted routes are at server/index.ts:255-270), so whatever monitor that is has been recording a 404 as 'up'.
- **Repro:** 1) curl https://uganda-dashboard-api.onrender.com/healthz and /readyz several times 2) mcp__render__list_logs over the same window → none of those requests appear 3) Read server/index.ts: routes at :110/:128 precede app.use(morgan(...)) at :196
- **Evidence:** $ grep -n "morgan\|app.use(\|app.get(" server/index.ts | head
52:import morgan from 'morgan';
110:app.get('/healthz', cors(corsOptions), (_req, res) => {
128:app.get('/readyz', cors(corsOptions), async (_req, res) => {
154:app.use(helmet());
196:app.use(
197:  morgan(':method :url :status :response-time ms - :res[content-length]')

$ mcp__render__list_logs resource=[srv-d8bc20mgvqtc73afh16g] 2026-08-22T00:00:00Z .. 2026-08-23T10:45:00Z limit=50
{"hasMore":false,"logs":[{"message":"GET /api/health 404 0.572 ms - 20","timestamp":"2026-08-23T08:27:26.209990382Z","labels":[..."level":"info","type":"app"]}]}
(exactly ONE app log line in 34 hours, despite ~60 keepalive pings, my own /healthz and /readyz probes, and the browser's /readyz calls)
- **Suggested fix (NOT applied):** Register morgan before the health routes — it adds one log line per ping and no meaningful bytes to the response body, preserving the ~1 KB budget the /healthz comment is protecting. Repoint whatever external monitor is hitting /api/health at /readyz. · effort S

### A09-011 · CI installs with --legacy-peer-deps while Render installs with plain npm ci; the flag is unnecessary and masks future peer breaks
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A09 / config-drift / infra/ci
- **Location:** `.github/workflows/test.yml (both jobs: `npm ci --legacy-peer-deps`) vs live Render buildCommand `npm ci``
- **Roles:** all
- **Impact:** CI can go green on a dependency tree that Render's stricter install would reject, and the flag permanently suppresses the peer-conflict signal for any future bump. Benign today (proven: no conflict exists, and Render's plain npm ci built successfully), but it is exactly the class of drift that only surfaces during a deploy. The user's working-tree package.json/package-lock.json were NOT modified — the probe ran on scratchpad copies.
- **Repro:** 1) Copy HEAD:package.json to a scratch dir with no lockfile 2) npm install --package-lock-only --dry-run --strict-peer-deps → succeeds, no peer error 3) Confirm the live Render build used plain `npm ci` and succeeded (mcp__render__list_deploys)
- **Evidence:** $ grep -n "npm ci" .github/workflows/test.yml
        run: npm ci --legacy-peer-deps          (lint-and-unit job)
        run: npm ci --legacy-peer-deps          (e2e job)

$ mcp__render__get_service srv-d8bc20mgvqtc73afh16g → "buildCommand": "npm ci && npm run build:api && npm prune --omit=dev"
$ mcp__render__list_deploys → dep-d9tfvju417fc73eb1igg, commit bd637f63, status "live", finishedAt 2026-08-11T10:57:30Z   (built successfully with plain `npm ci`)

$ git show HEAD:package.json > $SP/package.json && rm -f $SP/package-lock.json
$ cd $SP && npm install --package-lock-only --dry-run --strict-peer-deps --no-audit --no-fund
npm warn EBADENGINE Unsupported engine { required: { node: '22.x' }, current: { node: 'v24.14.0' } }
up to date in 1m
(strict peer resolution from scratch on the comm
- **Suggested fix (NOT applied):** Drop --legacy-peer-deps from both CI jobs so CI and Render install identically. · effort S

### A09-012 · @sentry/react is a devDependency but is imported by code that ships to the browser
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A09 / manifest-correctness / frontend
- **Location:** `package.json devDependencies ("@sentry/react": "^10.57.0"); imported at src/main.jsx:6 and src/components/ErrorBoundary.jsx:20`
- **Roles:** all
- **Impact:** Latent, not live — Vercel installs all dependencies, so the production build resolves the import today. Any build performed with --omit=dev (the posture Render's build already uses for the server half) would fail to resolve it. Also makes render.yaml:25's comment ('@sentry/* are devDeps') half-true in a way that could mislead a future maintainer into pruning @sentry/node.
- **Repro:** 1) Read package.json → @sentry/react sits under devDependencies 2) Read src/main.jsx:6 → it is a static import in browser-shipped code
- **Evidence:** $ python3 -c "import json;d=json.load(open('package.json'));..."
DEV (count 32):
  @sentry/react ^10.57.0        <-- devDependency
DEPENDENCIES:
  @sentry/node ^10.57.0         <-- correctly a prod dependency (Render prunes --omit=dev after build)

$ sed -n '6p' src/main.jsx
import * as Sentry from '@sentry/react';
$ sed -n '20p' src/components/ErrorBoundary.jsx
      import('@sentry/react').then((Sentry) =>
- **Suggested fix (NOT applied):** Move @sentry/react from devDependencies to dependencies. · effort S

### A09-013 · The repo's only typecheck skips every API test file; there is no root tsconfig and no pre-commit hook
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A09 / type-safety / infra/ci
- **Location:** `server/tsconfig.json (exclude); repository root`
- **Roles:** all
- **Impact:** npm run build:api is the only type gate in the repo, and it deliberately excludes 10+ TypeScript test files, so type drift in the API tests is caught by nothing. With no root tsconfig and no pre-commit hook either, the first feedback on any breakage is a CI run that never completes (A09-002).
- **Repro:** 1) cat server/tsconfig.json → api/**/*.test.ts and ./**/*.test.ts are excluded 2) find api server -name '*.test.ts' → 10+ files never type-checked 3) ls tsconfig*.json → none; ls .git/hooks | grep -v sample → none
- **Evidence:** $ cat server/tsconfig.json
  "exclude": ["../node_modules/**", "../dist/**", "../api/**/*.test.ts", "../api/**/*.spec.ts", "./**/*.test.ts"]

$ find api server -name "*.test.ts" | head
api/chat.test.ts  api/contact.test.ts  api/kyc/otp-verify.test.ts  api/kyc/nira-verify.test.ts
api/kyc/aml-screen.test.ts  api/kyc/id-ocr.test.ts  api/kyc/agent-referral.test.ts
api/kyc/id-quality.test.ts  api/kyc/otp-send.test.ts  api/kyc/face-match.test.ts

$ ls tsconfig*.json
(zsh): no matches found: tsconfig*.json

$ ls -a .husky 2>/dev/null || echo "no .husky"
no .husky
$ ls .git/hooks/ | grep -v sample || echo "no active git hooks"
no active git hooks
$ grep -n "husky\|lint-staged\|pre-commit\|prepare" package.json
(no output)
- **Suggested fix (NOT applied):** Add a second `tsc --noEmit` pass covering the excluded test files (or drop the excludes now that vitest type-strips them anyway), and consider a minimal pre-commit hook running eslint on staged files. · effort S

### A09-014 · SUPABASE_URL is absent from .env.local and local dev survives only on a fallback the code says is marked for removal
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A09 / env-config / infra/local
- **Location:** `.env.local (names only); server/env.ts:16,33`
- **Roles:** all
- **Impact:** The day someone completes the documented cleanup and removes the ?? VITE_SUPABASE_URL fallback, local `npm run dev:api` stops booting for anyone whose .env.local predates it — which is everyone's, today. assertServerEnv() would throw '[env] missing required server env vars: SUPABASE_URL'.
- **Repro:** 1) List the variable names in .env.local → SUPABASE_URL is not among them 2) Read server/env.ts:33 → boot succeeds only via the VITE_SUPABASE_URL fallback 3) Read the comment at server/env.ts:14-16 and .env.local.example:41 → both state the fallback is scheduled for removal
- **Evidence:** $ grep -oE '^[A-Za-z_][A-Za-z0-9_]*' .env.local | sort      # NAMES ONLY, no values read (G2)
PORT
RENDER_DEPLOY_HOOK
SUPABASE_DB_URL
SUPABASE_JWT_SECRET
SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_URL
VITE_USE_SUPABASE
(no SUPABASE_URL)

$ sed -n '14,16p;33p' server/env.ts
// `SUPABASE_URL` is the new server-side name (G19). During the Vercel
// → Render cutover we still accept `VITE_SUPABASE_URL` as a fallback —
// once every deploy has the renamed var, the fallback can drop in a follow-up.
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;

$ sed -n '41p' .env.local.example
# removal — set SUPABASE_URL so local `npm run dev:api` keeps booting once it's gone.
- **Suggested fix (NOT applied):** Add SUPABASE_URL to .env.local (it is already in the .env.local.example template) before the fallback is removed. · effort S

### A10-004 · On mobile, all 5 report sub-views share the same <h1> ('Analytics')
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A10 / accessibility / subscriber /dashboard/reports/* at <=768px
- **Location:** `src/subscriber-dashboard/pages/ReportsPage.jsx (mobile app-bar title) / shell app-bar`
- **Roles:** subscriber
- **Impact:** Distinct pages sharing one h1 is a minor screen-reader / heading-navigation wrinkle on mobile; non-blocking.
- **Repro:** 1) At 375px open each /dashboard/reports/* view 2) Inspect the h1 — always 'Analytics'
- **Evidence:** 375px sweep: /dashboard/reports/all-transactions, /contributions-summary, /withdrawals-history, /insurance-statement, /annual-statement all render h1='Analytics'; the report name appears only as an eyebrow (e.g. 'EVERY MOVEMENT IN YOUR ACCOUNT'). Desktop gives each view a distinct h1.
- **Suggested fix (NOT applied):** Set the mobile app-bar h1 to the active report's title on report sub-views. · effort S

### A11-007 · 'This month' resolves to two different calendar months on the same agent dashboard (Contributions=June 2026, Onboarded=August 2026)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A11 / consistency / agent /dashboard (home) + drill-down tiles
- **Location:** `src/agent-dashboard/home/agentHomeSummary.js deriveMonthAnchors (data-anchored) vs onboarded-this-month using created_at (real clock)`
- **Roles:** agent
- **Impact:** Two 'this month' tiles cite different months side by side, which reads as a data glitch in a demo.
- **Evidence:** Contributions page 'Payments logged · June 2026' (contributions-1440.png) vs Onboarded-this-month 'New subscribers · August 2026' (onboarded-this-month-1440.png), both reached from the same agent home. Cross-references the A06 multi-clock findings.
- **Suggested fix (NOT applied):** Anchor all 'this month' agent surfaces to one clock (the data-anchor or the MOCK_NOW clock consistently). · effort S

### A12-004 · Mobile 'reports' redirect lands on the overview instead of analytics (desktop is correct)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A12 / route-parity / branch reports redirect (mobile)
- **Location:** `src/branch-dashboard/shell/BranchMobileShell.jsx:37-63 (AnimatePresence mode="wait" + <Routes location={location}> containing reports Navigate)`
- **Roles:** branch
- **Impact:** Low — no in-app nav links to /dashboard/reports on either shell, so only a stale external deep link reaches it and it lands on a valid page (overview) rather than analytics. Confirmed parity defect and a latent fragility for any future in-route mobile redirect.
- **Repro:** 1) Sign in as b-kam-015 at 375px 2) Navigate to /dashboard/reports 3) Observe final URL /dashboard (overview) instead of /dashboard/analytics
- **Evidence:** Desktop direct /dashboard/reports FINAL URL = /dashboard/analytics. Mobile direct /dashboard/reports FINAL URL = /dashboard. URL-hop trace (a12-reports-trace.mjs): ['/dashboard/reports','/dashboard/reports','/dashboard/analytics','/dashboard','/dashboard/analytics','/dashboard'] FINAL /dashboard — the reports->analytics Navigate oscillates against the '*'->/dashboard catch-all and the catch-all wins.
- **Suggested fix (NOT applied):** Do not pass an animation-lagged location to a <Routes> that contains <Navigate> redirects; move the reports redirect outside the AnimatePresence subtree. · effort M

### A12-006 · Bulk agent onboarding (Excel/CSV) is desktop-only
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A12 / route-parity / branch create-agent
- **Location:** `src/branch-dashboard/desktop/AgentsDesktop.jsx:10-11,62-78 (BulkOnboardAgents) vs src/branch-dashboard/mobile/CreateAgentMobile.jsx`
- **Roles:** branch
- **Impact:** Low — bulk-onboarding agents from a spreadsheet is possible only on desktop; a reasonable phone omission but a genuine capability asymmetry between the two route tables.
- **Repro:** 1) Desktop: /dashboard/agents -> Add agent -> single + bulk tabs 2) Mobile: /dashboard/agents/new -> single form only
- **Evidence:** Desktop create mode has single + bulk tabs (CreateAgentForm + BulkOnboardAgents). Mobile /dashboard/agents/new is single-agent only: grep -i 'bulk|csv|excel|upload' CreateAgentMobile.jsx returns nothing.
- **Suggested fix (NOT applied):** Either add a bulk-upload entry to CreateAgentMobile or document the desktop-only scope; no correctness impact. · effort M

### A12-007 · Branch Settings 'Save changes' and mobile 'Update password' fabricate success without persisting
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A12 / ux-honesty / branch settings (desktop & mobile)
- **Location:** `src/branch-dashboard/desktop/SettingsDesktop.jsx:35; src/branch-dashboard/mobile/SettingsMobile.jsx:65,83`
- **Roles:** branch
- **Impact:** Low — branch profile editing is not a headline demo flow and matches the demo's mock-write pattern, but the toast claims a save that did not happen; a rep who edits the manager name and reloads finds it reverted.
- **Repro:** 1) Sign in as b-kam-015 -> Settings 2) Edit Manager name, click Save changes -> 'Branch profile saved.' 3) Reload -> edit is gone
- **Evidence:** handleSave = e.preventDefault(); addToast('success','Branch profile saved.') — no mutation/RPC. Mobile handleSaveProfile -> 'Branch profile saved.', handleUpdatePassword -> 'Password updated.' both toast-only. Edits revert on reload.
- **Suggested fix (NOT applied):** Wire a real update_branch mutation, or change the copy/CTA to indicate preview-only. · effort S

### A12-008 · Absurd '▲ 14903% over the year' on the branch overview & analytics
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A12 / data-credibility / branch overview + analytics contributions card
- **Location:** `src/branch-dashboard/overview/branchOverviewDerive.js:87-91 (monthlyContribStat.yoyPct)`
- **Roles:** branch
- **Impact:** Low — technically the true ratio, but a '▲14903%' badge reads as broken in a live demo.
- **Repro:** 1) Sign in as b-kam-015 2) Read overview 'Contributions — last 12 months' card: '▲ 14903% over the year'
- **Evidence:** yoyPct = (current - firstNonZero)/firstNonZero where firstNonZero is the seed ramp-up first month = 7,904 UGX (Jun'25) and current = 1,185,832 (May'26) -> 14,903%. Rendered on d-overview-1440.png ('UGX 1.2M ▲ 14903% over the year') and m-analytics-375.png.
- **Suggested fix (NOT applied):** Clamp/guard YoY when the base month is negligible, or compute YoY against a same-month-last-year value instead of the first non-zero bucket. · effort S

### A13-002 · Distributor mobile Branches/Agents lists show all-zero metrics (0 subs / 0 agents / 0 funds) for ~2-3s until the separate metrics query resolves
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A13 / loading-state / distributor mobile Branches & Agents lists (375px)
- **Location:** `src/dashboard/mobile/BranchesMobile.jsx:41-77 (list via useAllEntities, metrics via separate useAllEntitiesMetrics; spinner guard :80 covers only the list read); same pattern in AgentsMobile.jsx`
- **Roles:** distributor
- **Impact:** A rep who scrolls the Branches/Agents list in the first ~2-3s sees a network that looks empty (all zeros), then it self-corrects. Transiently misleading during a live demo.
- **Evidence:** a13-branches-load.mjs: early frame (~3.5s) summary '291 Branches / 0 Agents / 0 Funds', rows 'Buikwe Central 0 subs' (branches-375.png early). By ~3s metrics land: '@3000ms summary=291/1,872/1.95B | firstRow=Bukedea Central/41/71' and list re-sorts by subscriber count. Metric fields default to 0 when branchMetrics[b.id] is still empty rather than showing a skeleton.
- **Suggested fix (NOT applied):** Gate the metric count columns on useAllEntitiesMetrics isLoading (skeleton them) instead of defaulting to 0, or hold the list render until both queries resolve. · effort S

### A13-003 · CSV export 5,000-row mobile cap is unreachable for distributors (dead safeguard)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A13 / dead-code / distributor report CSV export
- **Location:** `src/utils/csvDownload.js:33 (MOBILE_ROW_CAP=5000, applied only when isMobile) via src/dashboard/reports/ReportView.jsx:72-88`
- **Roles:** distributor
- **Impact:** The 'cap at 5,000 + toast' safeguard can never trigger for the distributor role. Recorded so it is not mistaken for tested behaviour. (Platform total 5,064 would cap, but only admin's All-Subscribers export reaches that count.)
- **Evidence:** The cap fires only on a mobile UA reaching a report export, but the distributor reports route bounces on every sub-1024 viewport (A13-001) and d-001's largest export (All Subscribers) is 4,602 rows < 5,000. Desktop export verified with NO cap: a13-03-csv-map.mjs -> 'CSV DOWNLOAD file= all-subscribers-2026-08-24.csv dataRows= 4602'.
- **Suggested fix (NOT applied):** Once A13-001 is fixed the mobile cap becomes reachable; add an E2E on the mobile reports export asserting the cap toast at >5,000 rows (admin scope). · effort S

### A14-004 · Overview "Needs attention" mislabels combined group cover as "Group life cover"
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A14 / copy / Employer Overview (/dashboard) → Needs attention
- **Location:** `src/employer-dashboard/desktop/NeedsAttention.jsx`
- **Roles:** employer
- **Impact:** Minor copy inaccuracy on the dashboard; the amount is total cover, not life cover.
- **Evidence:** Overview shows 'Group life cover UGX 20.0M per member' but 20.0M = life 15.0M + health 5.0M combined (emp-001 config groupInsuranceProducts). The Insurance page correctly splits Life 15.0M / Health 5.0M. Screenshot: index-1440.png.
- **Suggested fix (NOT applied):** Rename to 'Group cover UGX 20.0M per member' or label from the enabled products. · effort S

### A15-004 · Mobile Agents list flashes "0 Subscribers · 0 Funds" before per-agent metrics resolve
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A15 / loading-state / admin (shared) — mobile Agents list
- **Location:** `src/dashboard/mobile/AgentsMobile.jsx:71-75 (totals reduce over a.metrics?.totalSubscribers/aum); isLoading guard at :80 doesn't cover the rows-loaded-metrics-pending window`
- **Roles:** admin, distributor
- **Impact:** Transient, self-correcting (~1-3s on the shared remote DB) but shows a '0 Funds' money figure on first paint of the Agents tab — a brief wrong-zero a rep could hit mid-demo.
- **Repro:** 1) At 375px sign in as admin 2) Open Agents — header reads '0 Subscribers 0 Funds' for ~1-3s, then corrects to 5,001 / 2.12B
- **Evidence:** scratch/a15-06 (@1.6s): `2,046 Agents  0 Subscribers  0 Funds` … `Dorothy Kiiza … 0 subs`. scratch/a15-07 (@5s): `2,046 Agents  5,001 Subscribers  2.12B Funds` … `Beatrice Mugisha … 12 subs`. SQL: subs-via-agent=5001, agent-channel AUM=2.125B. Screenshots screenshots/admin/m-agents-375.png vs m-agents-deep-375.png.
- **Suggested fix (NOT applied):** Show a skeleton/placeholder ('—') for the totals strip and per-row subs until metrics is present, rather than defaulting to 0. · effort S

### A16-002 · FAQ/Contact/About have no signup CTA in the 769-920px band; Navbar hamburger drawer is dead code
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A16 / responsive-ux / Public support pages (legacy Navbar)
- **Location:** `src/components/Navbar.module.css:220 (.cta display:none <=920) and :236 (.burger display:flex only <=768); Navbar.jsx imported only by FAQ.jsx/Contact.jsx/About.jsx`
- **Roles:** public/anonymous
- **Impact:** In the 769-920px band (real iPad-portrait widths 820/834), FAQ/Contact/About show neither the 'Start saving' CTA (hidden <=920) nor a menu button (burger only <=768, where the mobile shell replaces the header), and these page bodies carry no signup CTA. The Navbar's mobile drawer is unreachable dead code. Signup stays reachable via nav links -> home and 'Sign in' remains, so it is degraded-conversion polish, not a dead end. The in-code claim that the CTA 'stays reachable from the drawer' is structurally false on these routes.
- **Repro:** 1) Open http://localhost:5173/faq at 834px width 2) Header shows nav links + 'Sign in' but no 'Start saving' CTA and no hamburger button 3) Widen to 950px: 'Start saving' reappears; narrow to 768px: page becomes the mobile shell (which has its own action-bar CTA)
- **Evidence:** Command: node docs/audits/2026-08-23/scratch/a16/nav-band.mjs on /faq. Verbatim: width=950 startSaving.visible=true burger=false; width=900 startSaving.visible=false burger=false; width=800 startSaving.visible=false burger=false; width=769 startSaving.visible=false burger=false (signIn=true throughout). grep: Navbar imported only by FAQ/Contact/About; .burger's display:flex sits inside @media(max-width:768px). LandingLayout swaps the whole Navbar for LandingMobileShell at <=768px (useIsMobile MQ '(max-width:768px)'), so the burger breakpoint never actually renders.
- **Suggested fix (NOT applied):** Keep .cta visible below 920px (it fits — the CSS 'measured' note is stale), or raise the .burger breakpoint to 920px so the drawer covers the gap. Alternatively remove the now-unreachable Navbar drawer entirely. · effort S

### A17-004 · 280 hardcoded hex literals re-declare an existing token value (23x the brand indigo)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A17 / token-coverage-color / all roles (CSS modules)
- **Location:** `src/employer-dashboard/employees/OnboardStaffPanel.module.css (hardcodes #292867 x20) + others`
- **Roles:** employer, agent, subscriber, distributor, branch, admin
- **Impact:** CLAUDE.md §6 names #292867 the identity anchor; a brand shift would silently skip these 23+ hardcoded sites. Discipline debt, not a visible defect.
- **Evidence:** grep of module CSS: 280 hex literals equal a defined token value: 23x #292867 (--color-indigo), 11x #2E8B57 (--color-green), 6x #1B1A4A, 5x #2F8F9D, 4x #5E63A8, 2x #2F3550. Worst file OnboardStaffPanel.module.css hardcodes the brand indigo 20 times. Color token coverage overall 89.6% (5838 var / 678 literal).
- **Suggested fix (NOT applied):** Replace token-valued hex literals with var(--color-*); start with OnboardStaffPanel (20 sites). · effort M

### A17-005 · Cross-role inconsistency: the "Ask AI" affordance is styled two different ways
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A17 / cross-role-consistency / top-bar Ask AI button, all roles
- **Location:** `src/agent-dashboard/shell/AgentDesktopShell.module.css:79-87 (.askAi background:var(--color-white)) vs src/subscriber-dashboard/shell/SubscriberDesktopShell.module.css (.ask... background:var(--color-indigo-deep))`
- **Roles:** agent, subscriber, employer, distributor, branch, admin
- **Impact:** Same primary AI affordance reads as two different buttons across the 6 role dashboards. Aside (check 3): the 5 solid variants place two solid-indigo buttons on one screen (Ask AI + primary CTA e.g. subscriber 'Pay UGX 500,000'), brushing the '<=1 solid CTA per screen' rule; agent's white treatment is the more rule-compliant one.
- **Evidence:** Agent .askAi { border:1px solid var(--color-lavender); background:var(--color-white) } (indigo only when .askAiActive). Subscriber/admin/employer/distributor/branch shells use a solid dark-indigo pill at rest. Screenshots: subscriber/index-d, admin/desktop-overview-1440, employer/profile-1440, distributor/home-1440, branch/d-overview-1440 (all solid dark indigo) vs agent/home-1440, agent/profile-1440, agent/subscribers-1440 (white/lavender outline).
- **Suggested fix (NOT applied):** Pick one Ask AI treatment across roles; the agent white-at-rest style better honours the 'less solid indigo' house rule. · effort S

### A17-006 · Cross-role inconsistency: KPI tiles use two different patterns (left accent border vs flat)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A17 / cross-role-consistency / overview/home KPI tile row, all roles
- **Location:** `subscriber/employer/branch overview CSS (left accent border) vs agent/distributor/admin overview CSS (flat)`
- **Roles:** subscriber, employer, branch, agent, distributor, admin
- **Impact:** The 'KPI tile' concept splits 3/3 across the 6 roles — reads as unfinished convergence. Low unless two roles are shown side by side. (Status pills and the 78-score health ring ARE consistent across roles — those sub-checks pass.)
- **Evidence:** Screenshots: subscriber/index-d, employer/profile-1440 (overview), branch/d-overview-1440 show KPI tiles with a left colored accent border; agent/home-1440, distributor/home-1440, admin/desktop-overview-1440 show flat borderless KPI tiles. Icon chips, label casing and number weight are otherwise identical.
- **Suggested fix (NOT applied):** Converge on one KPI tile treatment (accent-border or flat) across all six dashboards. · effort M

### A17-007 · Spacing token coverage is 40% — the --space scale is mixed with ad-hoc px throughout
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A17 / token-coverage-spacing / all roles (CSS modules)
- **Location:** `src/pages/landing/landing.module.css (203 px spacing) + mobile/signup/contribution modules`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** Padding/margin/gap are set in ad-hoc px against a rem --space scale, so spacing drifts and cannot be retuned centrally. Discipline debt, not a visible defect.
- **Evidence:** Scripted coverage over module CSS: overall token coverage 67.9% (10768 var / 5090 literal); spacing only 40.3% (1856 var(--space) / 2745 px+rem literal); radius 76.4%; font 52.7%; shadow 84.7%. Worst files by tokenisable-literal count: pages/landing/landing.module.css, pages/landing/mobile/landingMobile.module.css, employer-dashboard/mobile/employerMobile.module.css, dashboard/mobile/distributorMobile.module.css, branch-dashboard/mobile/branchMobile.module.css, signup/contribution/ContributionSettings.module.css, components/contribution/SubscriberScheduleForm.module.css.
- **Suggested fix (NOT applied):** Migrate padding/margin/gap to --space-*; add a lint rule to block bare px on spacing properties. · effort L

### A17-008 · Decorative CSS keyframe animations ignore prefers-reduced-motion
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A17 / motion-reduced-motion / landing hero/CTA, distributor map, savings calculator
- **Location:** `src/components/Hero.module.css (pulse, scrollPulse), src/components/CTA.module.css (pulse), src/dashboard/map/UgandaMap.module.css (glowPulse), src/components/SavingsCalculator.module.css (shimmer)`
- **Roles:** public, distributor, subscriber
- **Impact:** Users with prefers-reduced-motion still get infinite decorative animation on the public landing and distributor map — inconsistent with the otherwise-disciplined motion system.
- **Evidence:** 14 CSS modules run @keyframes without a prefers-reduced-motion guard; ~5 are decorative infinite loops (Hero pulse 2.5s + scrollPulse 2s, CTA pulse, UgandaMap glowPulse 5s, SavingsCalculator shimmer 5s). 66 other modules DO guard their motion, and framer-motion is globally covered by <MotionConfig reducedMotion="user"> at src/main.jsx:97 — but MotionConfig does not govern CSS keyframes. Remaining ~9 unguarded keyframe files are loading spinners (conventionally exempt).
- **Suggested fix (NOT applied):** Wrap decorative keyframes in @media (prefers-reduced-motion: reduce){ animation: none }. · effort S

### A18-004 · Public landing pages About/Contact/FAQ render no h1 on mobile (heading-hierarchy a11y gap)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A18 / accessibility / public landing (mobile) /about /contact /faq
- **Location:** `src/pages/landing/mobile/AboutMobile.jsx:9 (<h3>), ContactMobile.jsx:70 (<h2>), FAQMobile.jsx:26 (<h2>)`
- **Roles:** public
- **Impact:** Three public marketing pages start their heading hierarchy at h2/h3 with no h1 on mobile — a WCAG heading-order issue for screen-reader users, and the sole real cause of 3 mobile Playwright smoke failures. Pages are otherwise fully usable.
- **Evidence:** grep '<h1|<h2|<h3' src/pages/landing/mobile/*.jsx: AboutMobile.jsx:9 <h3>About Universal Pensions</h3>; ContactMobile.jsx:70 <h2>Contact us.</h2>; FAQMobile.jsx:26 <h2>Frequently asked questions.</h2> — while AdminMobile.jsx:10 and DistributorsMobile.jsx:10 DO have <h1>. Desktop About.jsx:73 uses <h1>. Reproduced: npx playwright test landing.spec.ts --project=mobile-chromium -g 'FAQ|Contact|About' = 3 failed, 'getByRole(heading,{level:1}) element(s) not found'. About-page screenshot shows a fully-rendered, polished mobile page (usable, just no h1).
- **Suggested fix (NOT applied):** Promote each mobile landing page's top visible title (About Universal Pensions / Contact us / Frequently asked questions) to an <h1>. · effort S

### A18-005 · Touch targets below 44x44: app-bar back/icon buttons (40px), copilot close (32px)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A18 / accessibility / mobile app bars (all roles) + copilot panels + PageHeader
- **Location:** `src/subscriber-dashboard/shell/SubscriberMobileAppBar.module.css:17 (.backBtn 40x40), :60 (.iconBtn 40x40) — replicated in agent/branch/distributor/employer app bars and src/components/PageHeader.module.css:7; copilot .close 32x32`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** The persistent mobile back/help/notification buttons (40px) and copilot close (32px) are under Apple's 44px HIG minimum, making them slightly hard to hit; passes WCAG 2.5.8 AA (24px) so this is polish, not a blocker.
- **Evidence:** python parse of shell/component CSS for btn/icon/close with height|width < 44: SubscriberMobileAppBar.module.css:17 .backBtn 40x40, :60 .iconBtn 40x40 (x5 role app bars + PageHeader.module.css:7); {Subscriber,Agent,Branch,Employer}CopilotPanel.module.css:58/61 .close 32x32; BottomSheet .close 40x40. The bottom tab bar (primary nav) is fine — each tab is a full-height 64px slot; only the 22px glyph is small.
- **Suggested fix (NOT applied):** Bump .backBtn/.iconBtn to 44x44 and copilot .close to at least 40x40 on mobile. · effort S

### A18-006 · Two distinct subscriber report routes share the generic app-bar title 'Analytics' on mobile
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A18 / responsive-mobile / subscriber dashboard (mobile) /dashboard/reports/*
- **Location:** `src/subscriber-dashboard/shell/SubscriberMobileAppBar.jsx:59`
- **Roles:** subscriber
- **Impact:** On mobile, /dashboard/reports/all-transactions and /dashboard/reports/contributions-summary both display 'Analytics' as the page heading — a wayfinding imprecision (two pages, same title). Also a contributor to the subscriber-dashboard mobile smoke failures.
- **Evidence:** sed -n '54,60p' SubscriberMobileAppBar.jsx: resolve() has `if (!title && pathname.startsWith('/dashboard/reports/')) title = 'Analytics';`. The routed page title is suppressed on mobile (ReportsPage.jsx:98 `if (!isDesktop) return null` in ReportsHeader). Screenshot of /dashboard/reports/all-transactions on mobile-chromium shows the app-bar h1 reading 'Analytics' (not 'All Transactions'); /contributions-summary shows the same 'Analytics'.
- **Suggested fix (NOT applied):** Add distinct titles per report route in resolve()/SECONDARY (e.g. 'All transactions', 'Contributions summary'). · effort S

### A19-006 · Distributor + admin Copilot does not restore focus to its trigger on close
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A19 / a11y-focus-restore / distributor + admin desktop 'Ask AI' Copilot
- **Location:** `src/dashboard/DashboardShell.jsx:346-349 (onClose={() => setCopilotOpen(false)}); src/admin-dashboard/AdminDashboardShell.jsx:412-416`
- **Roles:** distributor, admin
- **Impact:** Keyboard/screen-reader users lose their place when the Copilot closes; focus is stranded wherever Tab last moved it in the background.
- **Failure scenario:** A keyboard user closes the Copilot with Escape and the next Tab continues from an arbitrary background control.
- **Evidence:** node scratchpad/a19-repro3.mjs: after pressing Escape to close the Copilot, 'focus after close -> BUTTON "Subscribers…"' — focus is left on a background sidebar button, not returned to the Ask-AI trigger. The four routed shells restore focus via askAiRef.current?.focus() in closeCopilot; the map-theme shells pass a bare setter with no restoration.
- **Suggested fix (NOT applied):** Capture the trigger element and call trigger.focus() on close, as the routed shells already do. Report-only. · effort S

### A19-007 · Two divergent Copilot interaction models across the six roles
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A19 / design-system-inconsistency / all six desktop shells (Ask-AI Copilot)
- **Location:** `src/subscriber-dashboard/shell/SubscriberCopilotPanel.jsx:147-148 (non-modal) vs src/dashboard/overlay/DataCopilotPanel.jsx:157-161 (modal)`
- **Roles:** subscriber, agent, branch, employer, distributor, admin
- **Impact:** The same 'Ask AI' feature behaves differently (grid-push side panel vs modal backdrop drawer) and carries different a11y contracts across roles — noticeable to anyone switching roles in one session, and the source of A19-005/006.
- **Failure scenario:** A rep demos subscriber (side panel) then admin (modal drawer) and the Ask-AI affordance behaves inconsistently.
- **Evidence:** grep across the copilot components: SubscriberCopilotPanel/AgentCopilotPanel/BranchCopilotPanel/EmployerCopilotPanel render a non-modal aside (no role=dialog, no aria-modal; inert={!open}+aria-hidden when closed; part of the CSS grid third column). DataCopilotPanel (distributor+admin) renders role="dialog" aria-modal="true" with a dimming backdrop over the map.
- **Suggested fix (NOT applied):** Standardise the Copilot on one interaction model (the non-modal grid-push panel is the cleaner, more consistent choice) across all six shells. Report-only. · effort M

### A20-006 · Skip-link target <main id="main"> is not programmatically focusable
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A20 / focus-management / all top-level shells; ComingSoon and AdminLogin use a <div> instead of <main>
- **Location:** `all shell <main id="main"> (e.g. src/subscriber-dashboard/shell/SubscriberDesktopShell.jsx:121); src/App.jsx:71 and src/pages/AdminLogin.jsx:33 use <div id="main">`
- **Roles:** subscriber, agent, branch, distributor, employer, admin, public
- **Impact:** Activating the skip link scrolls but does not reliably move keyboard/SR focus into main (works in Chrome via sequential-focus-start; inconsistent across other browsers/screen readers).
- **Evidence:** Runtime probe on /: Tab focuses skip-link (first in order) and it animates visible (top:0, matches :focus-visible). Enter -> location.hash='#main' but document.activeElement stays BODY, main tabindex=null, focusMovedToMain=false.
- **Suggested fix (NOT applied):** Add tabIndex={-1} to each <main id="main">; use <main> not <div> at the two div sites. · effort S

### A20-007 · 310 untracked jsx-a11y warnings dominated by two over-strict rules; real defects ~16
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A20 / lint-backlog / repo-wide (eslint, all a11y rules forced to warn)
- **Location:** `eslint config + src/**/*.jsx`
- **Roles:** all
- **Impact:** A large warn-only backlog masks the ~16 genuine warnings; no user-visible effect today.
- **Evidence:** Histogram: control-has-associated-label 139, label-has-for 137, aria-role 10, label-has-associated-control 8, no-autofocus 6, anchor-is-valid 4, no-noninteractive-element-to-interactive-role 3, interactive-supports-focus 2, no-static-element-interactions 1 = 310. axe found 0 rendered label/name violations across 108 scans, so the 284 label warnings are largely lint noise (label-has-for is deprecated/over-strict).
- **Suggested fix (NOT applied):** Drop deprecated label-has-for, keep label-has-associated-control; ratchet the ~16 genuine warnings to error (mostly S effort). · effort M

### A20-008 · All 10 jsx-a11y/aria-role warnings are a React prop-name collision, not invalid ARIA roles
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A20 / lint-noise / all 6 role dashboard shells (NotificationBell)
- **Location:** `src/components/notifications/NotificationBell.jsx role prop + 10 call sites (e.g. AdminDashboardShell.jsx:411, AgentDesktopShell.jsx:134, Sidebar.jsx:680)`
- **Roles:** admin, agent, branch, distributor, employer
- **Impact:** None functionally; the noise can hide a future genuine invalid role in this rule bucket.
- **Evidence:** All 10 warning sites read <NotificationBell role="admin|agent|branch|distributor|employer" .../> — role is a React prop, not a DOM attribute. NotificationBell renders only role="region" to the DOM (valid). Genuine invalid ARIA roles: 0.
- **Suggested fix (NOT applied):** Rename the prop recipientRole (per 00c). · effort S

### A20-009 · 6 autoFocus usages can disorient keyboard/screen-reader users
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A20 / focus-management / admin Create modals, employer member detail, distributor commission panel, sign-in
- **Location:** `src/admin-dashboard/employers/CreateEmployer.jsx:153, src/admin-dashboard/distributors/CreateDistributor.jsx:145, src/employer-dashboard/employees/MemberDetailBody.jsx:140, src/dashboard/commissions/CommissionPanel.jsx:619, src/dashboard/overlay/OverlayPanel.jsx:174, src/components/signin/PhoneEntry.jsx:148`
- **Roles:** admin, employer, distributor
- **Impact:** autoFocus can move SR/keyboard users unexpectedly and jump the viewport on open.
- **Evidence:** jsx-a11y/no-autofocus x6 (baseline lint.txt).
- **Suggested fix (NOT applied):** Manage focus imperatively on open instead of autoFocus (the two admin Create* modals are the weakest cases). · effort S

### A20-011 · Subscriber balance change is not announced to screen readers
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A20 / aria-live / subscriber home (Total balance)
- **Location:** `src/subscriber-dashboard/home/HomeDesktop.jsx:163-166,362-363 (and HomeMobile.jsx)`
- **Roles:** subscriber
- **Impact:** After a contribution the balance re-counts silently; SR users are not told it changed (minor because the action is confirmed via Toast).
- **Evidence:** useCountUp(net,1100,...) rendered as plain heroValue text with no aria-live and not aria-hidden. Money confirmations otherwise route through Toast.jsx aria-live=polite and the withdraw slider announces via aria-valuetext, so the actions themselves are announced.
- **Suggested fix (NOT applied):** Wrap the final balance in aria-live=polite and aria-hidden the intermediate count-up frames. · effort S

### A21-002 · Oversized aggregated CSS chunks (120KB landing sheet, 149KB distributor DashboardShell)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A21 / efficiency / all dashboards + landing
- **Location:** `dist/assets/index-*.css (120KB raw/20KB gzip), DashboardShell-*.css (149KB raw/20KB gzip), ConsentStep-*.css (93KB), EmployerDashboardShell-*.css (82KB)`
- **Roles:** all
- **Impact:** Gzip keeps each ~20KB so runtime impact is bounded, but the 120KB landing sheet is render-blocking and the aggregate size suggests shared tokens/utilities re-emitted per shell.
- **Evidence:** ls -la dist/assets/*.css and gzip -c: index CSS 122,753 B raw / 20,470 B gzip (landing critical path, render-blocking); DashboardShell 152,795 B raw / 20,367 B gzip; ConsentStep 95,514 B; EmployerDashboardShell 83,827 B.
- **Suggested fix (NOT applied):** Audit CSS Modules for dead/duplicated selectors and extract shared tokens/utility layers so they aren't re-emitted into every shell's chunk. · effort M

### A21-003 · Employer demo seed data (22KB gzip) ships to the browser on the live-backend path
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A21 / efficiency / subscriber + employer dashboards
- **Location:** `src/services/subscriber.js:38; src/services/employer.js:37 -> src/data/employerSeed.js`
- **Roles:** subscriber, employer
- **Impact:** 22KB gzip of dead demo data downloads on subscriber and employer dashboards in the live-backend demo path.
- **Evidence:** grep shows employerSeed.js (322 lines) statically imported by two service modules; build emits employerSeed-*.js at 78.27 KB raw / 22,176 B gzip. It is only the VITE_USE_SUPABASE=false mock fallback but a static import can't be tree-shaken from a reachable branch, so it downloads in the default Supabase-backed demo. (MemberDetailBody/useEmployer grep hits were comments, not real imports -> CLAUDE.md 4.1 not violated.)
- **Suggested fix (NOT applied):** Load employerSeed via dynamic import() inside the !IS_SUPABASE_ENABLED branch so it is not bundled into the live-backend path. · effort S

### A21-004 · Redundant/duplicate indexes and minor DB advisor lints
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A21 / efficiency / database schema
- **Location:** `public.subscribers, public.demo_personas, public.money_nonces, public.*_pre_nav`
- **Roles:** all
- **Impact:** Redundant write/storage overhead; negligible at demo scale. Backup pre_nav tables arguably shouldn't be in the live schema.
- **Evidence:** pg_indexes: subscribers has BOTH idx_subscribers_agent_id (single) and subscribers_agent_id_id_idx (agent_id,id composite) -> single-col redundant. Supabase perf advisor: demo_personas duplicate_index (2 identical unique indexes); money_nonces.subscriber_id FK unindexed; no_primary_key on subscribers_unit_value_pre_nav and subscriber_balances_pre_nav (NAV-migration backup tables). EXCLUDED: 9 unused_index advisor lints as unreliable (restore reset pg_stat_user_indexes.idx_scan).
- **Suggested fix (NOT applied):** Drop the redundant single-col subscribers index and one demo_personas duplicate; add a covering index on money_nonces.subscriber_id or drop the FK; drop the *_pre_nav backup tables once the NAV migration is settled. · effort S

### A22-006 · Support ticket confirms 'sent to your agent' then silently vanishes on refresh (Open 3→2, no error copy)
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A22 / demo-data-durability / subscriber support inbox
- **Location:** `src/services/tickets.js (module-level Map re-seeded on load)`
- **Roles:** subscriber, agent, branch, distributor, employer
- **Impact:** The in-memory reset is by-design demo scope (excluded), but the reportable slice is the visible mid-demo loss: a rep creates a ticket, sees a delivery-implying success toast, refreshes, and the ticket silently disappears (count reverts) with no explanation.
- **Failure scenario:** createTicket writes to the module-level Map → success toast → page reload rebuilds the module and re-seeds the Map → the just-created ticket is absent and the Open count drops with no error.
- **Repro:** 1) Sign in as subscriber, open the agent/support page 2) Raise an issue; see toast 'Your issue has been sent to your agent.' and Open count +1 3) Refresh the page — the ticket is gone and the Open count reverts, with no message
- **Evidence:** node docs/audits/2026-08-23/scratch/18-ticket-refresh-loss.mjs → BEFORE Open 2; AFTER CREATE Open 3, confirmation 'Your issue has been sent to your agent.'; AFTER RELOAD Open 2, hasProbe false, 'any missing/error copy after reload: false'.
- **Suggested fix (NOT applied):** Demo-scope: persist the demo tickets to sessionStorage so a refresh keeps them, or soften the confirmation copy so it does not promise delivery. · effort S

### A24-003 · anon cannot read branches / distributors / notifications at all — the RLS policy chain hard-errors instead of returning an empty set
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A24 / privilege-surface / PostgREST (live DB)
- **Location:** `public.current_distributor_id() — policies branches_select_distributor, distributors_select_self, notifications_select_distributor`
- **Roles:** anon
- **Impact:** No user-visible effect today — I captured every request from an unauthenticated session across six landing routes (/, /subscribers, /about, /contact, /claim, /request-access) and the app makes ZERO Supabase calls while logged out. It is a latent trap: the first logged-out feature that reads branches (a public coverage map, a distributor picker) gets a hard 401/500 instead of an empty list, with an error string that names an internal function.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local; set +a 2) for t in branches distributors notifications districts regions; do curl -s -o /tmp/t.json -w "$t %{http_code} " "$VITE_SUPABASE_URL/rest/v1/$t?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY"; head -c 130 /tmp/t.json; echo; done 3) psql "$SUPABASE_DB_URL" -c "BEGIN; SET LOCAL ROLE anon; SELECT count(*) FROM notifications; ROLLBACK;"   # ERROR: permission denied for function current_distributor_id
- **Evidence:** Postgres OR-evaluates ALL permissive SELECT policies. Three tables carry a policy calling current_distributor_id(), and anon has no EXECUTE on it — while table-level SELECT IS granted to anon, so the evident intent is "let anon ask, let RLS return nothing".

$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT p.proname, pg_get_userbyid(p.proowner), p.prosecdef, coalesce(array_to_string(p.proacl,' '),'<default>') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='current_distributor_id';"
current_distributor_id|postgres|f|postgres=X/postgres authenticated=X/postgres service_role=X/postgres

$ psql ... -c "SELECT 'authenticated', has_function_privilege('authenticated','public.current_distributor_id()','EXECUTE') UNION ALL SELECT 'anon', has_fu
- **Suggested fix (NOT applied):** GRANT EXECUTE ON FUNCTION public.current_distributor_id() TO anon; (it is a claims reader and discloses nothing to a caller with no claims). Alternatively make the three policies short-circuit on app_role before calling it, the way the agent/branch/employer policies already do. Primary owner is A03 (privilege surface) / A02 (RLS matrix) — raised here because it surfaced through the frontend network capture. · effort S
- **Verification:** CONFIRMED — Verified anon has no EXECUTE on current_distributor_id() while table-level SELECT is granted to anon on branches/distributors/notifications, so a Postgres OR-evaluation of the permissive SELECT policies hard-errors. Reproduced the live error via BEGIN...ROLLBACK (no commit): anon SELECT on branches errors 'permission denied for function current_dis

### A24-004 · react-router 7.17.0 carries 5 advisories incl. a high; the fix (7.18.2) is inside the declared semver range
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A24 / dependency / browser bundle
- **Location:** `package.json (react-router-dom: ^7.15.1) → installed react-router 7.17.0`
- **Roles:** all
- **Impact:** No exploit path exists today, so this is a hygiene finding — but it guarantees the advisory reappears in every future audit, and its non-reachability rests on the "no user-controlled navigation target" invariant, which nothing in the codebase enforces. The fix is free: 7.18.2 satisfies the declared ^7.15.1 range.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && npm ls react-router --all 2) npm outdated | grep react-router-dom   # 7.17.0 -> wanted 7.18.2 3) grep -rnE "<(Link|NavLink)[^>]*to=\{" src --include='*.jsx' | grep -v '\.test\.'   # every target is an internal constant
- **Evidence:** The only vulnerable package that reaches a browser at all.

$ npm ls react-router --all
universal-pensions-uganda@1.0.0
└─┬ react-router-dom@7.17.0
  └── react-router@7.17.0        ← PRODUCTION dependency

All other high/critical packages are devDependency-only and pruned by `npm prune --omit=dev` in render.yaml's buildCommand: nanoid/postcss ← vite; undici ← @vercel/node + jsdom; brace-expansion ← @vercel/nft + eslint-plugin-jsx-a11y; the vulnerable path-to-regexp@6.1.0 ← @vercel/node (express 5.2.1 uses router@2.2.0 → path-to-regexp@8.4.2, NOT in range). @vercel/node is a TYPE-ONLY import in all 18 api/ and server/ files (`import type { VercelRequest, VercelResponse }`; zero value imports), so it never executes.

Reachability of react-router's 5 advisories in THIS codebase — all refuted:
- **Suggested fix (NOT applied):** Merge Dependabot PR #35 (which already contains it) or run `npm update react-router-dom` → 7.18.2. The same PR also takes vite 6.4.2 → 6.4.3 (closes GHSA-fx2h-pf6j-xcff) and concurrently 9.2.1 → 9.2.4 (closes the shell-quote critical), so one merge clears all three in-range advisories. · effort S

### A24-005 · @sentry/react is a devDependency but is statically imported by production runtime code
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A24 / dependency / build
- **Location:** `package.json devDependencies; src/main.jsx:6, src/components/ErrorBoundary.jsx:20`
- **Roles:** all
- **Impact:** Any build performed with --omit=dev or NODE_ENV=production npm ci — exactly the pattern render.yaml already had to work around with NPM_CONFIG_PRODUCTION=false and `npm ci --include=dev` — fails to resolve @sentry/react and the frontend build breaks. A latent build-time failure, not a runtime one.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && grep -n '@sentry/react' package.json   # under devDependencies 2) grep -rn '@sentry/react' src | grep -v test   # imported by src/main.jsx and src/components/ErrorBoundary.jsx
- **Evidence:** $ python3 -c "import json; d=json.load(open('package.json')); [print(f'{n} -> {k}  {d[k][n]}') for k in ('dependencies','devDependencies') for n in ('@sentry/react','@sentry/node') if n in d[k]]"
@sentry/node    -> dependencies     ^10.57.0
@sentry/react   -> devDependencies  ^10.57.0

$ grep -rn "@sentry/react" src | grep -v test
src/main.jsx:6:import * as Sentry from '@sentry/react';
src/components/ErrorBoundary.jsx:20:      import('@sentry/react').then((Sentry) =>

@sentry/node is correctly a runtime dependency (used by server/index.ts); its browser twin is not. The build survives today only because Vercel installs devDependencies by default AND VITE_SENTRY_DSN is unset (so the static import is tree-shaken away entirely — 0 occurrences of 'sentry' across all 6 production entry chunks). 
- **Suggested fix (NOT applied):** Move @sentry/react from devDependencies into dependencies, alongside @sentry/node. · effort S
- **Verification:** CONFIRMED — Verified @sentry/react ^10.57.0 is in devDependencies and absent from dependencies, yet src/main.jsx:6 statically imports it in production runtime code (and ErrorBoundary.jsx:20 dynamic-imports it). Real dependency-classification defect; correctly rated low.

### A24-006 · Dependabot backlog: 12 open dependency PRs, oldest 76 days; 39 packages behind including 3 that each close a reported advisory
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A24 / supply-chain-process / repo / CI
- **Location:** `.github/dependabot.yml (config is correct); GitHub PRs #13-#35`
- **Roles:** all
- **Impact:** The audit's entire high/critical list is, in practice, one merge of PR #35 away from being materially shorter. Left alone, each weekly cycle widens the gap and the grouped PR grows harder to review — it is already 27 updates.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && gh pr list --state open --limit 30 2) npm outdated
- **Evidence:** The automation works and its output is being ignored.

$ gh pr list --state open --limit 30
35  build(deps): Bump the npm-minor-and-patch group across 1 directory with 27 updates   2026-08-11
31  build(deps): Bump actions/setup-node from 4 to 7                                     2026-07-14
29  build(deps): Bump actions/cache from 4 to 6                                          2026-06-30
27  chore(deps): Bump actions/checkout from 4 to 7                                       2026-06-23
23  chore(deps): Bump express-rate-limit from 7.5.1 to 8.5.2                             2026-06-09
20  chore(deps-dev): Bump @eslint/js from 9.39.4 to 10.0.1                               2026-06-09
19  chore(deps-dev): Bump eslint from 9.39.4 to 10.4.1                                   2026-06-09
18  chor
- **Suggested fix (NOT applied):** Merge PR #35 first (grouped minor/patch; closes all three in-range advisories in one go), then triage the 12 majors individually. Consider a CI gate that fails on a REACHABLE high rather than on any high, so the signal stays meaningful instead of being permanently red. · effort M

### A24-011 · xlsx resolves from cdn.sheetjs.com, not the npm registry — every build depends on that CDN being reachable
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A24 / supply-chain / build / CI / deploy
- **Location:** `package.json ("xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz")`
- **Roles:** all
- **Impact:** Availability, not tampering. `npm ci` on Vercel, on Render (render.yaml buildCommand) and in the test.yml CI job all need cdn.sheetjs.com reachable. A CDN outage, or a corporate proxy/registry mirror that only whitelists registry.npmjs.org, breaks every build and deploy with an error that looks nothing like a dependency problem.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && grep -n 'cdn.sheetjs.com' package.json package-lock.json | head
- **Evidence:** $ python3 -c "import json; d=json.load(open('package-lock.json')); print(json.dumps({k2:v2 for k2,v2 in d['packages']['node_modules/xlsx'].items() if k2 in ('version','resolved','integrity')}, indent=1))"
{
 "version": "0.20.3",
 "resolved": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz",
 "integrity": "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA=="
}

This is the RIGHT call for security — the npm-registry `xlsx` package is abandoned at 0.18.5 and carries unfixed CVEs — and the sha512 integrity IS pinned, so tampering fails the install rather than shipping.
- **Suggested fix (NOT applied):** Vendor the tarball into the repo and resolve it by relative path, or mirror it to a registry the org controls. If neither is acceptable, document the dependency in the deploy runbook so the failure mode is recognisable when it happens. · effort S
- **Verification:** CONFIRMED — Verified package.json:59 declares xlsx as the cdn.sheetjs.com tarball URL and package-lock.json pins resolved to that same CDN URL with a sha512 integrity hash. Availability (not tampering) concern for every npm ci build/CI/deploy. Accurate; correctly rated low.

### A25-008 · No stylelint, no import-boundary rule, no pre-commit hooks
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A25 / tooling-gap / repo
- **Location:** `repo root (no stylelint/prettier/husky/lint-staged config); .git/hooks (samples only)`
- **Roles:** all
- **Impact:** No design-token contract enforcement on 229 CSS modules (raw hex vs var(--...)), nothing blocks cross-role imports among the six per-role trees, and no gate runs before a commit lands.
- **Evidence:** ls -a | grep -iE 'stylelint|prettier|husky|lint-staged' -> nothing. ls .git/hooks | grep -v sample -> nothing. 229 .module.css files ship unlinted. Detail a25/lint-type-gaps.md.
- **Suggested fix (NOT applied):** stylelint + declaration-property-value-allowed-list for color/background restricted to var(--...); import/no-restricted-paths zones forbidding cross-role imports; husky + lint-staged. Ship as --max-warnings ratchets after burning down the existing backlog. · effort M

### A25-010 · ESLint lints 66 untracked/.gitignored files; no-unused-vars is 'error', so a stray scratch file can fail the gate
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A25 / lint-gap / repo
- **Location:** `eslint.config.js (globalIgnores omits docs/** and .understand-anything/**; flat config does not read .gitignore)`
- **Roles:** all
- **Impact:** npm run lint's pass/fail depends on files that are not part of the project; a single untracked scratch .mjs with an unused variable fails the gate.
- **Evidence:** npx eslint . 'by top dir' -> docs:63, .understand-anything:3 (the latter is on .gitignore:74). no-unused-vars is configured as 'error'. Detail a25/lint-type-gaps.md.
- **Suggested fix (NOT applied):** globalIgnores(['docs/**','.understand-anything/**']) or includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))) from @eslint/compat so lint scope tracks the repo's own ignore rules. · effort S

### A26-010 · '14 API routes' appears in eleven places across four documents and two code comments; there are sixteen, and two public write endpoints are undocumented
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-counts / docs
- **Location:** `README.md:18, :109; docs/api-contracts.md:1, :7, :23, :57, :239; docs/ARCHITECTURE.md:52-58, :540; docs/BACKEND.md:1036; server/index.ts:61, :250`
- **Impact:** docs/api-contracts.md is the file whose sole job is documenting request/response shapes, and it has no §2 entry for either of the two missing routes - so the platform's two public unauthenticated spam-vector endpoints are absent from the contract reference. The stale comments at server/index.ts:61 and :250 mean the count is wrong in the source file a reader would check to resolve the disagreement.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) grep -c '^app.all' server/index.ts 3) find api -name '*.ts' -not -name '*.test.ts' -not -path '*/_lib/*' | wc -l 4) grep -n '14' docs/api-contracts.md | grep -i route 5) sed -n '61p;250p' server/index.ts 6) sed -n '97p' docs/BACKEND.md
- **Evidence:** $ grep -c '^app.all' server/index.ts
16
$ find api -name '*.ts' -not -name '*.test.ts' -not -path '*/_lib/*' | wc -l
16
$ grep -n 'app.all' server/index.ts | tail -4
267:app.all('/api/contact', writeLimiter, toExpress(contact));
268:app.all('/api/access-request', writeLimiter, toExpress(accessRequest)); // DB insert (public employer/distributor lead form - spam vector)
269:app.all('/api/nominee-claim', writeLimiter, toExpress(nomineeClaim));   // DB insert (public bereavement claim form - spam vector)
270:app.all('/api/chat', chatLimiter, toExpress(chat));

The two undocumented routes are POST /api/access-request and POST /api/nominee-claim, both public unauthenticated write surfaces behind writeLimiter.

Internal contradiction: docs/BACKEND.md:97, :129, :130 and :283 already say 16 routes
- **Suggested fix (NOT applied):** Change 14 -> 16 at all eleven doc/comment sites and add §2.3 request/response entries for POST /api/access-request and POST /api/nominee-claim to docs/api-contracts.md. Rows drafted in DOC-CORRECTIONS.md §1, §3, §4, §6 and §13. · effort S

### A26-011 · docs/FRONTEND.md file-inventory counts are stale in six places and the document contradicts itself on the unit-test count
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-counts / docs
- **Location:** `docs/FRONTEND.md:52, :74, :387, :717, :1138, :1165, :1519`
- **Impact:** CLAUDE.md:209 makes updating FRONTEND.md in the same commit a repo rule; these counts are the evidence the rule is not being followed. Six services have no inventory row, including nav.js - the client of the NAV pricing authority that 0103-0106 introduced. A reader trying to reconcile :52 against :1519 has no way to tell which is closer to true without running the suite.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) find src -name '*.module.css' | wc -l 3) ls src/services/*.js | grep -v test | wc -l; ls src/hooks/*.js | wc -l; ls src/utils/*.js | grep -v test | wc -l; ls src/constants/*.js | grep -v test | wc -l 4) sed -n '52p;74p;387p;717p;1138p;1165p;1519p' docs/FRONTEND.md
- **Evidence:** $ find src -name '*.module.css' | wc -l
229                                  # doc :74 says 118
$ ls src/services/*.js | grep -v test | wc -l
20                                   # doc :387 heading says 14
$ ls src/hooks/*.js | wc -l
17                                   # doc :717 heading says 10
$ ls src/utils/*.js | grep -v test | wc -l
21                                   # doc :1138 says 18
$ ls src/constants/*.js | grep -v test | wc -l
7                                    # doc :1165 says 3

Unit tests - the same file states two different wrong numbers:
docs/FRONTEND.md:52   'Vitest one-shot (1221 tests across 76 files at last sync)'
docs/FRONTEND.md:1519 '48 test files, 871 passing tests at last sync'
Measured (00-baseline.md §3): 140 files / 2010 tests, all passing.

The six service
- **Suggested fix (NOT applied):** Refresh all six counts (229 / 20 / 17 / 21 / 7) and reconcile :52 and :1519 to a single figure (140 files / 2010 tests, verified 2026-08-23); add inventory rows for the six undocumented services and the nine undocumented hooks. Drafted in DOC-CORRECTIONS.md §5. · effort S

### A26-012 · README.md still lists 'hardcoded unit price' as intentional demo scope; migrations 0103-0106 retired it
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-demo-scope / docs
- **Location:** `README.md:9`
- **Roles:** subscriber, admin
- **Impact:** README is the first file a new reader or agent opens, and it labels the platform's pricing authority a mock. Under this audit's own demo-scope rule ('do not propose fixing demo scope'), an agent trusting README:9 would decline to investigate a genuine NAV or balance-valuation defect as out of scope. CLAUDE.md §10a - which README cites - no longer lists the unit price either, so README is the sole remaining source of the stale claim.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) sed -n '9p' README.md 3) sed -n '900p' docs/BACKEND.md; sed -n '1419p' docs/FRONTEND.md 4) psql "$SUPABASE_DB_URL" -X -q -At -c 'SELECT count(*) FROM nav_snapshots;'
- **Evidence:** README.md:9: '> This repo is a demo / sales-presentation tool ... Mocked OTP, mocked KYC, hardcoded unit price, and a 24-hour fixed JWT are intentional demo scope (see CLAUDE.md §10a).'

Both specialist docs already correct it:
docs/BACKEND.md:900  '~~Unit price hardcoded to 1,000 UGX/unit~~ - RESOLVED by 0103-0106. ... It is no longer hardcoded and is no longer demo scope.'
docs/FRONTEND.md:1419 '~~Hardcoded UGX 1,000 unit price.~~ RESOLVED by 0103-0106.'

Live confirmation:
$ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname IN ('latest_nav','nav_for_date');"
latest_nav
nav_for_date
$ psql "$SUPABASE_DB_URL" -X -q -At -c 'SELECT count(*) FROM nav_snapshots;'
1246
- **Suggested fix (NOT applied):** README.md:9 -> 'Mocked OTP, mocked KYC, and a 24-hour fixed JWT are intentional demo scope (see CLAUDE.md §10a). The unit price is not demo scope - it is a real admin-published fund NAV since migrations 0103-0106.' Drafted in DOC-CORRECTIONS.md §1. · effort S

### A26-013 · render-operational.md states the keepalive cadence wrongly in three places, carries two dead external references, and leaves a completed cutover instruction standing
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-ops-runbook / docs
- **Location:** `docs/render-operational.md:5, :14, :38, :56, :175; README.md:121`
- **Impact:** The 750 h/mo free-tier headroom arithmetic at :56 and :175 is derived from the wrong cadence, so the stated ~30 h/mo margin is not the real one. The two dead paths at :5 are the runbook's only cited sources, so its provenance is unrecoverable. And the un-actioned :38 means the settlement nonce-idempotency assertion - the one that proves a replayed upload does not double-record a batch - has been silently disabled since the cutover. A09 owns the operational half.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) grep -n 'cron' .github/workflows/keepalive.yml 3) grep -n '14 min\|14-min' docs/render-operational.md README.md 4) ls '/Users/shubhang/.claude/plans/dynamic-sparking-kite.md' '/Users/shubhang/Desktop/renderaudit-findings.md' 5) grep -n 'test.fixme' e2e/specs/flows/distributor-apply-settlement.spec.ts
- **Evidence:** $ grep -n 'cron' .github/workflows/keepalive.yml
3:# GitHub Actions' cron has 5-15 min real-world jitter; running every 10 min
12:    - cron: '*/10 * * * *'   # every 10 min

render-operational.md:14  'Wake: GHA cron (14 min) + cron-job.org/UptimeRobot (5 min backup)'
render-operational.md:56  'The 14-min GHA keepalive keeps the service warm for ~720h/mo - under the cap with headroom.'
render-operational.md:175 '| Instance hours | 750/month | ~720/mo (14-min keepalive + 24/7 wake) | ~30h/mo |'
README.md:121             '.github/workflows/keepalive.yml pings /healthz every 14 min'

$ ls -la '/Users/shubhang/.claude/plans/dynamic-sparking-kite.md'
ls: /Users/shubhang/.claude/plans/dynamic-sparking-kite.md: No such file or directory
$ ls -la '/Users/shubhang/Desktop/renderaudit-findings.md'
l
- **Suggested fix (NOT applied):** Change 14 min -> 10 min at render-operational.md:14/:56/:175 and README.md:121 and recompute the instance-hour headroom; replace the two dead paths at :5 with a pointer to docs/audits/2026-08-23/; rewrite :38 as a live TODO naming the surviving test.fixme at distributor-apply-settlement.spec.ts:426, or enable it. Drafted in DOC-CORRECTIONS.md §1 and §10. · effort S

### A26-014 · Seed-entity counts drifted across CLAUDE.md, SPEC.md, data-model.md and role-permissions.md; the third distributor is documented nowhere
- **Severity/Confidence:** low / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-seed-data / docs
- **Location:** `CLAUDE.md:145, :146, :147, :164; docs/SPEC.md:84-91, :107-109; docs/role-permissions.md:38, :40; docs/data-model.md:67`
- **Roles:** distributor, admin
- **Impact:** A rep or agent counting distributors from the docs finds two and sees three in the admin Distributors panel. d-003 was almost certainly created at runtime through the access-request approval path (0095/0101), so the docs also fail to convey that entities can now be provisioned outside the seed. Worth flagging onward to the data owners: one branch carries distributor_id IS NULL and is therefore invisible to every distributor (A02-010 owns the data side of that). The agent/branch count drift (~2,049 vs 2046, ~316 vs 321) is within the '~' tolerance the docs use, but combines with the distributor error to make the whole seed section untrustworthy.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c 'SELECT id,name,status FROM distributors ORDER BY id;' 3) psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT coalesce(distributor_id,'NULL'), count(*) FROM branches GROUP BY 1 ORDER BY 1;" 4) sed -n '145,147p;164p' CLAUDE.md; sed -n '67p' docs/data-model.md; sed -n '38p;40p' docs/role-permissions.md; sed -n '84,91p' docs/SPEC.md
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT id,name,status FROM distributors ORDER BY id;"
d-001|Universal Pensions Uganda - National|active
d-002|Universal Pensions Uganda - Secondary|active
d-003|Karamoja Pilot Network|active

$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT coalesce(distributor_id,'NULL'), count(*) FROM branches GROUP BY 1 ORDER BY 1;"
d-001|291
d-002|27
d-003|2
NULL|1

$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "SELECT (SELECT count(*) FROM agents),(SELECT count(*) FROM branches),(SELECT count(*) FROM subscribers);"
2046|321|5064

Doc claims: CLAUDE.md:147 'Distributor ... | 2 (each sees only its own network)' · CLAUDE.md:164 'Two in the demo seed: d-001 (national - 289 branches) and d-002 (Busoga sub-region - 27 branches)' · CLAUDE.md:145 'Agent ... ~2,
- **Suggested fix (NOT applied):** CLAUDE.md:147 -> '3'; CLAUDE.md:164 -> name all three distributors with live branch counts (291 / 27 / 2) and note the one NULL-owner branch; data-model.md:67 -> 'Three distributors live'; refresh ~2,049 -> ~2,046 and ~316 -> ~321 in all four docs; insert a Distributor level into SPEC.md's hierarchy diagram with a note that it is an ownership edge (branches.distributor_id), not a geographic one. Drafted in DOC-CORRECTIONS.md §2, §7, §8, §9. · effort S


## 🔵 INFO (44)

### A02-009 · Live data drifted materially during the audit window (other agents writing through the app)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A02 / environment / database
- **Location:** `public.subscribers, public.transactions, public.users`
- **Impact:** None to correctness of this audit's verdicts -- A02 wrote nothing (every probe was rolled back or forced into a constraint violation; verified afterwards: transactions matching 'a02-probe%' = 0, s-0001 total_balance unchanged at 1386092, name/phone/schedule mode/insurance cover unchanged). But every absolute row count in this report and in rls-matrix.csv is point-in-time, and downstream agents should not treat a mismatch against 00-baseline.md as evidence of a defect.
- **Repro:** 1) Re-run the count query above and compare against 00-baseline.md §6.
- **Evidence:** docs/audits/2026-08-23/00-baseline.md §6 vs measured mid-A02:\n$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select 'subscribers',count(*) from subscribers union all select 'transactions',count(*) from transactions union all select 'users',count(*) from users union all select 'agents',count(*) from agents union all select 'a-001 subs', count(*) from subscribers where agent_id='a-001';"\nsubscribers|5081     (baseline 5064)\ntransactions|29158   (baseline 29027)\nusers|51             (baseline 48)\nagents|2046          (baseline 2046)\na-001 subs|28        (was 11 at the start of this agent's run)\nAlso: admin SELECT subscribers returned 5079 mid-run and 5067 in the matrix pass -- two readings minutes apart.
- **Suggested fix (NOT applied):** No code change. Downstream audit agents should cite counts with a timestamp, and reconciliation agents (A04/A06) should take their own snapshot rather than reusing A00's. · effort S

### A02-010 · One branches row has distributor_id IS NULL and is invisible to every distributor
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A02 / data-integrity / database
- **Location:** `public.branches row id='tst-branch-msc7w8vm'`
- **Roles:** distributor, admin
- **Impact:** An ownership orphan that no distributor can ever see or manage; only the admin's branch list shows it. Looks like a leftover E2E fixture. Reported for A06 (ownership/invariants) rather than remediated here.
- **Repro:** 1) psql -c "select id, name, distributor_id from branches where distributor_id is null;" 2) Returns tst-branch-msc7w8vm.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select distributor_id, count(*) from branches group by 1 order by 1;"\nd-001|291\nd-002|27\nd-003|2\n|1\n$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select id from branches where distributor_id is null;"\ntst-branch-msc7w8vm\n\nbranches_scope_distributor is RESTRICTIVE with USING ((COALESCE(auth.jwt() ->> 'app_role','') <> 'distributor') OR (distributor_id = current_distributor_id())), so a NULL owner matches no distributor. Matrix confirms: admin sees 321 branches, d-001 sees 291, 291+27+2 = 320.
- **Suggested fix (NOT applied):** Delete the fixture row, or give it a distributor_id. Separately, consider adding a NOT NULL constraint on branches.distributor_id now that trg_branches_default_distributor exists to supply a default. · effort S

### A03-004 · commission_id_seq and subscriber_id_seq retain Supabase-default anon/authenticated rwU (nextval/setval)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A03 / least-privilege / database-sequence
- **Location:** `public.commission_id_seq, public.subscriber_id_seq`
- **Impact:** None reachable. PostgREST never exposes nextval/setval and anon has no direct SQL channel; the signup nextval runs inside SECURITY DEFINER functions as the owner. The anon grant is redundant and unreachable. Recorded as a least-privilege observation.
- **Evidence:** psql: has_sequence_privilege('anon', 'public.subscriber_id_seq', 'USAGE')=t and 'UPDATE'=t; relacl shows anon=rwU authenticated=rwU service_role=rwU for both commission_id_seq and subscriber_id_seq. The two *_log sequences (entity_detach_log_id_seq, entity_status_log_id_seq) are correctly revoked (anon usage/update = f), per migration 0080.
- **Suggested fix (NOT applied):** Optionally REVOKE USAGE, UPDATE ON SEQUENCE public.commission_id_seq, public.subscriber_id_seq FROM anon, authenticated to match the *_log sequences (defense in depth; no functional effect). · effort S
- **Verification:** CONFIRMED — Spot-check (info). Confirmed anon retains USAGE+UPDATE on subscriber_id_seq and commission_id_seq while the *_log sequences are revoked. Correctly scoped info: no reachable path (PostgREST never exposes nextval/setval; nextval runs inside DEFINER functions as owner).

### A03-005 · Dead commission-run migration 0021_commission_rpcs_app_role.sql retained in repo with no down-migration
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A03 / dead-code / migration
- **Location:** `supabase/migrations/0021_commission_rpcs_app_role.sql`
- **Impact:** No runtime effect (the code is not applied live). Cleanup / clarity item — a large dead migration and its absent down-file mislead future readers about the live surface.
- **Evidence:** File present, 39,576 bytes; no matching *0021*.down.sql. The 16 functions it defines are dropped by 0029_commission_simplify.sql and absent live: SELECT count(*) FROM pg_proc WHERE proname IN (open_run, cancel_run, ... mark_branch_reviewed) => 0; SELECT count(*) FROM pg_proc WHERE prosrc ILIKE '%commission_runs%' OR '%commission_lines%' => 0; run/dispute tables do not exist (only contribution_runs/contribution_run_uploads).
- **Suggested fix (NOT applied):** Remove or clearly deprecate 0021_commission_rpcs_app_role.sql; note that 0029 supersedes it. · effort S

### A03-006 · 34 anon-readable tables are RLS-only (no table-grant backstop) — a dropped policy fails to deny, not to leak
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A03 / architecture-observation / rls
- **Location:** `public.* (34 tables granting anon SELECT)`
- **Impact:** Confidentiality holds under the current posture: dropping any single policy yields default-deny (availability failure — empty demo data), not a leak. A leak would require RLS to be DISABLED on a table or a permissive USING(true) policy to be added. Standard Supabase posture; recorded as an architectural note, not a defect.
- **Evidence:** No blanket REVOKE SELECT ON ALL TABLES FROM anon in supabase/migrations (only targeted revokes: users/0081, entity_detach_log+entity_status_log/0080, v_reconciliation_exceptions/0096). 34 of 37 tables grant anon SELECT and ALL 34 are RLS enabled+forced: SELECT relrowsecurity, relforcerowsecurity, count(*) ... WHERE has_table_privilege('anon',oid,'SELECT') GROUP BY 1,2 => t|t|34. Live anon PostgREST reads of subscribers/transactions/commissions/subscriber_balances/agents/distributors/branches all return HTTP 401 (RLS predicate calls a DEFINER helper anon can't run); employers returns HTTP 200 [] (zero rows).
- **Suggested fix (NOT applied):** No action required. If defense-in-depth is desired, replace anon table-SELECT grants with explicit REVOKE + view-based access, but this is not necessary given RLS is enabled+forced everywhere. · effort M
- **Verification:** CONFIRMED — Spot-check (info). Confirmed 34 anon-SELECT tables are all RLS enabled AND forced, so a dropped policy fails to default-deny (availability), not to leak. Author's impact statement is accurate; correctly scoped info/architectural note.

### A03-007 · get_employer_invite exposes a token-existence oracle and returns HTTP 500 for not-found tokens
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A03 / api-hygiene / database-rpc
- **Location:** `public.get_employer_invite (ERRCODE P0002 vs P0001)`
- **Impact:** Negligible. The existence oracle is unusable against 122-bit random tokens. The 500-on-not-found is a minor status-code inconsistency with no security or demo impact.
- **Evidence:** Anon PostgREST: expired real token => HTTP 400 {code:P0001,'invite expired'}; nonexistent/empty/null token => HTTP 500 {code:P0002,'invite not found'}. Distinct codes distinguish existing-but-invalid from nonexistent; but tokens are 122-bit gen_random_uuid() values so enumeration is infeasible. The not-found path returns 500 (server error) rather than 400/404.
- **Suggested fix (NOT applied):** Return a uniform 400/404 for both not-found and expired, and map P0002 to a 4xx status; optional. · effort S

### A04-016 · The single live unit-bucket invariant break on s-0005 is AUDIT-CAUSED, not a product defect — it belongs in the write ledger
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A04 / audit-hygiene / live data
- **Location:** `public.subscriber_balances (s-0005) / docs/audits/2026-08-23/00d-live-write-ledger.md`
- **Roles:** admin
- **Impact:** No product impact. The write came from an ad-hoc SQL statement issued by another audit agent that replicated request_withdrawal's balance UPDATE without its PERFORM public._resync_bucket_units(...) call. Recorded here so it is not mistaken for a product defect by a later reader, and so the write ledger is complete. I did NOT repair it — hand-repairing a fractional unit count is exactly the class of action 00d-live-write-ledger.md warns against.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select subscriber_id, units, retirement_units, emergency_units, (retirement_units+emergency_units-units) as gap, updated_at from subscriber_balances where subscriber_id='s-0005';" 3) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select count(*) from transactions where subscriber_id='s-0005' and date > '2026-08-04';"   -- 0
- **Evidence:** $ psql -x -c "select * from subscriber_balances where subscriber_id='s-0005';"
 units 203.98642208035116 | retirement_units 185.404883 | emergency_units 24.9452911485705822
 updated_at 2026-08-24 08:01:28.956196+00 | nav_as_of 2026-08-24
 gap = 6.363752068219 units;  6.3637520682194222 * 1571.4 = 10000.00000000000004508

Five facts settle attribution:
1. s-0005's units is EXACTLY ledger-consistent — an independent replay of its transactions priced at nav_for_date reproduces it: `s-0005 | live 203.986422080351 | walk 203.986422080351 | unit_delta 0.000000000000`. Nothing corrupted units.
2. Only emergency_units is wrong, by exactly 10,000.00 UGX at the current NAV.
3. updated_at is 2026-08-24 08:01:28 UTC — inside this audit's window — yet s-0005 has NO transactions row and NO withdrawals r
- **Suggested fix (NOT applied):** Add this as Event 3 in docs/audits/2026-08-23/00d-live-write-ledger.md alongside the s-0001 contribution and the E2E employer runs. Leave the row alone, or repair it deliberately with `SELECT public._resync_bucket_units('s-0005');` which recomputes both bucket unit columns from the balance ratio in one atomic statement — that is the safe repair, and it is the only one I would recommend. · effort S

### A04-017 · 602 pre-0102 employer rows hold 10,843,200 UGX in the emergency bucket; 0102 documents this as a deliberate non-backfill
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A04 / documented-residue / ledger
- **Location:** `supabase/migrations/0102_employer_contributions_all_retirement.sql:52-58`
- **Roles:** subscriber, employer
- **Impact:** No defect — the RPC-level invariant (employer money is 100% retirement) is correct and verified against live data. Recorded so a later reader who queries `sum(split_emergency) where source='employer'` and sees 10.8M does not raise it as a regression. The residue means a handful of employer-tagged members still show employer-funded money in their withdrawable bucket, which is the state 0102 explicitly chose to preserve rather than rewrite.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select date_trunc('day',date)::date, count(*), count(*) filter (where split_emergency>0) emg, coalesce(sum(split_emergency),0) from transactions where source='employer' and type='contribution' group by 1 order by 1;"
- **Evidence:** $ psql -At -F'|' -c "select source, type, count(*), count(*) filter (where split_emergency>0) emg_rows, coalesce(sum(split_emergency),0) emg_ugx from transactions where type='contribution' group by 1,2;"
employer|contribution|697|602|10843200
$ psql -At -F'|' -c "select date_trunc('day',date)::date, count(*), count(*) filter (where split_emergency>0) from transactions where source='employer' and type='contribution' group by 1 order by 1;"
... 2026-08-03|57|57  |  2026-08-23|38|0  |  2026-08-24|57|0
The 0102 cutover is visible in the data: every employer-source row written on or after 2026-08-23 has split_emergency = 0.
0102 header lines 52-58: 'NOT TOUCHED, deliberately: * Existing transactions keep the splits they were posted with. Those runs really did allocate that way; rewriting them w
- **Suggested fix (NOT applied):** No action. If the residue is ever considered undesirable for demo purposes, it must be corrected by a migration that rewrites BOTH the transactions splits and the derived subscriber_balances buckets in one transaction — never the ledger alone. · effort L

### A04-018 · 0105's rollback artefacts are intact, so the NAV backfill remains reversible
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A04 / rollback-readiness / schema
- **Location:** `public.subscriber_balances_pre_nav`
- **Roles:** admin
- **Impact:** Positive finding: the only irreversible migration in the money engine still has its restore source, at full row count, correctly locked down. Worth stating explicitly because 0105's own header flags dropping these tables as the point of no return, and because a reader tidying up 'leftover' tables could destroy the rollback path without realising it. Note this counts 5,060 rows against today's 5,060 balance rows, so the snapshot is complete.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -At -F'|' -c "select count(*) from public.subscriber_balances_pre_nav;"
- **Evidence:** $ psql -At -F'|' -c "select relname, (select count(*) from public.subscriber_balances_pre_nav) from pg_class where relname in ('subscriber_balances_pre_nav','subscribers_unit_value_pre_nav');"
subscriber_balances_pre_nav|5060
subscribers_unit_value_pre_nav|5060
0105 header: '⚠️ THIS IS THE IRREVERSIBLE STEP ... §1 snapshots subscriber_balances into public.subscriber_balances_pre_nav FIRST — 0105_nav_backfill.down.sql restores from that table and cannot work without it. Do not drop it until the change is accepted.'
Both tables carry ENABLE + FORCE ROW LEVEL SECURITY with no policy and no grant, so they are unreachable by any client role.
- **Suggested fix (NOT applied):** No action, other than to NOT drop these two tables until the NAV change is formally accepted. If they are dropped, record it, because 0105 becomes irreversible at that moment. · effort S

### A05-014 · settlement_uploads is an unbounded, never-reconciled idempotency ledger claiming 1,530,000 UGX of settlement against 50,000 actually paid
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A05 / hygiene / db
- **Location:** `public.settlement_uploads · e2e/specs/flows/distributor-apply-settlement.spec.ts afterEach`
- **Impact:** No user-visible effect — the table has no RLS policies and no authenticated grant, so only the SECURITY DEFINER RPC reads it. It simply accumulates and diverges permanently from reality; today's baseline Playwright run added 8 more rows and zero orphan batches, i.e. cleanup works when tests pass.
- **Repro:** 1) Query select count(*), sum((result->>'totalPaid')::numeric) from settlement_uploads and compare with sum(paid_amount) from settlement_batches.
- **Evidence:** psql … -At -c "select count(*) from settlement_uploads;"                                          141
psql … -At -c "select count(*) from settlement_uploads where (result->>'linesSettled')::int > 0;"  126
psql … -At -F'|' -c "select sum((result->>'totalPaid')::numeric), sum((result->>'linesSettled')::int) from settlement_uploads;"
 1530000|306
Against 5 settlement_batches rows and 50,000 UGX / 10 lines actually paid. The E2E afterEach reverts commissions and deletes settlement_batches + notifications but never the settlement_uploads row.
- **Suggested fix (NOT applied):** Have the E2E cleanup also delete its settlement_uploads rows by nonce, and consider a retention window on the ledger (the nonce only needs to outlive a plausible retry). · effort S

### A05-015 · Migration 0087 documents an ownership guard on get_agent_commission_detail that its body never emits
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A05 / doc-drift / migration
- **Location:** `supabase/migrations/0087_scope_commission_rpcs.sql:15-19 vs live public.get_agent_commission_detail`
- **Impact:** No user-visible effect and no data leak: the intended behaviour is delivered incidentally by RLS on public.agents rather than by the guard the migration claims to have added. The risk is that anyone reading 0087 believes an explicit guard exists in the function body; if the function were ever converted to SECURITY DEFINER the protection would vanish silently.
- **Repro:** 1) Read supabase/migrations/0087_scope_commission_rpcs.sql lines 15-19. 2) Grep the same file for get_agent_commission_detail — it appears only in the header comment. 3) Dump the live definition: it is still the 0029 body.
- **Evidence:** 0087 header: 'Ownership guard on `get_agent_commission_detail` … It now returns NULL.' The migration body has four numbered sections (get_agent_commission_list, get_pending_dues_by_agent, get_pending_dues_by_branch, get_top_branch) and none re-emits that function.
grep -n get_agent_commission_detail supabase/migrations/*.sql (excluding .down) shows the last CREATE OR REPLACE is 0029_commission_simplify.sql:270.
psql … -c "select pg_get_functiondef(oid) from pg_proc where proname='get_agent_commission_detail' and pronamespace='public'::regnamespace;" | head -6
 CREATE OR REPLACE FUNCTION public.get_agent_commission_detail(p_agent_id text)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'public', 'pg_temp'
Behaviour is nevertheless correct — psql -f t_rls.sql under SET LOCAL
- **Suggested fix (NOT applied):** Either emit the documented guard (IF the resolved agent's branch is not in distributor_branch_ids() THEN RETURN NULL) or amend 0087's header to state that the protection comes from RLS on public.agents plus SECURITY INVOKER, and add a comment to that effect on the function. · effort S

### A06-018 · The insurance-premium invariant is violated in live data by three deliberate demo fixtures
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A06 / data-integrity / subscriber transaction history for s-0701/s-0702/s-0703; admin Reconciliation
- **Location:** `public.transactions ids t-demo-recon-1, t-demo-recon-2, t-demo-recon-3`
- **Roles:** admin, subscriber
- **Impact:** No user-visible defect — the three rows are demo fixtures that make the Reconciliation screen tell a story. Recorded because they mean the ANNUAL-only self-pay invariant is NOT true of live data, so anyone porting that assertion from the mock test to a DB guard must exempt txn_ref LIKE 'RECON-DEMO-%' or the guard fails on a clean database.
- **Evidence:** The invariant (src/data/__tests__/insurance-premium-invariant.test.js) is asserted only against the in-memory mockData population, never against live. Run against live it fails:
$ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select count(*) from (select subscriber_id, count(*) n from public.transactions where type='premium' group by 1 having count(*)>1) t;"
2
$ psql ... -c "select subscriber_id, count(*) n, sum(amount) from public.transactions where type='premium' group by 1 having count(*)>1 order by 2 desc;"
s-0701|2|69000
s-0703|2|62000
$ psql ... -c "select amount, count(*) from public.transactions where type='premium' group by 1 order by 2 desc;"
24000|2708
62000|1
45000|1
38000|1
$ psql ... -c "select id, subscriber_id, type, amount, date, status, method, txn_ref, source, created_at f
- **Suggested fix (NOT applied):** If the invariant is promoted to a DB guard, exclude txn_ref LIKE 'RECON-DEMO-%'. Otherwise no action. · effort S

### A06-019 · The duplicate-NIN invariant covers 22 of 5,064 subscriber rows
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A06 / test-coverage / e2e DB invariants guard
- **Location:** `e2e/specs/db/invariants.spec.ts (test 'no duplicate subscriber NIns')`
- **Impact:** No defect — the seed simply does not populate NIN for the bulk population (only real signups and KYC-completed members carry one). Recorded so nobody reads 'no duplicate subscriber NIns: 0' as evidence that 5,064 identities are unique; it is evidence that 22 are.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select count(*) filter (where nin is null), count(*) filter (where nin=''), count(*) from public.subscribers;"
5042|0|5064

The assertion filters .not('nin','is',null), so it evaluates 22 rows. The 0017 UNIQUE INDEX it guards is a PARTIAL index and therefore also only constrains those 22.
- **Suggested fix (NOT applied):** None required. If NIN uniqueness matters for the demo story, have the seed populate it; otherwise note the coverage in the test's comment block. · effort S

### A06-020 · Four stale pending NAV snapshots sit behind a later published price
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A06 / data-hygiene / admin NAV screen
- **Location:** `public.nav_snapshots (status='pending')`
- **Roles:** admin
- **Impact:** Four draft NAV rows dated 2026-08-04..2026-08-07 remain 'pending' while a later price for 2026-08-08 is already published, and all four carry the retired hardcoded 1,000.00 unit price rather than a real NAV. On the admin NAV screen they read as 'awaiting approval' for dates that are already priced. No money is affected — latest_nav() correctly returns 1571.4 from the published series.
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -F'|' -c "select status, count(*), min(nav_date), max(nav_date), min(unit_price), max(unit_price) from public.nav_snapshots group by 1;"
published|1242|2021-11-01|2026-08-08|996.38|1580.72
pending|4|2026-08-04|2026-08-07|1000.00|1000.00
$ psql ... -c "select public.latest_nav();"
1571.4
- **Suggested fix (NOT applied):** Delete or mark-superseded any pending nav_snapshots whose nav_date is earlier than the latest published nav_date. A04 owns the NAV pipeline; flagged here as data residue found during the table sweep. · effort S

### A07-003 · CORS allows no-Origin requests (by design)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A07 / security / backend
- **Location:** `server/cors.ts`
- **Impact:** none for this deployment
- **Evidence:** cb(null,true) when origin undefined; browser origins restricted to uganda-dashboard*.vercel.app
- **Suggested fix (NOT applied):** revisit if cookie auth added · effort ?

### A09-015 · The retired Tokyo Supabase project is still ACTIVE in the same free organisation as the live one
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A09 / infra-hygiene / infra/db
- **Location:** `Supabase org ugoaezmojpyvcbeeqfbz`
- **Roles:** all
- **Impact:** The pre-cutover Tokyo project (the one that ran out of disk, per the 2026-06-04 audit) is still live alongside the Singapore project, consuming the second free-tier project slot and holding a stale copy of the demo data that a mistyped project ref could connect to. Its name — 'Uganda dashboard' — is also the more obvious of the two; the live project is 'Pension dashbaord', typo included.
- **Repro:** 1) mcp__supabase__list_projects → two ACTIVE_HEALTHY projects in org ugoaezmojpyvcbeeqfbz
- **Evidence:** $ mcp__supabase__list_projects
{"id":"zengmiugieqjqzaccbqe","name":"Uganda dashboard","region":"ap-northeast-1","status":"ACTIVE_HEALTHY","created_at":"2026-05-14T07:36:41Z"}
{"id":"ilkhfnoyxlxwqadebnkp","name":"Pension dashbaord","region":"ap-southeast-1","status":"ACTIVE_HEALTHY","created_at":"2026-06-05T05:02:16Z"}
- **Suggested fix (NOT applied):** Pause or delete zengmiugieqjqzaccbqe once its data is confirmed unneeded, and rename the live project to something unambiguous. · effort S

### A09-016 · Planner statistics survived the restore — the audit plan's 'empty stats' premise is wrong and does not affect a cold demo
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A09 / correction / infra/db
- **Location:** `live DB ilkhfnoyxlxwqadebnkp, pg_class / pg_statistic / pg_stat_user_tables`
- **Roles:** all
- **Impact:** Only the cumulative activity counters were reset. The query planner reads pg_class.reltuples/relpages and pg_statistic, and both survived intact: reltuples for transactions is 28,671 against a true count of 29,027 (-1.2%) and subscribers is exact at 5,064, with 302 column-level statistics rows for the public schema. A manual ANALYZE would not measurably change any plan, so this does NOT materially affect a cold demo. What was lost is seq_scan/idx_scan history, which removes the evidence base for 'which indexes are unused' — A21 should note that rather than concluding indexes are dead.
- **Repro:** 1) Query pg_stat_user_tables → n_live_tup 0 and all last_* NULL for all 37 tables 2) Query pg_class.reltuples → accurate to within 1.2% 3) Query pg_stats → 302 rows for the public schema
- **Evidence:** $ psql -X -q -At -F'|' -c "SELECT relname, n_live_tup, last_analyze, last_autoanalyze, last_vacuum, last_autovacuum FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY relname;"
subscribers|0||||
transactions|114||||
commissions|0||||
... (all 37 tables: n_live_tup ~0, all four last_* timestamps NULL)

$ psql -c "SELECT relname, reltuples::bigint, relpages FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind='r' ORDER BY reltuples DESC LIMIT 12;"
transactions|28671|558
nominees|24386|357
withdrawals|6628|146
subscribers|5064|525
subscriber_balances|5060|185
contribution_schedules|5021|68
commissions|5000|69
agents|2043|68

$ psql -c "SELECT count(*) FROM pg_stats WHERE schemaname='public';"
302
- **Suggested fix (NOT applied):** No action needed for the demo. A21 should not infer unused indexes from the reset counters, and every agent should keep using count(*) rather than n_live_tup per baseline §6. · effort S

### A09-017 · Two header-level inconsistencies: content-hashed assets are not served immutable, and the API sets CORP same-origin on a deliberately cross-origin service
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A09 / security-headers / infra/deploy
- **Location:** `Vercel edge (/assets/*); server/index.ts:154 (app.use(helmet()))`
- **Roles:** all
- **Impact:** Content-hashed assets are revalidated on every page load instead of being served immutable — a cheap round-trip to reclaim on the Ugandan mobile connections a rep demos over. CORP: same-origin on an API that exists to be called cross-origin is contradictory but inert (CORP does not apply to CORS-mode fetch, and the app's calls all succeed). x-powered-by leaks on /healthz only — a deliberate consequence of registering it before helmet to protect the ~1 KB uptime-monitor response budget.
- **Repro:** 1) curl -D - the CSS asset → cache-control: public, max-age=0, must-revalidate 2) curl -D - POST /api/chat → cross-origin-resource-policy: same-origin 3) curl -D - /healthz → x-powered-by: Express present
- **Evidence:** $ curl -sS -D - -o /dev/null https://uganda-dashboard.vercel.app/assets/index-DpSq6jQ9.css
cache-control: public, max-age=0, must-revalidate
(content-hashed filename, but not immutable)

$ curl -sS -D - -o /dev/null -X POST -H 'Content-Type: application/json' -d '{"message":"hello"}' https://uganda-dashboard-api.onrender.com/api/chat
cross-origin-resource-policy: same-origin
cross-origin-opener-policy: same-origin
x-frame-options: SAMEORIGIN
content-security-policy: default-src 'self';…;frame-ancestors 'self';…

$ curl -sS -D - -o /dev/null https://uganda-dashboard-api.onrender.com/healthz
x-powered-by: Express
(registered before helmet at server/index.ts:110, so helmet never strips it)
- **Suggested fix (NOT applied):** Add a vercel.json headers rule for /assets/(.*) with `cache-control: public, max-age=31536000, immutable`. Optionally set helmet's crossOriginResourcePolicy to 'cross-origin' on the API so the header matches intent. · effort S

### A09-018 · Environment-documentation gaps and one stale note in docs/BACKEND.md §2
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A09 / documentation / docs
- **Location:** `docs/BACKEND.md §2 (env table and Notes)`
- **Roles:** all
- **Impact:** Env-var required/documented count is 21/20: ALLOW_DESTRUCTIVE_E2E appears in no env template, RENDER_DEPLOY_HOOK is missing from the canonical §2 table, SUPABASE_DB_URL's 'Read by' column is incomplete, the four GitHub Actions secret names are documented only inside test.yml's own comment header, and the 'no deploy-time preflight (audit X14)' note is now false. None has user-visible effect; all cost onboarding time.
- **Repro:** 1) grep ALLOW_DESTRUCTIVE_E2E across docs/ and .env.local.example → prose mention only, no template entry 2) grep RENDER_DEPLOY_HOOK in docs/BACKEND.md → prose rows 988/996 only, not the §2 table 3) Read docs/BACKEND.md:86 against server/index.ts:40-41 → the preflight claim is out of date
- **Evidence:** $ grep -rn "ALLOW_DESTRUCTIVE_E2E" docs/ CLAUDE.md
docs/ARCHITECTURE.md:457: (prose only, inside a testing table)
docs/audits/2026-05-31/06-testing.md:163:
(absent from .env.local.example and from the docs/BACKEND.md §2 table, yet read at e2e/specs/regression/empty-states.spec.ts:70)

$ grep -rn "RENDER_DEPLOY_HOOK" docs/*.md CLAUDE.md
docs/BACKEND.md:988, docs/BACKEND.md:996, docs/render-operational.md:22,24,26
(prose only — absent from the §2 env table)

$ grep -n "SUPABASE_DB_URL" docs/BACKEND.md
| `SUPABASE_DB_URL` | **Local-only** | `scripts/seed-supabase.mjs` | …
(omits scripts/apply-migration.mjs:20, which also reads it)

$ sed -n '86p' docs/BACKEND.md
- `api/_lib/supabase-admin.ts` and `api/_lib/jwt.ts` both hard-fail at first invocation if their env vars are missing (no deploy-tim
- **Suggested fix (NOT applied):** Add ALLOW_DESTRUCTIVE_E2E and RENDER_DEPLOY_HOOK rows to the docs/BACKEND.md §2 table, add scripts/apply-migration.mjs to SUPABASE_DB_URL's 'Read by' cell, list the four GHA secret names in the same table, and delete the stale X14 sentence now that assertServerEnv() exists. · effort S

### A10-003 · The 6 baseline mobile subscriber-dashboard Playwright failures are title-divergence (test brittleness), not product defects
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A10 / test-coverage / e2e/specs/smoke/subscriber-dashboard.spec.ts (mobile projects)
- **Location:** `e2e/specs/smoke/subscriber-dashboard.spec.ts:43,54,109,115,124,173`
- **Roles:** subscriber
- **Impact:** No user-facing defect — the pages work at 375. The baseline's 'element genuinely never appeared' is because the desktop-titled h1 does not exist on mobile. For A25 to relax assertions.
- **Repro:** 1) Run subscriber-dashboard.spec.ts on mobile-chromium/webkit 2) Failures at :43,:54,:109,:115,:124,:173 — mobile h1 differs from asserted desktop title
- **Evidence:** 375px sweep renders every flagged route cleanly (0 ErrorBoundary, content present, 0 console errors). Failures are getByRole('heading',{level:1,name:/<desktop title>/}) not matching the mobile shell's shorter h1: Schedule mobile h1 'Contribution settings' vs asserted /tune your schedule/; Withdraw hub 'Withdraw' vs /withdrawals/; All Transactions/Contributions 'Analytics' vs the report name; Help 'Help' vs /how can we help/; Profile edit 'Edit profile' vs /^profile$/.
- **Suggested fix (NOT applied):** Relax the smoke assertions to accept the mobile app-bar titles, or anchor on a title-agnostic identity element. · effort S

### A11-008 · Agent commissions error card surfaces a raw 'TypeError: Failed to fetch' string
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A11 / copy / agent /dashboard/commissions (error state)
- **Location:** `src/agent-dashboard/pages/CommissionsPage.jsx (ErrorCard message={error})`
- **Roles:** agent
- **Impact:** A field agent could momentarily see a JS exception string if the API blips during a demo.
- **Evidence:** Forced the commission fetch to fail via Playwright route-abort: ErrorCard renders 'We couldn't load your commissions / TypeError: Failed to fetch / Try again' (screenshots/agent/commissions-error-1440.png). The error STATE is otherwise well-handled; subscribers/:id for a missing id shows a clean 'Subscriber not found' (subscriber-detail-missing-1440.png).
- **Suggested fix (NOT applied):** Map fetch/network errors to a plain-language message before passing to ErrorCard. · effort S

### A12-I01 · Two E2E-leftover branches pollute the Kampala district in live data
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A12 / data-hygiene / branches table (district d-kampala)
- **Location:** `public.branches (b-new-1785700420016, b-new-1785753024670)`
- **Roles:** distributor, admin
- **Impact:** None user-visible on the branch surface (excluded from the count), but stale E2E writes remain in live demo data. Flagged for A06 (data integrity).
- **Evidence:** psql: district d-kampala has 10 branch rows; 8 have scores/ranks; 2 are 'E2E Branch ...' with NULL score and NULL district_rank. district_branch_count=8 excludes them so the '#3 of 8' chip is internally consistent.
- **Suggested fix (NOT applied):** Remove the E2E-created branch rows from live demo data; add cleanup to the E2E teardown. · effort S

### A12-I02 · Manager-name vs persona-name inconsistency across branch surfaces
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A12 / consistency / branch overview (desktop) vs hub (mobile)
- **Location:** `src/branch-dashboard/desktop/OverviewDesktop.jsx:184 vs src/branch-dashboard/mobile/BranchHubMobile.jsx`
- **Roles:** branch
- **Impact:** Cosmetic — the branch admin is greeted by different names on desktop vs mobile.
- **Evidence:** Desktop overview: 'Welcome back, Default branch (Kampala Central)' (JWT persona name). Mobile hub (m-menu-375.png): 'Isaac Asiimwe · Branch Admin' (branches.manager_name). Two names for the same signed-in user.
- **Suggested fix (NOT applied):** Pick one source (persona name or manager_name) for the signed-in identity across both shells. · effort S

### A13-004 · Desktop panel state (Commissions/Reports/etc.) is not URL-routed; a hard refresh drops the open panel back to Overview
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A13 / state-persistence / distributor desktop shell panels
- **Location:** `src/contexts/DashboardPanelContext.jsx (panels intentionally state-based per CLAUDE.md sec4 hard rule 2)`
- **Roles:** distributor
- **Impact:** By-design, but a rep who refreshes mid-demo on a panel (Commissions/Reports) lands on Overview; panels have no deep-link or browser-back support.
- **Evidence:** a13-08-panel-drill-error.mjs: open Commissions panel -> URL stays /dashboard; hard reload -> renders Overview ('Now viewing National Overview'), not Commissions (panel-refresh-1440.png). Contrast: geo drill DOES route (/dashboard/regions/r-central).
- **Suggested fix (NOT applied):** None required (documented intentional architecture). If deep-linkable panels are desired later, mirror panel state to a query param. · effort M

### A15-005 · Admin hero UGX 2.45B / 321 branches verified correct for admin scope (source figure for A22-001 bleed)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A15 / verification / admin — /dashboard hero
- **Location:** `admin /dashboard hero (get_platform_overview)`
- **Roles:** admin
- **Impact:** None on the admin surface; recorded so the A22-001 source screenshot is traceable. The cross-tenant bleed of this figure into distributor d-002's cache is A22-001's finding, not an admin-side defect.
- **Repro:** 1) Sign in as admin at /admin/login 2) Hero shows UGX 2.45B / 321 branches / 5,064 subscribers — all match SQL
- **Evidence:** `psql ...` platform totals: subscribers 5064, active 3968, distributors 3, employers 8, branches 321, agents 2046, AUM 2450226487 (2.4502B), contributions 2.0038B — every hero figure matches. Screenshot screenshots/admin/index-1440.png.
- **Suggested fix (NOT applied):** No admin-side action; fix belongs to A22-001 (clear React Query cache on login, not only logout). · effort S

### A16-003 · All seeded employer invites are expired; /invite/:token entry flow is not demoable from seed data
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A16 / data-staleness / Employer-invite onboarding
- **Location:** `live table public.employer_invites (4 rows)`
- **Roles:** public/anonymous, employer
- **Impact:** A rep who opens any of the 4 seeded /invite/<token> links hits the 'Invite unavailable — invite expired' screen. No UI surfaces these seed tokens, so normal demo flow mints a fresh invite (7-day window) from the employer dashboard, which works — hence info-level. Flag for whoever refreshes demo data before an invite-onboarding demo.
- **Repro:** 1) psql: SELECT token FROM employer_invites WHERE status='pending' LIMIT 1 2) Open http://localhost:5173/invite/<that token>/ 3) Screen shows 'Invite unavailable' / 'invite expired'
- **Evidence:** Command: psql "$SUPABASE_DB_URL" -c "SELECT status,count(*),max(expires_at) FROM employer_invites GROUP BY status;" => 'pending | 4 | 2026-08-14 12:09:42+00' (today 2026-08-24). Browser: node docs/audits/2026-08-23/scratch/a16/invite.mjs against a real seeded token => screen 'Invite unavailable' / body 'invite expired' (get_employer_invite RPC 400). get_employer_invite prosrc raises 'invite expired' when expires_at<=now().
- **Suggested fix (NOT applied):** Re-seed at least one employer_invites row with expires_at in the future (or bump the existing rows' expires_at) as part of demo-data refresh. · effort S

### A17-009 · Web fonts load async (FOUT/CLS on cold load)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A17 / typography-loading / every page (first load)
- **Location:** `index.html:39`
- **Roles:** public, subscriber, agent, branch, distributor, employer, admin
- **Impact:** Cold demo first-paints in system sans-serif then swaps to Plus Jakarta Sans/Inter — a brief FOUT and possible CLS, and a CDN dependency that matters on poor Ugandan connectivity. One-time, non-blocking.
- **Evidence:** index.html:39 loads Google Fonts via media="print" onload="this.media='all'" + display=swap, with preconnect but no preload of the woff2 files. Fallbacks --font-display/--font-body end in generic 'sans-serif' with no size-adjust/font-size-adjust. No @font-face/self-hosting (grep of src/index.css and modules).
- **Suggested fix (NOT applied):** Preload the two woff2 subsets (or self-host), or accept as demo-scope. · effort S

### A18-007 · PWA manifest is minimal: no shortcuts/screenshots/share_target/protocol_handlers, single maskable icon
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A18 / pwa-manifest / PWA install
- **Location:** `public/manifest.webmanifest`
- **Roles:** subscriber
- **Impact:** No user-visible effect for the demo; the manifest is valid and installable. Missing enhancements would improve Android install UI and quick actions.
- **Evidence:** cat public/manifest.webmanifest: has name, short_name, description, id, start_url, scope=/, display=standalone, orientation=portrait, theme/background #292867, lang en-UG, categories [finance], 3 icons (icon-192 any, icon-512 any, icon-maskable-512). Missing: shortcuts, screenshots, share_target, protocol_handlers, maskable-192, monochrome/badge icon. ls public/icons/ confirms icon-192/512/maskable-512/apple-touch-icon-180 present.
- **Suggested fix (NOT applied):** Optionally add shortcuts, screenshots, a maskable-192 and a monochrome icon if richer install UX is wanted. · effort S

### A18-008 · No offline data mode (no navigator.onLine, no write queue); failures surface as toasts, not silent
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A18 / offline / all roles (mobile/desktop)
- **Location:** `src/ (no navigator.onLine anywhere); src/subscriber-dashboard/pages/SavePage.jsx:204; public/sw.js:64-73`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** Acceptable demo scope for an always-online sales tool: offline the app boots but shows error toasts on any data action rather than an offline mode. No silent data loss.
- **Evidence:** grep -rn navigator.onLine|addEventListener('online'|'offline' src returns only an unrelated agent-status label. No offline write queue exists. The SW serves the cached SPA shell for navigations, but the prod API is cross-origin and never cached, so offline every fetch/mutation fails. SavePage.jsx:204 shows addToast('error', ... 'Could not complete the top-up.') and TanStack mutations use retry:0 — so loss is NOT silent (spec's 'silent data loss = High' does not fire). Note: offline.html is effectively dead code — index.html is always precached so sw.js:71 returns it before offline.html.
- **Suggested fix (NOT applied):** None required for the demo. If real offline support is ever wanted, add navigator.onLine detection + an outbox queue and surface an offline banner. · effort L

### A18-009 · No in-dashboard install affordance for any of the 6 roles (landing-mobile only)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A18 / pwa-install / 6 role dashboards vs mobile landing
- **Location:** `src/pages/landing/shell/LandingMobileShell.jsx (InstallPromptProvider + InstallBanner + LandingInstallSheet); src/pages/landing/shell/installPrompt.jsx`
- **Roles:** subscriber, agent, branch, distributor, employer, admin
- **Impact:** None beyond expectations — the spec explicitly notes this as expected. Dashboard users on mobile web have no prompt to install the PWA; they must use the browser's own install menu.
- **Evidence:** grep -rn 'InstallPromptProvider|<InstallBanner|<LandingInstallSheet' src: all hits under pages/landing/shell/ only. installPrompt.jsx reviewed: beforeinstallprompt preventDefault+defer (68-71), promptInstall (84-97), appinstalled (72-75), detectStandalone via display-mode + navigator.standalone (43-50), localStorage dismissal DISMISS_KEY (52-58,99-106) — all correct, but scoped to the landing.
- **Suggested fix (NOT applied):** Optionally surface the existing install affordance inside the mobile dashboards for subscribers. · effort M

### A19-I1 · Ultrawide (2560px) shows large but symmetric intentional gutters — no defect (recorded to prevent re-flagging)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A19 / layout-intentional / all six desktop shells
- **Location:** `src/subscriber-dashboard/shell/SubscriberDesktopShell.module.css:152 (.page max-width 880 / .pageWide 1240); agent/branch/employer .page max-width 1280; all margin:0 auto`
- **Impact:** None — the centred reading column is a deliberate, consistent choice. Recorded so the ultrawide 'waste' is not mistaken for a defect.
- **Failure scenario:** N/A — no failure; documented as intentional.
- **Evidence:** Screenshots scratchpad/a19-dist-subs-{1024,1440,1920,2560}.png and a19-sub-overview-2560.png: content caps ~1035-1280px and centres with symmetric ~640px gutters at 2560; clean and consistent 1024->2560, no overflow or broken columns.
- **Suggested fix (NOT applied):** No change needed. · effort S

### A19-I2 · Historical map onEachFeature empty-name->id race is fixed (refuted)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A19 / refuted-historical-bug / distributor + admin map mode (UgandaMap)
- **Location:** `src/dashboard/map/UgandaMap.jsx:396-404`
- **Impact:** None — the historical empty-name->id race is guarded. Recorded as refuted.
- **Failure scenario:** N/A — race no longer reproduces; guarded no-op.
- **Evidence:** onRegionClick/onDistrictClick resolve name->id via a ref map and guard the drill: 'const id = ...Ref.current[name]; if (id) drillDown(level, id);'. An empty/unknown feature name resolves to undefined -> if(id) false -> silent no-op, never a drill to a wrong id. Tooltip built via document.createElement/textContent (no HTML-string injection).
- **Suggested fix (NOT applied):** No change needed. · effort S

### A20-010 · <html lang="en"> while every formatter uses en-UG
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A20 / i18n / global document
- **Location:** `index.html:2; src/utils/currency.js:16; src/utils/date.js:11`
- **Roles:** all
- **Impact:** No material user-visible effect (en and en-UG are both English).
- **Evidence:** <html lang="en">; LOCALE='en-UG' declared twice; 18 direct en-UG call sites; og:locale=en_UG. Content is English, so the mismatch is cosmetic for SR pronunciation.
- **Suggested fix (NOT applied):** Set <html lang="en-UG"> for consistency. · effort S

### A21-005 · Six stacked permissive RLS SELECT policies add per-row overhead on large list reads
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A21 / efficiency / database RLS (cross-ref A02)
- **Location:** `public.subscribers SELECT policies (+ 17 other tables)`
- **Roles:** distributor, admin, branch, agent, employer
- **Impact:** Per-row policy evaluation on the 4,600-row list read. Deliberate 6-roles-one-table design, not a bug; consolidation into one app_role-gated policy would reduce per-row work.
- **Evidence:** Supabase performance advisor: 90 multiple_permissive_policies warnings. subscribers SELECT = 6 permissive policies (_select_admin/_agent/_branch/_distributor/_employer/_self) OR-evaluated per row, each reading auth.jwt(). EXPLAIN ANALYZE of the 5000-row list join executed in ~297ms; this per-row RLS work is part of that cost.
- **Suggested fix (NOT applied):** A02 to consider consolidating the 6 per-role SELECT policies into a single policy branching on auth.jwt()->>'app_role'. · effort L

### A21-006 · Free-tier cold start compounds first-paint of the first data screen
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A21 / infra-performance / backend cold start (cross-ref A09)
- **Location:** `render.yaml (plan: free); src/components/WarmupBanner.jsx:16`
- **Roles:** all
- **Impact:** A rep opening the demo cold waits 30-60s (Render) and up to ~2min (Supabase restore) before the first data screen paints; WarmupBanner mitigates the Render half by pinging on boot.
- **Evidence:** render.yaml plan: free, region singapore. WarmupBanner.jsx:16 comment: 'Render free-tier instances cold-start in 30-60s.' main.jsx mounts <WarmupBanner/> which fires warmupBackend() on boot. Baseline documents Supabase auto-pause (~2min restore, H-class). Measured landing LCP 312ms (fast) so the cold-start cost lands on the first data screen only.
- **Suggested fix (NOT applied):** Owned by A09. Options: a paid always-on Render instance for demos, and a Supabase keepalive that actually touches Postgres (the current /healthz is I/O-free and cannot prevent the pause). · effort M

### A21-007 · No metric-matched font fallback (measured CLS negligible)
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A21 / cls / landing + all pages
- **Location:** `src/index.css:31-32; index.html font link`
- **Roles:** all
- **Impact:** A layout shift is theoretically possible on a pathologically slow gstatic fetch but did not materialize in measurement. Defense-in-depth only; effectively a PASS.
- **Evidence:** Async Google Fonts correctly non-render-blocking (media=print onload swap + preconnect to googleapis + gstatic, display=swap). Playwright-on-preview measured landing CLS 0.0001 (desktop) / 0 (Slow-4G+4xCPU). grep for size-adjust/ascent-override/@font-face across src/**.css: none -- fallbacks are generic 'Plus Jakarta Sans',sans-serif / 'Inter',sans-serif.
- **Suggested fix (NOT applied):** Optional: add a metric-matched @font-face fallback (size-adjust/ascent-override) or self-host the two faces to remove the third-party critical-path dependency. · effort S

### A22-007 · No global QueryCache.onError — every read failure is silent unless the consuming component individually guards isError
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A22 / error-handling / react-query root config
- **Location:** `src/main.jsx:69 (new QueryClient — no QueryCache/MutationCache onError)`
- **Roles:** admin, distributor, branch, agent, employer, subscriber
- **Impact:** No user-visible surface for a read that a component does not explicitly guard. Recorded for context; the concrete user-visible manifestation and fix are folded into A22-002.
- **Failure scenario:** any read query rejects in a component that does not read isError → nothing renders an error → the UI shows loading-then-empty with no signal to the user.
- **Repro:** 1) Inspect src/main.jsx QueryClient defaultOptions — no queryCache/onError is configured
- **Evidence:** grep -n 'QueryCache|onError|MutationCache' src/main.jsx → none. Architectural root of A22-002 and A22-003: reads that no component guards fail invisibly.
- **Suggested fix (NOT applied):** Add a QueryCache onError handler on the root QueryClient that shows a non-blocking toast for unexpected read failures (excluding auth-expiry, which routes to logout). · effort S

### A24-007 · The single raw-HTML sink is correctly escaped today — and it writes into a popup that can read the session token
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A24 / xss-hardening / subscriber + signup (policy certificate)
- **Location:** `src/signup/contribution/insurancePolicyCertificate.js:37-44, 439`
- **Roles:** subscriber
- **Impact:** No defect today. But a single future field interpolated without escapeHtml() is not a cosmetic bug — it is a direct read of localStorage['upensions_token'] from a same-origin document, with no CSP in force to stop it (A24-002). The escaping is hand-rolled and no test asserts it against hostile input; the existing unit test asserts markup shape only.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && grep -on '\${[^}]*}' src/signup/contribution/insurancePolicyCertificate.js   # 37 interpolations, all safe 2) node docs/audits/2026-08-23/a24-winopen-probe.mjs   # popup is same-origin and can read the opener's localStorage
- **Evidence:** It is the ONLY raw-HTML sink in 610 client files:
$ grep -rn "dangerouslySetInnerHTML" src api server public index.html            → (no output)
$ grep -rn "\.innerHTML\|outerHTML\|insertAdjacentHTML" src api server public   → (no output)
$ grep -rnE "\beval\(|new Function\(" src api server public                     → (no output)
$ grep -rnE "srcDoc|createContextualFragment|createElement\(['\"]script|document\.write|javascript:" src --include='*.js' --include='*.jsx' | grep -v '\.test\.'
src/signup/contribution/insurancePolicyCertificate.js:439:  win.document.write(html);

I enumerated all 37 ${...} interpolations in the template and classified every one: constants (INDIGO/INK/SUBTLE), escapeHtml() outputs (product, holder, member, premiumLbl, cadence, beneficiary name/rel), or formatter 
- **Suggested fix (NOT applied):** Add a unit test that feeds `<img src=x onerror=...>` into every string field of buildPolicyCertificateHtml and asserts the output contains no `<img`, `<script` or `onerror`. That converts a convention into a guarantee before A24-001's fix makes this code path live again. · effort S

### A24-008 · xlsx security assessment — clean (no advisory, integrity-pinned, formula injection on write NOT reachable), with one bounded main-thread DoS caveat
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A24 / dependency / distributor settlement upload / employer bulk onboard / all xlsx exports
- **Location:** `package.json; src/utils/xlsx.js`
- **Roles:** distributor, employer, branch, subscriber
- **Impact:** No security defect. One residual: parseSheet runs on the MAIN THREAD (no Web Worker), so a 5 MB workbook — legitimate or crafted — blocks the tab for the duration of the parse. Both the distributor settlement upload and the employer bulk-onboard use it.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && node -e "const XLSX=require('xlsx'); const ws=XLSX.utils.aoa_to_sheet([['Name'],['=HYPERLINK(\"http://x\",\"c\")']]); console.log(JSON.stringify(ws['A2']))"   # t:"s" → not a formula 2) npm audit --json | python3 -c "import json,sys; print('xlsx' in json.load(sys.stdin)['vulnerabilities'])"   # False
- **Evidence:** The baseline is correct that npm reports NO advisory against xlsx, and I did not invent one.

$ (package-lock.json)
node_modules/xlsx { "version": "0.20.3", "resolved": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz", "integrity": "sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==" }
$ node -e "console.log(require('.../node_modules/xlsx/package.json').version)"  → 0.20.3

0.20.3 is the maintained SheetJS build, past prototype pollution (CVE-2023-30533, <=0.19.2) and ReDoS (CVE-2024-22363, <=0.20.1). Integrity IS pinned, so a CDN compromise fails the install.

Hardening already present in src/utils/xlsx.js: MAX_UPLOAD_BYTES = 5 MB, XLSX.read({ sheetRows: 50_000 }), and an extension + MIME allow-list applied BEFORE the bytes reach the parse
- **Suggested fix (NOT applied):** No action required for security. If a rep ever reports a frozen tab on upload, move parseSheet into a Web Worker, and tighten MAX_UPLOAD_BYTES toward the real template size (a few KB) rather than 5 MB. · effort M

### A24-009 · Sentry is wired end to end but completely inert in production — the SDK is not even in the bundle
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A24 / observability / whole app
- **Location:** `src/main.jsx:29-38; vercel.json:11 (connect-src https://*.sentry.io)`
- **Roles:** all
- **Impact:** Not a defect for a demo tool, but three things are quietly untrue: (a) the careful PII scrubber in src/utils/sentryScrub.js has never run in production; (b) ErrorBoundary's Sentry forwarding is a no-op, so the only record of a frontend crash is console.error; (c) the CSP allow-lists https://*.sentry.io in connect-src for traffic that does not exist. "We have error reporting" is not currently true.
- **Repro:** 1) curl -s https://uganda-dashboard.vercel.app/ | grep -o '/assets/[A-Za-z0-9_.-]*\.js' | sort -u 2) for f in <those chunks>; do curl -s https://uganda-dashboard.vercel.app$f | grep -oic sentry; done   # 0 for every chunk
- **Evidence:** VITE_SENTRY_DSN is unset in the Vercel build, so Sentry.init never runs — and Vite's static replacement turns the whole guard into dead code, which Rollup then uses to drop the import entirely.

$ for f in prod*.js; do printf "%-36s sentry=%s captureException=%s browserTracing=%s\n" "$f" "$(grep -oic sentry "$f")" "$(grep -oc captureException "$f")" "$(grep -oc 'browserTracing\|BrowserClient' "$f")"; done
prodindex-IM_IiCjH.js                sentry=0 captureException=0 browserTracing=0
prodvendor-CRnas3xB.js               sentry=0 captureException=0 browserTracing=0
prodvendor-motion-B1udY_rf.js        sentry=0 captureException=0 browserTracing=0
prodvendor-react-DWMwQj0t.js         sentry=0 captureException=0 browserTracing=0
prodvendor-router-BuR1e31r.js        sentry=0 captureException=
- **Suggested fix (NOT applied):** Either set VITE_SENTRY_DSN in the Vercel project (the scrubber and beforeSend wiring are already correct and sendDefaultPii is explicitly false), or drop https://*.sentry.io from the CSP connect-src and note in the runbook that frontend errors are console-only. · effort S

### A24-010 · Transient PostgREST 25P02 500s observed mid-audit — hypothesis actively REFUTED, not a product defect
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A24 / audit-hygiene / live PostgREST (project ilkhfnoyxlxwqadebnkp)
- **Location:** `live PostgREST connection pool`
- **Roles:** all
- **Impact:** None. The burst correlates with the audit's own concurrent load — 27 agents hammering one free-tier project — and cleared on its own. Recorded here so downstream agents who catch a 25P02 re-measure after a cool-down instead of writing it up as a product defect.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && node docs/audits/2026-08-23/a24-recheck-subscriber.mjs   # currently 6/6 clean loads
- **Evidence:** During my first captures (approx. 08:05-08:15 UTC) the live PostgREST returned {"code":"25P02","message":"current transaction is aborted, commands ignored until end of transaction block"} on 8-30% of AUTHENTICATED reads across unrelated tables, hitting real UI surfaces — the admin notification bell (HEAD /rest/v1/notifications 500) and the subscriber dashboard's single data call (GET /rest/v1/subscribers?select=*,subscriber_balances(*),... 500).

I chased the obvious hypothesis (that an anon read tripping A24-003's 42501 poisons pooled connections) and DISPROVED it under controlled conditions:
STEP 0 clean baseline (40 authenticated reads): 500s = 0
STEP 1 fire ONE anon SELECT on public.branches:  -> HTTP 401 {"code":"42501",...}
STEP 2 immediately: 40 authenticated reads: 500s = 0
STEP 3 
- **Suggested fix (NOT applied):** No action. If 25P02 500s reappear outside an audit window (i.e. during a real demo), THEN investigate — the signature would be a genuinely aborted transaction inside a PostgREST request, and the first thing to check is whether any policy chain raises rather than filters (see A24-003). · effort S

### A25-013 · Exactly one genuinely flaky spec in the whole suite; the predicted 'prime flake candidates' are real defects
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A25 / test-reliability / e2e
- **Location:** `e2e/specs/regression/modal-escape.spec.ts:224`
- **Roles:** distributor
- **Impact:** None user-visible. Recorded so modal-escape:224 is not conflated with the 28 real defects, and so the collision-caused 'rerun-only' failures are not mistaken for flake.
- **Evidence:** a25/flake-diff.txt: 'BASELINE ONLY (passed on re-run) -> flaky (2)' = modal-escape:224 on chromium + webkit. The plan's predicted flake candidates (subscriber-signin:78, subscriber-signup:116, map-drill:250 x2) all REPRODUCED -> real WebKit defects, not flake. The 19 'rerun-only' failures were A22/A24 concurrency artifacts (isolated rerun a25/pw-rerun3-targeted.txt shows all pass).
- **Suggested fix (NOT applied):** Stabilise modal-escape:224 (single true flake). Run cross-agent E2E in isolation to avoid shared-dev-server collision that produced the 19 spurious rerun failures. · effort S

### A26-015 · No live doc carries a 'verified against live on <date>' line; docs/role-permissions.md has no temporal marker anywhere in 362 lines
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A26 / doc-hygiene / docs
- **Location:** `all 12 live docs; worst case docs/role-permissions.md`
- **Impact:** This is the cheapest structural fix in the report and it explains how every other finding accumulated: nothing in these files tells a reader when the claim was last true, so decay is invisible. BACKEND.md:44's 'Live census (verified 2026-07-08)' is the counter-example that proves the value - it is wrong, but it is dateably wrong, and a reader can weigh it. role-permissions.md, the document A02 measured its whole matrix against, offers no such handle at all.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard 2) for f in CLAUDE.md README.md docs/*.md .claude/skills/qa.md; do echo "$f :: $(grep -oiE '(last (updated|sync|verified)|as of|snapshot)[^.|]{0,40}' "$f" | head -1)"; done 3) head -3 docs/role-permissions.md 4) for f in $(find docs/audits -maxdepth 2 -name '*.md' | grep -v 2026-08-23); do head -1 "$f" | grep -c 'Historical audit'; done | sort | uniq -c
- **Evidence:** $ for f in CLAUDE.md README.md docs/FRONTEND.md docs/BACKEND.md docs/ARCHITECTURE.md docs/SPEC.md docs/data-model.md docs/role-permissions.md docs/api-contracts.md docs/migrations-runbook.md docs/render-operational.md .claude/skills/qa.md; do d=$(grep -oiE '(last (updated|sync|verified)|as of|snapshot)[^.|]{0,40}' "$f" | head -1); echo "$f :: ${d:-NONE}"; done
...
docs/role-permissions.md :: NONE

Results: docs/migrations-runbook.md is the only file that dates AND scopes itself correctly ('the one-time apply/verify/rollback runbook for migrations 0045-0057 ... Treat it as a historical record'). docs/ARCHITECTURE.md discloses a May-2026 pin (honest). docs/BACKEND.md and docs/FRONTEND.md carry inline markers ('verified 2026-07-08' / 'at last sync') but no doc-level header date. README.md war
- **Suggested fix (NOT applied):** Add one two-line block under each agent-guide header: '> Verified against the live Singapore DB (ilkhfnoyxlxwqadebnkp) on YYYY-MM-DD. Counts (tables, functions, policies, migrations, routes, file inventories) decay fast - re-measure before relying on any number here.' Priority order: role-permissions.md, api-contracts.md, data-model.md, CLAUDE.md, then the rest. Drafted in DOC-CORRECTIONS.md §14. No action needed on the 29 archived audit docs (§15). · effort S

### A26-016 · The anon-EXECUTE surface is documented as 3; it is 13, and the sentence contradicts itself
- **Severity/Confidence:** info / confirmed
- **Agent/Category/Surface:** A26 / doc-accuracy-privilege-surface / docs
- **Location:** `docs/BACKEND.md:428, docs/BACKEND.md:657`
- **Impact:** Informational rather than a security defect - Postgres refuses to invoke a trigger function directly ('trigger functions can only be called as triggers'), so the 10 are not an exploitable surface, and A03 owns proving that per call. But a reviewer running the obvious has_function_privilege('anon', ...) query gets 13 and cannot reconcile it with the doc's headline, costing a cycle. The audit plan's own §5 made the same class of error in the opposite direction, predicting 25.
- **Repro:** 1) cd /Users/shubhang/Desktop/Projects/uganda-dashboard && set -a; . ./.env.local >/dev/null 2>&1; set +a 2) psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE');" 3) psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1;" 4) grep -n 'only the 3 intended' docs/BACKEND.md
- **Evidence:** $ psql "$SUPABASE_DB_URL" -X -q -At -c "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE');"
13

docs/BACKEND.md:428 (0094 inventory row) contains both of these in one cell:
  'KEPT anon deliberately: create_subscriber_from_signup, create_subscriber_from_employer_invite, get_employer_invite - the three genuine pre-login surfaces - plus every trigger function (not usefully callable; revoking risks breaking INSERTs on the anon signup path).'
  'Verified after applying: ... only the 3 intended pre-login RPCs still anon-executable'
The two clauses cannot both be the headline. docs/BACKEND.md:657 repeats the '3' framing.

Per 00-baseline.md §5.2 the 13 are the 3 intentional grants plus 10 zero-
- **Suggested fix (NOT applied):** Replace the headline at :428 and :657 with the precise number and composition: '13 functions remain anon-EXECUTE: the 3 intended pre-login RPCs plus the 10 zero-arg RETURNS trigger functions that keep their default PUBLIC grant (listed). Postgres refuses to call a trigger function directly, so the 10 are not an exploitable surface - but the number is 13, not 3.' Also correct '46 app RPCs' -> 87. Drafted in DOC-CORRECTIONS.md §4. · effort S
