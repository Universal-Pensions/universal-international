// Flow spec: Settings → Set password → Change password (Phase 6 of the
// password-auth feature). Exercises the conditional title flip (`hasPassword
// ? 'Change password' : 'Set password'` — Settings.jsx:421) and the full
// "set → sign out → sign back in with password" loop.
//
// DIVERGENCE FROM TASK SPEC (Phase 6 author note → Phase 7 regression):
//
//   The task says "Sign in as a seeded subscriber via OTP" and then navigate
//   to /dashboard/settings. That path is BROKEN today: the subscriber
//   dashboard (`SubscriberDashboardShell`) routes `/dashboard/settings` to its
//   own page (`subscriber-dashboard/pages/SettingsPage.jsx`) which does NOT
//   include the password card. The password card lives in the slide-in panel
//   `src/dashboard/settings/Settings.jsx`, which is only mounted by
//   `DashboardShell` (distributor) and `BranchDashboardShell` (branch). For
//   subscribers there is no route or sidebar trigger that opens that panel,
//   so the card is unreachable for them today.
//
//   Adaptation: run the spec for the DISTRIBUTOR role. This still exercises
//   the same `Settings.jsx` component, the same `changePassword()` service
//   call, the same `updateUser({ hasPassword: true })` flip, and the same
//   sign-in-with-password loop. The only thing missed vs. the task spec is
//   surfacing the regression that subscribers can't reach the card. That is
//   captured in the Phase 6 hand-off report; Phase 7 owns the fix decision.
//
// What this spec does (distributor):
//   1. Start signed-in via the pre-minted distributor JWT (storageState).
//   2. Clear any pre-existing password_hash on the seeded `users` row so the
//      card mounts in the "Set password" variant (initial-set path).
//   3. Open the Settings panel via the sidebar Settings button.
//   4. Assert the card title is "Set password".
//   5. Fill new + confirm password → click Save.
//   6. Wait for the change-password POST → assert success toast.
//   7. Assert the card title flips to "Change password" (hasPassword=true).
//   8. Sign out via the sidebar Log out button.
//   9. Sign in via SignInModal with the password → assert /dashboard renders.
//
// Cleanup: always blank out users.password_hash for the seeded phone in
// afterEach so reruns / future specs start from the "no password yet" state.
// We also defensively delete the row in beforeEach (NULLing is safer because
// it preserves whatever id/last_login the row already carried, but the row
// itself may not exist on a cold seed — see verify-otp upsert semantics).

import { test, expect } from '@playwright/test';
import { storageStatePathFor, PERSONA_FOR } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { supabaseAdmin } from '../../fixtures/db';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('distributor') });

const DISTRIBUTOR_PHONE = PERSONA_FOR.distributor.phone; // +256700000021
const DISTRIBUTOR_ROLE = 'distributor';

