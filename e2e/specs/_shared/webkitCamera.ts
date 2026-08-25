// Shared WebKit-only fake-camera stub for signup/onboarding flows that drive
// LivenessStep's "Take selfie" step (src/signup/steps/LivenessStep.jsx).
//
// playwright.config.ts's `chromium` project passes
// `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` so
// Chromium's getUserMedia() resolves with a synthetic camera stream. A
// comment there used to claim those flags were "Mirrored to the webkit +
// mobile projects below" — they never were (`git log
// -S"use-fake-ui-for-media-stream"` shows the webkit project block has never
// had a `launchOptions` entry), and Chromium's CLI flags don't apply to
// WebKit's engine anyway. Without a fake device, real WebKit's
// getUserMedia() never settles (headless WebKit has no permission UI to
// auto-accept), so `cameraReady` never flips true and "Take selfie" stays
// disabled forever. That is the root cause of the two webkit-only baseline
// failures this stub fixes: subscriber-signin-with-password.spec.ts:78 and
// subscriber-signup-to-contribute.spec.ts:116. Full diagnosis:
// docs/audits/2026-08-23/a25/webkit-diagnosis.md.
//
// Fix: stub `navigator.mediaDevices.getUserMedia` for the webkit project
// only (Chromium keeps its already-working fake device untouched) via
// `page.addInitScript()`, returning a real MediaStream from a plain 2D
// canvas's `captureStream()` — a genuine video track with nonzero
// dimensions, so LivenessStep's `waitForVideoDimensions` (which waits on the
// <video>'s `loadedmetadata`/`loadeddata` event) resolves the same way it
// would for a real camera, and `captureFrame()`'s `ctx.drawImage(video, …)`
// + `canvas.toBlob()` produce a real JPEG blob for the mocked `faceMatch`
// call.
//
// Call this BEFORE any `page.goto(...)` in the test. `addInitScript`
// registers the script for every subsequent navigation on this `page`, so it
// does not matter whether the LivenessStep visit happens via this spec's own
// inline steps or via `e2e/helpers/signup.ts`'s
// `walkSignupToFirstContribution` — that helper is outside this remediation
// phase's write-set, so this stub works around it from the call site instead
// of editing it.
import type { Page } from '@playwright/test';

export async function stubWebkitCamera(page: Page, browserName: string): Promise<void> {
  // No-op on chromium/mobile-chromium — their fake device already works.
  if (browserName !== 'webkit') return;

  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#292867';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // 15fps is plenty for a static frame and keeps CPU use low across the suite.
    const stream = (
      canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }
    ).captureStream(15);

    const nav = navigator as Navigator & { mediaDevices?: MediaDevices };
    if (!nav.mediaDevices) {
      // Some WebKit builds under automation don't expose a full
      // `mediaDevices` object at all — synthesize the minimum shape
      // LivenessStep needs.
      // @ts-expect-error — deliberately narrow stand-in, not a full MediaDevices implementation.
      nav.mediaDevices = {};
    }
    Object.defineProperty(nav.mediaDevices, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: async () => stream,
    });
  });
}
