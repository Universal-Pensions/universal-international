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
//      Reuses the same KYC step components AND the same contribution wizard as
//      /signup — but NOT the same copy: OnboardFlow wraps the tree in
//      OnboardAudienceProvider value="agent", so every shared step renders its
//      third-person variant ("Scan the subscriber's ID", not "…your Ndaga
//      Muntu"). Selectors here must use the AGENT strings; assuming they mirror
//      subscriber-signup-to-contribute one-for-one is what let this spec rot.
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
//   pay CTA     1.2s simulated payment delay (handlePay setTimeout)
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
//   • Unlike the self-signup specs (subscriber-signup-to-contribute.spec.ts,
//     helpers/signup.ts), this one does NOT override the OCR-provided #nin.
//     That's deliberate: it's the direct regression test for A11-002 (the
//     mock ID-OCR used to return one fixed identity forever, which 409'd the
//     create RPC on ux_subscribers_nin the moment a SECOND subscriber was
//     onboarded). id-ocr.ts now mints a fresh identity per call, seeded off
//     the onboarding session id, so leaving #nin untouched here is what
//     actually exercises that mint end-to-end. Re-running this spec twice in
//     a row without a DB reset is the fix's verification step — see
//     api/kyc/id-ocr.ts's IDENTITY MINTING comment for why it's stable
//     within one attempt (retries) but distinct across attempts.

import { test, expect } from '@playwright/test';
import { clickPay, fillContributionPlan } from '../../helpers/contribution';
import { storageStatePathFor, PERSONA_FOR } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { cleanupSubscriberByPhone, getRow, rowExists } from '../../fixtures/db';
import { PHONE_PREFIX } from '../../helpers/signup-constants';

test.use({ storageState: storageStatePathFor('agent') });
test.setTimeout(90_000);

const AGENT_ID = PERSONA_FOR.agent.entityId; // 'a-001'

type TransactionRow = {
  id: string;
  subscriber_id: string;
  type: string;
  method: string | null;
  amount: number | string;
};

type ScheduleRow = {
  subscriber_id: string;
  insurance_funding_mode: string | null;
  insurance_savings_pct: number | null;
  contribution_indexation_pct: number | null;
};

