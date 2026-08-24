// Flow spec: distributor applies a commission settlement through the UI, the
// affected agent's `due` commissions flip to `paid`, a settlement_batches row
// is recorded, and `commission_settled` notifications land for the agent +
// branch (surfaced via the NotificationBell badge).
//
// This is the post-0029 replacement for the deleted agent-confirm-commission /
// settlement-run-lifecycle specs. The headline simplified flow (migrations
// 0030/0031 + apply_settlement RPC + notifications + NotificationBell) had ZERO
// E2E coverage at any layer — only mock-branch unit tests. This spec exercises
// the REAL SECURITY DEFINER apply_settlement path end-to-end.
//
// WHY THROUGH THE UI (not supabaseAdmin.rpc): apply_settlement gates on
// `auth.jwt() ->> 'app_role' = 'distributor'` and raises P0001 otherwise. The
// service-role client carries a NULL jwt, so a direct RPC call is rejected by
// the role gate (the same limitation the old settlement-run-lifecycle spec
// documented). Driving the distributor storageState through CommissionPanel
// means the bearer token carries `app_role='distributor'` and the RPC runs for
// real. DB-side assertions then use the service-role read helpers.
//
// >>> CUTOVER GATE — MIGRATION 0032 NOW APPLIED TO LIVE (gate MET) <<<
// The committed frontend (src/services/commissions.js) calls
// `apply_settlement(p_rows, p_nonce)` — the TWO-arg form added by migration
// 0032 (BL-1/BL-2/BL-8/BL-13 fixes). Migration 0032 is now LIVE on the
// Singapore project (ilkhfnoyxlxwqadebnkp, cutover 2026-06-05), so the UI's
// {p_rows, p_nonce} call resolves to the real two-arg function and the whole
// spec runs end-to-end. This file is therefore ENABLED (the outer
// `test.describe.fixme` gate has been removed); it is the canonical live E2E
// coverage for the money-moving settlement path.
//
// The differentiating behaviours that ONLY 0032 introduces — partial-payment
// FIFO, per-line paid_amount reconciliation, and idempotency — are likewise
// enabled now that the two-arg apply_settlement(p_rows, p_nonce) is live; they
// assert outcomes only 0032 can produce.

import { test, expect } from '@playwright/test';
import { storageStatePathFor, PERSONA_FOR } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import {
  supabaseAdmin,
  seedDueCommissionForFixture,
  type CommissionFixtureHandle,
} from '../../fixtures/db';
import { selectors } from '../../helpers/selectors';

const AGENT_ID = PERSONA_FOR.agent.entityId; // 'a-001'

// Build a settlement CSV the distributor file input accepts. `.csv` is in
// ALLOWED_EXTENSIONS and parseSheet reads CSV via SheetJS; the header row
// matches SETTLEMENT_TEMPLATE_COLUMNS (src/utils/settlement.js). One row per
// agent: Agent ID + Amount Paid are the only required columns.
function settlementCsv(agentId: string, amountPaid: number, paymentRef: string): string {
  return [
    'Agent ID,Agent Name,Branch,Pending Amount (UGX),Amount Paid (UGX),Payment Reference,Payment Date',
    `${agentId},Settlement Agent,Settlement Branch,${amountPaid},${amountPaid},${paymentRef},`,
  ].join('\n');
}

type DueRow = { id: string; amount: number };

/**
 * Read the agent's current `due` slice (ids + amounts), newest-first. The
 * happy-path enters this exact total so the RPC clears every due line.
 */
async function readDueSlice(agentId: string): Promise<DueRow[]> {
  const { data, error } = await supabaseAdmin
    .from('commissions')
    .select('id, amount')
    .eq('agent_id', agentId)
    .eq('status', 'due');
  if (error) throw new Error(`readDueSlice(${agentId}): ${error.message}`);
  return (data || []).map((r) => ({ id: (r as DueRow).id, amount: Number((r as DueRow).amount) }));
}

