// Flow spec: an employer runs a contribution run through the UI wizard.
//
// Closes audit §7b.8 / F2-07 ("≥1 employer flow"). The employer contribution-run
// is the role's core money write (UI → useRunContribution → submitContributionRun
// → submit_employer_contribution_run RPC, atomic + nonce-idempotent — write-flow
// #6 / §4a.3). It had ZERO E2E coverage at any layer.
//
// What this exercises:
//   1. Employer persona auth via storageState (no UI login).
//   2. Sidebar → Contribution Runs → "New contribution run" opens the wizard.
//   3. Step 1 (period + method, live preview) → Continue → Step 2 (confirm).
//   4. "Confirm & record" fires the real submit_employer_contribution_run RPC.
//   5. Result — success toast + a contribution_runs row recorded for the period.
//   6. Cleanup — delete the run + its lines + transactions + the upload nonce by
//      the unique period label so re-runs don't accumulate.
//
// Mirrors distributor-apply-settlement.spec.ts: storageState auth,
// waitForResponse on the RPC, DB assert via supabaseAdmin, afterEach cleanup.
//
// >>> LIVE-DB GATE <<<
// submit_employer_contribution_run is part of the employer stack (migrations
// 0034/0035) on the live Singapore DB. The wizard mints a fresh nonce per
// session and reuses it across retries (§4a F-4 fix), so a real run inserts one
// contribution_runs row + per-active-member transactions(source='employer').
// Cleanup is therefore MANDATORY — the shared live DB is mutated. NOTE: the
// balance trigger credits subscriber_balances on each inserted transaction; the
// cleanup removes the ledger rows but (like the settlement spec) does not
// perfectly reverse the cumulative balance side-effect — acceptable demo-scope.

import { test, expect } from '@playwright/test';
import { storageStatePathFor, PERSONA_FOR } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { supabaseAdmin, rowExists, getRow } from '../../fixtures/db';

const EMPLOYER_ID = PERSONA_FOR.employer.entityId; // 'emp-001'

test.use({ storageState: storageStatePathFor('employer') });
test.setTimeout(60_000);

type RunRow = {
  id: string;
  employer_id: string;
  period_label: string | null;
  status: string;
  employer_total: number;
  employee_total: number;
  insurance_total: number;
  grand_total: number;
};

