// Subscriber dashboard smoke spec — one test per route, asserting only that
// the page navigates without crashing, the ErrorBoundary fallback is not on
// screen, and a single role-specific identity element renders. Deeper
// behavioural assertions (form submits, balance maths, schedule writes) are
// out of scope for SMOKE and live in Phase 2 flow specs.
//
// All routes piggy-back on the pre-minted subscriber storageState produced by
// global-setup, so each test loads at /dashboard/* already authenticated. Most
// pages render a <PageHeader> whose <h1> title is the cheapest, hashed-class-
// free identity anchor; HomePage is the exception and is identified via its
// "Total balance" copy from PulseCard.

import { test, expect } from '@playwright/test';
import { disableAnimations } from '../../fixtures/motion';
import { storageStatePathFor } from '../../fixtures/auth';
import { selectors } from '../../helpers/selectors';

test.use({ storageState: storageStatePathFor('subscriber') });

test.describe('subscriber dashboard smoke', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
  });

  test('Home loads (/dashboard)', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard\/?$/);
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // PulseCard renders the "Total balance" label even before the balance
    // count-up has finished animating — stable identity anchor for HomePage.
    await expect(page.getByText(/total balance/i).first()).toBeVisible();
  });

  test('Save loads (/dashboard/save)', async ({ page }) => {
    await page.goto('/dashboard/save');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // Redesign: SavePage's hero <h1> is "Save" (eyebrow "TOP UP AMOUNT");
    // "Top up" now lives only on the footer CTA, not the heading. Anchor on
    // the stable hero title — verified in SavePage.jsx (title="Save").
    await expect(page.getByRole('heading', { level: 1, name: /^save$/i })).toBeVisible();
  });

  test('Schedule loads (/dashboard/save/schedule)', async ({ page }) => {
    await page.goto('/dashboard/save/schedule');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // SchedulePage's own h1 flips between "Set a schedule" (new) and "Tune
    // your schedule" (existing) on DESKTOP. On mobile the page's own header
    // doesn't render at all — SubscriberMobileAppBar supplies the <h1>
    // instead, titled "Contribution settings"
    // (SubscriberMobileAppBar.jsx FLOW map) — a real, different, but equally
    // valid identity anchor, not a broken page (audit A10-003: the baseline's
    // mobile failures here are test-selector brittleness, not product
    // defects — every route renders cleanly at 375px). Match all three so the
    // test survives both demo-data resets and the desktop/mobile shell split.
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: /(set a schedule|tune your schedule|contribution settings)/i,
      }),
    ).toBeVisible();
  });

  test('Withdrawals hub loads (/dashboard/withdraw)', async ({ page }) => {
    await page.goto('/dashboard/withdraw');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // Desktop's own header (WithdrawalsHubPage.jsx) reads "Withdrawals"; the
    // mobile app-bar's shorter tab title is just "Withdraw"
    // (SubscriberMobileAppBar.jsx TAB map) — same page, real content, not a
    // bug (audit A10-003). Match the shared stem so both shells pass.
    await expect(page.getByRole('heading', { level: 1, name: /withdraw/i })).toBeVisible();
  });

  test('Withdraw savings loads (/dashboard/withdraw/savings)', async ({ page }) => {
    await page.goto('/dashboard/withdraw/savings');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // The page <h1> is "Withdraw savings" (WithdrawPage.jsx); /^withdraw$/ was an
    // exact match against the older, shorter title.
    await expect(
      page.getByRole('heading', { level: 1, name: /^withdraw savings$/i }),
    ).toBeVisible();
  });

  test('Claim loads (/dashboard/withdraw/claim)', async ({ page }) => {
    await page.goto('/dashboard/withdraw/claim');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /file a claim/i })).toBeVisible();
  });

  test('Claim redirect resolves (/dashboard/claim -> /dashboard/withdraw/claim)', async ({ page }) => {
    await page.goto('/dashboard/claim');
    await expect(page).toHaveURL(/\/dashboard\/withdraw\/claim$/);
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /file a claim/i })).toBeVisible();
  });

  test('Activity loads (/dashboard/activity)', async ({ page }) => {
    // Redesign: /dashboard/activity no longer redirects to
    // /dashboard/reports/all-transactions — it now renders ActivityPage
    // (SubscriberDashboardShell.jsx routes "activity" → <ActivityPage />).
    // Anchor on ActivityPage's identity surface: the hero <h1> "Activity",
    // the "THIS YEAR" eyebrow, and the All/Incoming/Outgoing sign filters
    // (PillChip labels) — all verified in ActivityPage.jsx.
    await page.goto('/dashboard/activity');
    await expect(page).toHaveURL(/\/dashboard\/activity$/);
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /^activity$/i })).toBeVisible();
    await expect(page.getByText(/this year/i).first()).toBeVisible();
    await expect(page.getByText(/^incoming$/i).first()).toBeVisible();
    await expect(page.getByText(/^outgoing$/i).first()).toBeVisible();
  });

  test('Reports loads (/dashboard/reports)', async ({ page }) => {
    await page.goto('/dashboard/reports');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // The /dashboard/reports hub is titled "Analytics" now (the downloadable
    // reports are one section within it); the route kept its old name.
    await expect(
      page.getByRole('heading', { level: 1, name: /^analytics$/i }),
    ).toBeVisible();
  });

  test('All Transactions report loads (/dashboard/reports/all-transactions)', async ({ page }) => {
    await page.goto('/dashboard/reports/all-transactions');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // ReportsPage's own <h1> is desktop-only — ReportsHeader renders nothing
    // below 1024px (ReportsPage.jsx: `if (!isDesktop) return null`). The
    // mobile app-bar's <h1> is the fixed, shared "Analytics" for every
    // /dashboard/reports/* route regardless of which report is open (audit
    // A10-003/A10-004 — not a bug; on mobile the specific report name is only
    // an eyebrow, and all 5 report views share that one app-bar title).
    // Anchor on AllTransactions.jsx's own body eyebrow instead of a heading —
    // it renders in both the loading and loaded states, on both shells, and
    // is unique to this report.
    await expect(page.getByText(/every movement in your account/i)).toBeVisible();
  });

  test('Contributions Summary report loads (/dashboard/reports/contributions-summary)', async ({ page }) => {
    // ReportsPage's REPORT_VIEWS map keys the route segment as
    // "contributions-summary", not "contributions" — verified in
    // src/subscriber-dashboard/pages/ReportsPage.jsx.
    await page.goto('/dashboard/reports/contributions-summary');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // Same title-agnostic anchor strategy as the All Transactions test above
    // (audit A10-003/A10-004): the mobile app-bar's <h1> is the shared
    // "Analytics" for every report route, so anchor on
    // ContributionsSummary.jsx's own body eyebrow, which is unique to this
    // report and renders on both shells.
    await expect(page.getByText(/month-by-month view/i)).toBeVisible();
  });

  test('Help loads (/dashboard/help)', async ({ page }) => {
    await page.goto('/dashboard/help');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // Desktop HelpPage's own header reads "How can we help?"; the mobile
    // app-bar's shorter title is just "Help" (SubscriberMobileAppBar.jsx
    // SECONDARY map) — same page, real content, not a bug (audit A10-003).
    await expect(
      page.getByRole('heading', { level: 1, name: /(how can we help|^help$)/i }),
    ).toBeVisible();
  });

  test('Agent loads (/dashboard/agent)', async ({ page }) => {
    await page.goto('/dashboard/agent');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);

    // The <h1> IS the settle signal — it just needs a realistic budget.
    //
    // While the agent query is in flight AgentPage renders a bare spinner and
    // NO <h1> at all (`loadingAgent ? <spinner> : …`), so this assertion is a
    // race against that query. Warm it resolves in ~1s; under full-suite load
    // against the live demo DB it occasionally exceeds the 15s default, which
    // made this the single most frequent flake in the suite.
    //
    // Do NOT try to "settle" on the text "Your agent" — the left nav rail has a
    // menu item with exactly that label, so such a wait matches instantly and
    // silently does nothing. (Measured: h1s=[] with the spinner still up while
    // that text was already visible.) The heading is the only honest signal.
    //
    // The raised timeout does not weaken the check: a genuinely broken page
    // never renders an h1 and still fails, and the ErrorCard branch is asserted
    // separately below.
    await expect(
      page.getByRole('heading', { level: 1 }).first(),
      'AgentPage should settle out of its loading spinner and render a heading',
    ).toBeVisible({ timeout: 45_000 });

    // A slow load must not be confused with a failed one: the error branch
    // ("We couldn't load your agent") renders no h1 either, so assert it is
    // absent rather than letting a real query failure look like a timeout.
    await expect(page.getByText(/couldn't load your agent/i)).toHaveCount(0);
  });

  test('Profile tab loads (/dashboard/settings)', async ({ page }) => {
    // Redesign: the /dashboard/settings tab is now the account/Profile hub —
    // SettingsPage.jsx renders a hero <h1> "Profile" (NOT "Settings") plus a
    // "Sign out" action. The old /^settings$/ heading no longer exists; the
    // shared Settings panel opens from a row inside this page instead.
    await page.goto('/dashboard/settings');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: /^profile$/i })).toBeVisible();
    // Distinguishes the account hub from the ProfilePage edit form below.
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('Profile edit form loads (/dashboard/settings/profile)', async ({ page }) => {
    await page.goto('/dashboard/settings/profile');
    await expect(selectors.errorBoundary.fallback(page)).toHaveCount(0);
    // Desktop's own header reads exactly "Profile"; the mobile app-bar's
    // title for this deep route is "Edit profile" (SubscriberMobileAppBar.jsx
    // SECONDARY map) — same page, real content, not a bug (audit A10-003).
    await expect(
      page.getByRole('heading', { level: 1, name: /^(profile|edit profile)$/i }),
    ).toBeVisible();
    // ProfilePage is the editable form. The "Full name" textbox is its
    // distinguishing surface vs the account hub above (the footer CTA reads
    // "No changes to save" until the form is dirty, so it is not a stable
    // anchor — verified in ProfilePage.jsx:205).
    await expect(page.getByRole('textbox', { name: /full name/i })).toBeVisible();
  });
});