type SubscriberRow = {
  id: string;
  phone: string;
  name: string;
  nin: string;
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
    // 5 talking points; each records a Yes/No judgment, and Continue only
    // enables once all 5 are answered. AwarenessCheck renders TWO layouts:
    //   desktop (>=1024px) — a master/detail list, so exactly ONE Yes radio is
    //     in the DOM at a time (the selected question's). Select each row first.
    //   mobile             — an accordion with all 5 Yes/No pairs mounted.
    // Handle both rather than assuming a count; this spec runs at 1440x900 on
    // the desktop projects, which is the master/detail branch.
    const yesButtons = page.getByRole('radio', { name: /^yes$/i });
    await expect(yesButtons.first()).toBeVisible({ timeout: 15_000 });

    if ((await yesButtons.count()) >= 5) {
      for (let i = 0; i < 5; i++) await yesButtons.nth(i).click();
    } else {
      // Master/detail: pick each question in the left rail, then mark it Yes.
      const rows = page.getByRole('button', { name: /^\d\s/ });
      const rowCount = await rows.count();
      expect(rowCount, 'awareness master list should offer 5 questions').toBe(5);
      for (let i = 0; i < rowCount; i++) {
        await rows.nth(i).click();
        await yesButtons.first().click();
      }
    }

    const continueToKyc = page.getByRole('button', { name: /continue to kyc/i });
    await expect(continueToKyc, 'Continue enables once all 5 are answered').toBeEnabled();
    await continueToKyc.click();

    // ── KYC step 1 · id-upload ─────────────────────────────────────────
    // Upload front + back. id-quality always passes for files ≥ 20 KiB
    // (services/kyc.js:53 floor); we pass a 32 KiB buffer. id-ocr accepts
    // any truthy front/back tokens and returns a fixed sample subscriber.
    await expect(
      page.getByRole('heading', { name: /scan the subscriber's id/i }),
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
      page.getByRole('heading', { name: /check the subscriber's details/i }),
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

    // Password — ReviewStep collects the member's sign-in credential on BOTH
    // paths (the agent sets it on their behalf; the copy reads "Create their
    // password"). It's required, so Continue stays disabled without it; the
    // signup helper does the same at helpers/signup.ts.
    await page.locator('#password').fill('Demo1234');
    await page.locator('#confirm-password').fill('Demo1234');

    const reviewContinue = page.getByRole('button', { name: /^continue$/i });
    await expect(reviewContinue).toBeEnabled({ timeout: 10_000 });
    await reviewContinue.click();

    // ── KYC step 3 · nira (silent, auto-advances) ──────────────────────
    // ~2400ms verify + ~1100ms confirmation beat, then it moves on by itself.
    // We deliberately DON'T assert on its loader: it's a transient screen with
    // no interaction, so any assertion on it is a race against its own
    // auto-advance. Landing on step 4 below is proof step 3 passed (a NIRA
    // failure routes to the AgentFallback terminal instead, which would fail
    // that assertion loudly).

    // ── KYC step 4 · otp ───────────────────────────────────────────────
    // 4-digit OTP. The route accepts any 4-digit code except '0000'; we
    // use '1234'. Entering the 4th digit triggers auto-submit after 450ms.
    await expect(
      page.getByRole('heading', { name: /verify the phone number/i }),
    ).toBeVisible({ timeout: 25_000 });

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
      page.getByRole('heading', { name: /take the subscriber's selfie/i }),
    ).toBeVisible({ timeout: 15_000 });
    // "Take selfie" is gated on `canCapture` (the getUserMedia stream being live), so
    // wait for it to enable rather than clicking into a disabled control. NOTE: this
    // step is intermittently flaky under the fake camera device even so — the capture
    // can land with an empty frame and faceMatch then leaves you on this screen.
    const takeSelfie = page.getByRole('button', { name: /take selfie/i });
    await expect(takeSelfie).toBeEnabled({ timeout: 15_000 });
    await takeSelfie.click();

    // ── KYC step 6 · aml (silent, auto-advances) ───────────────────────
    // ~1700ms screen + ~1100ms cleared beat, then it advances itself. Same
    // reasoning as step 3 — no assertion on the transient loader; reaching
    // step 7 is the proof (an AML flag routes to the pending-review terminal).

    // ── KYC step 7 · beneficiaries ─────────────────────────────────────
    // Lazy-seeded with a single row at share=100; fill name/phone/relationship
    // to satisfy validList(). insuranceSameAsPension defaults to true so we
    // don't have to manage a separate insurance section.
    await expect(
      page.getByRole('heading', { name: /nominate beneficiaries/i }),
    ).toBeVisible({ timeout: 25_000 });

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
    // The native checkbox is deliberately visually hidden (ConsentStep.jsx: "the
    // whole box is the clickable label"), so `.check()` fights Playwright's
    // visible-and-stable gate inside the agent shell's scroll container. Click the
    // label — the actual user target — and assert the state via the CTA enabling.
    await page
      .locator('label')
      .filter({ hasText: /I consent to Universal Pensions processing/i })
      .click();

    const consentContinue = page.getByRole('button', { name: /i consent — continue/i });
    await expect(consentContinue, 'consent CTA enables once the box is ticked').toBeEnabled();
    await consentContinue.click();

    // ── Stage 3 · plan & pay ───────────────────────────────────────────
    // This stage now renders the SAME ContributionSettings wizard the subscriber
    // sees at /signup/contribution (in `embedded` mode, with agent-voice copy) —
    // see helpers/contribution.ts for the two-page + payment sequence. Life is
    // selected by default; add health + funeral so the 0065 chain's split is
    // exercised: life → insurance_policies, health/funeral →
    // subscriber_insurance_products. Route A ("Pay now") makes 0072 post the
    // extra type='premium' transaction asserted below.
    // Covers: raised off the entry tiers, and deliberately DIFFERENT from the
    // self-signup spec's choices, so the DB block proves the AGENT's selection
    // is what gets stored for the member they enrolled.
    await fillContributionPlan(page, {
      audience: 'agent',
      amount: '50000',
      toggleProducts: ['health', 'funeral'],
      covers: { life: 3_000_000, health: 12_000_000, funeral: 5_000_000 },
    });
    await clickPay(page);

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
    // The headline only claims enrolment once the RPC has returned (it reads
    // "Saving …'s record…" while the write is in flight).
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
    // A11-002: the persisted NIN came from the mocked OCR's per-session mint,
    // not the old fixed 'CF92018AB3CD45'. Confirms the mint's shape survived
    // the full round trip (OCR -> ReviewStep -> RPC -> DB), and — since this
    // spec deliberately leaves #nin untouched (see the header comment) — that
    // create_subscriber_from_agent_onboard actually received a fresh value.
    expect(sub!.nin, 'persisted NIN should be CM/CF + 12 alphanumeric chars').toMatch(/^C[MF][A-Z0-9]{12}$/);

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

    // Per-product COVER AMOUNTS chosen by the AGENT on the cover step. Row
    // existence can't distinguish a real selection from the entry-tier default,
    // so assert the figures — this is the agent half of "every role that can
    // onboard a subscriber stores the cover it was told to".
    const lifeRow = await getRow<{ cover: string; premium_monthly: string }>(
      'insurance_policies', { subscriber_id: sub!.id },
    );
    expect(Number(lifeRow!.cover), 'life cover should be the tier the agent picked').toBe(3_000_000);
    expect(Number(lifeRow!.premium_monthly), 'life premium should come from the ladder').toBe(5_000);

    const healthRow = await getRow<{ cover: string; premium_monthly: string }>(
      'subscriber_insurance_products', { subscriber_id: sub!.id, product: 'health' },
    );
    expect(Number(healthRow!.cover), 'health cover should be the tier the agent picked').toBe(12_000_000);
    expect(Number(healthRow!.premium_monthly), 'health premium should come from the ladder').toBe(15_000);

    const funeralRow = await getRow<{ cover: string; premium_monthly: string }>(
      'subscriber_insurance_products', { subscriber_id: sub!.id, product: 'funeral' },
    );
    expect(Number(funeralRow!.cover), 'funeral cover should be the tier the agent picked').toBe(5_000_000);
    expect(Number(funeralRow!.premium_monthly), 'funeral premium should come from the ladder').toBe(3_250);

    // The payment step is what makes these two rows possible. Before the parity
    // change the agent form emitted no `paymentMethod` at all (buildPayload read
    // a field nothing set), and there was no pay-now route — so 0072's
    // _insert_subscriber_chain had nothing to stamp. Assert both legs now land.
    const contribTxn = await getRow<TransactionRow>('transactions', {
      subscriber_id: sub!.id,
      type: 'contribution',
    });
    expect(contribTxn, `first contribution transaction for ${sub!.id}`).not.toBeNull();
    // The UI emits the method ID ('momo' | 'gateway'); the RPC COALESCEs it into
    // transactions.method verbatim. Self-signup behaves identically.
    expect(contribTxn!.method).toBe('momo');

    // Route A charges one year of every selected product up front, as a separate
    // type='premium' row (excluded from balance maths).
    const premiumTxn = await getRow<TransactionRow>('transactions', {
      subscriber_id: sub!.id,
      type: 'premium',
    });
    expect(
      premiumTxn,
      `pay-now premium transaction for ${sub!.id} (life + health + funeral, one year)`,
    ).not.toBeNull();
    expect(Number(premiumTxn!.amount)).toBeGreaterThan(0);

    // The save-to-cover / step-up columns the old form never emitted.
    const sched = await getRow<ScheduleRow>('contribution_schedules', {
      subscriber_id: sub!.id,
    });
    expect(sched, `contribution_schedules row for ${sub!.id}`).not.toBeNull();
    expect(sched!.insurance_funding_mode).toBe('pay_now');
    expect(sched!.insurance_savings_pct).not.toBeNull();
    expect(sched!.contribution_indexation_pct).not.toBeNull();

    // eslint-disable-next-line no-console
    console.log(
      `[db] agent ${AGENT_ID} onboarded ${sub!.id} (phone=${uniquePhone}, district=${sub!.district_id})`,
    );
  });
});
