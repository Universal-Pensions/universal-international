// Flow spec: subscriber password sign-in (Phase 6 of the password-auth
// feature). Two cases:
//
//   A) Fresh signup (which sets a bcrypt password_hash via verify-otp) →
//      sign out → reopen the SignInModal → toggle the Password chip → enter
//      the same password → land on the dashboard.
//
//   B) Seeded subscriber phone with no password_hash on file → password
//      submit → backend returns `password_not_set` → SignInModal flips
//      `showSwitchToCodeCta` → PasswordEntry renders the prominent
//      `role="status"` switch panel ("This account uses one-time codes
//      only.") with a "Use a code instead" CTA → clicking it advances to
//      the OTP step with the phone preserved.
//
// What this demonstrates:
//   • Re-use of the shared signup walkthrough helper (`e2e/helpers/signup.ts`)
//     so the password-sign-in spec doesn't drift from the canonical signup
//     flow as it evolves.
//   • End-to-end exercise of the new auth surface:
//       - verify-otp w/ password (sets users.password_hash during signup)
//       - signInWithPassword → /api/auth/verify-password (success path)
//       - signInWithPassword → /api/auth/verify-password (password_not_set
//         path; the seeded subscriber `+256711000001` has no users row yet,
//         so verify-password 401s with the fallback CTA)
//   • The "switch to OTP" CTA preserves phone state across the password →
//     OTP step transition.
//
// Cleanup: case (A) creates a fresh subscriber row; we tear it down via the
// `cleanupSubscriberByPhone` helper + a manual `users` row delete. Case (B)
// never mutates DB state — the password attempt rejects without writes.
//
// KNOWN DIVERGENCE (Phase 6 author note → Phase 7 regression):
//   The subscriber dashboard does NOT mount the Settings.jsx slide-in panel
//   (where the password card lives). That divergence is not exercised here;
//   it's covered (and adapted around) in settings-change-password.spec.ts.
//   This spec only depends on the SignInModal, which works for all 4 roles.

import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { cleanupSubscriberByPhone, supabaseAdmin } from '../../fixtures/db';
import { walkSignupToFirstContribution } from '../../helpers/signup';
import { selectors } from '../../helpers/selectors';
import { PHONE_PREFIX } from '../../helpers/signup-constants';

test.setTimeout(120_000);

