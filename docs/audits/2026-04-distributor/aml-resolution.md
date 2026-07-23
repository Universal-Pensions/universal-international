> **Agent guide.** Historical validation from 2026-05-22 covering the investigation into the agent-onboarding AML step hang (finding AUDIT-4-7) — a point-in-time snapshot, **not** current state. Read only for background on what was found or decided then. For the live system, start at `CLAUDE.md` and the `docs/` it links.

# AUDIT-4-7 — AML step hang resolution

**Date:** 2026-05-22 19:02 local · **Phase:** Phase 0 (A0.4)
**Source claim:** `.claude/skills/qa.md` line 142 — "Agent onboard AML step hang: spec marked `test.fixme()` with diagnostic notes. Needs investigation under the agent storageState specifically."

## Verdict

**The AML hang does NOT reproduce.** The spec passes through all 9 KYC steps including AML in ~26 seconds, with no stall at step 6 of 8. The spec is **NOT** `test.fixme()`'d in current `main` — qa.md is stale on that point too (same pattern as AUDIT-4-1: 5 of 6 qa.md items were FIXED).

A *different* bug surfaced when we removed the fixme assumption and ran the spec end-to-end: the final `create_subscriber_from_agent_onboard` RPC returns **HTTP 409** because the test fixture re-uses the same NIN value across runs and the production-correct UNIQUE constraint `ux_subscribers_nin` rejects the duplicate.

## Evidence

### Runtime trace

Command: `npx playwright test e2e/specs/flows/agent-onboard-subscriber.spec.ts --trace=on --workers=1 --reporter=list --timeout=120000 --project=chromium`

Result: 1 failed in **31.7s** total wall-clock.

- All 9 KYC steps render and auto-advance correctly:
  1. Awareness (5 yes radios) — clicked, advanced
  2. KYC step 1 · id-upload — uploaded both sides, idContinue enabled, advanced
  3. KYC step 2 · review — OCR returned, district/phone/occupation filled, advanced
  4. KYC step 3 · nira — auto-advance via verified beat
  5. KYC step 4 · otp — `1234` entered, auto-submit
  6. KYC step 5 · liveness — Take selfie clicked, ok beat
  7. **KYC step 6 · AML — passed cleanly. No hang.**
  8. KYC step 7 · beneficiaries — single row at share=100
  9. KYC step 8 · consent — Continue
  10. Schedule + complete — all advanced
- **Final RPC** `create_subscriber_from_agent_onboard` → HTTP **409**, payload:
  > `duplicate key value violates unique constraint "ux_subscribers_nin"`
- Screenshot at failure: 4 stage indicators all show ✓ (Awareness, KYC, Schedule, Complete) — the "Namukasa is enrolled" success screen renders THEN flips to error toast.

### Spec state

```bash
grep -n "test.fixme\|test.skip\|test.fail" e2e/specs/flows/agent-onboard-subscriber.spec.ts
```

Returns **zero hits**. The fixme that qa.md describes is no longer in the spec. Some prior fix removed it.

### Test-fixture bug isolation

`e2e/specs/flows/agent-onboard-subscriber.spec.ts:64-75` generates a unique 9-digit phone per run via `+2567${Date.now().slice(-7)}`. **It does not generate a unique NIN.** Instead:

- KYC step 2 review (line 138-140 comment): "The OCR mock supplies fullName/nin/cardNumber/dob/gender" — the NIN comes from `services/kyc.js`'s `ocr` mock, which returns a fixed sample subscriber.
- `cleanupSubscriberByPhone(uniquePhone)` cleans up by phone, not NIN.

Result: every run after the first creates a subscriber with the *same* NIN. After the first success, the `ux_subscribers_nin` UNIQUE index rejects.

## Why this is correctness, not regression

The RPC and the index are doing exactly what they should — preventing two subscribers from sharing a national ID. The bug is in the **test fixture**, not the product. A real agent onboarding two real subscribers would naturally use different NIN values.

## Recommended fix (out-of-Phase-0 scope)

Three options, in increasing complexity:

**Option A — Generate a unique NIN per run, override the OCR mock client-side.**
```ts
// Before navigating to /dashboard/onboard:
await page.addInitScript((nin) => {
  window.__upensions_ocr_force_nin = nin;
}, `CM${Date.now().toString().slice(-12)}`);
```
Then `services/kyc.js`'s OCR mock reads `window.__upensions_ocr_force_nin` if present. Spec fix + ~3 lines in services/kyc.js.

**Option B — Have `cleanupSubscriberByPhone` also clean by NIN before the run.**
Wider blast — could mask other tests' state.

**Option C — Bump the OCR mock to generate a random NIN per call.**
Affects every onboarding spec; OCR mock becomes non-deterministic; introduces flake.

**Recommended: A.** Surgical, opt-in via init script, no impact on non-test flows.

## Sprint impact

| Item | Status |
|---|---|
| AML hang claim | Closed — does not reproduce |
| `qa.md` known-bugs update | Goes into Phase 6 (PR-9) doc refresh per AUDIT-4-1 |
| Test-fixture NIN-uniqueness bug | New finding — added to deferred backlog as "AUDIT-4-7b (post-sprint)" |
| `agent-onboard-subscriber.spec.ts` test status | Currently FAILS on re-run; expected to pass once Option A lands |

This is a TEST-side fix that requires a coordinated edit in two files (`e2e/specs/flows/agent-onboard-subscriber.spec.ts` + `src/services/kyc.js`). Estimate: ~30 min, sprint 2 or as a pre-sprint chore.

## Trace artifacts retained

- `docs/audits/2026-04-distributor/baseline-traces/aml-resolution-stdout.log` — Playwright output
- `test-results/flows-agent-onboard-subscr-98fac-subscriber-balances-via-RPC-chromium/test-failed-1.png` — screenshot at failure
- `test-results/flows-agent-onboard-subscr-98fac-subscriber-balances-via-RPC-chromium/trace.zip` — full trace
- `test-results/flows-agent-onboard-subscr-98fac-subscriber-balances-via-RPC-chromium/error-context.md` — Playwright error context dump

## Acceptance — Phase 0 A0.4 exit

- [x] AML hang verdict: DOES NOT REPRODUCE
- [x] Different bug surfaced and root-caused (NIN test-fixture)
- [x] Fix recommendation documented (Option A)
- [x] qa.md known-bugs entry update queued for Phase 6 (PR-9)
- [x] No source-file modification (spec was not edited; we ran it as-is)
- [x] Trace artifacts retained for follow-up
