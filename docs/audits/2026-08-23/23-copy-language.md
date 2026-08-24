# A23 · Copy, language & localisation

**Repo** `/Users/shubhang/Desktop/Projects/uganda-dashboard` @ `bd637f6` (main) · **Live DB** `ilkhfnoyxlxwqadebnkp`
**Report-only.** No file under `src/`, `api/`, `server/`, `supabase/`, `scripts/`, `public/` or any config was modified.
Everything written by this agent lives under `docs/audits/2026-08-23/` (probe scripts + one screenshot, listed in §10).

## Metrics
| Metric | Value |
|---|---|
| Artifacts in scope | 632 (490 non-test `src/**/*.{js,jsx}` files · 53 `api/`+`server/` `.ts` files · 89 live `pg_proc` functions) |
| Artifacts examined | 632 (100% machine-scanned; 46 files additionally read line-by-line) |
| Coverage | 100% |
| Checks defined | 26 (the spec's 8 numbered checks decomposed into 26 executable sub-checks) |
| Checks executed | 26 |
| Checks passed / failed / blocked | 7 / 19 / 0 |
| Findings C / H / M / L / I | 0 / 2 / 8 / 4 / 1 |
| Evidence commands run | 78 (greps, 14 `psql` queries against the live DB, 9 Node/Playwright probes, 2 `curl`) |
| Excluded as demo-scope | 3 (absence of an i18n library — spec check 8, INFO only; "NIN" as an acronym — it is the standard Ugandan civil-ID term, not jargon; mocked payment-brand copy) |
| Blocked, with reason | none |

### Domain metrics (required by the A23 spec)
| Metric | Value |
|---|---|
| Strings reviewed | **7,851** distinct user-visible candidate strings extracted from 490 files (`a23-extract-strings2` pass; the narrower first pass found 3,492) |
| Jargon flags **with a written plain replacement** | **62** (§1 table — the rewritten copy is the deliverable) |
| Currency-formatting sites | **37** total: 18 `toLocale*` bypasses outside `src/utils/` + 6 hardcoded `UGX …` string concatenations + 4 strip-and-re-add round trips + 9 standalone `<span>UGX</span>` prefix elements |
| `Intl.NumberFormat` / `Intl.DateTimeFormat` uses | **0** across `src/`, `api/`, `server/` |
| Currency inconsistencies proven on screen | **2** (compact vs exact for the same number on one screen; units 897.98 desktop vs 898 phone) |
| Locale-drift sites | **18** (5 × `en-GB`, 4 × `en-US`, 9 × direct `en-UG` bypassing `currency.js`/`date.js`) — rendered output identical today, see §3 |
| Dates at timezone risk | **22** `formatDate()` call sites fed by a `timestamptz`; **27,206 / 29,313** transaction rows (92.8%) shift a calendar day for any viewer west of UTC |
| Raw error codes shown to users | **2 CONFIRMED rendered** (`rate_limited`, `message_too_long`) + 85 call sites where the friendly fallback is unreachable + 17 bare snake_case DB exception texts + ~60 API responses carrying a `code` with no `message` |
| Terminology conflicts | **6** (see §6) |

---

## Traceability

Every numbered check in the A23 spec, decomposed, each mapped to exactly one disposition.

| # | Check | Disposition |
|---|---|---|
| 1a | Extract every user-visible string from the JSX | **PASS** — 7,851 strings from 490 files, `docs/audits/2026-08-23/a23-extract-strings.mjs` + the broader second pass |
| 1b | Flag financial jargon | **FINDING A23-007** |
| 1c | Flag English idiom | **FINDING A23-012** |
| 1d | Flag acronyms | **FINDING A23-007** (KYC); "NIN" **EXCLUDED-DEMO-SCOPE** (standard Ugandan civil-ID term, not jargon) |
| 1e | Flag paragraphs where a number/picture would do | **FINDING A23-007** (§1 rows P1–P6) |
| 1f | Give a plain replacement for each | **PASS** — 62 replacements written in §1 |
| 1g | Prioritise money screens and error text | **FINDING A23-001** (money screens), **A23-004** (error text) |
| 2a | `'UGX '` hardcoded as a string instead of `Intl.NumberFormat` — list EVERY site | **FINDING A23-010** — full list in §2.1; `Intl.NumberFormat` is used **nowhere** |
| 2b | Inconsistent thousands separators | **PASS** — every path resolves to the same `,` grouping; verified in Chromium + WebKit |
| 2c | Inconsistent decimal handling | **FINDING A23-006** — 0 dp / 1 dp / 2 dp coexist; proven on screen |
| 3a | Verify the real `en-GB` count (spec predicted ~5) | **PASS** — exactly **5** non-test sites, all in `src/admin-dashboard/` |
| 3b | Verify the real `en-US` count (spec predicted ~2) | **FINDING A23-010** — **4**, not 2; the spec undercounted |
| 3c | Verify the real direct-`en-UG` bypass count (spec predicted ~7) | **FINDING A23-010** — **9**, not 7 |
| 3d | Show a rendered example of the divergence | **PASS** — §3.2, rendered in Node, Chromium and WebKit. **The divergence is zero today**; this corrects the spec's premise |
| 4a | Confirm no timezone constant exists | **PASS** — `Africa/Kampala` appears in **0** files |
| 4b | Find every date that could render a day off for a Kampala user | **FINDING A23-005** — 22 sites; §4 |
| 4c | Focus on date-only rendering of `timestamptz` | **FINDING A23-005** — proven end-to-end in a browser |
| 5a | Are raw codes ever shown to a user — prove it either way | **FINDING A23-002 / A23-003** — proven **YES**, twice, rendered |
| 5b | Grep the error-rendering path | **FINDING A23-004** — `src/services/api.js:229` + 85 `err?.message \|\|` sites + `ErrorCard.jsx:24` |
| 5c | `unexpected_error` / `not_ready` / `db_error` reachability | **PASS** — all 5xx codes are masked by `api.js` as "Server unavailable"; they never reach a user |
| 5d | DB-layer raw codes | **FINDING A23-004 / A23-009** — 17 bare snake_case `RAISE EXCEPTION` texts live |
| 6a | member / subscriber / saver | **FINDING A23-008** |
| 6b | agent / field agent · branch / branch admin · distributor | **PASS** — consistent enough; 4 "Field agent" vs 7 "field agent" is casing only, folded into A23-008 as a note |
| 6c | nominee / beneficiary (not in the spec list; found while checking 6a) | **FINDING A23-008** |
| 7 | Empty-state and loading copy — reassuring and specific, or generic? | **FINDING A23-011** |
| 8 | Absence of an i18n library | **EXCLUDED-DEMO-SCOPE** — recorded as INFO in §8, not raised as a defect, per the spec |

---

## 0. Scope, method, and how severity was calibrated

The house style this audit measures against is the user's standing preference, treated as a requirement:
**UI copy must be dead simple. No jargon. Shillings. Written for low-literacy users. A clear picture beats a paragraph.**

That bar does **not** apply uniformly. This platform has six roles and only some of them are the
low-literacy audience:

| Surface | Audience | Bar applied |
|---|---|---|
| Public landing + `/claim` + `/contact` + signup | prospective members, bereaved families | **full house style** |
| Subscriber dashboard | the member | **full house style** |
| Agent dashboard | field agent on a phone | **full house style** |
| Branch / Distributor / Employer / Admin | salaried operators, B2B staff | plain-English bar; domain terms allowed |

So "AUM" on a distributor analytics tile is **low/info**, while "liquid savings" on the member's own
insurance slider is a real defect. Findings below are severity-calibrated on that basis, and every
finding says which surface it lives on.

**Method.** (1) A string extractor walked all 490 non-test `src/**/*.{js,jsx}` files and pulled JSX
text nodes, quoted props, bare string literals of ≥3 words, and sentence-shaped template literals —
7,851 distinct strings. (2) The extracted corpus was mined against a jargon/idiom/acronym lexicon.
(3) Every claim about currency, locale, timezone and error text was then **executed**, not reasoned:
live `psql` against `ilkhfnoyxlxwqadebnkp`, Node probes against the real formatters, and Playwright
against the running dev servers (Vite `:5173`, Express `:3001`, `/readyz` `{"ok":true}`).

---

## 1. The plain-language rewrite table (deliverable for check 1)

62 rewrites. Ordered by surface, money screens first. `file:line` is the exact anchor.

### 1.1 Subscriber money screens — the highest-priority set

| # | file:line | current | plain replacement |
|---|---|---|---|
| M1 | `src/subscriber-dashboard/pages/WithdrawPage.jsx:196` | `Locked until age 60 — your retirement savings unlock then. Use your Savings pot any time.` | `Your retirement money is locked until you are 60. You can take out money you can use now at any time.` |
| M2 | `src/subscriber-dashboard/pages/WithdrawPage.jsx:353` · `WithdrawalsHubPage.jsx:163` | `Only your emergency fund can be withdrawn before retirement.` | `Before you are 60, you can only take out money you can use now.` |
| M3 | `src/subscriber-dashboard/pages/WithdrawalsHubPage.jsx:19` | `Pull funds from your emergency or retirement bucket.` | `Take out money you can use now, or your retirement money.` |
| M4 | `src/subscriber-dashboard/pages/WithdrawalsHubPage.jsx:183` | `Emergency pot · retirement locked to 60` | `Money you can use now · retirement money locked until 60` |
| M5 | `src/subscriber-dashboard/pages/WithdrawPage.jsx:197` | `UGX 282K available · paid to your Mobile Money in 24 hours.` | `You can take out up to UGX 282,218. It reaches your Mobile Money within one day.` |
| M6 | `src/subscriber-dashboard/pages/WithdrawPage.jsx:393` | `Savings left after` | `What is left after this` |
| M7 | `src/subscriber-dashboard/pages/InsurancePage.jsx:337` · `:349` · `:350` | `How much of your liquid savings builds cover?` | `How much of the money you can use now should pay for your cover?` |
| M8 | `src/subscriber-dashboard/pages/InsurancePage.jsx:354` | `Nothing is going in, so this cover will not finish building. Raise it to start.` | `You are putting in nothing, so this cover will never start. Move the slider up to begin.` |
| M9 | `src/subscriber-dashboard/pages/InsurancePage.jsx:355` | `Higher means your cover starts sooner, but less of your saving stays available to withdraw.` | `Move it up and your cover starts sooner. Move it down and you keep more money you can take out.` |
| M10 | `src/subscriber-dashboard/pages/InsurancePage.jsx:254` | `Build speed set to 40% of your liquid savings.` | `You are now putting 40 out of every 100 shillings towards your cover.` |
| M11 | `src/subscriber-dashboard/pages/InsurancePage.jsx:197` | `Life cover lowered to UGX 2M. New premium starts next cycle.` | `Your life cover is now UGX 2,000,000. The new price starts from your next payment.` |
| M12 | `src/subscriber-dashboard/pages/InsurancePage.jsx:379` · `:515` | `Premium` | `What you pay` |
| M13 | `src/subscriber-dashboard/pages/InsurancePage.jsx:521` | `Next renewal` | `Next payment date` |
| M14 | `src/subscriber-dashboard/pages/InsurancePage.jsx:405` · `:406` | `Confirm downgrade to UGX 2M` / `Downgrade to UGX 2M` | `Lower my cover to UGX 2,000,000` |
| M15 | `src/subscriber-dashboard/pages/InsurancePage.jsx:422` | `Upgrade your cover` | `Raise your cover` |
| M16 | `src/subscriber-dashboard/pages/InsurancePage.jsx:548` | `You're paying to upgrade` | `You are paying to raise your cover` |
| M17 | `src/subscriber-dashboard/pages/SavePage.jsx:403` | `Units it buys` | `Shares of the fund this buys` (or drop the row — see P4) |
| M18 | `src/subscriber-dashboard/pages/SavePage.jsx:423` | `Paid into the buckets you set in your schedule.` | `Split the way you chose in your plan.` |
| M19 | `src/subscriber-dashboard/pages/SavePage.jsx:461` · `:664` | `UGX 25,000 is now working for you. Your new balance is UGX 1,411,092.` | `You added UGX 25,000. You now have UGX 1,411,092.` |
| M20 | `src/subscriber-dashboard/pages/SchedulePage.jsx:314` | `Your contribution schedule is saved. This is the balance for the current month from the changes you just made — settle it now to stay on track, or choose Maybe later.` | `Your plan is saved. Because you changed it, you owe UGX X for this month. Pay it now, or pay later.` |
| M21 | `src/subscriber-dashboard/pages/SchedulePage.jsx:330` | `Settle this month` / `Settle this period` | `Pay for this month` |
| M22 | `src/subscriber-dashboard/home/HomeDesktop.jsx:365` · `HomeMobile.jsx:154` · `reports/AnalyticsPanel.jsx:171` | `Units` / `Units held` | `Fund shares` — and add one line: `Your money buys shares in the fund. The price changes each day.` |
| M23 | `src/subscriber-dashboard/home/HomeDesktop.jsx` (INVESTMENT GROWTH tile) | `≈ UGX 11K more than you saved.` | `You have UGX 11,000 more than you put in.` (the `≈` glyph reads as noise to a low-literacy user) |
| M24 | `src/subscriber-dashboard/pages/HelpPage.jsx:27` | `Retirement savings unlock at age 60. Before then, use your Emergency bucket for hardship withdrawals.` | `You can take your retirement money at 60. Before then, take from the money you can use now — for sickness, school fees, home or business.` |
| M25 | `src/subscriber-dashboard/pages/ClaimPage.jsx:247` | `UGX 6,000,000 active cover · UGX 102,000 / yr · renews 1 Sept 2026` | `Your cover: UGX 6,000,000. You pay UGX 102,000 each year. Next payment 1 September 2026.` |
| M26 | `src/subscriber-dashboard/pages/ActivityPage.jsx:117` | eyebrow `THIS YEAR` + prefix `UGX` + a signed net figure | `Money in and out this year` with the number shown twice: `In: UGX …` / `Out: UGX …` (a signed `−UGX` net is the hardest possible shape for a low-literacy reader) |
| M27 | `src/subscriber-dashboard/reports/views/InsuranceStatement.jsx:121` · `:134` | `Your coverage at a glance` | `What your cover pays` |
| M28 | `src/subscriber-dashboard/pages/ReportsPage.jsx:44` | `Bucket, reason and settlement time.` | `Which money, why you took it, and when it arrived.` |
| M29 | `src/subscriber-dashboard/pages/ReportsPage.jsx:33` | `Month-by-month, retirement vs. emergency.` | `Each month: retirement money and money you can use now.` |

### 1.2 Signup + contribution setup (public, phone-first)

| # | file:line | current | plain replacement |
|---|---|---|---|
| S1 | `src/components/contribution/SubscriberScheduleForm.jsx:429` · `:794` · `ContributionSettings.jsx:1062`/`1094`/`1279`/`1414` | `Liquid savings` | `Money you can use now` |
| S2 | `src/components/contribution/SubscriberScheduleForm.jsx:650` | `Stays liquid` | `Stays yours to take out` |
| S3 | `src/components/contribution/SubscriberScheduleForm.jsx:646` (`aria-valuetext`) | `40 percent — UGX 8,000 to insurance, UGX 12,000 stays liquid` | `40 out of 100. UGX 8,000 pays for cover, UGX 12,000 you can take out.` |
| S4 | `src/components/contribution/SubscriberScheduleForm.jsx:688` · `ContributionSettings.jsx:644`/`673` | `Assign some liquid savings to start building.` / `Add liquid savings` | `Put some of the money you can use now towards cover.` |
| S5 | `src/components/contribution/SubscriberScheduleForm.jsx:813` | `Your new cover builds from your liquid savings — nothing extra to pay now.` | `Your cover is paid from the money you can use now. You pay nothing extra today.` |
| S6 | `src/signup/steps/BeneficiariesStep.jsx:180` | `Nominate at least one beneficiary for your pension. Move any slider — the others auto-adjust so the total always adds up to 100%.` | `Choose at least one person to get your money if you die. Move a slider and the others change so the shares always add up to 100.` |
| S7 | `src/signup/steps/BeneficiariesStep.jsx:175` | `Step 7 · Beneficiaries` | `Step 7 · Who gets your money` |
| S8 | `src/signup/steps/AmlStep.jsx:84` | `You're cleared. Moving on to beneficiaries…` | `All checks passed. Next: who gets your money.` |
| S9 | `src/signup/steps/NiraStep.jsx:209` | `Your details didn't match an existing record. Check your NIN and date of birth, then try again. If the problem continues, an agent can help in person.` | `We could not find you. Check your NIN and date of birth and try again. If it still fails, an agent can help you face to face.` |
| S10 | `src/signup/steps/ReviewStep.jsx:173` | `NIN must be 14 characters — CM or CF followed by 12 letters/numbers` | `Your NIN has 14 characters. It starts with CM or CF, then 12 more letters or numbers.` |
| S11 | `src/signup/contribution/ContributionSettings.jsx:262` · `:666` · `:667` | `≈ UGX 20,000/mo` · `≈ UGX 240,000 a year` | `About UGX 20,000 each month` · `About UGX 240,000 a year` |
| S12 | `src/agent-dashboard/onboarding/AwarenessCheck.jsx:52` | `How much will the government contribute to your pension account? What do you need to do to be eligible? Until what year is this benefit available?` | Three separate one-line questions, each with the number as the answer — this is one paragraph doing the work of three cards. |

### 1.3 Public landing, contact and claim

| # | file:line | current | plain replacement |
|---|---|---|---|
| L1 | `src/pages/About.jsx:115` | `Your savings are professionally managed and invested in diversified portfolios, growing steadily over time through the power of compound returns.` | `Experts invest your money in many safe places. It grows a little every year, and the growth earns more growth.` |
| L2 | `src/pages/landing/SubscribersPage.jsx:183` | `Retirement savings, liquid savings and insurance — all from your phone.` | `Retirement money, money you can use now, and cover — all on your phone.` |
| L3 | `src/pages/landing/SubscribersPage.jsx:188` | `keep some as liquid savings you can withdraw, and grow the rest for retirement` | `keep some money you can take out, and grow the rest for when you are old` |
| L4 | `src/pages/landing/SubscribersPage.jsx:190` · `mobile/SubscribersMobile.jsx:37` | `Your retirement pot is invested professionally — around 10% a year — for a monthly income or lump sum later.` | `Experts invest your retirement money. It has grown about 10 shillings for every 100 each year. Later you take it monthly, or all at once.` |
| L5 | `src/pages/landing/SubscribersPage.jsx:119` · `Hero.jsx:120` · `Trust.jsx:9` | `Active savers` | `People saving today` |
| L6 | `src/pages/landing/mobile/SubscribersMobile.jsx:72` · `SubscribersPage.jsx:291` | `Free for savers` | `Free for you` |
| L7 | `src/components/ForYou.jsx:38` | `Whether you are a gig worker, farmer, or self-employed — Universal Pensions is built for you. Start small, stay consistent, and build long-term security.` | `Boda rider, farmer, market vendor, own business — this is for you. Start with a little. Keep going. You will have money when you are old.` |
| L8 | `src/pages/landing/EmployersPage.jsx:28` · `:44` · `mobile/EmployersMobile.jsx:39`/`:64` | `See enrolment, participation and contribution health at a glance` | `See who has joined, who is paying, and who has stopped` |
| L9 | `src/pages/landing/DistributorsPage.jsx:138` | `Drill into any level to find what's working and what needs attention, without spreadsheets or calls.` | `Open any level to see what is going well and what needs your attention. No spreadsheets, no phone calls.` |
| L10 | `src/pages/NomineeClaim.jsx` (form error banner) | `rate_limited` (raw code — see A23-002) | `Too many claims have been sent from here just now. Please wait one minute and try again, or call us on <number>.` |
| L11 | `src/pages/Contact.jsx:59` (`err?.message` fallback) | `message_too_long` (raw code — see A23-003) | `Your message is too long. Please shorten it to about 4,000 characters.` |

### 1.4 Agent + branch (field workers on phones)

| # | file:line | current | plain replacement |
|---|---|---|---|
| A1 | `src/agent-dashboard/pages/ProfilePage.jsx:89` · `SubscribersPage.jsx:99` · `SubscribersDesktop.jsx:131` · `home/HomeDesktop.jsx:228` · `home/HomeMobile.jsx:112` | `Your portfolio` / `YOUR PORTFOLIO` / `Portfolio overview` | `Your members` |
| A2 | `src/agent-dashboard/shell/AgentAskAISheet.jsx:119` | `Ask anything about your portfolio` | `Ask anything about your members` |
| A3 | `src/agent-dashboard/home/agentCopilotReply.js:60` | `Onboarding new members keeps your pipeline healthy.` | `Signing up new members keeps your income steady.` |
| A4 | `src/agent-dashboard/home/agentCopilotReply.js:43` | `…and 12 are uninsured. Open the insurance card on your Home to nudge the uninsured ones.` | `…and 12 have no cover. Open the cover card on your Home to remind them.` |
| A5 | `src/branch-dashboard/desktop/AttentionAgentsDesktop.jsx:24` · `mobile/AttentionAgentsMobile.jsx:19` | `Hi Sarah, 7 subscribers on your book have gone dormant (no recent contributions). Please reach out this week to re-engage them.` | `Hi Sarah, 7 of your members have stopped saving. Please call them this week.` |
| A6 | `src/branch-dashboard/desktop/AttentionAgentsDesktop.jsx:33` | `…are past their scheduled contribution date. Please follow up so they stay on track.` | `…have missed their payment date. Please call them.` |
| A7 | `src/branch-dashboard/desktop/AttentionAgentsDesktop.jsx:19` · `mobile:16` · `admin-dashboard/attention/attentionMeta.js:55` | `Nudge the agents below to re-engage them.` / `Nudge an agent to re-engage their book.` | `Ask the agents below to call them.` |
| A8 | `src/agent-dashboard/onboarding/OnboardingComplete.jsx:95` | `The subscriber's record is created and KYC has been submitted.` | `The member is signed up and their ID check has been sent.` |
| A9 | `src/agent-dashboard/onboarding/OnboardingComplete.jsx:98` · `:182` | `Payment captured. Writing the subscriber record and submitting KYC…` / `KYC status` | `Payment received. Saving the member and sending their ID check…` / `ID check` |
| A10 | `src/agent-dashboard/pages/AnalyticsPage.jsx:237` · `AnalyticsDesktop.jsx:289` | `Dormant` | `Stopped saving` |
| A11 | `src/agent-dashboard/pages/HelpPage.jsx:36` | `What makes a subscriber "dormant"?` | `When does a member count as stopped saving?` |
| A12 | `src/agent-dashboard/pages/NudgeSheet.jsx:13` | `…Every contribution grows your future savings — reach out if you need any help. Thank you!` | `…Every payment makes your savings bigger. Call me if you need help. Thank you!` |
| A13 | `src/agent-dashboard/pages/CommissionsPage.jsx:136` | `3 commissions owed — settled when your distributor next pays out.` | `You are owed for 3 members. You get paid when your distributor next pays.` |
| A14 | `src/agent-dashboard/home/agentCopilotReply.js:52` | `UGX 40,000 is still to be paid to you across 3 records — it'll be settled when your distributor next pays out.` | `Your distributor still owes you UGX 40,000 for 3 members.` |

### 1.5 Operator surfaces (lower bar — plain English, domain terms allowed)

| # | file:line | current | plain replacement |
|---|---|---|---|
| O1 | `src/admin-dashboard/attention/attentionMeta.js:81` | `Valuation days with no signed-off unit price. Escalate to fund administration so the register can be brought current.` | `Days with no unit price published. Ask the fund administrator to publish them.` |
| O2 | `src/admin-dashboard/attention/attentionMeta.js:89` | `The unit price for 21 Aug has not been published — 3 days late. Please confirm the fund administrator feed and sign off the valuation.` | `No unit price for 21 Aug — 3 days late. Check with the fund administrator and publish it.` |
| O3 | `src/admin-dashboard/overview/adminAttentionDerive.js:138` · `attentionMeta.js:80` | `Delayed NAV updation` | `Unit price is late` ("updation" is not standard English) |
| O4 | `src/dashboard/overview/DistributorOverview.jsx:274` · `admin-dashboard/overview/AdminOverview.jsx:276` | `Biggest lever: coverage — 2 regions have branches and agents in place but no members yet.` | `Biggest opportunity: 2 regions have branches and agents but no members yet.` |
| O5 | `src/branch-dashboard/desktop/OverviewDesktop.jsx:172` | `Reactivating 412 dormant subscribers is the biggest lever to lift this score.` | `Getting 412 stopped members saving again would raise this score the most.` |
| O6 | `src/dashboard/commissions/CommissionPanel.jsx:824` · `:952` | `Loading commission ledger` / `Download commission ledger as CSV` | `Loading commissions` / `Download commissions as CSV` |
| O7 | `src/dashboard/reports/ReportsHub.jsx:231` | `Regional breakdown of subscribers, AUM, contributions, and active rates across the entire network` | `Members, total savings, payments and how many are active — by region, across your whole network` |
| O8 | `src/dashboard/overlay/platformCopilotContext.js:109` | `What's our total AUM?` | `How much money do we hold in total?` |
| O9 | `src/services/chat.js:443` | `Uganda Distributors holds UGX 2.4B in assets under management across 5,064 subscribers.` | `Uganda Distributors holds UGX 2,440,000,000 of members' savings for 5,064 members.` |
| O10 | `src/services/chat.js:181` | `Your total balance reflects contributions minus withdrawals, translated to units at the latest unit value.` | `Your balance is what you put in, minus what you took out, valued at today's fund price.` |
| O11 | `src/branch-dashboard/desktop/OverviewDesktop.jsx:223` · `:314` | `Branch Health Score` / `Today's Snapshot` | `Branch score` / `Today` |
| O12 | `src/employer-dashboard/desktop/AnalyticsDesktop.jsx:365` | `Total funded per month — what your staff put in plus what you add.` | keep — this one is already at the bar; cited as the model the rest should follow |

**Paragraph-where-a-number-would-do (rows P1–P6, cross-referenced above):**
P1 = M20 (SchedulePage:314 — a 31-word sentence whose whole payload is one amount).
P2 = M26 (ActivityPage:117 — a signed net figure where two labelled numbers are clearer).
P3 = S12 (AwarenessCheck:52 — three questions in one block).
P4 = M17/M22 (units — a concept, not a number the member needs; a one-line explainer or removal beats the raw figure).
P5 = L1 (About:115 — 24 words of investment theory).
P6 = `src/subscriber-dashboard/reports/AnalyticsPanel.jsx:233` — a generated sentence that recites a whole chart in prose; the chart is already on screen.

---

## 2. Currency (check 2)

### 2.1 Every site that formats money outside `src/utils/currency.js`

`Intl.NumberFormat` is used **nowhere** in `src/`, `api/` or `server/`. All money formatting goes
through `Number.prototype.toLocaleString`, either inside `currency.js` (correct) or at these 18
bypass sites:

```
$ grep -rn "toLocaleString(\|toLocaleDateString(\|toLocaleTimeString(" src \
    | grep -v "__tests__/\|\.test\.\|^src/utils/"
src/admin-dashboard/attention/AdminAttentionDesktop.jsx:43:  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
src/admin-dashboard/attention/AdminAttentionMobile.jsx:22:  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
src/admin-dashboard/attention/attentionMeta.js:48:  return Number.isFinite(n) ? `UGX ${n.toLocaleString('en-UG')}` : 'the amount';
src/admin-dashboard/mobile/AdminNavMobile.jsx:22:  return `UGX ${Number(n).toLocaleString('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
src/admin-dashboard/mobile/AdminNavMobile.jsx:33:  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
src/admin-dashboard/nav/AdminNavDesktop.jsx:363:  tickFormatter={(v) => Number(v).toLocaleString('en-UG', { maximumFractionDigits: 0 })} />
src/admin-dashboard/nav/AdminNavDesktop.jsx:65:  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
src/admin-dashboard/nav/AdminNavDesktop.jsx:71:  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
src/admin-dashboard/nav/AdminNavDesktop.jsx:76:  return `UGX ${Number(n).toLocaleString('en-UG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
src/agent-dashboard/pages/analytics/deriveAnalytics.js:87:  label: d.toLocaleDateString('en-UG', { month: 'short' }),
src/branch-dashboard/desktop/AgentDetailDesktop.jsx:44:  return { label: m.toLocaleString('en-US', { month: 'short' }), total: v };
src/branch-dashboard/desktop/OverviewDesktop.jsx:69:  out.push(m.toLocaleString('en-US', { month: 'short' }));
src/pages/landing/mobile/calc.js:19:export const formatUGX = (n) => 'UGX ' + Math.round(n).toLocaleString('en-US');
src/pages/landing/SubscribersPage.jsx:55:const formatUGX = (n) => 'UGX ' + Math.round(n).toLocaleString('en-US');
src/subscriber-dashboard/home/HomeDesktop.jsx:366:  <strong>{units.toLocaleString('en-UG', { maximumFractionDigits: 2 })}</strong> units
src/subscriber-dashboard/home/HomeMobile.jsx:153:  <b>{units.toLocaleString('en-UG', { maximumFractionDigits: 0 })}</b>
src/subscriber-dashboard/home/HomeMobile.jsx:75:  const amountLabel = Math.round(reduce ? balance : counted).toLocaleString('en-UG');
src/subscriber-dashboard/pages/SavePage.jsx:404:  <span className={flow.sumVal}>{units.toLocaleString('en-UG', { maximumFractionDigits: 2 })} units</span>
COUNT: 18
```

**Hardcoded `UGX …` string concatenation (6 sites, of which 2 also carry the wrong locale):**

| file:line | code |
|---|---|
| `src/pages/landing/SubscribersPage.jsx:55` | `'UGX ' + Math.round(n).toLocaleString('en-US')` |
| `src/pages/landing/mobile/calc.js:19` | `'UGX ' + Math.round(n).toLocaleString('en-US')` |
| `src/admin-dashboard/attention/attentionMeta.js:48` | `` `UGX ${n.toLocaleString('en-UG')}` `` |
| `src/admin-dashboard/mobile/AdminNavMobile.jsx:22` | `` `UGX ${…toLocaleString('en-UG', { min/maxFractionDigits: 2 })}` `` |
| `src/admin-dashboard/nav/AdminNavDesktop.jsx:76` | `` `UGX ${…toLocaleString('en-UG', { min/maxFractionDigits: 2 })}` `` |
| `src/utils/settlement.js:43` | `` `UGX ${formatNumber(amount)} paid for …` `` — routes money through `formatNumber`, the **count** formatter |

**Strip-and-re-add round trips (4 sites)** — the prefix is removed from `formatUGX()`'s output and
immediately re-added, which both defeats the single source of truth and re-exposes the `'—'`
sentinel:

| file:line | code | failure mode |
|---|---|---|
| `src/agent-dashboard/pages/CommissionsPage.jsx:116` | `` `UGX ${formatUGX(totals.totalAll).replace('UGX ', '')}` `` | `formatUGX(0)` returns `'—'` in compact mode → hero renders **`UGX —`**. Live: **514 of 2,046 agents (25%) have zero commissions** (`psql … 2046\|1532\|514`). Not reachable via the three seeded agent personas (a-001/a-042/a-118 hold 11/3/8 commissions), so it is latent rather than demo-visible. |
| `src/subscriber-dashboard/pages/ClaimPage.jsx:247` | `` `UGX ${formatUGX(coverTotal, { compact: false }).replace('UGX ', '')}` `` | no-op round trip |
| `src/subscriber-dashboard/pages/ActivityPage.jsx:124` | `.replace('UGX ', '')` feeding `PageHeader prefix="UGX"` | during load renders `UGX —` |
| `src/agent-dashboard/home/HomeMobile.jsx:118` | `` `UGX ${formatUGXShort(m.lifetime)}` `` | guarded by `hasLifetime`, benign |

**Standalone `UGX` label elements (9 sites):** `ContributionSettings.jsx:1005`,
`AdminNavDesktop.jsx:287`, `SavePage.jsx:283`/`306`/`499`/`513`, `ActivityPage.jsx:121`,
`SchedulePage.jsx:212`, `SubscriberScheduleForm.jsx:381`. All are `aria-hidden="true"`, so screen
readers hear a bare number with no currency — an a11y gap A20 also owns, noted here because it is a
currency-rendering decision.

### 2.2 Thousands separators — PASS

Every path resolves to the same `,` grouping. Verified in Node (ICU 78.2), Chromium and WebKit:

```
en-UG  grouped=1,234,567.5  2dp=1,234,567.50
en-GB  grouped=1,234,567.5  2dp=1,234,567.50
en-US  grouped=1,234,567.5  2dp=1,234,567.50
```

### 2.3 Decimal handling — FAIL (A23-006)

Four different precisions for money and money-adjacent figures coexist, and two of them collide on
one screen:

| precision | where | renders |
|---|---|---|
| 0 dp exact | `formatUGX(n, { compact: false })` | `UGX 282,218` |
| compact 0 dp `K` | `formatUGX(n)` ≥ 1e3 | `UGX 282K` |
| compact 1 dp `M` / 2 dp `B` | `formatUGX(n)` | `UGX 1.1M`, `UGX 2.44B` |
| 2 dp | NAV unit price, `AdminNavDesktop.jsx:76` · `AdminNavMobile.jsx:22` | `UGX 1,043.27` |

**Rendered proof — one screen, one number, two formats** (`/dashboard/withdraw/savings`, subscriber
`s-0001`, screenshot `a23-withdraw-naming.png`):

```
SAVINGS FUND
Withdraw savings
UGX 282K available · paid to your Mobile Money in 24 hours.     ← compact
…
AVAILABLE TO WITHDRAW
UGX 282,218                                                     ← exact
```

**Rendered proof — one figure, two viewports, two precisions** (`a23-units-viewport.mjs`):

```
desktop 1440 -> UNITS  897.98      (HomeDesktop.jsx:366, maximumFractionDigits: 2)
phone   390  -> Units  898         (HomeMobile.jsx:153,  maximumFractionDigits: 0)
```

A member who checks their account on a laptop and then on their phone sees a different number of
units for the same balance.

---

## 3. Locale drift (check 3)

### 3.1 The real counts — the spec's predictions were close but wrong twice

| Locale | Spec predicted | **Measured (non-test)** | Verdict |
|---|---|---|---|
| `en-GB` | ~5 admin files | **5** — `AdminAttentionDesktop:43`, `AdminAttentionMobile:22`, `AdminNavMobile:33`, `AdminNavDesktop:65`, `AdminNavDesktop:71` | ✅ exact |
| `en-US` | ~2 branch files | **4** — `AgentDetailDesktop:44`, `OverviewDesktop:69` (branch) **plus** `landing/SubscribersPage:55`, `landing/mobile/calc.js:19` | ❌ spec missed the two landing files |
| direct `en-UG` bypassing `currency.js`/`date.js` | ~7 | **9** | ❌ spec undercounted by 2 |
| canonical `LOCALE = 'en-UG'` | — | declared twice, `currency.js:16` and `date.js:11` | duplicated constant, not shared |

(One further `en-GB` and two `en-US` occurrences exist in `e2e/` and `src/**/__tests__/`; excluded as
test code.)

### 3.2 Rendered example — and the honest answer: the drift renders **identically today**

The spec asked for a rendered example "so the impact is concrete". Run against the two engines the
product actually ships to (`a23-tz-locale-probe.mjs`):

```
### chromium Intl rendering
en-UG  resolved=en-UG  grouped=1,234,567.5  2dp=1,234,567.50  short=9 Aug 2026  long=9 August 2026  monthShort=Aug  time=00:00
en-GB  resolved=en-GB  grouped=1,234,567.5  2dp=1,234,567.50  short=9 Aug 2026  long=9 August 2026  monthShort=Aug  time=00:00
en-US  resolved=en-US  grouped=1,234,567.5  2dp=1,234,567.50  short=Aug 9, 2026  long=August 9, 2026  monthShort=Aug  time=12:00 AM

### webkit Intl rendering
(identical to chromium, line for line)
```

Reading that against the actual drift sites:

- **`en-GB` (5 sites)** — `{day, month:'short'|'long', year}` renders **byte-identical** to `en-UG`
  (`9 Aug 2026` / `9 August 2026`). Zero user-visible divergence.
- **`en-US` (4 sites)** — two use `{ month: 'short' }` only (`Aug` in every locale) and two use
  integer `toLocaleString` (`1,234,567` in every locale). Zero user-visible divergence.
- The only shapes where `en-US` *would* diverge — a full date (`Aug 9, 2026`) and a time
  (`12:00 AM`) — are **not** among the drifted sites.
- `en-UG` is a genuine ICU locale, not a fallback: `Intl.DateTimeFormat('en-UG').resolvedOptions().locale === 'en-UG'`.

**Verdict:** locale drift is real as a *maintenance* defect (18 sites will not follow the canonical
`LOCALE` if it ever changes, and two landing-page files ship their own private `formatUGX`), but it
produces **no wrong output today**. Reported as **low**, not medium. This corrects the audit plan's
implicit assumption that the drift is user-visible.

### 3.3 One rendering inconsistency that *is* visible — month-abbreviation width

`{ month: 'short' }` under `en-UG`/`en-GB` gives a **4-letter** `Sept` for September and 3 letters
for every other month. Captured on the subscriber home:

```
NEXT PAYMENT · DUE 29 SEPT      ← 4 letters
Contribution  23 Aug · MTN Mobile Money   ← 3 letters
```

Cosmetic, but it breaks column alignment in the dated lists and reads as a typo. **A23-014, low.**

---

## 4. Timezone (check 4)

### 4.1 There is no timezone anchor

```
$ grep -rn "Africa/Kampala" src api server
(no matches)
```

`src/utils/date.js` pins `timeZone: 'UTC'` **only** when the value matches `^\d{4}-\d{2}-\d{2}$`
(`date.js:33`, `:63`) — i.e. bare Postgres `DATE` columns. That guard is correct and it works. Every
`timestamptz` value keeps runtime-zone rendering.

### 4.2 The exposure, measured on live data

`transactions.date` is `timestamp with time zone`. Live distribution:

```
$ psql -c "SELECT to_char(date AT TIME ZONE 'UTC','HH24'), count(*) FROM transactions GROUP BY 1 ORDER BY 1;"
00|27206      05|114   06|285   07|57    08|171   09|399   10|400
11|65         12|214   13|114   15|2     17|1     19|57    20|171

$ psql -c "SELECT count(*) FILTER (WHERE (date AT TIME ZONE 'UTC')::date <> (date AT TIME ZONE 'America/New_York')::date), count(*) FROM transactions;"
27206|29313
```

**27,206 of 29,313 rows (92.8%)** sit at exactly `00:00Z`, so they shift a calendar day for any
viewer west of UTC. For a Kampala viewer (UTC+3) the shift is **0 rows** — no transaction falls in
the 21:00–23:59 UTC window that would push it forward.

### 4.3 Proof at the formatter, using verbatim live values

```
$ for TZ in Africa/Kampala UTC Europe/London America/New_York America/Los_Angeles; do TZ=$TZ node tzproof.mjs; done
TZ = Africa/Kampala      timestamptz 00:00Z -> 4 Nov 2021   DATE-only -> 15 Jun 2026   time -> 11:10
TZ = UTC                 timestamptz 00:00Z -> 4 Nov 2021   DATE-only -> 15 Jun 2026   time -> 08:10
TZ = Europe/London       timestamptz 00:00Z -> 4 Nov 2021   DATE-only -> 15 Jun 2026   time -> 09:10
TZ = America/New_York    timestamptz 00:00Z -> 3 Nov 2021   DATE-only -> 15 Jun 2026   time -> 04:10
TZ = America/Los_Angeles timestamptz 00:00Z -> 3 Nov 2021   DATE-only -> 15 Jun 2026   time -> 01:10
```

### 4.4 Proof in the browser, end to end

`a23-tz-probe3.mjs` — the *same* subscriber (`s-0001`), the *same* page (`/dashboard/activity`),
two viewer timezones:

```
Africa/Kampala      dates: ["23 Aug 2026","7 Aug 2026","7 Aug 2026","2 Aug 2026","2 Aug 2026","26 Jun 2026","29 May 2026","29 Apr 2026","27 Apr 2026","24 Feb 2026"]
America/Los_Angeles dates: ["23 Aug 2026","7 Aug 2026","7 Aug 2026","2 Aug 2026","2 Aug 2026","25 Jun 2026","28 May 2026","28 Apr 2026","26 Apr 2026","23 Feb 2026"]
identical: false
```

**5 of 10 dates on the member's own transaction list are off by one day.** The five that shift are
exactly the seeded rows at `00:00Z`; the five that don't are the newer rows written at real
wall-clock times.

### 4.5 The 22 sites at risk

`formatDate()` is called at 83 non-test sites. These 22 are fed by a `timestamptz`:

| Backing column | Sites |
|---|---|
| `transactions.date` (raw pass-through at `services/subscriber.js:350`, `:402`) | `subscriber-dashboard/home/HomeDesktop.jsx:582` · `pages/ActivityPage.jsx:228` · `reports/views/AllTransactions.jsx:115` · `employer-dashboard/desktop/ContributionsDesktop.jsx:156` · `mobile/ContributionsMobile.jsx:101` · `employees/MemberDetailBody.jsx:203` · `agent-dashboard/pages/ContributionsThisMonthPage.jsx:112` |
| `contribution_runs.run_at` | `employer-dashboard/desktop/RunsDesktop.jsx:171` · `mobile/RunsMobile.jsx:102` · `runs/runViews.jsx:125` · `runViews.jsx:202` · `mobile/OverviewMobile.jsx:71` |
| `access_requests.created_at` | `admin-dashboard/access-requests/ViewAccessRequests.jsx:197` · `mobile/AdminAccessRequestsMobile.jsx:89` |
| `nominee_claims.created_at` | `admin-dashboard/nominee-claims/ViewNomineeClaims.jsx:210` · `mobile/AdminNomineeClaimsMobile.jsx:102` |
| `distributors.created_at` | `admin-dashboard/distributors/ViewDistributors.jsx:194` · `mobile/DistributorDetailMobile.jsx:57` |
| other (`notifications`, tickets, attention rows) | `subscriber-dashboard/shell/NotificationsSheet.jsx:33` · `branch-dashboard/mobile/ThreadMobile.jsx:94` · `admin-dashboard/attention/AdminAttentionDesktop.jsx:51` |

`withdrawals.date`, `commissions.paid_date`, `contribution_schedules.next_due_date`,
`insurance_policies.renewal_date` and `subscribers.dob` are all bare `DATE` columns and are
**correctly** pinned to UTC by `date.js`. Confirmed against `information_schema.columns`.

**Fix shape:** add `const TZ = 'Africa/Kampala'` beside `LOCALE` in `date.js` and pass
`timeZone: TZ` for every non-`time` variant. That makes the calendar day stable for all viewers and
matches the only jurisdiction this product serves. (Do **not** simply extend the existing UTC pin —
Kampala is UTC+3, so a genuinely late-evening Kampala event would then render as the previous day.)

---

## 5. Error messages (check 5) — raw codes ARE shown to users

### 5.1 The mechanism

`src/services/api.js:229`:

```js
const body = await res.json().catch(() => ({}));
const code = body?.error || body?.code;
const message = body?.message || code || `API error: ${res.status}`;
throw createApiError(code, message, res.status, body);
```

Roughly 60 API responses return `{ code: '<snake_case>' }` with **no** `message` field, so
`err.message` **is** the raw code. The UI then does, at **85 sites**:

```js
addToast('error', err?.message || 'Could not complete the top-up.');
```

`err.message` is never falsy for a coded response, so **the friendly fallback at all 85 sites is
unreachable whenever the server answered with JSON**. Confirmed count:

```
$ grep -rn "err?\.message\|error?\.message\|e\.message" src --include='*.jsx' | grep -v "\.test\." | wc -l
      85
```

Separately, `src/components/feedback/ErrorCard.jsx:24` renders raw `Error.message` verbatim
(`const text = message instanceof Error ? message.message : message;`), and **80** call sites pass a
React Query error object straight into it (`grep -rn "message={.*[Ee]rror" src --include='*.jsx' | wc -l → 80`).
`PostgrestError extends Error` (`node_modules/@supabase/postgrest-js/dist/index.d.mts:7`), so a
Postgres `RAISE EXCEPTION` text lands on screen unchanged.

### 5.2 CONFIRMED render #1 — `rate_limited` on the public nominee-claim form

`docs/audits/2026-08-23/a23-errcode-probe2.mjs`, verbatim output:

```
warmup 0 400 {"code":"invalid_product"}
warmup 1 400 {"code":"invalid_product"}
warmup 2 400 {"code":"invalid_product"}
warmup 3 400 {"code":"invalid_product"}
warmup 4 400 {"code":"invalid_product"}
warmup 5 429 {"code":"rate_limited"}
warmup 6 429 {"code":"rate_limited"}
RENDERED role=alert TEXTS >>> ["rate_limited"]
```

Screenshot: `docs/audits/2026-08-23/a23-claim-rate-limited.png`.

**Root cause, precisely.** `/claim` maps server codes through
`src/pages/landing/validateNomineeClaim.js:182`:

```js
export function messageForCode(code) {
  return CODE_MESSAGES[code] ?? null;          // ← null
}
```

`CODE_MESSAGES` covers the 16 field-validation codes but **not** `rate_limited`,
`method_not_allowed` or `db_error`. `src/pages/NomineeClaim.jsx:146` then falls through to
`|| err?.message` — the raw code.

Its near-identical twin, `src/pages/landing/validateAccessRequest.js:134`, is hardened:

```js
export function messageForCode(code) {
  return CODE_MESSAGES[code] ?? 'Something went wrong sending your request. Please try again.';
}
```

So `/request-access` is safe and `/claim` is not. Two copies of the same helper, one with a default
and one without. `writeLimiter` is `max: 5 / 60 s` per IP and is **shared** between `/api/contact`
and `/api/nominee-claim` (`server/index.ts:228`), so a rep demoing the claim form a few times — or
several reps behind one office NAT — reaches it.

The audience for this screen is a bereaved family member filing a death claim. Showing them
`rate_limited` is the worst copy failure in the product. **A23-002, high.**

### 5.3 CONFIRMED render #2 — `message_too_long` on `/contact`

`docs/audits/2026-08-23/a23-errcode-probe3.mjs`:

```
RENDERED role=alert TEXT >>> "message_too_long"
```

`src/pages/Contact.jsx` validates name, email and non-empty message (`:28`–`:38`) but has **no**
length check and **no** `maxLength` on the textarea (`grep -n "maxLength" src/pages/Contact.jsx` →
no matches), while `api/contact.ts:57` rejects >4,000 chars. Line 59 is
`setError(err?.message || …)`. **A23-003, medium.**

### 5.4 Raw snake_case codes in the live database

```
$ psql -c "SELECT DISTINCT p.proname, m[1] FROM pg_proc p,
     LATERAL regexp_matches(p.prosrc,'RAISE EXCEPTION\s+''([^'']{2,160})''','g') m
     WHERE p.pronamespace='public'::regnamespace AND m[1] ~ '^[a-z0-9_]+( \(got %\))?$' ORDER BY 1,2;"
_insert_subscriber_chain|insurance_share_sum_must_equal_100 (got %)
_insert_subscriber_chain|pension_share_sum_must_equal_100 (got %)
get_branch_pending_contributions|out_of_scope
get_branch_pending_contributions|role_not_permitted
get_branch_pending_contributions|unauthenticated
get_entity_metrics_rollup|out_of_scope
get_entity_metrics_rollup|role_not_permitted
get_entity_metrics_rollup|unauthenticated
get_top_branch|role_not_permitted
get_top_branch|unauthenticated
get_top_entities|role_not_permitted
get_top_entities|unauthenticated
upsert_nominees|insurance_share_sum_must_equal_100 (got %)
upsert_nominees|out_of_scope
upsert_nominees|pension_share_sum_must_equal_100 (got %)
upsert_nominees|role_not_permitted
upsert_nominees|unauthenticated
```

17 texts, all of which reach `ErrorCard` / `addToast` unchanged. The four read RPCs
(`get_entity_metrics_rollup`, `get_branch_pending_contributions`, `get_top_branch`,
`get_top_entities`) are the ones an operator can plausibly trip, producing an error card reading
literally **`out_of_scope`** under a friendly title. The two `*_share_sum_must_equal_100` writes are
guarded client-side (`NomineesPage.jsx:210` `shareValid`, `:261` early return), so they are latent.

### 5.5 Developer-speak in the signup RPC — reaches the member verbatim

`create_subscriber_from_signup` calls `_validate_signup_payload` **before** any insert
(`pg_proc.prosrc` line 14), so failures raise and roll back. Probing that validator directly with
payloads a real form could produce:

```
$ psql -c "SELECT public._validate_signup_payload('{...}'::jsonb);"
--- payload: {}
ERROR:  phone is required
--- payload: {... "phone":"0712" ...}
ERROR:  phone must be a valid Uganda number (9 digits, optional +256 prefix); got: 0712
--- payload: {... "gender":"F" ...}
ERROR:  gender must be male|female|other
```

`src/signup/contribution/ContributionRoute.jsx:107` renders
`err?.message || "Couldn't create your account. Please try again."` — so a Ugandan signing up on a
phone can be shown `gender must be male|female|other`. Sixteen such texts exist on this one
validator, plus `contributionSchedule.amount must be > 0`, `dob is required (YYYY-MM-DD)`,
`districtId is required`, `signup payload is required`. **A23-009, medium (plausible** — the client
form validates most of these first, so I could not reproduce it through the UI**).**

Suggested plain replacements for the reachable ones:

| RPC text | plain replacement |
|---|---|
| `phone must be a valid Uganda number (9 digits, optional +256 prefix); got: 0712` | `That phone number is not right. Use 9 digits, for example 712 345 678.` |
| `gender must be male\|female\|other` | `Please choose male, female or other.` |
| `dob is required (YYYY-MM-DD)` | `Please give your date of birth.` |
| `contributionSchedule.amount must be > 0` | `Please enter how much you want to save.` |
| `unknown district: X` | `We do not know that district. Please pick one from the list.` |
| `invite already used` / `invite expired` / `invite not found` | `This invite link has already been used.` / `This invite link has expired. Ask your employer for a new one.` / `We could not find this invite link.` |

### 5.6 `unexpected_error`, `db_error`, `not_ready` — PASS, never shown

`api.js:167` intercepts **every** `res.status >= 500` and replaces the body with
`createApiError('server_unavailable', 'Server unavailable', status)`. So `unexpected_error`
(`api/auth/verify-otp.ts:264`, `change-password.ts:163`, `server/index.ts:294`), `db_error`
(`contact.ts:72`, `nominee-claim.ts:184`, `access-request.ts:148`) and `not_ready`
(`server/index.ts:138`, `:143`) are all masked. Confirmed by reading the interception path; no
counter-example found. Only **4xx and 429** codes leak.

### 5.7 The sign-in path is the model to copy

`src/services/auth.js:28` does map codes to sentences
(`if (code === 'rate_limited') return 'Too many attempts. Try again shortly.';`) and
`src/components/signin/OtpVerify.jsx:17` handles `invalid_otp | rate_limited | locked | network`.
That vocabulary exists and works — it simply was never extended past `/auth/*`. The fix for
A23-002/003/004 is to put one `messageForCode()` in front of every `err?.message` render, not to
write 85 new strings.

---

## 6. Terminology (check 6)

Six conflicts. The first is the most serious thing in this report.

### 6.1 CONFLICT — six names for one pot of money on the member's money screens

The member's withdrawable balance is called, across the subscriber surfaces:

| # | name | where |
|---|---|---|
| 1 | **Liquid savings** | `SubscriberScheduleForm.jsx:429`, `:794` · `ContributionSettings.jsx:1062`, `:1094`, `:1279`, `:1414` · `InsurancePage.jsx:337` · `landing/SubscribersPage.jsx:183`, `:188` |
| 2 | **Emergency bucket** | `HelpPage.jsx:21`, `:22`, `:27` · `services/chat.js:155`, `:175`, `:529` |
| 3 | **Emergency fund** | `HomeDesktop.jsx:510` · `WithdrawalsHubPage.jsx:163` · `WithdrawPage.jsx:353` |
| 4 | **Emergency pot** | `WithdrawalsHubPage.jsx:183` |
| 5 | **Savings pot / SAVINGS FUND / SAVINGS** | `WithdrawPage.jsx:196`, `:467` (`bucket === 'emergency' ? 'Savings' : 'Retirement'`) |
| 6 | **emergency** (bare, lowercase) | `WithdrawPage.jsx:240`, `:244`, `:491`, `:495` · `HomeMobile.jsx:240` |

**Rendered proof — `/dashboard/withdraw/savings`, subscriber `s-0001`, desktop 1440×950**
(screenshot `a23-withdraw-naming.png`, text capture `a23-withdraw-copy.mjs`):

```
SAVINGS FUND                                     ← name 5
Withdraw savings
UGX 282K available · paid to your Mobile Money in 24 hours.
WITHDRAW FROM
  ● SAVINGS      UGX 282,218                     ← name 5
  ● RETIREMENT   UGX 1,128,874   [Locked until 60]
                                  AVAILABLE TO WITHDRAW
                                  UGX 282,218
                                  ● Emergency · available   UGX 282,218   ← name 6
                                  ● Retirement · locked to 60  UGX 1,128,874
                                  Only your emergency fund can be withdrawn before retirement.   ← name 3
THIS WITHDRAWAL  UGX 0
Savings left after   UGX 282,218                 ← name 5
```

On one viewport, **`SAVINGS · UGX 282,218`** and **`Emergency · available · UGX 282,218`** sit a few
centimetres apart, labelled differently, against the same number. A low-literacy member can
reasonably read that as two balances of UGX 282,218. This is misleading money labelling on the
withdrawal screen — the most sensitive screen in the product — which is why it is scored **high**
rather than medium.

**Recommended single term:** *Money you can use now* (and *Retirement money*). Both are concrete,
avoid the "emergency" framing (which discourages the everyday education/business withdrawals the
Help page actually encourages), and avoid the container metaphors (*pot*, *bucket*, *fund*) that a
member has no reason to map onto a balance.

### 6.2 CONFLICT — member / subscriber / saver

The glossary itself is the source: `CLAUDE.md §9` defines *Subscriber* as "Individual saver — a
member with a balance" — three words in one definition, no canonical user-facing term. Measured on
user-visible strings only:

| Surface | "member" | "subscriber" | "saver" |
|---|---|---|---|
| `agent-dashboard/` | 24 | **92** | 0 |
| `branch-dashboard/` | 13 | **47** | 0 |
| `dashboard/` (distributor) | 6 | **67** | 0 |
| `admin-dashboard/` | **29** | 7 | 0 |
| `pages/` (landing) | **21** | 5 | 3 |
| `subscriber-dashboard/` | 0 | 3 | 0 |

Admin flips the ratio relative to every other operator surface. The landing pages use all three —
`Hero.jsx:120` and `Trust.jsx:9` say **"Active savers"**, `SubscribersPage.jsx:291` says **"Free for
savers"**, while `AdminPage.jsx:43` says **"…agent, employer and member"**. The member's own
dashboard uses none of them for the member, which is correct — but the marketing site should pick
one. **Recommendation: "member" everywhere in copy; keep "subscriber" as a code/DB term only.**

### 6.3 CONFLICT — staff / member / employee on one employer page

`src/employer-dashboard/desktop/EmployeesDesktop.jsx` alone:

```
:94   Employees                                                    ← page heading
:95   Your staff roster — everyone enrolled in the company pension.
:136  Search staff by name or phone…
:181  Member                                                        ← table column header
:191  Loading your staff…
:197  No staff on your roster yet — onboard an employee to get started.   ← two terms in ONE sentence
```

And `ContributionsDesktop.jsx` puts a `Member` column (`:130`) next to a `Staff` column (`:161`) in
the same table, with `Paid by staff` (`:71`) above them. Counts across the employer dashboard:
**staff 83 · member 38 · employee 17**. **Recommendation: "staff" throughout** (it is what a Ugandan
employer says), with "Employees" as the nav label only if it must match the route.

### 6.4 CONFLICT — nominee / beneficiary in one signup step

`src/signup/steps/BeneficiariesStep.jsx`:

```
:175  Step 7 · Beneficiaries
:180  Nominate at least one beneficiary for your pension.
:204  Use the same nominees for my insurance products
:240  Insurance nominees
```

The dashboard then names the page **"Nominees"** (`NomineesPage.jsx:299`) while the insurance page
says **"Insurance beneficiaries"** (`InsurancePage.jsx:442`). Both words are legal-register English
that a low-literacy member will not know. **Recommendation: "Who gets your money" as the heading,
"the people you chose" in body copy;** keep `nominees` as the code/DB term.

### 6.5 CONFLICT — bucket / pot / fund as the container metaphor

`ReportsPage.jsx:44` says **"Bucket, reason and settlement time"**, `WithdrawalsHubPage.jsx:19` says
**"emergency or retirement bucket"**, `WithdrawPage.jsx:219` says **"your ${potLabel} pot"**,
`HomeDesktop.jsx:510` says **"EMERGENCY FUND"**. Three metaphors, one concept. Folded into §6.1.

### 6.6 PASS (with a note) — agent / branch / distributor

"Agent", "Branch" and "Distributor" are used consistently and match `CLAUDE.md §9`. The only defect
is casing: **"Field agent" ×4** vs **"field agent" ×7** in mid-sentence positions, and
**"Branch admin" ×2** with no lowercase counterpart. Cosmetic; folded into A23-008 as a note rather
than raised separately.

---

## 7. Empty-state and loading copy (check 7)

### 7.1 Empty states — specific in wording, but 78% dead-end

169 distinct empty-state strings. Only **38 (22%)** tell the user what to do next.

**Good (the pattern to copy):**
```
No agents yet — add your first agent to start enrolling subscribers.
No tickets yet. Raise a ticket and our support team will reply right here.
No valid rows to onboard. Fix the flagged rows and re-upload.
No payments of this kind yet. Try another tab to see the rest.
```

**Dead-end (a sample of the 131):**
```
No active agents yet          No activity yet.           No age data recorded yet.
No active policy yet          No agents found            No beneficiaries named.
No active staff yet.          No agents match            No branches
No agent assigned yet         No agents yet.             No settlements yet
No agent reply yet            No branch is assigned to your account.
```

Punctuation is also inconsistent within the same category: `No agents yet.` / `No agents yet` /
`No agents match` / `No agents match your search.` / `No agents on this branch yet.` /
`No agents in this branch yet.` — six variants of one message.

Plain replacements for the four that a member or agent actually meets:

| file:line | current | plain replacement |
|---|---|---|
| `src/subscriber-dashboard/pages/ActivityPage.jsx` (`No activity yet.`) | `No activity yet.` | `Nothing yet. Your payments will show here once you start saving.` |
| `src/subscriber-dashboard/pages/PoliciesPage.jsx` (`No active cover`) | `No active cover` | `You have no cover yet. Tap below to choose one.` |
| `src/agent-dashboard/pages/SubscribersPage.jsx` (`No subscribers yet.`) | `No subscribers yet.` | `No members yet. Tap Add member to sign up your first one.` |
| `src/subscriber-dashboard/pages/NomineesPage.jsx` (`No beneficiaries named.`) | `No beneficiaries named.` | `You have not chosen anyone yet. Add the people who should get your money.` |

### 7.2 Loading copy — specific, but inconsistently punctuated

The house pattern "Loading your X" is good and used widely. Two problems:

- **9 × bare `Loading…`** with no object.
- Ellipsis is applied at random: `Loading your commissions` / `Loading commissions…`;
  `Loading your staff…` / `Loading staff`; `Loading transactions` / `Loading schedule…`.
  40 distinct loading strings, 8 of which carry `…` and 32 of which do not.

### 7.3 One thing the loading copy hides (hand-off, not an A23 finding)

While probing `/dashboard/reports/all-transactions` I twice caught a `500` from
`GET /rest/v1/subscribers?select=*,subscriber_balances(*),contribut…`, after which the page sat on
**`Loading transactions…` indefinitely** (25 s wait, no error card), and on a third run rendered the
error-boundary fallback **"Something went wrong / An unexpected error occurred. Please refresh the
page to try again."** On a fourth, successful run the page rendered with **0 table rows** for
`s-0001` even though the member has 11 transactions (visible on `/dashboard/activity`), and the
"Export CSV" button produced a header-only file:

```
$ node docs/audits/2026-08-23/a23-csv-probe.mjs
h1: "All Transactions"
export button visible: true
--- CSV first 6 lines ---
"﻿Date,Type,Paid by,Amount (UGX),Method,Reference,Status"
$ node docs/audits/2026-08-23/a23-csv-probe2.mjs
table rows: 0
buttons: ["Log out","Export CSV","Ask AI","9"]
```

This is a data/route defect, not a copy defect — **handed to A10 (subscriber) and A22 (error
states)**. I record it because the copy layer masks it: an indefinite "Loading transactions…" is
what a rep would actually see.

---

## 8. i18n — EXCLUDED, recorded as INFO only

No i18n library is present (no `i18next`, `react-intl`, `formatjs` in `package.json`), and all 7,851
strings are hardcoded English in JSX. **Per the A23 spec this is INFO only and is explicitly not
raised as a defect.** Recorded here for completeness: should Luganda/Swahili ever be scoped, the
7,851 inline strings plus the ~60 API codes plus the 216 `RAISE EXCEPTION` texts in Postgres are the
extraction surface, and the DB-layer texts (§5.4/§5.5) would need a code-to-message table in the
client regardless of language.

---

## 9. Findings

| id | sev | conf | title | location | demo-visible |
|---|---|---|---|---|---|
| A23-001 | high | confirmed | Six names for one pot of money on the member's money screens; two label the same UGX 282,218 side by side | `src/subscriber-dashboard/pages/WithdrawPage.jsx:196` | yes |
| A23-002 | high | confirmed | Public nominee-claim form renders the raw code `rate_limited` to a bereaved family | `src/pages/landing/validateNomineeClaim.js:182` | yes |
| A23-003 | medium | confirmed | `/contact` renders the raw code `message_too_long`; no `maxLength` on the textarea | `src/pages/Contact.jsx:59` | yes |
| A23-004 | medium | confirmed | `err?.message \|\| 'friendly'` makes the friendly fallback unreachable at 85 sites; `ErrorCard` prints raw Postgres text at 80 more | `src/services/api.js:229` | yes |
| A23-005 | medium | confirmed | `timestamptz` rendered date-only with no timezone anchor — 22 sites, 92.8% of transactions shift a day west of UTC | `src/utils/date.js:63` | yes |
| A23-006 | medium | confirmed | Same number, two precisions: `UGX 282K` above `UGX 282,218`; units `897.98` desktop vs `898` phone | `src/subscriber-dashboard/home/HomeDesktop.jsx:366` | yes |
| A23-007 | medium | confirmed | Financial jargon on member money screens — "liquid savings" ×29, premium, units, downgrade, settle, `≈` | `src/components/contribution/SubscriberScheduleForm.jsx:429` | yes |
| A23-008 | medium | confirmed | Role terminology collides: staff/member/employee in one sentence; nominee/beneficiary in one step; member/subscriber/saver across surfaces | `src/employer-dashboard/desktop/EmployeesDesktop.jsx:197` | yes |
| A23-009 | medium | plausible | Signup RPC validation text is developer-speak rendered verbatim to the member | `public._validate_signup_payload` | no |
| A23-010 | low | confirmed | 18 formatter bypasses, 0 uses of `Intl.NumberFormat`, 5 `en-GB` + 4 `en-US` against canonical `en-UG` — rendered output identical today | `src/pages/landing/SubscribersPage.jsx:55` | no |
| A23-011 | low | confirmed | 131 of 169 empty states dead-end with no next action; 6 punctuation variants of one message; loading ellipsis applied at random | `src/employer-dashboard/desktop/AnalyticsDesktop.jsx:428` | yes |
| A23-012 | low | confirmed | English business idiom in the nudge drafts sent to field agents — "on your book", "gone dormant", "re-engage", "pipeline", "biggest lever" | `src/branch-dashboard/desktop/AttentionAgentsDesktop.jsx:24` | yes |
| A23-013 | info | confirmed | `MOCK_NOW` drift: the value is `2026-07-01` but `CLAUDE.md §10b` and three code comments say `2026-05-26` | `src/data/mockData.js:25` | no |
| A23-014 | low | confirmed | Month-abbreviation width inconsistency — "29 SEPT" beside "23 Aug" from `{month:'short'}` under `en-UG` | `src/utils/date.js:19` | yes |
| A23-016 | medium | plausible | The member's transactions CSV writes the raw `timestamptz` into a column headed "Date" and raw machine tokens into "Type" | `src/subscriber-dashboard/reports/views/AllTransactions.jsx:177` | yes |

### A23-013 — MOCK_NOW drift, in full (the spec explicitly asked for this)

```
$ grep -rn "MOCK_NOW" src | grep -v node_modules
src/data/mockData.js:25:export const MOCK_NOW = new Date(2026, 6, 1); // 2026-07-01     ← the actual value
src/utils/periodSettlement.test.js:11:const NOW = new Date(2026, 4, 26); // 2026-05-26 (the demo MOCK_NOW)
src/admin-dashboard/overview/adminAttentionDerive.js:13://      seeded charts), JS MOCK_NOW (2026-05-26) and the real wall clock, which
src/data/employerSeed.js:14:// `MOCK_NOW` (2026-05-26) for demo stability.
```

plus `CLAUDE.md §10b`: "**`MOCK_NOW = new Date(2026, 4, 26)`** (2026-05-26)".

**The value is 2026-07-01. Four places say 2026-05-26 — a 36-day drift.** No user-visible effect
(nothing reads the comments), but `periodSettlement.test.js:11` pins a test to the stale date, so a
maintainer reasoning from either the test or `CLAUDE.md` will compute due-dates 36 days wrong.

---

## 10. Artifacts written, and cleanup

**Files this agent created — all under `docs/audits/2026-08-23/`, none elsewhere:**

```
23-copy-language.md          this report
a23-tz-locale-probe.mjs      Intl rendering in chromium + webkit; two-timezone date diff
a23-tz-probe2.mjs            page-text dump used to debug the report route
a23-tz-probe3.mjs            /dashboard/activity rendered under Africa/Kampala vs America/Los_Angeles
a23-500-probe.mjs            network-status capture for the intermittent report-route 500
a23-csv-probe.mjs            transactions CSV download capture
a23-csv-probe2.mjs           row-count + button-name capture for the same route
a23-withdraw-copy.mjs        rendered copy of the withdraw flow, desktop + phone
a23-withdraw-shot.mjs        screenshot driver
a23-units-viewport.mjs       units precision, desktop vs phone
a23-withdraw-naming.png      screenshot evidence for A23-001 / A23-006
(+ .bak/.bak2/.bak3 files left by in-place `sed` edits to the probes above)
```

Pre-existing from an earlier interrupted A23 pass and **re-run, not modified**:
`a23-extract-strings.mjs`, `a23-errcode-probe.mjs`, `a23-errcode-probe2.mjs`,
`a23-errcode-probe3.mjs`, `a23-claim-rate-limited.png`.

**Fixture rows created: ZERO — verified, not assumed.** Every error probe was designed so the
request fails before any insert: the rate-limit warmups used invalid payloads (`400 invalid_product`,
five of them) and the browser submissions were rejected `429` by the limiter, which short-circuits
ahead of the DB write; the `message_too_long` probe is rejected `400` by `api/contact.ts:57` before
the insert; and `_validate_signup_payload` raises before `_insert_subscriber_chain` runs. Confirmed
afterwards against the live DB:

```
$ psql -c "SELECT count(*) FROM contact_submissions;"
0
$ psql -c "SELECT id, claimant_name, deceased_name, created_at FROM nominee_claims WHERE created_at > now() - interval '2 hours';"
nc-bbf6090b4d1d48e991f65357be9e62f1|A24XSSPROBE…|A24XSSPROBE …|2026-08-24 08:05:02.34611+00
nc-d810114b14304a0f85c0337cdfa21ac3|A24XSSPROBE2 …|A24XSSPROBE2 …|2026-08-24 08:05:03.746805+00
```

The only recent `nominee_claims` rows belong to **A24's** XSS probe, not to A23. Nothing named
`Audit Probe` / `Test Deceased` exists in either table. **Nothing to clean up.**

**Guardrails honoured:** no writes to `src/`, `api/`, `server/`, `supabase/`, `scripts/`, `public/`
or config (G1); no secret printed — the anon key, service-role key and JWT secret were never echoed,
and `SUPABASE_DB_URL` was sourced into the environment but never displayed (G2); no `vercel env pull`
(G3); no `npm run seed` (G4); no deploy or push (G5); no down-migration executed (G6); nothing
staged, and the only files touched are the ones I created (G7); applied state read from `pg_proc` /
`information_schema`, never from `schema_migrations` (G8); every finding carries a verbatim command
and output, and the two unreproduced ones are marked `plausible` (G9); no blockers (G10).
