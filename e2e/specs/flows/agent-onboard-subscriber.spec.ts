// Flow spec: agent walks the /dashboard/onboard wizard and enrols a brand-new
// subscriber, triggering the SECURITY DEFINER
// `create_subscriber_from_agent_onboard` RPC. We then verify the
// (subscribers + subscriber_balances) chain landed in the DB.
//
// What this demonstrates (extends the subscriber-edit-profile + signup-to-
// contribute templates):
//   1. Auth via storageState — pre-authed as agent a-001 (Kampala). The agent
//      onboard RPC cross-checks payload.calling_agent_id against the JWT
//      claim agentId, so this also covers that guard implicitly.
//   2. Multi-stage agent panel: awareness → 8-step KYC → schedule → done.
//      Reuses the same KYC step components as /signup, so the selectors
//      mirror the subscriber-signup-to-contribute spec one-for-one.
//   3. RPC verification via page.waitForResponse on the rest/v1/rpc/* URL.
//      The OnboardingComplete component auto-fires the RPC on mount, so we
//      register the listener *before* navigating into /dashboard/onboard.
//   4. DB verification via service-role Supabase client (fixtures/db).
//   5. afterEach cleanup keyed on the unique +256 phone we generated.
//
// Timing budget (mocked KYC latencies stack up):
//   id-quality  ~900ms × 2 sides
//   id-ocr      ~2200ms
//   nira        ~2400ms + 1100ms verified beat
//   otp-send    ~600ms, otp-verify ~700ms + 450ms auto-submit debounce
//   face-match  ~2200ms + 1100ms ok beat + ~700ms capturing beat
//   aml         ~1700ms + 1100ms cleared beat
//   RPC         under 1s on a warm pool
// ≈ 16-22s typical; test.setTimeout(60_000) gives plenty of headroom.
//
// KNOWN GOTCHAS (called out alongside the code where they bite):
//   • OTP is 4 digits, not 6 (api/kyc/otp-verify.ts:29). '0000' is rejected.
//   • IdUploadStep enforces a 20 KiB minimum file size client-side
//     (services/kyc.js:53) — we pass a 32 KiB buffer.
//   • districtId 'd-kampala' is from mockGeo.js — also seeded in the
//     `districts` table so the RPC's FK lookup passes.
//   • The agent onboard variant skips the subscriber-side "done" celebration
//     step entirely (OnboardKycFlow.jsx:52). Consent -> handoff -> schedule
//     -> OnboardingComplete is the agent-only ending.

import { test, expect } from '@playwright/test';
import { storageStatePathFor, PERSONA_FOR } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { cleanupSubscriberByPhone, getRow, rowExists } from '../../fixtures/db';
import { PHONE_PREFIX } from '../../helpers/signup-constants';

test.use({ storageState: storageStatePathFor('agent') });
test.setTimeout(90_000);

const AGENT_ID = PERSONA_FOR.agent.entityId; // 'a-001'

type SubscriberRow = {
  id: string;
  phone: string;
  name: string;
  district_id: string;
  agent_id: string;
  kyc_status: string;
};

