// Shared signup walkthrough helper — drives the 9-step subscriber signup
// wizard + the contribution onboarding step. Factored out of the original
// inline walkthrough in `e2e/specs/flows/subscriber-signup-to-contribute.spec.ts`
// so the password-sign-in spec can reuse the same path.
//
// Camera/liveness flows depend on the Chromium `--use-fake-ui-for-media-stream`
// launch flag (configured in playwright.config.ts) so the getUserMedia prompt
// auto-accepts instead of stalling the LivenessStep "Take selfie" click.
//
// The original spec (Phase 1 of the QA suite) inlined the walkthrough with
// some DB-assertion-specific waits — the helper preserves those exact waits
// so callers don't get flake from the mocked-KYC latency budget (~15-20s on
// a warm dev server; see the source spec's timing comment for the breakdown).
//
// The helper does NOT run any DB cleanup — that's the caller's responsibility.
// Use `cleanupSubscriberByPhone(phone)` from `e2e/fixtures/db.ts` in your
// afterEach (and also delete `users(phone, role='subscriber')` for the bcrypt
// row stamped by verify-otp).

import { expect, type Page } from '@playwright/test';
import {
  BENEFICIARY_NAME,
  BENEFICIARY_PHONE,
  BENEFICIARY_RELATIONSHIP,
  ID_UPLOAD_BYTES,
  ID_UPLOAD_FILENAME,
  ID_UPLOAD_MIMETYPE,
  NIN_PREFIX,
  NIN_SUFFIX,
  QUICK_CONTRIBUTION_LABEL,
  SIGNUP_DISTRICT,
  SIGNUP_OCCUPATION,
  SIGNUP_OTP_CODE,
} from './signup-constants';

export type SignupConfig = {
  /** 9-digit local phone (no +256 prefix). Generate with Date.now() for parallel-safe uniqueness. */
  phoneDigits: string;
  /** Raw password to set during ReviewStep. Must be ≥8 chars with at least one letter + one digit. */
  password: string;
};

/**
 * Walk through the full subscriber signup wizard + first contribution.
 * Caller must already have navigated nowhere yet — the helper does the goto.
 *
 * Returns once the `create_subscriber_from_signup` RPC has completed with a
 * 200 response — i.e. the auth state is fully persisted and the dashboard is
 * about to render. Callers can then assert on dashboard content or sign out.
 */
