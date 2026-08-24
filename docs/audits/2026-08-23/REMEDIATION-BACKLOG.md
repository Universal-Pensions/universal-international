# REMEDIATION BACKLOG (report-only)

3 lanes, effort-sized S/M/L. Nothing applied.

## Lane 1 — BEFORE THE NEXT DEMO

| ID | Finding | Sev | Effort | Fix |
|---|---|---|---|---|
| A05-001 | apply_settlement has no tenancy check — any distributor can settle anoth | critical | S | Add an ownership predicate inside apply_settlement's per-row loop, mirroring 0087: IF |
| A05-002 | Agent demo persona's Commissions page shows Playwright test residue as r | critical | S | Delete the three orphan E2E-PARTIAL-* settlement_batches rows and their notifications |
| A06-001 | 61% of the default employer persona's roster balance is uncleaned E2E te | critical | M | Delete the E2E residue: DELETE FROM public.transactions WHERE txn_ref LIKE 'EMP-%' AN |
| A11-001 | Agent Commissions shows E2E test residue as real settlement history + tw | critical | S | Delete the five E2E-* settlement_batches (and their notifications) from live; make di |
| A11-002 | Agent onboarding wizard cannot complete — final create RPC returns 409 ( | critical | S | Make the mock ID-OCR mint a fresh NIN per call (or per session), OR have create_subsc |
| A14-002 | E2E test residue displayed as live data across the employer demo dashboa | critical | M | Purge txn_ref LIKE 'EMP-%' residue + the E2E contribution_runs row from live demo dat |
| A22-001 | Cross-tenant cache bleed: login never clears the React Query cache, so a | critical | S | Call queryClient.clear() (or removeQueries) inside AuthContext.login as well as logou |
| A24-001 | Insurance policy certificate can never open — window.open(..., 'noopener | critical | S | Drop `noopener` from the feature string — it is meaningless for an about:blank docume |
| A04-001 | make_contribution accepts NaN / Infinity / unbounded amounts; NaN irreco | high | S | Replace the guard with a shared validator: `IF p_amount IS NULL OR p_amount <= 0 OR p |
| A04-002 | request_withdrawal validates only that the split legs SUM to the amount, | high | S | Add to the same IF block: `IF v_split_ret < 0 OR v_split_emg < 0 THEN RAISE EXCEPTION |
| A04-003 | A reseed leaves units at the dead 1,000 UGX price and zeroes bucket unit | high | S | Either (a) have the seed derive units from public.latest_nav() instead of the 1,000 l |
| A05-003 | settlement_batches.paid_amount / line_count do not equal the lines they  | high | S | Repair the five rows (drop the three orphan E2E batches; recompute sb-seed-0001 from  |
| A05-004 | Re-uploading the same settlement file settles another tranche against th | high | S | Add CREATE UNIQUE INDEX … ON settlement_batches (agent_id, txn_ref) WHERE txn_ref IS  |
| A05-005 | Two rows for the same agent in one settlement upload settle that agent t | high | S | Aggregate p_rows by agentId before the loop (SELECT agentId, sum(amountPaid) … GROUP  |
| A06-002 | E2E contribution-run cleanup orphans 1,824 transactions on a premise the | high | S | In the afterEach, delete transactions BEFORE the run header, scoped by the FK that ex |
| A06-003 | Seed's stale MOCK_NOW mirror pushes every contribution schedule 36 days  | high | S | Set scripts/seed-supabase.mjs:169 to new Date(2026, 6, 1) and update the comment, OR  |
| A06-004 | Agent and subscriber surfaces disagree on 1,284 members' policy status ( | high | S | Make buildAgentPolicies call derivePolicyStatus from src/utils/policies.js with the s |
| A06-005 | create_employer / create_distributor ignore the identity-write failure,  | high | S | Change create_employer and create_distributor from PERFORM to `v_bound := public.regi |
| A09-001 | Keepalive monitor cannot see or prevent the Supabase auto-pause that tak | high | S | Point keepalive.yml:31 at /readyz instead of /healthz (one line). /readyz performs on |
| A09-003 | `npm run seed` TRUNCATEs the live demo database with no confirmation and | high | S | Require an explicit `--yes-destroy <project-ref>` argument that must match the ref pa |
| A10-001 | All Transactions and Annual Tax Statement reports show no data / all zer | high | S | Point AllTransactions and AnnualStatement at useSubscriberTransactions(sub.id) (as Ac |
| A11-005 | Agent member detail shows 'Life cover · Active' for members whose own da | high | M | Have the agent policy view derive status from renewal_date via the same clock as the  |
| A13-001 | Distributor Reports route unreachable on every viewport below 1024px; Me | high | S | const usesReportsPanel = (role === 'distributor' || role === 'branch') && !isDesktop; |
| A14-001 | "Total contributions" computed from two irreconcilable sources; same scr | high | M | Feed the Overview Hero, Runs 'funded to date', and Analytics 'total contributions' fr |
| A15-001 | Mobile subscriber detail shows every member's Balance / Contributions /  | high | M | In SubscriberDetailMobile render formatUGX(sub.totalBalance) for Balance and add the  |
| A25-004 | E2E teardown leaks fixture rows into the LIVE demo DB, incl. 'E2E Branch | high | M | 1) expect(error).toBeNull() on every teardown delete. 2) A globalTeardown sweep of id |

## Lane 2 — NEXT SPRINT (rest of High + Medium)

| ID | Finding | Sev | Effort | Fix |
|---|---|---|---|---|
| A02-001 | Subscriber JWT can mint arbitrary money by POSTing straight to /rest/v1/ | high | S | Narrow the policy to the one shape the app needs: WITH CHECK (... AND type = 'premium |
| A02-002 | Subscriber can rewrite their own insurance cover, premium and status to  | high | M | Revoke UPDATE on the business columns of both tables from authenticated/anon and rout |
| A03-001 | Anon invite-completion RPC is not bound to the invited phone → cross-ten | high | S | In the re-tag and create branches, bind completion to the invited phone: require righ |
| A09-002 | Playwright E2E job times out on every push to main, so the §15-M1 db gua | high | M | Split e2e into its own job or raise timeout-minutes to >=45; move the §15-M1 assertio |
| A26-001 | Four documents assert that RLS blocks direct client writes; it does not, | high | S | Replace the assertion with the intent plus a pointer to measured reality. CLAUDE.md:1 |
| A26-002 | api-contracts.md instructs an agent to apply migration 0092 to live; it  | high | S | Replace row 240 entirely: "| Migrations | 0001-0108 | supabase/migrations/*.sql. Appl |
| A26-004 | docs/role-permissions.md disagrees with the measured RLS matrix in seven | high | M | :340 -> "distributor | Its OWN network only (branches.distributor_id -> agents.branch |
| A02-003 | contribution_schedules.insurance_funding_mode and the accrual counters a | medium | S | REVOKE UPDATE (insurance_funding_mode, insurance_premium_accrued, insurance_premium_t |
| A02-004 | Subscriber can create withdrawals and nominees rows directly, bypassing  | medium | S | Drop withdrawals_insert_self (the app already calls the request_withdrawal DEFINER RP |
| A02-005 | agent / branch / distributor can create and edit their own hierarchy row | medium | M | Pick one: either drop the six write policies so the DEFINER RPCs are the only door, o |
| A04-004 | request_withdrawal with bucket='emergency' for more than the emergency b | medium | S | In the p_bucket branch, read the locked balance row's bucket columns and RAISE when p |
| A04-005 | publish_nav_snapshot's p_unit_price <= 0 guard AND the unit_price > 0 CH | medium | S | Extend the guard to `IF p_unit_price IS NULL OR p_unit_price <= 0 OR p_unit_price = ' |
| A04-006 | Four unrelated down-migrations CREATE OR REPLACE the contribution trigge | medium | M | Add a guard header to each affected down-migration: a DO block that RAISEs if the NAV |
| A04-007 | NAV is 16 days stale and the 'Delayed NAV updation' counter cannot see i | medium | M | Have get_admin_attention compute staleness from the newest PUBLISHED day (CURRENT_DAT |
| A04-008 | v_reconciliation_exceptions checks the shilling split but not the unit l | medium | S | Add two branches to v_reconciliation_exceptions: unit_split_mismatch (abs(retirement_ |
| A04-009 | 33 leftover E2E employer contribution runs (1,881 rows, 145.37M UGX) per | medium | M | Extend the E2E fixture to record the txn_ref returned by submit_employer_contribution |
| A04-010 | Four leftover E2E subscribers named 'TST tree member' / 'TST retag probe | medium | S | Reverse the deletion order in cleanupSubscriberByPhone (parent last is correct for FK |
| A04-011 | The idempotency nonce is claimed AFTER the money write with ON CONFLICT  | medium | S | Claim the nonce FIRST and let the unique index arbitrate: `INSERT INTO public.money_n |
| A05-006 | apply_settlement has no NULL guard on amountPaid — a row with no amount  | medium | S | After the round(), add: IF v_amount_paid IS NULL OR v_amount_paid <= 0 THEN v_skipped |
| A05-007 | Over-payment is silently swallowed — the entered amount above the due to | medium | S | Either cap and report — add a skip entry {reason:'overpaid', unallocated:<remainder>} |
| A05-008 | Seeded settlement batches are stamped with the wrong branch, so the b-ka | medium | S | In scripts/seed-supabase.mjs settlementSeeds, derive branchId from the agent (as the  |
| A05-009 | 0089's down-migration would silently revert NAV pricing — it re-emits tr | medium | M | Regenerate the affected down files from the live function body at authoring time — th |
| A06-006 | Four abandoned E2E fixtures are 4 of the 7 rows on the Admin Reconciliat | medium | S | DELETE FROM public.subscribers WHERE id LIKE 'tst-sub-%' (4 rows; they have no child  |
| A06-008 | DB invariant #5 is vacuous by 41 days and blind to 21 NULL rows | medium | S | Import the single shared MOCK_NOW (see A06-003 fix) instead of the local literal. Add |
| A06-009 | A fifth clock, public._demo_now() = 2026-05-18, is live in SQL and 44 da | medium | M | Either move _demo_now() forward in lockstep with mockData's MOCK_NOW (a one-line migr |
| A06-010 | SUBSCRIBER_CHILD_TABLES misses three subscriber-FK tables; two of them h | medium | S | Add money_nonces, subscriber_balances_pre_nav and employer_invites to SUBSCRIBER_CHIL |
| A06-011 | The only employer created through the live approval path has an empty co | medium | S | Have create_employer default default_contribution_config to the standard {"employeePc |
| A07-001 | Sentry scrubber has no NIN redaction pattern | medium | ? | add NIN_RE + 'nin' to SENSITIVE_KEYS |
| A09-004 | Enforcing the report-only CSP would break the app's typography three way | medium | M | Preferred: self-host Plus Jakarta Sans and Inter into public/fonts/, which lets style |
| A09-005 | Frontend Sentry is not configured in production — @sentry/react is tree- | medium | S | Set VITE_SENTRY_DSN (and ideally VITE_SENTRY_RELEASE wired to VERCEL_GIT_COMMIT_SHA)  |
| A09-006 | render.yaml is not the applied configuration — the live build command ha | medium | S | Re-apply the blueprint so the live buildCommand matches render.yaml (or edit the live |
| A09-007 | Keepalive fires roughly a third as often as its own stated design ration | medium | S | Either correct the comment to the measured reality, or move the ping to an external s |
| A09-008 | Dependabot security alerts are disabled, and 12 version PRs are wedged b | medium | M | Enable Dependabot alerts in repository settings. Unblock the grouped PR by pinning es |
| A09-009 | No documented rollback for the frontend or the API, and 22 migrations ca | medium | M | Add a short 'Rollback' section to docs/render-operational.md covering (a) Vercel: `ve |
| A10-002 | Insurance settings shows '0 beneficiaries on file' when a beneficiary ex | medium | S | Read useSubscriberNominees(sub.id) inside InsurancePage (as NomineesPage does), or ma |
| A11-003 | Desktop agent home shows scheduled monthly-equivalent (UGX 331K) but lab | medium | S | On desktop use the actual collected figure (as mobile does) for a 'saved this month'  |
| A11-004 | Agent Settings renders a malformed phone with a double country code (+25 | medium | S | Replace the local formatPhone + literal '+256 ' with formatUGPhone(phone) (utils/phon |
| A11-006 | 'Yet to contribute' flashes the entire roster (11) before the contributi | medium | S | Gate the list render on the contributions query too (show the skeleton until useAgent |
| A12-001 | Branch collections charts drift against the demo clock — wall-clock mont | medium | S | Pass MOCK_NOW (src/data/mockData.js) as the `now` argument to the label helpers in Ov |
| A12-002 | Agent-detail gender donut prints percentages as a subscriber count ('100 | medium | S | Use metrics.totalSubscribers for the section tag, not the sum of the two percentages. |
| A12-003 | District rank computed from a stale stored score, not the 'recomputed da | medium | M | Rank branches on the same live score the gauge shows, or drop the 'recomputed daily'  |
| A12-005 | Per-agent subscriber list is desktop-only — unreachable on mobile | medium | M | Add the agents/:agentId/subscribers route (and a 'View subscribers' affordance in Age |
| A14-003 | Expired invites labeled "awaiting sign-up" on Overview & roster, contrad | medium | S | Compute the Overview/roster 'pending' figure with the same expires_at split the Pendi |
| A15-002 | Admin platform hero has no error/retry state; a failed money read render | medium | S | Give the shared hero an isError branch (message + Retry that calls refetch()); add a  |
| A15-003 | Reconciliation queue shows leftover test-fixture rows ("TST tree member" | medium | S | Delete the 4 tst-sub-* subscribers left by prior test runs (and any orphaned rows); t |
| A16-001 | Mobile public pages (FAQ/Contact/About/Request-access) render with no <h | medium | S | Promote the top heading of each *Mobile screen to <h1> (AboutMobile h3->h1 and demote |
| A17-001 | Circular avatars violate the standing "no circular avatars" house rule a | medium | M | Standardise .avatar/.avatarInitials on var(--radius-md) (or --radius-sm); remove the  |
| A17-002 | Type scale is bypassed: 76 distinct ad-hoc font sizes, 519 of them below | medium | L | Map font-sizes to --text-* tokens; set a floor of --text-xs (12px) for anything not a |
| A17-003 | Four dashboard BottomSheets declare aria-modal but implement no focus tr | medium | M | Promote the hardened landing BottomSheet to a single shared primitive; delete the 4 s |
| A18-001 | iOS Safari zoom-on-focus: dashboard/search/payment inputs render below 1 | medium | S | Add a @media (max-width:1023px) bump forcing font-size:16px on the global .input prim |
| A18-002 | 769-1023px dead band renders a stretched phone shell (iPad-portrait widt | medium | M | Either add a tablet layout for 769-1023px, or drop the shell breakpoint to min-width: |
| A18-003 | Bottom sheets and PaySheet do not lock body scroll; page scrolls behind  | medium | S | Apply the Modal.jsx body-scroll-lock pattern (or a shared useBodyScrollLock hook) to  |
| A19-001 | Refresh loses the current view on distributor + admin desktop (reverts t | medium | M | Reflect the active rail destination + mode in the URL (a query param or path segment) |
| A19-002 | Distributor + admin panel/rail views are not deep-linkable or shareable  | medium | L | Give each rail destination a routed path (or query param) as the four routed shells a |
| A19-003 | Browser Back exits the dashboard instead of undoing a panel switch | medium | L | Route panel navigation (per A19-002) so Back traverses panel history naturally; or in |
| A19-004 | Distributor + admin Subscribers (~4,602) / Agents (~2,046) lists defeat  | medium | M | Point getScrollElement at the actual scroll viewport in fullPage mode (the .dashHost  |
| A19-005 | Distributor + admin Ask-AI Copilot declares aria-modal but does not trap | medium | S | Either add a Tab/Shift+Tab trap + background inert while open (matching Modal.jsx), o |
| A20-001 | Public site footer nav links render invisible (1.35:1) on desktop landin | medium | S | Set an explicit light color on .footer a / .link (e.g. var(--color-lavender)) with sp |
| A20-002 | Widespread AA contrast failures incl. status pills and the green money v | medium | M | Use the darker --color-kyc-success #1f6e44 (6.23:1) for green pill/value text, or enl |
| A20-003 | aria-modal dialogs without focus trap/restore (incl. PaySheet payment su | medium | M | Extract Modal.jsx's focus-trap into a shared useFocusTrap hook and apply to every ari |
| A20-004 | Closed landing nav drawer keeps focusable children tabbable while aria-h | medium | S | Render the drawer contents only when open, or apply inert / tabindex=-1 to its focusa |
| A20-005 | Horizontally/vertically scrollable data tables are not keyboard-accessib | medium | S | Add tabindex="0" and an aria-label to the scroll containers (axe's canonical fix). |
| A21-001 | Distributor/admin subscriber list downloads the entire collection client | medium | M | Wire the list to the already-built getEntityPage server-side paginate+filter+sort pat |
| A22-002 | Primary dashboard hero money reads have no error/retry state — a read fa | medium | M | Give the shared hero an isError branch (message + Retry calling refetch()); add a glo |
| A22-003 | Mid-session JWT expiry on the direct-Supabase path never re-logs-in; for | medium | M | Call forwardSupabaseAuthError(error) on every .rpc/.from result (or centralise it in  |
| A22-004 | Raw technical error strings ('TypeError: Failed to fetch', raw Postgres  | medium | M | Map known err.code values to friendly copy and default to the fallback for anything u |
| A22-005 | Access-request approve/reject does not invalidate adminAttention, so the | medium | S | Add queryClient.invalidateQueries({ queryKey: ['adminAttention'] }) and ['adminAttent |
| A24-002 | CSP is report-only, reports nowhere, and cannot be enforced as written — | medium | S | Add https://fonts.googleapis.com to style-src and https://fonts.gstatic.com to font-s |
| A25-001 | Baseline Playwright suite ships RED with 30 deterministic failures (28 r | medium | L | Treat the 28 reproduced failures as product defects and route root-cause to A10/A16/A |
| A25-002 | Mobile E2E coverage is 0-8% for 4 of 6 roles, exactly where the product  | medium | M | Expand the two mobile testMatch lists to include each role's home landing and primary |
| A25-003 | Four 'contract' tests grep migration TEXT and never touch the DB, provin | medium | S | Add one ~40-line behavioural twin under e2e/specs/db/ that runs the identical regex b |
| A25-005 | Money engine's live invariants are essentially unguarded; 2 are violated | medium | M | Add behavioural specs under e2e/specs/db/ for M1 (every subscriber has exactly one ba |
| A25-006 | api/, server/, e2e/ TypeScript (100 files) is not linted at all | medium | S | Add a flat-config block: { files: ['api/**/*.ts','server/**/*.ts','e2e/**/*.ts','*.co |
| A25-007 | No typecheck script; tsc checks 32 of 100 .ts files and skips all tests  | medium | S | Add e2e/tsconfig.json (extends server, include ['**/*.ts','../playwright.config.ts']) |
| A25-009 | All 34 jsx-a11y rules forced to 'warn' and lint has no --max-warnings; 3 | medium | S | 1) Pin the ceiling now: "lint": "eslint . --max-warnings=323" (ratchet down only). 2) |
| A25-011 | CI section 15-M1 'executed-not-skipped' guard runs only on push-to-main, | medium | S | Change the guard step to if: always() (or drop the condition); optionally tighten 'ex |
| A25-012 | Coverage gate is statements-only at 23% (10 points below actual); branch | medium | S | Raise statements to the current floor (~32) and add branch/function/line thresholds a |
| A26-003 | MOCK_NOW documented as 2026-05-26 in four docs; the real value is 2026-0 | medium | S | Docs (A26 scope): CLAUDE.md:201 -> "MOCK_NOW = new Date(2026, 6, 1) (2026-07-01) in s |
| A26-005 | Twelve of CLAUDE.md's thirteen 'binding' rules have no mechanical enforc | medium | M | Immediate (doc): insert after CLAUDE.md:108 an 'Enforcement reality' note naming whic |
| A26-006 | Every schema and architecture census in ARCHITECTURE.md and BACKEND.md i | medium | M | Refresh both censuses to the measured values and add the unjoinable-ledger warning to |
| A26-007 | Migration ledger head documented as 0076 in five places; the ledger's st | medium | S | Replace all five BACKEND.md occurrences with: 'live head 0108_nominee_claims_seed (ve |
| A26-008 | .claude/skills/qa.md misdescribes the suite it operates: 13 wrong claims | medium | M | Refresh the coverage map from the tree (18 flows, 4 db, 8 regression, 8 smoke), delet |
| A26-009 | docs/data-model.md field tables diverge from the live schema, and the Em | medium | M | Rewrite :241 to the unified model (staff ARE subscribers tagged via subscribers.emplo |

## Lane 3 — DEFERRED (112 Low/Info): polish, a11y, docs, dead code — batch by directory.
