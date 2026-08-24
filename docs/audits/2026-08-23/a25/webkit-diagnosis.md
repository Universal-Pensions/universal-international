# The four unowned WebKit failures — diagnosed

**Run:** 2026-08-25 · Phase 1, `P1-webkit`. Diagnosis only; no files changed.

These were the only rows in the whole 30-failure routing table with no owning
finding — the 221-finding audit never root-caused them. Signin and signup are
demo-path, so the question that mattered was: **does Safari actually break the demo?**

## Verdict: no. All four are test artefacts.

| Test | Verdict | Demo impact |
|---|---|---|
| `subscriber-signin-with-password:78` | TEST ARTEFACT | none |
| `subscriber-signup-to-contribute:116` | TEST ARTEFACT | none |
| `map-drill:250` (admin) | TEST ARTEFACT | none |
| `map-drill:250` (distributor) | TEST ARTEFACT | none |

## 1 & 2 — the camera that was never wired up for WebKit

Both fail identically: `expect(getByRole('button', {name: /take selfie/i})).toBeEnabled()`
times out, and the screenshot shows LivenessStep stuck on **"Starting camera…"** — a hang,
not a permission-denied or no-camera error.

`playwright.config.ts`'s **chromium** project passes
`launchOptions.args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']`,
and the comment beside it says *"Mirrored to the webkit + mobile projects below"*.

**It never was.** The webkit project block has no `launchOptions` at all, and
`git log -S"use-fake-ui-for-media-stream"` shows this has been true since the commit that
introduced the flags. The comment asserted a parity that never existed. (Chromium's CLI flags
would not apply to WebKit anyway.)

With no fake device and no granted permission, WebKit's `getUserMedia()` never settles, so
`cameraReady`/`cameraError` stay at their initial values, `canCapture` stays false, and the
button stays disabled forever.

**Why there is no demo impact:** a rep on a real Mac or iPhone gets Safari's native camera
prompt. Safari has supported `getUserMedia` over HTTPS for years and production is HTTPS. This
is a gap in the test double, not the product.

**Fix (test-infra):** do not copy Chromium's args — WebKit does not accept them. Stub
`navigator.mediaDevices.getUserMedia` for the webkit project via `page.addInitScript()`,
returning a synthetic stream from `canvas.captureStream()`. And fix or delete the false
"Mirrored to…" comment.

## 3 & 4 — one bug, and it is not WebKit-only

Both map-drill rows are the **same** failure: same component, same helper, only the persona
differs. The region drill works; the second click (region → district) never advances.

`clickPolygonUntilUrl` picks its target by *"drop the single largest `.leaflet-interactive`
shape, click the next-largest"*, assuming exactly one oversized non-clickable outline.
`UgandaMap.jsx` Layer 2 (the region colour overlay) is re-rendered for all 4 regions at every
drill level, and gets `onEachFeature` **only** at country level — but is never marked
`interactive={false}` otherwise. Leaflet therefore still tags all four `.leaflet-interactive`
and hit-tests them. After zooming into a region the other regions' leftover polygons have huge
projected bounding boxes, so there are up to four oversized decoys, not one. The click lands on
a shape nothing is listening to: a silent no-op that exhausts all three retries.

### The finding that changes the routing table

**Chromium does not reliably pass this either — 3 passed / 2 failed over 5 runs**, with the
byte-identical error. WebKit failed 5/5. The frozen baseline simply caught a passing chromium
instance.

So the audit's claim (A25-013) that `modal-escape:224` is *"the ONLY true flake in the whole
suite"* is **wrong**. `map-drill:250` is flaky too, on both engines. The ledger's routing table
and Phase 7's scope should be corrected.

**Positive control:** clicking an *actual visible district* polygon (filtering to the
transparent fill real districts use — what a human aims at) succeeded **6/6**, three chromium
and three webkit. So `drillDown()`, the ref-based name→id lookup, and WebKit's hit-testing all
work correctly and identically. Only the blind geometric heuristic is broken.

This is **not** a revival of the historical `onEachFeature` empty-name→id race — that fix is
confirmed still working.

**Fix, two parts:**
- *Required (test):* in `map-drill.spec.ts`, when the target is a district, filter candidates to
  transparent-fill shapes before applying "drop biggest, take next".
- *Optional but worth it (app):* gate `interactive={level === 'country'}` on `UgandaMap.jsx`
  Layer 2 to match its existing `onEachFeature` conditional. This removes a real dead-click zone
  for any user whose click lands on a leftover region tint instead of the district beneath.

## Left unverified, honestly

- What happens in WebKit **after** the camera gate — both specs block before the remaining ~5
  steps, which have no other media dependency but were not empirically confirmed.
- The exact chromium flake rate (5 runs is enough to disprove "always passes", not to quantify).
- Real non-headless Safari against production — inferred from Safari's documented HTTPS
  `getUserMedia` support, not device-tested.
