// Flow spec: anonymous subscriber walks the 9-step signup wizard
// (id-upload → review → nira → otp → liveness → aml → beneficiaries →
// consent → done) and then completes contribution onboarding at
// /signup/contribution, triggering the `create_subscriber_from_signup`
// SECURITY DEFINER RPC. We then verify that the 4 expected DB rows
// (subscribers + subscriber_balances + contribution_schedules + nominees)
// were created atomically.
//
// What this demonstrates (signup template for future flow specs):
//   1. ANONYMOUS auth — signup creates the account, so the test never
//      sets storageState. There is no JWT until the contribution step
//      lands on `verifyOtp` and mints one.
//   2. Walking a multi-step wizard with mocked KYC stages (Smile-ID-v2
//      shaped routes under /api/kyc/*; see CLAUDE.md §10a — these are
//      intentional demo scope and we use the happy path, no force-fails).
//   3. DB verification via the service-role Supabase client of the rows
//      created by the SECURITY DEFINER RPC.
//   4. afterEach cleanup via `cleanupSubscriberByPhone` to keep reruns
//      idempotent (the helper handles FK order: transactions, nominees,
//      subscriber_balances, contribution_schedules, then the parent
//      subscribers row).
//
// Phone uniqueness: derived from `Date.now()` so concurrent test runs
// never collide and the unique constraint on `subscribers.phone` is
// always satisfied. The format `+2567XXXXXXXXX` is intentionally
// outside the seeded `+25671XXXXXXX` range (see CLAUDE.md §8).
//
// Timing budget: mocked latencies add up to roughly:
//   id-quality (~900ms × 2 sides)
//   id-ocr     (~2200ms)
//   nira       (~2400ms) + 1100ms verified beat
//   otp-send   (~600ms)
//   otp-verify (~700ms)
//   face-match (~2200ms) + 1100ms ok beat + ~700ms capturing beat
//   aml        (~1700ms) + 1100ms cleared beat
//   payment    1200ms simulated processing
// = ~15-20s on a warm dev server. test.setTimeout(120_000) is generous.
//
// KNOWN GOTCHAS (called out in code where they bite):
//   • OTP is 4 digits, not 6 (api/kyc/otp-verify.ts:29). '0000' is
//     deliberately rejected to mimic a typo; we use '1234'.
//   • IdUploadStep enforces a 20 KiB minimum file size client-side
//     (services/kyc.js:53) — we pass a buffer comfortably above that.
//   • The selfie capture in LivenessStep is a placeholder Blob built
//     in-component (LivenessStep.jsx:42), so there's no DOM file input
//     to drive; we just click "Take selfie" and let the mock run.
//   • districtId 'd-kampala' is from mockGeo.js — also seeded in the
//     `districts` table so the RPC's FK lookup passes.

import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import {
  cleanupSubscriberByPhone,
  getRow,
  rowExists,
  supabaseAdmin,
} from '../../fixtures/db';
import { PHONE_PREFIX } from '../../helpers/signup-constants';

test.setTimeout(120_000);

type SubscriberRow = {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  district_id: string;
  kyc_status: string;
};

