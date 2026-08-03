// Regression spec: employer pending-KYC is a ROUTED page on both form factors
// and can nudge invitees over Email / SMS / WhatsApp.
//
// Why this exists: pending-KYC used to be a desktop slide-over
// (kyc/PendingKyc.jsx, opened via EmployerPanelContext.kycOpen) with a separate
// phone body — two copies that had already drifted, and `/dashboard/pending-kyc`
// explicitly redirected desktop away to /dashboard/employees. The panel was
// retired: the route now renders on BOTH form factors and both bodies run off
// kyc/usePendingKycNudge. Two things could silently regress:
//   1. the desktop redirect coming back (the page vanishes on desktop), and
//   2. the channel picker disappearing, leaving a "reminder" with no way to
//      choose how it is sent.
// Neither is caught by the unit/component tests, so both are pinned here.
//
// Self-contained: creates its own pending invite via the service-role client and
// removes it afterwards, so it neither depends on nor disturbs whatever demo
// invites happen to exist.

import { test, expect } from '@playwright/test';
import { storageStatePathFor } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { getAdminClient } from '../../fixtures/db';

test.use({ storageState: storageStatePathFor('employer') });

const EMPLOYER_ID = 'emp-001';
// Namespaced so it can never collide with a real demo invite.
const TOKEN = 'inv-e2e-kyc-nudge-regression';
const INVITEE = 'E2E Nudge Target';

test.describe('employer pending KYC — routed page + nudge channels', () => {
  test.beforeAll(async () => {
    const db = getAdminClient();
    await db.from('employer_invites').delete().eq('token', TOKEN);
    const { error } = await db.from('employer_invites').insert({
      token: TOKEN,
      employer_id: EMPLOYER_ID,
      prefill: { fullName: INVITEE, phone: '+256700100099', email: 'e2e.nudge@example.com' },
      collect_schedule: false,
      status: 'pending',
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    if (error) throw new Error(`could not seed the e2e invite: ${error.message}`);
  });

  test.afterAll(async () => {
    await getAdminClient().from('employer_invites').delete().eq('token', TOKEN);
  });

  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
    await page.goto('/dashboard/pending-kyc');
  });

  test('the route renders in place — it does NOT redirect away', async ({ page }) => {
    // The old behaviour bounced desktop to /dashboard/employees.
    await expect(page).toHaveURL(/\/dashboard\/pending-kyc$/);
    await expect(page.getByRole('heading', { name: /pending kyc/i })).toBeVisible();
    await expect(page.getByText(INVITEE)).toBeVisible();
  });

  test('offers Email, SMS and WhatsApp once someone is selected', async ({ page }) => {
    await page.getByRole('checkbox', { name: new RegExp(`Select ${INVITEE}|${INVITEE}`) })
      .first()
      .click();

    for (const channel of ['Email', 'SMS', 'WhatsApp']) {
      await expect(page.getByRole('checkbox', { name: `Send via ${channel}` })).toBeVisible();
    }

    // Email + SMS are the shipped defaults; WhatsApp is opt-in.
    await expect(page.getByRole('checkbox', { name: 'Send via Email' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Send via SMS' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Send via WhatsApp' })).not.toBeChecked();
  });

  test('sending marks the invitee as reminded', async ({ page }) => {
    await page.getByRole('checkbox', { name: new RegExp(`Select ${INVITEE}|${INVITEE}`) })
      .first()
      .click();

    await page.getByRole('button', { name: /send reminder to/i }).click();

    // The row picks up the session nudge marker. "now" (not a date months back)
    // is the point — the log is stamped with the real clock, not MOCK_NOW.
    await expect(page.getByText(/reminded now/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test('unticking every channel blocks the send', async ({ page }) => {
    await page.getByRole('checkbox', { name: new RegExp(`Select ${INVITEE}|${INVITEE}`) })
      .first()
      .click();

    await page.getByRole('checkbox', { name: 'Send via Email' }).click();
    await page.getByRole('checkbox', { name: 'Send via SMS' }).click();

    await expect(page.getByText(/choose at least one channel/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /send reminder to/i })).toBeDisabled();
  });
});