test.describe('agent → onboard new subscriber (UI + RPC + DB)', () => {
  // Unique 9-digit local phone per run; canonical DB form prepends +256.
  // Pin the PHONE_PREFIX carrier prefix (valid per src/utils/phone.js
  // VALID_PREFIXES) and fill the remaining 7 digits from epoch ms so reruns
  // can't collide with the seeded +25671XXXXXXX demo range or each other.
  // Append a 2-digit workerIndex %% 100 disambiguator so up to 100 parallel
  // workers each carve their own phone-suffix pool.
  let uniquePhoneDigits = '';
  let uniquePhone = '';

  test.beforeEach(async ({ page }, testInfo) => {
    await disableAnimations(page);
    const workerSuffix = String(testInfo.workerIndex % 100).padStart(2, '0');
    uniquePhoneDigits = `${PHONE_PREFIX}${String(Date.now()).slice(-5)}${workerSuffix}`;
    uniquePhone = `+256${uniquePhoneDigits}`;
    // Defensive: if a previous run crashed mid-flow, scrub any rows holding
    // this phone so the unique partial index on subscribers(phone) doesn't
    // block the new INSERT.
    await cleanupSubscriberByPhone(uniquePhone);
  });

  test.afterEach(async () => {
    // FK-aware cleanup (transactions, nominees, subscriber_balances,
    // contribution_schedules, then parent subscribers). Always runs so the
    // next worker isn't blocked by a stale row.
    await cleanupSubscriberByPhone(uniquePhone);
  });

  test('full wizard creates subscriber + balances via RPC', async ({ page }) => {
    // Register the RPC listener BEFORE we trigger any wizard interaction.
    // OnboardingComplete fires create_subscriber_from_agent_onboard on its
    // first mount (Promise.resolve().then(persist)) — the listener has to
    // be live by the time we reach that screen. 60s timeout is generous:
    // the full wizard (9 KYC steps + schedule) takes ~30s end-to-end on a
    // warm dev server because each mocked KYC endpoint has 1-2.4s latency.
    const rpcPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/rest/v1/rpc/create_subscriber_from_agent_onboard') &&
        r.request().method() === 'POST',
      { timeout: 60_000 },
    );

    await page.goto('/dashboard/onboard');
    await expect(
      page.getByRole('heading', { level: 1, name: /onboard a new subscriber/i }),
    ).toBeVisible();

    // ── Stage 1 · awareness ────────────────────────────────────────────
    // 5 quiz cards (q1-q5); each has a Yes/No radio pair. Mark every one
    // "Yes" so Continue enables (requires all 5 answered).
    const yesButtons = page.getByRole('radio', { name: /^yes$/i });
    await expect(yesButtons).toHaveCount(5);
    for (let i = 0; i < 5; i++) {
      await yesButtons.nth(i).click();
    }
    await page.getByRole('button', { name: /continue to kyc/i }).click();

    // ── KYC step 1 · id-upload ─────────────────────────────────────────
    // Upload front + back. id-quality always passes for files ≥ 20 KiB
    // (services/kyc.js:53 floor); we pass a 32 KiB buffer. id-ocr accepts
    // any truthy front/back tokens and returns a fixed sample subscriber.
    await expect(
      page.getByRole('heading', { name: /scan both sides of your ndaga muntu/i }),
    ).toBeVisible({ timeout: 10_000 });

    const sampleImage = {
      name: 'id.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.alloc(32 * 1024, 0xff),
    };
    await page.setInputFiles('#id-upload-front', sampleImage);
    await page.setInputFiles('#id-upload-back', sampleImage);

    // Both quality checks must resolve before Continue enables. We lean on
    // the button's disabled state (driven by bothUploaded && bothPass) so
    // we don't race the per-side badge animations.
    const idContinue = page.getByRole('button', { name: /^continue$/i });
    await expect(idContinue).toBeEnabled({ timeout: 30_000 });
    await idContinue.click();

    // ── KYC step 2 · review ────────────────────────────────────────────
    // OCR runs on mount (~2200ms). After it lands we fill the manual
    // fields the ID doesn't carry: district, phone, occupation. The OCR
    // mock supplies fullName/nin/cardNumber/dob/gender, so we don't have
    // to type those.
    await expect(
      page.getByRole('heading', { name: /check your details/i }),
    ).toBeVisible({ timeout: 30_000 });

    // Phone — bare 9 digits (the +256 prefix is rendered as a sibling badge).
    await page.locator('input[name="phone"]').fill(uniquePhoneDigits);

    // District — combobox: focus opens the listbox, then we click the option.
    // Picking "Kampala" yields id 'd-kampala' (seeded in the `districts`
    // table so the RPC's FK lookup succeeds).
    await page.locator('#district').click();
    await page.locator('#district').fill('Kampala');
    await page.getByRole('option', { name: 'Kampala', exact: true }).click();

    // Occupation — a plain <select>.
    await page.locator('#occupation').selectOption('trader');

    await page.getByRole('button', { name: /^continue$/i }).click();

    // ── KYC step 3 · nira (silent + verified beat) ─────────────────────
    // Auto-advances after ~2400ms verify + ~1100ms confirmation beat.
    // Nothing to click; we just need the loader to be visible to confirm
    // we landed on the right step before the auto-advance moves on.
    await expect(
      page.getByRole('heading', { name: /verifying your identity with nira/i }),
    ).toBeVisible({ timeout: 15_000 });

    // ── KYC step 4 · otp ───────────────────────────────────────────────
    // 4-digit OTP. The route accepts any 4-digit code except '0000'; we
    // use '1234'. Entering the 4th digit triggers auto-submit after 450ms.
    await expect(
      page.getByRole('heading', { name: /enter the code we sent you/i }),
    ).toBeVisible({ timeout: 15_000 });

    const otpCode = '1234';
    for (let i = 0; i < otpCode.length; i++) {
      await page
        .getByRole('textbox', { name: new RegExp(`digit ${i + 1} of 4`, 'i') })
        .fill(otpCode[i]!);
    }

    // ── KYC step 5 · liveness ──────────────────────────────────────────
    // Click "Take selfie" — the component builds its own placeholder Blob
    // (LivenessStep.jsx:42) and calls faceMatch. Mock returns 'ok'; the
    // auto-advance fires ~1100ms after the "All good" status.
    await expect(
      page.getByRole('heading', { name: /take a quick selfie/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /take selfie/i }).click();

    // ── KYC step 6 · aml (silent + cleared beat) ───────────────────────
    // Auto-advance after the "Background check passed" beat (~1700ms +
    // 1100ms). No interaction needed.
    await expect(
      page.getByRole('heading', { name: /running a quick compliance check/i }),
    ).toBeVisible({ timeout: 15_000 });

    // ── KYC step 7 · beneficiaries ─────────────────────────────────────
    // Lazy-seeded with a single row at share=100; fill name/phone/relationship
    // to satisfy validList(). insuranceSameAsPension defaults to true so we
    // don't have to manage a separate insurance section.
    await expect(
      page.getByRole('heading', { name: /who inherits your savings\?/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('textbox', { name: /full name/i }).fill('Test Nominee');
    // BeneficiaryRow phone input has a generated id (random row id), so we
    // scope by the placeholder which is unique on the step.
    await page.getByPlaceholder('7XX XXX XXX').fill('700111222');
    // The first (and only) relationship <select>; the page has no other
    // role=combobox elements at this point.
    await page.getByRole('combobox').first().selectOption('spouse');

    const benefContinue = page.getByRole('button', { name: /^continue$/i });
    await expect(benefContinue).toBeEnabled({ timeout: 10_000 });
    await benefContinue.click();

    // ── KYC step 8 · consent ───────────────────────────────────────────
    // Tick the (single) checkbox to enable "I consent — continue".
    await expect(
      page.getByRole('heading', { name: /consent & data use/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /i consent — continue/i }).click();

    // ── Stage 3 · contribution schedule ────────────────────────────────
    // ContributionSettingsForm — monthly is the default frequency. Fill
    // amount (above the MIN_CONTRIBUTION floor, 500 UGX), keep the 80/20
    // retirement split, then Save & continue.
    await expect(
      page.getByRole('heading', { name: /how often\?/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page
      .getByRole('textbox', { name: /contribution amount/i })
      .fill('50000');

    // Section 04 · multi-product insurance — select all three so we can assert
    // both the life row (insurance_policies) and the health/funeral rows
    // (subscriber_insurance_products) persist via the 0065 chain.
    await page.getByRole('switch', { name: /life insurance/i }).click();
    await page.getByRole('switch', { name: /health insurance/i }).click();
    await page.getByRole('switch', { name: /funeral insurance/i }).click();

    const saveContinue = page.getByRole('button', { name: /save & continue/i });
    await expect(saveContinue).toBeEnabled();
    await saveContinue.click();

    // ── Stage 4 · OnboardingComplete (RPC auto-fires on mount) ─────────
    // The success screen fires the RPC immediately on mount; wait for the
    // network response. That's the authoritative success signal.
    const rpcResponse = await rpcPromise;
    expect(
      rpcResponse.status(),
      'create_subscriber_from_agent_onboard RPC must succeed',
    ).toBe(200);

    // Once the RPC resolves, status flips to 'success' and the "Saved" pill
    // renders alongside the "Onboard another / Close" actions.
    await expect(page.getByText(/^saved$/i)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: /is enrolled$/i }),
    ).toBeVisible();

    // ── DB verification ─────────────────────────────────────────────────
    expect(
      await rowExists('subscribers', { phone: uniquePhone }),
      `expected subscribers row for ${uniquePhone}`,
    ).toBe(true);

    const sub = await getRow<SubscriberRow>('subscribers', { phone: uniquePhone });
    expect(sub, 'subscriber row should be readable').not.toBeNull();
    expect(sub!.id, 'subscriber id should be minted by the RPC').toMatch(/^s-\d+$/);
    expect(sub!.district_id).toBe('d-kampala');
    // The RPC binds agent_id to the calling agent (cross-checked against the
    // JWT claim). For our storageState agent that's a-001.
    expect(sub!.agent_id).toBe(AGENT_ID);
    expect(sub!.kyc_status).toBe('complete');
    expect(sub!.name).toBeTruthy();

    // subscriber_balances is created atomically inside _insert_subscriber_chain
    // (via the AFTER INSERT trigger on the first transactions row); its
    // existence proves the full trigger chain fired.
    expect(
      await rowExists('subscriber_balances', { subscriber_id: sub!.id }),
      `subscriber_balances row should be created atomically for ${sub!.id}`,
    ).toBe(true);

    // Multi-product insurance: life lands in insurance_policies; health/funeral
    // in subscriber_insurance_products (0065 chain re-emit).
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

    // eslint-disable-next-line no-console
    console.log(
      `[db] agent ${AGENT_ID} onboarded ${sub!.id} (phone=${uniquePhone}, district=${sub!.district_id})`,
    );
  });
});