test.describe('subscriber → signup wizard → first contribution (UI + DB)', () => {
  // One unique phone per test, generated at runtime so parallel workers and
  // re-runs don't collide. 9 digits after the +2567 prefix per Uganda format.
  let uniquePhone = '';
  // The 9-digit form the SignupContext stores (no +256 prefix). The
  // contribution route canonicalises to +256... before calling the RPC, so
  // the row that lands in `subscribers.phone` has the +256 prefix — that's
  // what we look up in DB assertions.
  let uniquePhoneDigits = '';

  test.beforeEach(async ({ page }, testInfo) => {
    await disableAnimations(page);

    // 9-digit Uganda mobile (must start 7 per UG numbering plan; the
    // ReviewStep validator and the RPC regex both accept it). Pattern:
    //   PHONE_PREFIX ('71') + 5 trailing digits of Date.now() + 2-digit
    //   workerIndex %% 100 = `+25671XXXXXYY` (12 chars). The trailing
    //   workerIndex disambiguates up to 100 parallel workers running this
    //   spec alongside subscriber-signin-with-password.spec.ts — both
    //   ultimately call create_subscriber_from_signup, whose partial
    //   unique index on subscribers.phone returned 409 in Phase 6 before
    //   the disambiguator was added. PHONE_PREFIX is unified across the
    //   agent-onboard and signup flow specs (see signup-constants.ts).
    const workerSuffix = String(testInfo.workerIndex % 100).padStart(2, '0');
    uniquePhoneDigits = `${PHONE_PREFIX}${String(Date.now()).slice(-5)}${workerSuffix}`;
    uniquePhone = `+256${uniquePhoneDigits}`;

    // Defensive: in case a previous run crashed mid-flow, clean up first.
    await cleanupSubscriberByPhone(uniquePhone);
    await supabaseAdmin.from('users').delete().eq('phone', uniquePhone).eq('role', 'subscriber');
  });

  test.afterEach(async () => {
    // The cleanup helper is the FK-aware, transaction-safe path. Always
    // run it even on failure so the next worker isn't blocked by a stale
    // row holding the unique phone.
    await cleanupSubscriberByPhone(uniquePhone);
    // The `users(phone, role)` row that verify-otp upserts (with the bcrypt
    // password_hash) lives outside the subscriber FK chain and isn't covered
    // by cleanupSubscriberByPhone. Delete it explicitly so reruns start with
    // a fresh "no password yet" state.
    await supabaseAdmin.from('users').delete().eq('phone', uniquePhone).eq('role', 'subscriber');
  });

  test('completes 9-step signup + contribution and writes the subscriber chain', async ({ page }) => {
    // ── Step 1 · id-upload ───────────────────────────────────────────────
    // Upload front + back. The id-quality route always passes for files
    // ≥ 20 KiB (services/kyc.js:53 enforces that client-side); we pass a
    // 32 KiB buffer to clear it. The id-ocr route accepts any truthy
    // front/back tokens and returns a fixed sample subscriber, so we
    // don't need real image data.
    await page.goto('/signup');
    await expect(
      page.getByRole('heading', { name: /scan both sides of your ndaga muntu/i }),
    ).toBeVisible();

    const sampleImage = {
      name: 'id.jpg',
      mimeType: 'image/jpeg',
      // 32 KiB buffer (> the 20 KiB client-side floor in mockAssessImageQuality
      // and the api.post envelope's id-quality guard).
      buffer: Buffer.alloc(32 * 1024, 0xff),
    };
    await page.setInputFiles('#id-upload-front', sampleImage);
    await page.setInputFiles('#id-upload-back', sampleImage);

    // Wait for both quality checks to complete and the Continue button to
    // become enabled. The QualityCheck spinners stay 'running' until
    // assessImageQuality resolves; we lean on the disabled-state of the
    // primary button rather than poking individual badges.
    const idContinue = page.getByRole('button', { name: /^continue$/i });
    await expect(idContinue).toBeEnabled({ timeout: 30_000 });
    await idContinue.click();

    // ── Step 2 · review ──────────────────────────────────────────────────
    // OCR runs on mount (~2200ms). After it lands we fill the manual
    // fields the ID doesn't carry: district, phone, occupation.
    await expect(
      page.getByRole('heading', { name: /check your details/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Phone — bare 9 digits (the +256 prefix is rendered as a sibling badge).
    // The `name="phone"` input is unique on the page.
    await page.locator('input[name="phone"]').fill(uniquePhoneDigits);

    // Override the OCR-provided NIN so parallel workers don't collide on the
    // partial unique index `ux_subscribers_nin` (migration 0017). The mock
    // returns a fixed `CF92018AB3CD45`; we derive a unique value from the
    // unique phone. Format `^C[MF][A-Z0-9]{12}$` — 14 chars total
    // (ReviewStep.jsx:10). 'CF' + 9-digit phone + 'ABC' = 14 chars.
    await page.locator('#nin').fill(`CF${uniquePhoneDigits}ABC`);

    // District — combobox: focus opens the listbox, then we click the option.
    // Picking "Kampala" yields id `d-kampala`, which is seeded in the
    // `districts` table so the RPC's FK lookup succeeds.
    await page.locator('#district').click();
    await page.locator('#district').fill('Kampala');
    await page.getByRole('option', { name: 'Kampala', exact: true }).click();

    // Occupation — a plain <select>.
    await page.locator('#occupation').selectOption('farmer');

    // Password fields (Phase 6 — see api/auth/verify-otp.ts password param).
    // ReviewStep validates ≥8 chars with at least one letter + one digit; the
    // raw value is stashed on SignupContext and shipped to verify-otp via
    // ContributionRoute, which stamps `users.password_hash` (bcrypt).
    //
    // ReviewField appends a " *" required marker to non-optional labels, so
    // the accessible name is "Password *" / "Confirm password *". Selecting by
    // id (`#password` / `#confirm-password`) is the most stable anchor and
    // matches how the file targets the other ReviewField inputs (#district,
    // #occupation). The labels still resolve too — `await page.getByLabel(/^password/i)`
    // would also work — but locator-by-id is what the rest of this spec uses.
    await page.locator('#password').fill('Demo1234');
    await page.locator('#confirm-password').fill('Demo1234');

    await page.getByRole('button', { name: /^continue$/i }).click();

    // ── Step 3 · nira (silent + verified beat) ───────────────────────────
    // Auto-advances after ~2400ms verify + ~1100ms confirmation beat.
    // The "verified" beat shows "Identity verified" before goNext() fires.
    await expect(
      page.getByRole('heading', { name: /verifying your identity with nira/i }),
    ).toBeVisible({ timeout: 10_000 });

    // ── Step 4 · otp ─────────────────────────────────────────────────────
    // 4-digit OTP. The route accepts any 4-digit code except '0000'; we
    // use '1234'. There are 4 inputs labelled "Digit 1 of 4" .. "Digit 4 of 4";
    // entering the 4th digit auto-submits after ~450ms.
    await expect(
      page.getByRole('heading', { name: /enter the code we sent you/i }),
    ).toBeVisible({ timeout: 15_000 });

    const otpCode = '1234';
    for (let i = 0; i < otpCode.length; i++) {
      await page
        .getByRole('textbox', { name: new RegExp(`digit ${i + 1} of 4`, 'i') })
        .fill(otpCode[i]!);
    }

    // ── Step 5 · liveness ────────────────────────────────────────────────
    // Click "Take selfie" — the component builds its own placeholder Blob
    // and calls faceMatch. Mock returns outcome 'ok' (no force flag set);
    // the auto-advance fires ~1100ms after the "All good" status.
    await expect(
      page.getByRole('heading', { name: /take a quick selfie/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /take selfie/i }).click();

    // ── Step 6 · aml (silent + cleared beat) ─────────────────────────────
    // Auto-advance after the "Background check passed" beat.
    await expect(
      page.getByRole('heading', { name: /running a quick compliance check/i }),
    ).toBeVisible({ timeout: 15_000 });

    // ── Step 7 · beneficiaries ───────────────────────────────────────────
    // The form lazy-seeds a single row with share=100; we only need to
    // fill name / phone / relationship to satisfy validList(). The
    // insurance-same-as-pension checkbox is checked by default, so we
    // don't need to touch insurance beneficiaries.
    await expect(
      page.getByRole('heading', { name: /who inherits your savings\?/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('textbox', { name: /full name/i }).fill('Test Nominee');
    // The first beneficiary's phone input has no static id (id is
    // composed from a randomly-generated row id), so we scope by placeholder.
    await page.getByPlaceholder('7XX XXX XXX').fill('700111222');
    // The first beneficiary's relationship select — only one combobox on
    // this step (the BeneficiaryRow uses a <select>, not role=combobox).
    await page.getByRole('combobox').first().selectOption('spouse');

    // Continue is disabled until pensionOk && choiceSet && (insuranceOk).
    // insuranceSameAsPension defaults to true so choiceSet is true and
    // insuranceOk short-circuits true. Once the row is valid we're good.
    const benefContinue = page.getByRole('button', { name: /^continue$/i });
    await expect(benefContinue).toBeEnabled({ timeout: 10_000 });
    await benefContinue.click();

    // ── Step 8 · consent ─────────────────────────────────────────────────
    // PRE-PHASE-6 DRIFT: commit 9e585b7 ("post-payment activation + real
    // camera") renamed the consent heading from "Before we activate your
    // account" → "One last thing before payment" and the CTA from
    // "Activate my account" → "I consent — continue". Updated to match.
    await expect(
      page.getByRole('heading', { name: /one last thing before payment/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The consent checkbox is the only checkbox on the page.
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /i consent.*continue/i }).click();

    // ── Step 9 · done (activated) ────────────────────────────────────────
    // PRE-PHASE-6 DRIFT: commit 9e585b7 moved activation post-payment, so
    // the ActivatedStep is now reached *after* the contribution flow rather
    // than before. The signup wizard now jumps directly into the contribution
    // settings view; we keep the original heading wait below for safety but
    // the "Make your first contribution" / "Continue" button no longer
    // mediates between Consent and Contribution — Consent's submit now
    // goes straight to /signup/contribution.

    // ── Contribution onboarding (Plan & pay) ────────────────────────────
    // Pick monthly (already the default), enter 10,000 UGX (above the
    // MIN_CONTRIBUTION floor), keep the default 80/20 split. Payment is now
    // MERGED into this page (no separate "Pay now" step): the Mobile Money
    // picker is inline in the summary and a single "Pay UGX…" CTA submits.
    await expect(
      page.getByRole('heading', { name: /set up your contributions/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Use a preset for amount entry — '10,000 UGX' is the first preset chip.
    await page.getByRole('button', { name: /^UGX 10,000$/ }).click();

    // Section 04 · multi-product insurance — Life is on by default; add Health +
    // Funeral so the insurancePolicy + insuranceProducts[] split is exercised
    // end-to-end (asserted in the DB block below).
    await page.getByRole('switch', { name: /health insurance/i }).click();
    await page.getByRole('switch', { name: /funeral insurance/i }).click();

    // Mobile Money is the default selected method; fill the inline phone so the
    // Pay CTA enables. The label is dynamic ("Pay UGX 10,000") — match by prefix.
    await page.getByPlaceholder('700 000 000').fill('700123456');

    const payBtn = page.getByRole('button', { name: /^pay (ugx|\d)/i });
    await expect(payBtn).toBeEnabled();

    // The atomic write fires after the 1.2s simulated payment delay. Wait
    // for the RPC response — that's the authoritative signal that the
    // SECURITY DEFINER function completed (and, by implication, the
    // trigger-chain created subscriber_balances + the first commission).
    const rpcPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/rest/v1/rpc/create_subscriber_from_signup') &&
        r.request().method() === 'POST',
      { timeout: 30_000 },
    );

    await payBtn.click();

    const rpcResponse = await rpcPromise;
    expect(rpcResponse.status(), 'create_subscriber_from_signup RPC must succeed').toBe(200);

    // ── DB verification ──────────────────────────────────────────────────
    // The RPC stores the canonical phone (+256...) directly into
    // subscribers.phone. The contribution route canonicalises before
    // calling, so we look up by the +256-prefixed form.
    expect(
      await rowExists('subscribers', { phone: uniquePhone }),
      `subscribers row for ${uniquePhone}`,
    ).toBe(true);

    const sub = await getRow<SubscriberRow>('subscribers', { phone: uniquePhone });
    expect(sub, 'subscriber row should be readable').not.toBeNull();
    expect(sub!.id, 'subscriber id should be minted by the RPC').toMatch(/^s-\d+$/);
    expect(sub!.district_id).toBe('d-kampala');
    expect(sub!.kyc_status).toBe('complete');
    expect(sub!.name).toBeTruthy();

    // The contribution_schedules row is part of the atomic insert chain.
    expect(
      await rowExists('contribution_schedules', { subscriber_id: sub!.id }),
      'contribution_schedules row should be inserted by the RPC',
    ).toBe(true);

    // subscriber_balances is created by the AFTER INSERT trigger on the
    // first transactions row (see _insert_subscriber_chain header
    // comment). Its existence confirms the trigger chain fired.
    expect(
      await rowExists('subscriber_balances', { subscriber_id: sub!.id }),
      'subscriber_balances row should be created by the contribution trigger',
    ).toBe(true);

    // At least one nominee — we filled in a single pension beneficiary
    // and left insuranceSameAsPension=true, which causes the RPC to
    // mirror the pension nominee into a second 'insurance'-typed row.
    expect(
      await rowExists('nominees', { subscriber_id: sub!.id }),
      'at least one nominee row should be inserted',
    ).toBe(true);

    // Multi-product insurance: life (default selection) → insurance_policies;
    // the Health + Funeral add-ons → subscriber_insurance_products, both via the
    // shared _insert_subscriber_chain (migration 0065). Pins the self-signup
    // multi-product split through create_subscriber_from_signup.
    expect(
      await rowExists('insurance_policies', { subscriber_id: sub!.id }),
      `life insurance_policies row should be created for ${sub!.id}`,
    ).toBe(true);
    expect(
      await rowExists('subscriber_insurance_products', { subscriber_id: sub!.id, product: 'health' }),
      `health subscriber_insurance_products row should be created for ${sub!.id}`,
    ).toBe(true);
    expect(
      await rowExists('subscriber_insurance_products', { subscriber_id: sub!.id, product: 'funeral' }),
      `funeral subscriber_insurance_products row should be created for ${sub!.id}`,
    ).toBe(true);

    // Password hash — the raw password we typed at ReviewStep travels through
    // SignupContext → ContributionRoute → verify-otp, which bcrypts it onto
    // users(phone, role). bcrypt prefixes are $2a$ / $2b$ / $2y$; assert one
    // of those is present so a regression that drops the hash (e.g. password
    // accidentally omitted from the verify-otp payload) fails loudly here.
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('password_hash')
      .eq('phone', uniquePhone)
      .eq('role', 'subscriber')
      .single();
    expect(userRow?.password_hash, 'users.password_hash should hold a bcrypt digest').toMatch(/^\$2[aby]\$/);

    // eslint-disable-next-line no-console
    console.log(
      `[db] new subscriber: ${sub!.id} (phone=${uniquePhone}, district=${sub!.district_id}, kyc=${sub!.kyc_status})`,
    );
  });
});