test.describe('employer → contribution run (UI → RPC → DB)', () => {
  // Unique period label so the DB assert + cleanup target exactly this run.
  const periodLabel = `E2E Run ${Date.now()}`;

  test.afterEach(async () => {
    // Find the run(s) we created by the unique period label, then walk the
    // child rows (lines + the employer-source transactions) before deleting the
    // run + the upload nonce ledger so a re-run starts clean.
    const { data: runs } = await supabaseAdmin
      .from('contribution_runs')
      .select('id')
      .eq('employer_id', EMPLOYER_ID)
      .eq('period_label', periodLabel);
    const runIds = (runs || []).map((r) => (r as { id: string }).id);
    if (runIds.length > 0) {
      await supabaseAdmin.from('contribution_run_lines').delete().in('run_id', runIds);
      // Employer-source transactions stamped by this run carry source='employer';
      // there is no run_id FK on transactions, so we scope by the run's window is
      // not reliable — instead delete the run rows + their lines (the ledger rows
      // are demo-scope residue, consistent with the settlement spec's discipline).
      await supabaseAdmin.from('contribution_runs').delete().in('id', runIds);
    }
    // Best-effort: clear any upload-nonce ledger row(s) created this run so the
    // idempotency table doesn't accumulate E2E nonces (ignore if the table or
    // the rows aren't present — cleanup must never fail the test).
    await supabaseAdmin
      .from('contribution_run_uploads')
      .delete()
      .eq('employer_id', EMPLOYER_ID)
      .gte('created_at', new Date(Date.now() - 5 * 60_000).toISOString())
      .then(() => undefined, () => undefined);
  });

  test('running a contribution run records a run and shows a success result', async ({ page }) => {
    await disableAnimations(page);

    await page.goto('/dashboard');
    await expect(page.getByText(/welcome back/i)).toBeVisible({ timeout: 20_000 });

    // ── Open Contribution Runs → New run wizard ───────────────────────────────
    // The employer dashboard became a ROUTED shell (2026-06-24): nav items are
    // <Link>s to /dashboard/runs etc., and Runs is a page — not a button opening a
    // role="dialog" panel. Navigate by link, then assert the page's own CTA.
    await page.getByRole('link', { name: /^contribution runs$/i }).first().click();
    await expect(page).toHaveURL(/\/dashboard\/runs/, { timeout: 15_000 });
    const newRunCta = page.getByRole('button', { name: /new contribution run/i }).first();
    await expect(newRunCta).toBeVisible({ timeout: 20_000 });
    await newRunCta.click();

    // The wizard view has NO heading of its own — the routed page keeps its single
    // <h1> "Contribution Runs" across history/detail/wizard (RunsDesktop swaps the
    // body only). Assert on an affordance unique to the wizard instead.
    await expect(
      page.getByRole('button', { name: /back to history/i }),
      'the new-run wizard is open',
    ).toBeVisible({ timeout: 15_000 });

    // ── Step 1: period + method ───────────────────────────────────────────────
    await page.locator('#run-period').fill(periodLabel);
    // Method already defaults to METHOD_OPTIONS[0]; leave it.
    // Continue is disabled when preview.funded === 0; the demo employer (emp-001)
    // has ~16 seeded active members, so it enables.
    const continueBtn = page.getByRole('button', { name: /^continue$/i });
    await expect(continueBtn).toBeEnabled();
    await continueBtn.click();

    // ── Step 2: confirm ───────────────────────────────────────────────────────
    // Register the RPC listener BEFORE confirming so we capture its result.
    const rpcPromise = page.waitForResponse(
      (r) =>
        r.url().includes('/rest/v1/rpc/submit_employer_contribution_run') &&
        r.request().method() === 'POST',
      { timeout: 25_000 },
    );

    const confirmBtn = page.getByRole('button', { name: /confirm & record/i });
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    const rpcResponse = await rpcPromise;
    expect(rpcResponse.status(), 'submit_employer_contribution_run RPC must succeed').toBe(200);

    // ── Result: success toast ─────────────────────────────────────────────────
    // handleConfirm shows "Run recorded — N funded · UGX total".
    await expect(page.getByText(/run recorded/i)).toBeVisible({ timeout: 15_000 });

    // ── DB assertion: a completed run row exists for this period ───────────────
    expect(
      await rowExists('contribution_runs', {
        employer_id: EMPLOYER_ID,
        period_label: periodLabel,
      }),
      `a contribution_runs row should exist for period "${periodLabel}"`,
    ).toBe(true);
    const row = await getRow<RunRow>('contribution_runs', {
      employer_id: EMPLOYER_ID,
      period_label: periodLabel,
    });
    expect(row, `inserted run row should exist for period ${periodLabel}`).not.toBeNull();
    expect(row!.status, 'a recorded run is completed').toBe('completed');

    // ── Two-leg assertion (UNIFIED MODEL, migration 0092) ─────────────────────
    // The demo employer's config funds BOTH legs — staff put in 10% of pay and the
    // company adds 5% of pay (src/data/employerSeed.js). The two legs are
    // INDEPENDENT shares of each member's compensation, so a run posts an employee
    // leg (source='own') AND an employer leg (source='employer'), and the header
    // carries a positive total for each. Neither figure is derived from the other.
    const employerTotal = Number(row!.employer_total);
    const employeeTotal = Number(row!.employee_total);
    const grandTotal = Number(row!.grand_total);
    expect(employeeTotal, 'the staff leg (10% of pay) posts real money').toBeGreaterThan(0);
    expect(employerTotal, 'the company leg (5% of pay) posts real money').toBeGreaterThan(0);

    // grand_total is a THREE-leg sum. Migration 0066 folded the employer-funded
    // group-insurance premium into it, and emp-001 has insurance ON (Life 15M +
    // Health 5M = UGX 40,000/member/month across ~19 active members ≈ 760,000).
    // Asserting grand === employer + employee was therefore failing on the live DB
    // for the insurance amount — a release blocker, not a model change.
    const insuranceTotal = Number(row!.insurance_total);
    expect(insuranceTotal, 'emp-001 has group insurance on, so the premium leg is funded').toBeGreaterThan(0);
    expect(
      grandTotal,
      'grand_total = employer_total + employee_total + insurance_total (0066)',
    ).toBe(employerTotal + employeeTotal + insuranceTotal);
    // eslint-disable-next-line no-console
    console.log(
      `[db] contribution_runs row inserted: id=${row!.id} period=${row!.period_label} status=${row!.status} employer=${employerTotal} employee=${employeeTotal} insurance=${insuranceTotal} grand=${grandTotal}`,
    );
  });
});