export async function walkSignupToFirstContribution(
  page: Page,
  config: SignupConfig,
): Promise<void> {
  const { phoneDigits, password } = config;

  // ── Step 1 · id-upload ───────────────────────────────────────────────────
  await page.goto('/signup');
  await expect(
    page.getByRole('heading', { name: /scan both sides of your ndaga muntu/i }),
  ).toBeVisible();

  const sampleImage = {
    name: ID_UPLOAD_FILENAME,
    mimeType: ID_UPLOAD_MIMETYPE,
    // ID_UPLOAD_BYTES is 32 KiB > the 20 KiB client-side floor in
    // mockAssessImageQuality (services/kyc.js:53).
    buffer: Buffer.alloc(ID_UPLOAD_BYTES, 0xff),
  };
  await page.setInputFiles('#id-upload-front', sampleImage);
  await page.setInputFiles('#id-upload-back', sampleImage);

  const idContinue = page.getByRole('button', { name: /^continue$/i });
  await expect(idContinue).toBeEnabled({ timeout: 30_000 });
  await idContinue.click();

  // ── Step 2 · review ──────────────────────────────────────────────────────
  await expect(
    page.getByRole('heading', { name: /check your details/i }),
  ).toBeVisible({ timeout: 30_000 });

  await page.locator('input[name="phone"]').fill(phoneDigits);

  // Override the OCR-provided NIN so parallel runs don't collide on the
  // partial unique index `ux_subscribers_nin` (migration 0017). The OCR mock
  // returns a fixed `CF92018AB3CD45`; we replace it with a per-run unique
  // value derived from the unique phone digits. NIN format is
  // `^C[MF][A-Z0-9]{12}$` (14 chars total — ReviewStep.jsx:10).
  await page.locator('#nin').fill(`${NIN_PREFIX}${phoneDigits}${NIN_SUFFIX}`);

  await page.locator('#district').click();
  await page.locator('#district').fill(SIGNUP_DISTRICT);
  await page.getByRole('option', { name: SIGNUP_DISTRICT, exact: true }).click();

  await page.locator('#occupation').selectOption(SIGNUP_OCCUPATION);

  // Password + confirm — Phase 6 fields. ReviewField appends a " *" required
  // marker to non-optional labels, so we target by id (matches the rest of
  // this walkthrough's selector style for ReviewField inputs).
  await page.locator('#password').fill(password);
  await page.locator('#confirm-password').fill(password);

  await page.getByRole('button', { name: /^continue$/i }).click();

  // ── Step 3 · nira (silent + verified beat) ───────────────────────────────
  await expect(
    page.getByRole('heading', { name: /verifying your identity with nira/i }),
  ).toBeVisible({ timeout: 10_000 });

  // ── Step 4 · otp ─────────────────────────────────────────────────────────
  await expect(
    page.getByRole('heading', { name: /enter the code we sent you/i }),
  ).toBeVisible({ timeout: 15_000 });

  for (let i = 0; i < SIGNUP_OTP_CODE.length; i++) {
    await page
      .getByRole('textbox', { name: new RegExp(`digit ${i + 1} of 4`, 'i') })
      .fill(SIGNUP_OTP_CODE[i]!);
  }

  // ── Step 5 · liveness ────────────────────────────────────────────────────
  await expect(
    page.getByRole('heading', { name: /take a quick selfie/i }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /take selfie/i }).click();

  // ── Step 6 · aml (silent + cleared beat) ─────────────────────────────────
  await expect(
    page.getByRole('heading', { name: /running a quick compliance check/i }),
  ).toBeVisible({ timeout: 15_000 });

  // ── Step 7 · beneficiaries ───────────────────────────────────────────────
  await expect(
    page.getByRole('heading', { name: /who inherits your savings\?/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole('textbox', { name: /full name/i }).fill(BENEFICIARY_NAME);
  await page.getByPlaceholder('7XX XXX XXX').fill(BENEFICIARY_PHONE);
  await page.getByRole('combobox').first().selectOption(BENEFICIARY_RELATIONSHIP);

  const benefContinue = page.getByRole('button', { name: /^continue$/i });
  await expect(benefContinue).toBeEnabled({ timeout: 10_000 });
  await benefContinue.click();

  // ── Step 8 · consent ─────────────────────────────────────────────────────
  // PRE-PHASE-6 DRIFT: commit 9e585b7 ("post-payment activation + real
  // camera") renamed the heading + CTA and moved activation post-payment.
  await expect(
    page.getByRole('heading', { name: /one last thing before payment/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /i consent.*continue/i }).click();
  // Consent navigates directly to /signup/contribution — no intermediate
  // ActivatedStep heading (that renders post-payment now).

  // ── Contribution onboarding (Plan & pay) ─────────────────────────────────
  // Payment is now MERGED into the contribution page (no "Pay now" swap): the
  // method picker lives in the summary and the single "Pay UGX…" CTA submits.
  await expect(
    page.getByRole('heading', { name: /set up your contributions/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page
    .getByRole('button', { name: new RegExp(`^${QUICK_CONTRIBUTION_LABEL}$`) })
    .click();

  // Mobile Money is selected by default; fill the phone so the Pay CTA enables.
  await page.getByPlaceholder('700 000 000').fill('700123456');

  const payBtn = page.getByRole('button', { name: /^pay (ugx|\d)/i });
  await expect(payBtn).toBeEnabled();

  const rpcPromise = page.waitForResponse(
    (r) =>
      r.url().includes('/rest/v1/rpc/create_subscriber_from_signup') &&
      r.request().method() === 'POST',
    { timeout: 30_000 },
  );

  await payBtn.click();

  const rpcResponse = await rpcPromise;
  expect(rpcResponse.status(), 'create_subscriber_from_signup RPC must succeed').toBe(200);

  // ── Activated → /dashboard ────────────────────────────────────────────────
  // ContributionRoute flips to phase='activated' after the RPC + verify-otp
  // succeed, rendering ActivatedStep with a "Continue" button that calls
  // navigate('/dashboard'). The signup-to-contribute spec stops at the RPC
  // 200 and goes straight to DB checks; the password-sign-in spec needs the
  // dashboard to land so it can sign out. We wait for the activation heading
  // ("You're all set") then click Continue.
  await expect(
    page.getByRole('heading', { name: /you['’]re all set/i }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /go to my dashboard/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
}
