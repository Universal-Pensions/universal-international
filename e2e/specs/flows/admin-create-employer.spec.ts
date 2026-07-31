// Flow spec: an admin creates an employer from name/sector (+ profile fields)
// and it appears in the platform Employers list.
//
// Closes audit §7b.8 / F2-07 ("≥1 admin flow") + §7b.5 (admin create-employer
// write surface untested at every layer). Admin create-employer is write-flow
// #17 (RPC create_employer, SECURITY DEFINER, gated on app_role='admin' — §4a.1).
//
// CONTRIBUTION MODEL v2 (migration 0062): the admin no longer sets a payroll
// cadence or a default contribution config when creating an employer. Funding is
// driven entirely by each member's monthly `compensation` (set on the roster) +
// the company-wide config the employer manages in its own Settings — NOT at
// admin-create time. So this spec posts ONLY the company profile fields the form
// still carries (name, sector, district, registration no., contact details).
//
// What this exercises:
//   1. Admin persona auth via storageState (no UI login).
//   2. Sidebar → Employers → "New" launches the CreateEmployer panel.
//   3. Fill the company name + sector (the form's profile fields).
//   4. "Create employer" fires the real create_employer RPC.
//   5. It appears — re-open the Employers panel; the new name is listed.
//   6. DB verify — the employers row exists with the posted profile fields.
//   7. Cleanup — delete the row by name.
//
// Mirrors distributor-create-branch.spec.ts: storageState auth, waitForResponse
// on the write, DB assert, afterEach cleanup via supabaseAdmin.

import { test, expect } from '@playwright/test';
import { storageStatePathFor } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { supabaseAdmin, rowExists, getRow } from '../../fixtures/db';

test.use({ storageState: storageStatePathFor('admin') });
test.setTimeout(45_000);

type EmployerRow = {
  id: string;
  name: string;
  sector: string | null;
};

test.describe('admin → create employer (UI + DB)', () => {
  const employerName = `E2E Employer ${Date.now()}`;
  const sector = 'Manufacturing';

  test.afterEach(async () => {
    // Auto-clean the inserted employer by name so re-runs don't accumulate
    // duplicate E2E employers in the demo DB.
    const { error } = await supabaseAdmin
      .from('employers')
      .delete()
      .eq('name', employerName);
    expect(error, `cleanup: deleting employer by name ${employerName}`).toBeNull();
  });

  test('creating an employer inserts a row and it appears in the list', async ({ page }) => {
    await disableAnimations(page);

    // Listen for the create_employer RPC that fires when the form submits.
    const rpcPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/rest/v1/rpc/create_employer') &&
        r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.goto('/dashboard');

    // ── Open Employers → "New" → CreateEmployer panel ─────────────────────────
    await page.getByRole('button', { name: /^employers$/i }).first().click();
    await expect(page.getByRole('heading', { name: /^employers$/i, level: 2 })).toBeVisible();
    await page.getByRole('button', { name: /^new$/i }).click();

    // CreateEmployer renders <h2>New Employer</h2>.
    await expect(page.getByRole('heading', { name: /new employer/i, level: 2 })).toBeVisible();

    // ── Fill the company profile fields ───────────────────────────────────────
    // Profile only: the admin never sets contribution figures. create_employer
    // provisions the employer with an empty config, which normalises to 0/0 — a
    // legal state that funds no pension until the employer sets its two legs in
    // Settings → Pension. There is no funding "mode" or match % to fill in.
    await page.locator('#ce-name').fill(employerName);
    await page.locator('#ce-sector').fill(sector);

    // ── Submit → create_employer RPC ──────────────────────────────────────────
    const submitBtn = page.getByRole('button', { name: /^create employer$/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    const rpcResponse = await rpcPromise;
    expect(rpcResponse.status(), 'create_employer RPC must succeed').toBe(200);

    // Success toast: `Employer "<name>" created.`
    await expect(page.getByText(new RegExp(`employer "${employerName}" created`, 'i'))).toBeVisible({
      timeout: 10_000,
    });

    // ── It appears in the Employers list ──────────────────────────────────────
    // CreateEmployer closes on success; the ViewEmployers panel (still open
    // underneath) re-renders from the invalidated useAllEmployersMetrics. The new
    // employer name is rendered as a row in the list.
    await expect(
      page.getByRole('heading', { name: /^employers$/i, level: 2 }),
    ).toBeVisible();
    await expect(page.getByText(employerName).first()).toBeVisible({ timeout: 15_000 });

    // ── DB verify — the employers row exists with the posted profile fields ───
    expect(await rowExists('employers', { name: employerName })).toBe(true);
    const row = await getRow<EmployerRow>('employers', { name: employerName });
    expect(row, `inserted employer row should exist for name ${employerName}`).not.toBeNull();
    expect(row!.sector).toBe(sector);
    // eslint-disable-next-line no-console
    console.log(
      `[db] employers row inserted: id=${row!.id} name=${row!.name} sector=${row!.sector}`,
    );
  });
});
