// Flow spec: distributor creates a new branch via the slide-in CreateBranch panel.
//
// What this exercises:
//   1. Distributor persona auth via storageState (no UI login).
//   2. Sidebar → Branches submenu → "Create New Branch" launches CreateBranch.
//   3. 3-step form (Branch Details, Branch Admin, Review) → Confirm.
//   4. DB verification — branch row exists, manager fields landed.
//   5. Cleanup — delete the row by name.
//
// Mirrors subscriber-edit-profile.spec.ts: storageState auth, waitForResponse
// on the write, DB assert, afterEach cleanup via supabaseAdmin.
//
import { test, expect } from '@playwright/test';
import { storageStatePathFor } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { supabaseAdmin, rowExists, getRow } from '../../fixtures/db';

test.use({ storageState: storageStatePathFor('distributor') });
test.setTimeout(45_000);

type BranchRow = {
  id: string;
  name: string;
  district_id: string;
  manager_name: string | null;
  manager_phone: string | null;
  manager_email: string | null;
};

test.describe('distributor → create branch (UI + DB)', () => {
  const branchName = `E2E Branch ${Date.now()}`;
  // Unique 9-digit Uganda local mobile. CreateBranch's phone input strips
  // non-digits and caps at 9 — '70' prefix is in the valid carrier set.
  const managerPhone = `70${String(Date.now()).slice(-7)}`;
  const managerName = `E2E Manager ${Date.now()}`;
  const managerEmail = `e2e-manager-${Date.now()}@example.com`;

  test.afterEach(async () => {
    // Auto-clean the inserted row by name so re-runs don't accumulate
    // duplicate E2E branches in the demo DB.
    const { error } = await supabaseAdmin
      .from('branches')
      .delete()
      .eq('name', branchName);
    expect(error, `cleanup: deleting branch by name ${branchName}`).toBeNull();
  });

  test('submitting the form inserts a branch row', async ({ page }) => {
    await disableAnimations(page);

    // Listen for the POST /rest/v1/branches that fires when the panel
    // submits. Tight timeout so a regression that breaks the wiring fails
    // fast at this await rather than hanging for 45s.
    const insertPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/rest/v1/branches') &&
        res.request().method() === 'POST' &&
        res.status() === 201,
      { timeout: 15_000 },
    );

    await page.goto('/dashboard');

    // Distributor sidebar, MAP MODE: Branches → flyout → "Create New Branch".
    //
    // The flyout submenus render only in map mode (`mapMode && branchMenuOpen` in
    // Sidebar.jsx). In the default "dash" mode a Branches click jumps straight to
    // the full-page branch LIST and returns — there is no Create entry on that
    // path at all, even though DashboardShell still wires a `createBranch` page.
    // So enable Map view first; this is currently the only route to the form.
    // (Worth deciding separately whether dash mode should surface a Create CTA on
    // the Branches page — flagged, not silently worked around.)
    const mapViewToggle = page.getByRole('switch', { name: /map view/i });
    await expect(mapViewToggle).toBeVisible();
    if ((await mapViewToggle.getAttribute('aria-checked')) !== 'true') {
      await mapViewToggle.click();
    }

    await page.getByRole('button', { name: /^branches$/i }).first().click();
    await page.getByRole('button', { name: /create new branch/i }).click();

    // Slide-in panel header.
    await expect(page.getByRole('heading', { level: 2, name: /create new branch/i })).toBeVisible();

    // ── Step 1: Branch Details ───────────────────────────────────────────
    await page.locator('#cb-branchName').fill(branchName);

    // District picker — type-to-filter SearchableSelect, free text disabled
    // (must pick an existing district to satisfy the FK on branches.district_id).
    // "Kampala" matches a seeded district reliably.
    await page.locator('#cb-district').click();
    await page.locator('#cb-district').fill('Kampala');
    // Pick the first matching dropdown option that says "Kampala".
    await page.getByRole('button', { name: /^kampala$/i }).first().click();

    // City / Town — searchable with allowCustom; pick from the static list.
    await page.locator('#cb-cityTown').click();
    await page.locator('#cb-cityTown').fill('Kampala');
    await page.getByRole('button', { name: /^kampala$/i }).first().click();

    await page
      .locator('#cb-address')
      .fill('Plot 1, E2E Street, Kampala');

    await page.getByRole('button', { name: /continue/i }).click();

    // ── Step 2: Branch Admin ─────────────────────────────────────────────
    await page.locator('#cb-adminName').fill(managerName);
    await page.locator('#cb-adminPhone').fill(managerPhone);
    await page.locator('#cb-adminEmail').fill(managerEmail);

    await page.getByRole('button', { name: /continue/i }).click();

    // ── Step 3: Review → Create ──────────────────────────────────────────
    await expect(page.getByRole('heading', { level: 4, name: /branch details/i })).toBeVisible();
    const createBtn = page.getByRole('button', { name: /^create branch$/i });
    await expect(createBtn).toBeEnabled();
    await createBtn.click();

    // Wait for the insert response — confirms the panel actually called
    // useCreateBranch → entities.createBranch → POST /rest/v1/branches.
    const insertResponse = await insertPromise;
    expect(insertResponse.ok()).toBe(true);

    // [DB] Verify the row exists and manager fields landed.
    expect(await rowExists('branches', { name: branchName })).toBe(true);
    const row = await getRow<BranchRow>('branches', { name: branchName });
    expect(row, `inserted branch row should exist for name ${branchName}`).not.toBeNull();
    expect(row!.manager_name).toBe(managerName);
    // CreateBranch normalises to canonical +256-prefixed form before insert.
    expect(row!.manager_phone).toBe(`+256${managerPhone}`);
    expect(row!.manager_email).toBe(managerEmail);
    // eslint-disable-next-line no-console
    console.log(
      `[db] branches row inserted: id=${row!.id} name=${row!.name} district=${row!.district_id}`,
    );
  });
});