test.describe('subscriber → sign in with password', () => {
  let uniquePhoneDigits = '';
  let uniquePhone = '';

  test.beforeEach(async ({ page }, testInfo) => {
    await disableAnimations(page);

    // Per-test unique phone: a VALID carrier prefix + 6 trailing Date.now()
    // digits + 1-digit workerIndex (9 digits total), so two specs on different
    // workers can't collide on the partial unique index over
    // `subscribers.phone WHERE NOT is_demo_signup`.
    //
    // The prefix MUST come from PHONE_PREFIX. The old generator was
    // `7 + Date.now().slice(-7)`, which left the SECOND digit up to the clock —
    // so it minted 73x/79x numbers that `isValidUGPhone` rejects (valid prefixes
    // are 70/71/74/75/76/77/78, utils/phone.js). That made this test pass or fail
    // purely on what time it ran at.
    const workerSuffix = String(testInfo.workerIndex % 10);
    uniquePhoneDigits = `${PHONE_PREFIX}${String(Date.now()).slice(-6)}${workerSuffix}`;
    uniquePhone = `+256${uniquePhoneDigits}`;

    // Defensive: tear down any leftover state from a previous crashed run.
    await cleanupSubscriberByPhone(uniquePhone);
    const { error: preDelErr } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('phone', uniquePhone)
      .eq('role', 'subscriber');
    expect(preDelErr, `pre-cleanup: deleting stale users row for ${uniquePhone}`).toBeNull();
  });

  test.afterEach(async () => {
    await cleanupSubscriberByPhone(uniquePhone);
    const { error: delErr } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('phone', uniquePhone)
      .eq('role', 'subscriber');
    expect(delErr, `cleanup: deleting users row for ${uniquePhone}`).toBeNull();
  });

  test('A) signs in with password after fresh signup', async ({ page }) => {
    // 1. Walk the full signup flow. The helper stops once the
    //    create_subscriber_from_signup RPC has returned 200 — i.e. auth is
    //    persisted, the user is signed in, and the dashboard about to render.
    await walkSignupToFirstContribution(page, {
      phoneDigits: uniquePhoneDigits,
      password: 'Demo1234',
    });

    // The dashboard renders post-RPC. PulseCard's "Total balance" label is
    // the same anchor the subscriber smoke spec uses for "HomePage mounted".
    await expect(page.getByText(/total balance/i).first()).toBeVisible({ timeout: 20_000 });

    // 2. Sign out via the dashboard. The subscriber Settings page has a
    //    "Sign out" button (src/subscriber-dashboard/pages/SettingsPage.jsx:194).
    //    Navigate there and click it; the logout handler navigates back to '/'.
    await page.goto('/dashboard/settings');
    // The page's <h1> is "Profile" (SettingsDesktop.jsx) — the route is
    // /dashboard/settings but the heading was renamed. Match either so this holds
    // whichever way the copy lands.
    await expect(
      page.getByRole('heading', { level: 1, name: /^(profile|settings)$/i }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /sign out/i }).click();

    // Logout drops us back at the landing page.
    await expect(page).toHaveURL(/\/$/);

    // 3. Open the SignInModal. The landing CTA opens it; the bottom-of-page
    //    sticky "Get started" / nav "Sign in" both trigger SignInContext.open.
    //    Match the first visible Sign in trigger.
    await page.getByRole('button', { name: /^sign in$/i }).first().click();

    // 4. Role select → Subscriber.
    await expect(selectors.signInModal.surface(page).first()).toBeVisible();
    // Optional: the subscriber landing card is single-audience so it renders no
    // role picker at all; only a multi-role card (or the legacy SignInModal
    // RoleSelect) does. See selectors.signInModal.pickRole.
    await selectors.signInModal.pickRole(page, /^subscriber\b/i);

    // 5. PhoneEntry — enter the 9-digit local form (the +256 prefix is a
    //    sibling badge); toggle the Password chip; submit. The Password chip
    //    is rendered as a role=radio button labelled "Password".
    await page.locator('input[name="phone"]').fill(uniquePhoneDigits);
    await page.getByRole('radio', { name: /^password$/i }).click();
    await selectors.signInModal.continueButton(page).click();

    // 6. PasswordEntry — fill the same password we set during signup.
    //    The input is labelled "Password" (aria-label on the <input>).
    // PasswordEntry's input is aria-label="Password" — unique to this step.
    // (Anchoring on the "Welcome back" h2 is unstable because RoleSelect uses
    // the same heading text; with animations disabled, the exit transition
    // leaves the RoleSelect h2 briefly in the DOM and getByRole returns 2.)
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('Demo1234');
    // Multiple "Sign in" buttons exist on screen: the navbar (outside the
    // modal), the role=tab "Sign in" inside the subscriber modal header, and
    // the PasswordEntry form submit. Scope to the form's submit button —
    // role=button + the input above it puts us unambiguously inside
    // PasswordEntry's form.
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();

    // 7. Dashboard renders post-login. Wait for the modal to close + the
    //    home route to mount the same PulseCard anchor.
    await expect(selectors.signInModal.surface(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/total balance/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('B) seeded subscriber password attempt falls back to OTP CTA', async ({ page }) => {
    // The seeded subscriber `+256711000001` (Brian Okello, s-0001 per
    // api/auth/verify-otp.ts ROLE_DEFAULTS) exists in `subscribers` but has
    // no `users` row with a non-null `password_hash` — so verify-password
    // returns `password_not_set`, which SignInModal maps to the prominent
    // switch-CTA panel inside PasswordEntry.
    const seededPhone = '+256711000001';
    const seededLocalDigits = '711000001';

    // Belt-and-braces: any previous run that managed to stamp a hash on the
    // seeded users row would invalidate this test's premise. Clear it so the
    // password_not_set branch is reliable. (Idempotent — no-op if none exists.)
    await supabaseAdmin
      .from('users')
      .update({ password_hash: null })
      .eq('phone', seededPhone)
      .eq('role', 'subscriber');

    await page.goto('/');

    // Open the modal → Subscriber → enter the seeded phone → toggle Password.
    await page.getByRole('button', { name: /^sign in$/i }).first().click();
    await expect(selectors.signInModal.surface(page).first()).toBeVisible();
    // Optional: the subscriber landing card is single-audience so it renders no
    // role picker at all; only a multi-role card (or the legacy SignInModal
    // RoleSelect) does. See selectors.signInModal.pickRole.
    await selectors.signInModal.pickRole(page, /^subscriber\b/i);

    await page.locator('input[name="phone"]').fill(seededLocalDigits);
    await page.getByRole('radio', { name: /^password$/i }).click();
    await selectors.signInModal.continueButton(page).click();

    // PasswordEntry mounts.
    // PasswordEntry's input is aria-label="Password" — unique to this step.
    // (Anchoring on the "Welcome back" h2 is unstable because RoleSelect uses
    // the same heading text; with animations disabled, the exit transition
    // leaves the RoleSelect h2 briefly in the DOM and getByRole returns 2.)
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('Wrongguess1');
    // Scope to the password form's submit button — see comment on the test A
    // click for context (multiple "Sign in" buttons on screen).
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();

    // verify-password returns 401 + `password_not_set` → SignInModal flips
    // `showSwitchToCodeCta` → PasswordEntry renders the prominent
    // `role="status"` switch panel ("This account uses one-time codes only.")
    // with a "Use a code instead" CTA. The tertiary "Use a one-time code
    // instead" link below the submit is hidden when `showSwitchToCodeCta`
    // is on (see PasswordEntry.jsx:139), so we drive the prominent CTA.
    const switchPanel = page.getByRole('status').filter({
      hasText: /one-time codes only/i,
    });
    await expect(switchPanel).toBeVisible({ timeout: 10_000 });
    const switchCta = switchPanel.getByRole('button', { name: /^use a code instead$/i });
    await expect(switchCta).toBeVisible();
    await switchCta.click();

    // OtpVerify renders. Its heading is "Verification code" (OtpVerify.jsx:141).
    await expect(page.getByRole('heading', { name: /verification code/i })).toBeVisible({ timeout: 10_000 });

    // Phone preservation: OtpVerify renders `formatUGPhone(phone)` in its
    // subtext (utils/phone.js:38 → '+256 711 000 001'). Both PasswordEntry
    // (briefly during the exit transition) and OtpVerify show the phone, so
    // we filter the paragraph by the OtpVerify-specific prefix
    // ("Enter the 6-digit code sent to ...") before asserting.
    await expect(
      page.getByText(/enter the 6-digit code sent to/i),
    ).toBeVisible();
    await expect(
      page
        .getByRole('paragraph')
        .filter({ hasText: /enter the 6-digit code/i }),
    ).toContainText('+256 711 000 001');
  });
});