test.describe('settings → set / change password (distributor — see header note)', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);

    // The JWT-mint auth fixture (e2e/fixtures/auth.ts) writes
    // localStorage/upensions_token directly and skips verify-otp entirely —
    // so the `users(phone, role)` row that verify-otp would normally upsert
    // does NOT exist for storage-state-only tests. The change-password route
    // 404s ("user_not_found") if the row is missing. Upsert a clean row here
    // with password_hash=NULL so the test starts in the "Set password" path.
    await supabaseAdmin
      .from('users')
      .upsert(
        {
          id: `${DISTRIBUTOR_ROLE}:${DISTRIBUTOR_PHONE}`,
          phone: DISTRIBUTOR_PHONE,
          role: DISTRIBUTOR_ROLE,
          password_hash: null,
          last_login_at: new Date().toISOString(),
        },
        { onConflict: 'phone,role' },
      );
  });

  test.afterEach(async () => {
    // Always restore to the "no password" state so reruns and any future
    // distributor specs aren't accidentally gated by leftover hashes.
    await supabaseAdmin
      .from('users')
      .update({ password_hash: null })
      .eq('phone', DISTRIBUTOR_PHONE)
      .eq('role', DISTRIBUTOR_ROLE);
  });

  test('set password → flip title → sign out → sign in with password', async ({ page }) => {
    // ── 1. Land on the distributor dashboard ───────────────────────────────
    // JWT in localStorage skips the SignInModal entirely. AuthContext does
    // NOT carry `hasPassword: true` because the storageState was minted
    // without that claim — which is what we want for the "Set password"
    // variant on first render. The card reads `user.hasPassword === true`,
    // so a missing/undefined claim resolves to the initial-set path.
    await page.goto('/dashboard');
    await expect(selectors.dashboardShell.overviewTab(page)).toBeVisible();

    // ── 2. Open the Settings panel via the sidebar ─────────────────────────
    // Sidebar.jsx bottom items expose Settings + Log out as aria-labelled
    // buttons. The Settings button id-tagged 'settings' calls
    // setSettingsOpen(true) on click.
    await selectors.dashboardShell.settingsTab(page).click();

    // The panel mounts as role=dialog (slide-in) or role=region (routed full
    // page) — both aria-label="Settings". Assert the "Set password" heading
    // inside it. The heading is rendered as <h3>.
    const panel = selectors.panel.settings(page);
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole('heading', { name: /^set password$/i }),
    ).toBeVisible();

    // ── 3. Fill new + confirm password → Save ──────────────────────────────
    // The inputs are labelled "New password" / "Confirm new password" (no
    // "Current password" field in the initial-set variant). The Save button
    // is the only one in the password card.
    // getByLabel without exact:true is a substring match — "New password"
    // would also match "Confirm new password". Use exact:true.
    await panel.getByLabel('New password', { exact: true }).fill('Demo1234');
    await panel.getByLabel('Confirm new password', { exact: true }).fill('Demo1234');

    const changePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/auth/change-password') &&
        r.request().method() === 'POST',
      { timeout: 15_000 },
    );

    await panel.getByRole('button', { name: /^save$/i }).click();

    const changeResponse = await changePromise;
    expect(changeResponse.status(), '/api/auth/change-password must succeed').toBe(200);

    // ── 4. Success toast + title flip ──────────────────────────────────────
    // ToastContext renders the success copy. Settings.jsx:207 picks the
    // string 'Password set.' for the initial-set path.
    await expect(page.getByText('Password set.')).toBeVisible({ timeout: 10_000 });

    // updateUser({ hasPassword: true }) → React rerenders the panel → the
    // card title flips to "Change password" and a "Current password" field
    // becomes visible.
    await expect(
      panel.getByRole('heading', { name: /^change password$/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByLabel('Current password')).toBeVisible();

    // ── 5. Sign out via the sidebar ────────────────────────────────────────
    // In SLIDE-IN mode a backdrop covers the rail, so the panel has to be closed
    // before Log out is clickable. In dash mode the panel IS the page, rendered
    // inline beside a always-visible rail — and Escape is deliberately inert there
    // (`if (e.key === 'Escape' && !fullPage)` in Settings.jsx), so asserting it
    // closes would hang. Try Escape, then only require it to have closed if it
    // actually can.
    await page.keyboard.press('Escape');
    if (await panel.isVisible({ timeout: 1_000 }).catch(() => false)) {
      // Full-page mode: nothing to close; the rail is already reachable.
      await expect(selectors.dashboardShell.overviewTab(page)).toBeVisible();
    }

    // The sidebar Log out button is in the bottom row (Sidebar.jsx:137).
    await page.getByRole('button', { name: /^log out$/i }).click();

    // logout() → navigate('/') in handleClick.
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // ── 6. Sign back in with the password we just set ──────────────────────
    // logout() drops us on '/', which is the SUBSCRIBER landing — and each landing
    // now carries its own audience-scoped login card (no single universal
    // SignInModal any more). Signing a distributor in through the subscriber card
    // fails, so go to the distributor landing first.
    await page.goto('/distributors');
    await page.getByRole('button', { name: /^sign in$/i }).first().click();
    await expect(selectors.signInModal.surface(page).first()).toBeVisible();

    // The distributor landing card offers Distributor / Branch / Agent as role
    // TABS (LandingLoginCard), and the old SignInModal DistributorSelect sub-step
    // ("Distributor Admin") no longer exists on that path — so both are optional.
    await selectors.signInModal.pickRole(page, /^distributor$/i);
    await selectors.signInModal.pickRole(page, /distributor admin/i);

    // Phone (9 digits, no +256). Distributor demo phone is +256700000021.
    await page.locator('input[name="phone"]').fill('700000021');
    await page.getByRole('radio', { name: /^password$/i }).click();
    await selectors.signInModal.continueButton(page).click();

    // PasswordEntry mounts → fill the same value we set above.
    // (RoleSelect's "Welcome back" h2 lingers briefly during the exit
    // transition; anchor on the Password input which is PasswordEntry-only.)
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill('Demo1234');
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();

    // Dashboard lands. The URL is the authoritative signal: the inline landing
    // login card is ALWAYS mounted on a landing page, so "surface count 0" only
    // becomes true as a side effect of navigating away — a weaker and slower
    // assertion than just waiting for /dashboard.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
    await expect(selectors.dashboardShell.overviewTab(page)).toBeVisible();
  });
});
