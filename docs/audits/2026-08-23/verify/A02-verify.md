# A02 — Adversarial Verification (RLS write-policy surface)

**Verifier stance:** refute by default. All writes wrapped in `BEGIN … ROLLBACK`;
re-read after ROLLBACK to prove zero persistence. No commits. Secrets redacted (G2).
Verified both `high` findings; spot-checked three `medium` findings. **No fixtures leaked.**

| Finding | Sev | Verdict | One-line basis |
|---|---|---|---|
| A02-001 | high | **CONFIRMED** | Reproduced: subscriber JWT INSERT of `type='contribution'` for own id fired `trg_transactions_contribution`, balance 1,411,092 → 1,001,411,092 UGX; units 897.98 → 637,273. Reachability chain verified in code. |
| A02-002 | high | **CONFIRMED** | Reproduced: subscriber JWT UPDATE set `cover` 1,000,000 → 500,000,000, `premium_monthly` 2,000 → 0, `status='active'`; 2 `subscriber_insurance_products` rows flipped. No triggers, table-level UPDATE grant, WITH CHECK pins only `subscriber_id`. |
| A02-003 | medium | **CONFIRMED** | Column grants match verbatim: `authenticated` holds UPDATE on `insurance_funding_mode`, `insurance_premium_accrued/target`, `retirement_pct`, `emergency_pct`, … Contrast `subscribers` (locked to 5 cols) proves the pattern gap. Author's bounded-impact caveat is honest. |
| A02-004 | medium | **CONFIRMED** | `withdrawals_insert_self` + `nominees_{insert,update,delete}_self` policies exist; reproduced own-withdrawal INSERT (1 row, rolled back). Tenant-scoped. |
| A02-005 | medium | **CONFIRMED (citation caveat)** | Hierarchy write policies exist; reproduced agent INSERT of own subscriber (OK) vs cross-tenant a-042 (RLS DENIED). Doc-vs-live mismatch real, but the BACKEND.md:46 citation actually *permits* explicit write policies — the true contradiction is BACKEND.md:601 / role-permissions.md:250 ("no client write policies"). Author states "no isolation failure," which held. |

## A02-001 — money mint (CONFIRMED, high)

The transactions INSERT policy is exactly as reported — value-blind on `type`:
```
transactions_insert_self | INSERT | WITH CHECK:
  ((auth.jwt()->>'app_role')='subscriber' AND subscriber_id=(auth.jwt()->>'subscriberId'))
```
`transactions_after_insert_contribution` fires `WHEN (new.type='contribution')`. Reproduced
(rolled back):
```
BEFORE (as postgres)          || 1411092 || ... || units 897.9839...
AFTER (as subscriber, own row)|| 1001411092 || ... || units 637273.19...
POST-ROLLBACK balance         || 1411092
POST-ROLLBACK probe txn rows  || 0
```
**Reachability confirmed in code (not assumed):** `api/_lib/jwt.ts` signs HS256 with
`SUPABASE_JWT_SECRET` — the same secret PostgREST validates (explicit comment: "Signing with
base64-decoded bytes would mint tokens that PostgREST rejects (PGRST301)") — and includes
`app_role` + `subscriberId`. `src/services/supabaseClient.js:216-223` `fetchWithAuth` reads the
`upensions_token` JWT from localStorage and sets `Authorization: Bearer …` on **every**
postgrest-js request (`fetch: fetchWithAuth` on the client). So any logged-in subscriber's
browser can POST straight to `/rest/v1/transactions`. **Not demo-scope**: the fabricated money
rolls up into agent/branch/distributor and admin AUM — i.e. wrong money displayed to *other*
roles (audit brief: "DO report … WRONG MONEY … leaks one tenant's data to another"). Severity
`high` is correct under this rubric ("a write can corrupt or duplicate data"); author correctly
notes it would be critical on a real deployment.

## A02-002 — insurance overwrite (CONFIRMED, high)

`insurance_policies_update_self` / `sip_update_self` USING+CHECK pin only `subscriber_id`; no
editable-column trigger exists on either table (trigger enumeration returned empty for both);
`authenticated` holds a full table-level UPDATE grant. Reproduced (rolled back): cover 1,000,000
→ 500,000,000, premium 2,000 → 0, status→active, 2 SIP rows→active; POST-ROLLBACK cover back to
1,000,000. Wrong money in the insurance ledger, falsifying the self-pay-premium invariant.
**Not demo-scope.** `high` correct.

## Medium spot-checks
- **A02-003:** column-privilege dump matches the finding verbatim; the `subscribers`-vs-`contribution_schedules` contrast is real. Bounded (the trigger sweep still needs real emergency_balance). Medium fits.
- **A02-004:** policies present; own-withdrawal INSERT reproduced and rolled back. Medium fits (bypasses `request_withdrawal` balance/nonce checks; tenant-scoped only).
- **A02-005:** agent OWN-insert OK, cross-tenant DENIED — reproduced. The security claim ("no isolation failure") is honest; the finding's worth is the doc mismatch + RPC-validation bypass. Note: BACKEND.md:46 does **not** support "clients cannot write" (it explicitly allows explicit write policies); the real contradiction is with BACKEND.md:601 / role-permissions.md:250. Medium is defensible (borderline low).

**No writes committed. No fixture rows created (all probes rolled back; POST-ROLLBACK counts = 0).**
