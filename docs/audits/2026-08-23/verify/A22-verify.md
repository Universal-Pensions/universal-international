# A22 — Adversarial Verification (state/cache-bleed & error-handling agent)

Verifier stance: refute first. All repros run against the LIVE DB (project
`ilkhfnoyxlxwqadebnkp`) using read-only `BEGIN … set_config(local) … ROLLBACK`
transactions — no write was committed, no fixture row created.

## A22-001 — Cross-tenant cache bleed on in-SPA role switch — **CONFIRMED (critical)**
Every lens holds.
- **Code mechanic (confirmed):** `AuthContext.login` (src/contexts/AuthContext.jsx:56-66)
  sets token + user but NEVER clears the React Query cache; only `logout` (:91) calls
  `queryClient.clear()`. Verified verbatim.
- **Shared query key (confirmed):** the ADMIN hero (`AdminOverview.jsx:127` →
  `useEntityMetrics('country','ug')`) and the DISTRIBUTOR hero
  (`DistributorOverview.jsx:132` → `useEntityMetrics('country','ug')`) resolve to the
  IDENTICAL cache key `['entityMetrics','country','ug']`. staleTime is 5 min
  (src/main.jsx:70) and refetchOnWindowFocus is off, so a fresh entry is served without
  a refetch.
- **Wrong money quantified (confirmed, live):** the RPC `get_entity_metrics_rollup`
  scopes by `app_role` (SECURITY DEFINER, `v_all = (app_role <> 'distributor')`). Live:
  admin → `aum 2,450,226,487 · 321 branches · 5001 subs`; d-002 → `aum 170,104,155 ·
  27 branches · 399 subs`; d-001 → `aum 1,954,892,232 · 291 branches`. So a d-002 hero
  reading the admin-cached entry shows UGX 2.45B / 321 branches instead of 0.17B / 27 —
  another operator's money.
- **Reachability (confirmed):** `/admin/login` DOES redirect authed users
  (AdminLogin.jsx:28), but the landing pages and their login surfaces do NOT: `SignInModal`
  and `LandingLoginCard` carry no `isAuthenticated` guard, and `DistributorsPage`
  renders `<LandingLoginCard roles={['distributor','branch','agent']} />`. An admin
  who browser-backs to `/distributors` can sign in as d-002 via `useLoginFlow` →
  `login()` (no clear) → `navigate('/dashboard')` (SPA, no reload). No dashboard-mount
  cache reset exists. A rep demoing admin then a distributor in one tab hits this.
- **Demo-scope:** NOT excluded — the OUT-OF-SCOPE list explicitly says to report
  "wrong money" and "one tenant's data to another." This is both.
Verdict: CONFIRMED, critical stands.

## A22-002 — Silent-zero hero on a failed overview read — **CONFIRMED as a defect, SEVERITY-ADJUST high → medium**
- **Confirmed:** `AdminOverview.jsx:139-148` does `platform ?? {}` then every field
  `?? 0`, with NO `isError` branch on the mounted hero. `formatUGX` returns `'—'` for
  `n<=0` (currency.js:32), and `scoreQuality(0)='Needs work'` (:100). A failed
  `get_platform_overview` therefore renders `Funds under management —`, `0` subscribers,
  `Health Score 0 · Needs work`, no message, no retry. `src/main.jsx` sets no
  `QueryCache.onError`. All verbatim-verified.
- **Why medium, not high:** the severity rubric lists "missing empty/loading/error
  state" and "degraded UX" under MEDIUM. This is not a route made unreachable or a
  deterministic wrong-money display — it manifests only on an actual read failure, and
  the output is an unmistakable no-data state (`—` / `0` / `Needs work`) that reads as
  "broken/not-loaded", NOT as a convincing wrong figure a rep would narrate as real
  money. `retry:1` also absorbs single transient blips. The author's "reads as wrong
  money" framing overstates blast radius. Real, worth fixing, but medium.

## A22-003 — `forwardSupabaseAuthError` dead (0 call sites) — **CONFIRMED (medium)** (spot-check)
`grep -rn forwardSupabaseAuthError src` outside supabaseClient.js → zero hits.
`fetchWithAuth` uses `liveToken()` which treats an expired JWT as absent and falls back
to the anon key, so an expired session silently downgrades to anon reads (zeros) with no
logout on the direct-PostgREST path. Author's own medium + `demo_visible:false` is
correct — needs a 24h-old session, which a fresh demo never has. Not overstated.

## A22-004 — Raw error strings leak into write toasts — **CONFIRMED (medium)** (spot-check)
All four cited sites use `addToast('error', err?.message || 'Could not …')`:
SavePage.jsx:204, WithdrawPage.jsx:142, ProfilePage.jsx:102, runViews.jsx:361. Because a
network drop yields `err.message='Failed to fetch'` (always populated), the friendly
fallback never runs and a money action can toast `TypeError: Failed to fetch`. Confirmed;
medium is fair.

## A22-005 — approve/deny access request doesn't invalidate `adminAttention` — **CONFIRMED (medium)** (spot-check)
`useApproveAccessRequest` invalidates accessRequests/platformOverview/entities but NOT
`['adminAttention']`; `useDenyAccessRequest` invalidates only accessRequests
(useAccessRequests.js:19-43). `useAdminAttention` is keyed `['adminAttention']` with
`staleTime 5min`; live `get_admin_attention()->>'pendingAccessRequests' = 4`, and this
count feeds the admin Needs-attention card. `usePublishNav` correctly invalidates
`['adminAttention']`, proving the inconsistency. Confirmed medium. (Minor: author names
the hook "useRejectAccessRequest"; the real name is `useDenyAccessRequest` — substance
unaffected.)

## Low/Info (A22-006, A22-007): not verified in depth (out of mandate); both read as
consistent with the code (in-memory ticket Map; no root QueryCache.onError).

Write discipline: only rolled-back read transactions were used; nothing committed;
no fixture rows created or left behind.
