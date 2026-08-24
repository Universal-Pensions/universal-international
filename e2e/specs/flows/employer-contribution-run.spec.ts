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
//   6. Cleanup — delete the run's transactions (by contribution_run_id) BEFORE
//      the run header (ON DELETE SET NULL on that FK would otherwise orphan
//      them — A06-002), then the upload-nonce ledger row by its own nonce, so
//      re-runs don't accumulate.
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
  // Captured from the submit_employer_contribution_run RPC's own request body
  // during the test — the wizard mints a fresh crypto.randomUUID() nonce
  // client-side (runViews.jsx mintNonce()) that never surfaces in the DOM, so
  // reading the RPC's outgoing request is the only way a spec can observe it.
  // Scopes the contribution_run_uploads cleanup to exactly the row this test
  // created (see A06-002 — that table has no employer_id column to filter on).
  let capturedNonce: string | null = null;

  test.afterEach(async () => {
    // Find the run(s) we created by the unique period label.
    const { data: runs, error: findErr } = await supabaseAdmin
      .from('contribution_runs')
      .select('id')
      .eq('employer_id', EMPLOYER_ID)
      .eq('period_label', periodLabel);
    expect(findErr, 'cleanup: locating contribution_runs by period_label').toBeNull();
    const runIds = (runs || []).map((r) => (r as { id: string }).id);
    if (runIds.length > 0) {
      // transactions.contribution_run_id DOES carry a real FK
      // (transactions_contribution_run_id_fkey, ON DELETE SET NULL — verified
      // live via pg_constraint: confdeltype='n'). A previous version of this
      // comment claimed the opposite ("no run_id FK on transactions") and
      // deleted the run header FIRST; that ON DELETE SET NULL then nulled
      // contribution_run_id on every transaction the run had stamped before
      // this cleanup could ever scope a delete by it, permanently orphaning
      // them (audit A06-002 — 1,824 unattributable EMP-% transaction rows in
      // the live demo DB traced to exactly this ordering bug). Delete the
      // transactions FIRST, scoped by the FK column, THEN the run header.
      const { error: txnErr } = await supabaseAdmin
        .from('transactions')
        .delete()
        .in('contribution_run_id', runIds);
      expect(txnErr, 'cleanup: deleting transactions by contribution_run_id').toBeNull();

      // contribution_run_lines is deliberately NOT deleted here: the table does
      // not exist on the live schema (verified against
      // information_schema.tables — 0 rows). The old cleanup's delete from it
      // was always a silent no-op.
      const { error: runErr } = await supabaseAdmin
        .from('contribution_runs')
        .delete()
        .in('id', runIds);
      expect(runErr, 'cleanup: deleting contribution_runs header').toBeNull();
    }
    // Clear the upload-nonce ledger row this run created. contribution_run_uploads
    // has NO employer_id column (its only columns are nonce/result/created_at —
    // verified against information_schema.columns), so the old `.eq('employer_id',
    // ...)` filter never matched, and the trailing
    // `.then(() => undefined, () => undefined)` silently swallowed the resulting
    // error — the row was NEVER deleted, which is exactly how this ledger grew to
    // 33 monotonically-increasing rows (A06-002). Target the exact nonce the
    // wizard minted instead, captured from the RPC request body in the test below.
    if (capturedNonce) {
      const { error: nonceErr } = await supabaseAdmin
        .from('contribution_run_uploads')
        .delete()
        .eq('nonce', capturedNonce);
      expect(nonceErr, 'cleanup: deleting contribution_run_uploads by nonce').toBeNull();
    }
    capturedNonce = null;
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

    // Capture the idempotency nonce straight off the RPC's own request body so
    // afterEach can target the exact contribution_run_uploads row this test
    // creates (see the describe-level comment on capturedNonce for why this is
    // the only place a spec can observe it).
    const rpcRequestBody = rpcResponse.request().postDataJSON() as { p_nonce?: string | null } | null;
    capturedNonce = rpcRequestBody?.p_nonce ?? null;
    expect(
      capturedNonce,
      'the RPC request must carry the idempotency nonce so afterEach can clean up its upload-ledger row',
    ).not.toBeNull();

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