// Migration 0032_fix_settlement_apply.sql is applied to live (FE sends two-arg
// apply_settlement(p_rows,p_nonce); the live Singapore DB carries the matching
// two-arg overload), so PostgREST resolves the UI's {p_rows, p_nonce} call to
// the real function and every test below runs end-to-end. The file is enabled
// (no describe.fixme); the per-line 0032 behaviours are enabled inline too.
test.describe('distributor → apply settlement (UI → RPC → DB → notifications)', () => {
  test.use({ storageState: storageStatePathFor('distributor') });
  test.setTimeout(60_000);

  // Each test seeds its own due slice + records the touched rows so the
  // afterEach can restore everything (commissions flipped back to due, and the
  // settlement_batches + notifications rows the RPC created are removed). The
  // shared live DB is mutated, so cleanup is mandatory.
  let dueHandle: CommissionFixtureHandle | null = null;
  let settledLineIds: string[] = [];
  let createdBatchIds: string[] = [];
  // Captured from each apply_settlement RPC's own request body — the panel
  // mints a fresh crypto.randomUUID()-based nonce per upload
  // (CommissionPanel.jsx newSettlementNonce()) that never surfaces anywhere
  // else observable, so reading the RPC's outgoing request is the only way a
  // spec can learn it. settlement_uploads (columns: nonce/result/created_at
  // only) has no batch/agent/ref column a cleanup could otherwise scope by —
  // without this it was NEVER cleaned up by the E2E suite (audit A05-014).
  let capturedNonces: string[] = [];

  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
    dueHandle = await seedDueCommissionForFixture(AGENT_ID, 2);
    settledLineIds = [];
    createdBatchIds = [];
    capturedNonces = [];
  });

  test.afterEach(async () => {
    // Every delete's error is COLLECTED rather than asserted inline, so a
    // single failure can't skip dueHandle.cleanup() below — it MUST always
    // run regardless (it reverts rows the fixture itself flipped paid→due to
    // build the seed slice, independent of whatever the test settled). The
    // collected list IS asserted at the end: a silently-swallowed cleanup
    // failure is exactly how fixture rows leak into the live demo DB
    // unnoticed (audit A25-004).
    const teardownErrors: string[] = [];

    // Flip any lines the test settled back to `due` (clearing the settlement
    // stamp), then remove the batch + notification rows the RPC created.
    if (settledLineIds.length > 0) {
      const { error } = await supabaseAdmin
        .from('commissions')
        .update({ status: 'due', paid_date: null, paid_amount: null, txn_ref: null })
        .in('id', settledLineIds);
      if (error) teardownErrors.push(`commissions revert: ${error.message}`);
    }
    if (createdBatchIds.length > 0) {
      const { error: notifErr } = await supabaseAdmin
        .from('notifications')
        .delete()
        .in('ref_id', createdBatchIds);
      if (notifErr) teardownErrors.push(`notifications: ${notifErr.message}`);
      const { error: batchErr } = await supabaseAdmin
        .from('settlement_batches')
        .delete()
        .in('id', createdBatchIds);
      if (batchErr) teardownErrors.push(`settlement_batches: ${batchErr.message}`);
    }
    // settlement_uploads is an idempotency ledger keyed only on `nonce` — until
    // now the E2E cleanup never touched it at all (A05-014). Delete by the
    // exact nonce(s) captured off each RPC request this test made.
    if (capturedNonces.length > 0) {
      const { error: uploadErr } = await supabaseAdmin
        .from('settlement_uploads')
        .delete()
        .in('nonce', capturedNonces);
      if (uploadErr) teardownErrors.push(`settlement_uploads: ${uploadErr.message}`);
    }
    // Restore any rows the fixture flipped paid→due to create the seed slice.
    // MUST run regardless of the outcome above.
    if (dueHandle) await dueHandle.cleanup();
    dueHandle = null;

    expect(
      teardownErrors,
      `cleanup: all teardown deletes must succeed — failures: ${teardownErrors.join('; ')}`,
    ).toEqual([]);
  });

  test('full payment flips due→paid, records a batch, notifies agent + branch', async ({ page }) => {
    // Snapshot the due slice + the agent's branch BEFORE settling.
    const dueBefore = await readDueSlice(AGENT_ID);
    expect(dueBefore.length, 'fixture must seed ≥1 due line').toBeGreaterThan(0);
    settledLineIds = dueBefore.map((r) => r.id);
    const fullTotal = dueBefore.reduce((s, r) => s + r.amount, 0);

    const { data: agentRow } = await supabaseAdmin
      .from('agents')
      .select('branch_id')
      .eq('id', AGENT_ID)
      .maybeSingle();
    const branchId = (agentRow as { branch_id: string | null } | null)?.branch_id ?? null;

    const paymentRef = `E2E-FULL-${Date.now()}`;

    // ── Open the CommissionPanel ───────────────────────────────────────────
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /^overview$/i })).toBeVisible();
    await page.getByRole('button', { name: /^commissions$/i }).click();
    // Mode-agnostic: the panel is a dialog as a slide-in and a region as a routed
    // full page (see selectors.panel). Asserting the bare `dialog` role broke here
    // when the two-mode redesign landed.
    const panel = selectors.panel.commissions(page);
    await expect(panel).toBeVisible();

    // ── Upload a full-payment settlement ───────────────────────────────────
    // We register the RPC listener BEFORE confirming so we capture its result.
    const rpcPromise = page.waitForResponse(
      (r) => r.url().includes('/rest/v1/rpc/apply_settlement') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );

    await page.setInputFiles('input[type="file"]', {
      name: 'settlement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(settlementCsv(AGENT_ID, fullTotal, paymentRef), 'utf-8'),
    });

    // Confirm modal opens; click "Confirm settlement" to fire the real RPC.
    const modal = page.getByRole('dialog').filter({ hasText: /confirm settlement/i });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await modal.getByRole('button', { name: /confirm settlement/i }).click();

    const rpcResponse = await rpcPromise;
    expect(rpcResponse.status(), 'apply_settlement RPC must succeed').toBe(200);
    const rpcBody = rpcResponse.request().postDataJSON() as { p_nonce?: string | null } | null;
    if (rpcBody?.p_nonce) capturedNonces.push(rpcBody.p_nonce);

    // Success toast appears.
    await expect(
      page.getByRole('status').filter({ hasText: /settled \d+ agent/i }),
      'the success toast appears (the confirm modal shows the same phrase, so scope to the toast)',
    ).toBeVisible({ timeout: 10_000 });

    // ── DB assertions ──────────────────────────────────────────────────────
    // 1. Every previously-due line for the agent is now `paid` with a stamp.
    const { data: afterRows, error: afterErr } = await supabaseAdmin
      .from('commissions')
      .select('id, status, paid_date, paid_amount, txn_ref')
      .in('id', settledLineIds);
    expect(afterErr, 'commissions read-back').toBeNull();
    for (const row of afterRows || []) {
      const r = row as { status: string; paid_date: string | null; txn_ref: string | null };
      expect(r.status, `line ${(row as { id: string }).id} should be paid`).toBe('paid');
      expect(r.paid_date, 'paid line carries paid_date').not.toBeNull();
      expect(r.txn_ref, 'paid line carries the payment reference').toBe(paymentRef);
    }

    // The agent has no `due` lines left after a full payment.
    const dueAfter = await readDueSlice(AGENT_ID);
    expect(dueAfter.length, 'full payment clears all due lines').toBe(0);

    // 2. A settlement_batches row was recorded for this agent + ref.
    const { data: batches, error: bErr } = await supabaseAdmin
      .from('settlement_batches')
      .select('id, agent_id, branch_id, line_count, paid_amount, txn_ref')
      .eq('agent_id', AGENT_ID)
      .eq('txn_ref', paymentRef);
    expect(bErr, 'settlement_batches read-back').toBeNull();
    expect(batches?.length, 'exactly one batch recorded for this settlement').toBe(1);
    const batch = batches![0] as {
      id: string;
      branch_id: string | null;
      line_count: number;
      paid_amount: number;
    };
    createdBatchIds = [batch.id];
    expect(batch.line_count, 'batch line_count matches settled lines').toBe(settledLineIds.length);
    expect(Number(batch.paid_amount), 'batch paid_amount matches the entered total').toBe(fullTotal);

    // 3. A commission_settled notification landed for the agent (ref_id = batch).
    const { count: agentNotif, error: nAErr } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_role', 'agent')
      .eq('recipient_id', AGENT_ID)
      .eq('type', 'commission_settled')
      .eq('ref_id', batch.id);
    expect(nAErr, 'agent notification read-back').toBeNull();
    expect(agentNotif ?? 0, 'agent receives a commission_settled notification').toBe(1);

    // …and for the branch, when the agent has one.
    if (branchId) {
      const { count: branchNotif, error: nBErr } = await supabaseAdmin
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('recipient_role', 'branch')
        .eq('recipient_id', branchId)
        .eq('type', 'commission_settled')
        .eq('ref_id', batch.id);
      expect(nBErr, 'branch notification read-back').toBeNull();
      expect(branchNotif ?? 0, 'branch receives a commission_settled notification').toBe(1);
    }
  });

  test('the settled agent sees an unread NotificationBell badge', async ({ browser }) => {
    // Settle through the distributor, then open a SEPARATE agent-authed context
    // and assert the agent's NotificationBell surfaces the unread count. The
    // agent shell mounts <NotificationBell role="agent" entityId={agentId} />
    // whose button has the static aria-label "Notifications"; the unread count
    // is surfaced by the badge's aria-label "N unread" when unread > 0 (BL-39
    // standardised this with NotificationCenterCard — NotificationBell.jsx).
    const dueBefore = await readDueSlice(AGENT_ID);
    expect(dueBefore.length).toBeGreaterThan(0);
    settledLineIds = dueBefore.map((r) => r.id);
    const fullTotal = dueBefore.reduce((s, r) => s + r.amount, 0);
    const paymentRef = `E2E-BELL-${Date.now()}`;

    // --- Distributor settles ---
    const distributorContext = await browser.newContext({
      storageState: storageStatePathFor('distributor'),
    });
    const distPage = await distributorContext.newPage();
    await disableAnimations(distPage);
    await distPage.goto('/dashboard');
    await distPage.getByRole('button', { name: /^commissions$/i }).click();
    await expect(selectors.panel.commissions(distPage)).toBeVisible();
    await distPage.setInputFiles('input[type="file"]', {
      name: 'settlement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(settlementCsv(AGENT_ID, fullTotal, paymentRef), 'utf-8'),
    });
    const modal = distPage.getByRole('dialog').filter({ hasText: /confirm settlement/i });
    await expect(modal).toBeVisible({ timeout: 15_000 });
    // Register BEFORE confirming so we capture the nonce this upload mints
    // (needed to clean up its settlement_uploads row — A05-014).
    const rpcPromise = distPage.waitForResponse(
      (r) => r.url().includes('/rest/v1/rpc/apply_settlement') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await modal.getByRole('button', { name: /confirm settlement/i }).click();
    const rpcResponse = await rpcPromise;
    expect(rpcResponse.status(), 'apply_settlement RPC must succeed').toBe(200);
    const rpcBody = rpcResponse.request().postDataJSON() as { p_nonce?: string | null } | null;
    if (rpcBody?.p_nonce) capturedNonces.push(rpcBody.p_nonce);
    await expect(
      distPage.getByRole('status').filter({ hasText: /settled \d+ agent/i }),
      'the success toast appears (the confirm modal shows the same phrase, so scope to the toast)',
    ).toBeVisible({ timeout: 10_000 });
    await distributorContext.close();

    // Record the created batch id for cleanup.
    const { data: batches } = await supabaseAdmin
      .from('settlement_batches')
      .select('id')
      .eq('agent_id', AGENT_ID)
      .eq('txn_ref', paymentRef);
    createdBatchIds = (batches || []).map((b) => (b as { id: string }).id);

    // --- Agent sees the badge ---
    const agentContext = await browser.newContext({
      storageState: storageStatePathFor('agent'),
    });
    const agentPage = await agentContext.newPage();
    await disableAnimations(agentPage);
    await agentPage.goto('/dashboard');
    // The bell polls every 30s; on mount it fetches once, so the unread badge
    // should resolve well within the timeout for a freshly-emitted notification.
    // The count lives on the badge's aria-label ("N unread"), not the button.
    const badge = agentPage.getByLabel(/^\d+\s*unread$/i);
    await expect(badge.first()).toBeVisible({ timeout: 20_000 });
    await agentContext.close();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 0032-only behaviours — ENABLED now that 0032 is applied to live. These
  // assert outcomes the single-arg 0031 RPC could not produce (FIFO partial
  // allocation, per-line paid_amount, nonce idempotency); the two-arg
  // apply_settlement(p_rows, p_nonce) is live, so they run for real.
  // ───────────────────────────────────────────────────────────────────────

  test(
    'partial payment settles only the lines the amount covers; the rest stay due (0032)',
    async ({ page }) => {
      // Enter LESS than the agent's due total: 0032's FIFO loop should settle
      // the oldest line(s) the budget fully covers and leave the remainder
      // genuinely `due` (INFORM-NOT-BLOCK). Against the pre-0032 single-arg RPC
      // this is impossible — it clears ALL due lines (BL-1), which is exactly
      // why this is fixme'd rather than enabled.
      //
      // DETERMINISM NOTE (reviewer): 0032 allocates FIFO —
      //   ORDER BY due_date ASC NULLS LAST, id ASC  +  EXIT WHEN remaining < line.amount.
      // The seed gives every commission a FLAT, EQUAL amount
      // (COMMISSION_CONFIG.ratePerSubscriber = 5000 UGX, src/data/mockData.js),
      // so `Math.min(...amounts)` == the single-line amount == every line. Paying
      // exactly ONE line's worth therefore covers exactly the oldest line and
      // EXITs at the second (remaining 0 < amount), settling exactly 1.
      //   coveredCount = floor(partial / lineAmount)  when all amounts are equal.
      // If a future seed introduces UNEQUAL amounts this assertion must be
      // recomputed against the FIFO order (sort by due_date ASC, walk subtracting
      // each line.amount while remaining >= line.amount) — paying `min` could
      // then settle ZERO lines if the smallest line is not the oldest. The
      // cutover author owns re-deriving `expectedSettled` if the seed changes.
      const dueBefore = await readDueSlice(AGENT_ID);
      expect(dueBefore.length).toBeGreaterThanOrEqual(2);
      settledLineIds = dueBefore.map((r) => r.id);
      const lineAmounts = dueBefore.map((r) => r.amount);
      const lineAmount = lineAmounts[0];
      const allEqual = lineAmounts.every((a) => a === lineAmount);
      expect(
        allEqual,
        'this assertion assumes the flat-rate-equal seed; re-derive expectedSettled via the FIFO walk if amounts differ',
      ).toBe(true);
      // Pay exactly one line's worth so the FIFO walk settles exactly one line.
      const partial = lineAmount;
      const expectedSettled = Math.floor(partial / lineAmount); // == 1 under the equal-amount seed
      const paymentRef = `E2E-PARTIAL-${Date.now()}`;

      await page.goto('/dashboard');
      await page.getByRole('button', { name: /^commissions$/i }).click();
      await expect(selectors.panel.commissions(page)).toBeVisible();
      await page.setInputFiles('input[type="file"]', {
        name: 'settlement.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(settlementCsv(AGENT_ID, partial, paymentRef), 'utf-8'),
      });
      const modal = page.getByRole('dialog').filter({ hasText: /confirm settlement/i });
      await expect(modal).toBeVisible({ timeout: 15_000 });
      // Register BEFORE confirming so we capture the nonce this upload mints
      // (needed to clean up its settlement_uploads row — A05-014).
      const rpcPromise = page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/apply_settlement') && r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await modal.getByRole('button', { name: /confirm settlement/i }).click();
      const rpcResponse = await rpcPromise;
      expect(rpcResponse.status(), 'apply_settlement RPC must succeed').toBe(200);
      const rpcBody = rpcResponse.request().postDataJSON() as { p_nonce?: string | null } | null;
      if (rpcBody?.p_nonce) capturedNonces.push(rpcBody.p_nonce);
      await expect(
      page.getByRole('status').filter({ hasText: /settled \d+ agent/i }),
      'the success toast appears (the confirm modal shows the same phrase, so scope to the toast)',
    ).toBeVisible({ timeout: 10_000 });

      const dueAfter = await readDueSlice(AGENT_ID);
      // FIFO settles exactly `expectedSettled` of the (equal-amount) lines; the
      // rest stay genuinely `due`. Deterministic given the flat-rate seed.
      expect(
        dueBefore.length - dueAfter.length,
        'partial payment settles exactly the FIFO-covered line count',
      ).toBe(expectedSettled);
      // And a partial payment never clears the whole slice (INFORM-NOT-BLOCK).
      expect(dueAfter.length, 'partial payment leaves uncovered lines due').toBeGreaterThan(0);

      const { data: batches } = await supabaseAdmin
        .from('settlement_batches')
        .select('id')
        .eq('agent_id', AGENT_ID)
        .eq('txn_ref', paymentRef);
      createdBatchIds = (batches || []).map((b) => (b as { id: string }).id);
    },
  );

  test(
    'per-line paid_amount reconciles with the batch total (0032)',
    async ({ page }) => {
      // 0032 stamps each settled line with its OWN amount (BL-2), so
      // SUM(paid_amount) over the settled lines equals settlement_batches
      // .paid_amount. The pre-0032 RPC stamps the whole batch total on EVERY
      // line, so this sum would be line_count× too large — hence fixme.
      const dueBefore = await readDueSlice(AGENT_ID);
      expect(dueBefore.length).toBeGreaterThanOrEqual(2);
      settledLineIds = dueBefore.map((r) => r.id);
      const fullTotal = dueBefore.reduce((s, r) => s + r.amount, 0);
      const paymentRef = `E2E-PERLINE-${Date.now()}`;

      await page.goto('/dashboard');
      await page.getByRole('button', { name: /^commissions$/i }).click();
      await expect(selectors.panel.commissions(page)).toBeVisible();
      await page.setInputFiles('input[type="file"]', {
        name: 'settlement.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(settlementCsv(AGENT_ID, fullTotal, paymentRef), 'utf-8'),
      });
      const modal = page.getByRole('dialog').filter({ hasText: /confirm settlement/i });
      await expect(modal).toBeVisible({ timeout: 15_000 });
      // Register BEFORE confirming so we capture the nonce this upload mints
      // (needed to clean up its settlement_uploads row — A05-014).
      const rpcPromise = page.waitForResponse(
        (r) => r.url().includes('/rest/v1/rpc/apply_settlement') && r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await modal.getByRole('button', { name: /confirm settlement/i }).click();
      const rpcResponse = await rpcPromise;
      expect(rpcResponse.status(), 'apply_settlement RPC must succeed').toBe(200);
      const rpcBody = rpcResponse.request().postDataJSON() as { p_nonce?: string | null } | null;
      if (rpcBody?.p_nonce) capturedNonces.push(rpcBody.p_nonce);
      await expect(
      page.getByRole('status').filter({ hasText: /settled \d+ agent/i }),
      'the success toast appears (the confirm modal shows the same phrase, so scope to the toast)',
    ).toBeVisible({ timeout: 10_000 });

      const { data: paidRows } = await supabaseAdmin
        .from('commissions')
        .select('paid_amount')
        .in('id', settledLineIds);
      const sumPerLine = (paidRows || []).reduce(
        (s, r) => s + Number((r as { paid_amount: number }).paid_amount || 0),
        0,
      );

      const { data: batches } = await supabaseAdmin
        .from('settlement_batches')
        .select('id, paid_amount')
        .eq('agent_id', AGENT_ID)
        .eq('txn_ref', paymentRef);
      createdBatchIds = (batches || []).map((b) => (b as { id: string }).id);
      const batchTotal = Number((batches?.[0] as { paid_amount: number })?.paid_amount || 0);

      // Per-line allocation reconciles with the batch total (BL-2 fixed).
      expect(sumPerLine, 'SUM(per-line paid_amount) == batch paid_amount').toBe(batchTotal);
    },
  );

  // STILL fixme'd — NOT because of the migration gate (0032 is live), but
  // because the concrete UI replay vehicle is unimplemented: the body below is
  // a placeholder (`expect(true).toBe(true)`), so enabling it would assert
  // nothing and report a misleading green. Enable it once a real replay is
  // wired (a second confirm against a reopened modal carrying the SAME nonce,
  // or a service-level replay with the captured nonce), asserting
  // settlement_batches gains exactly ONE row across the two submits.
  test.fixme(
    'idempotency: re-submitting the same upload nonce records no second batch (0032)',
    async ({ page }) => {
      // 0032 accepts a per-upload nonce persisted in settlement_uploads with a
      // PK on the nonce; a replay returns the prior result without recording a
      // second batch or re-notifying (BL-13). The two-arg RPC is live, so the
      // only thing missing is the UI replay vehicle described above.
      expect(true).toBe(true);
    },
  );
});
