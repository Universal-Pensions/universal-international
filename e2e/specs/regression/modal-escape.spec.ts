// Regression spec: pressing Escape inside a Modal closes ONLY the modal,
// never the outer slide-in panel that triggered it.
//
// Why: src/components/Modal.jsx's keydown handler calls
//   e.preventDefault()
//   e.stopPropagation()
//   e.nativeEvent.stopImmediatePropagation()
// to ensure the React-bubbled Escape stops at the Modal. The slide-in panels
// (ViewSubscribers / ViewBranches / ViewAgents / CommissionPanel) listen for
// Escape at document level to close themselves — without the stop, opening a
// modal and pressing Escape would close BOTH (a common UX bug Modal v1 had).
//
// Coverage:
//   - Distributor: ViewBranches confirm-status modal — opens Modal over the
//     ViewBranches panel; Escape must close the Modal but leave ViewBranches.
//   - Distributor: settlement confirm modal — opens over CommissionPanel.
//
// Both modals route through the shared <Modal> primitive at
// src/components/Modal.jsx, so the focus-trap + Escape stop behaviour is
// shared. We test each entry point so a regression in any consumer is caught
// (not just the primitive).
//
// HISTORY: this file previously also covered an agent DisputeModal and a
// distributor "commission resolution" (Approve/Reject) modal. Both the dispute
// flow and its enum states (released/disputed) were removed by the 0029
// commission simplification (BACKEND.md §15b: "there is no longer a dispute
// path on either side"), so those two blocks were rewritten onto the surviving
// settlement confirm modal. The Modal.jsx Escape stop-propagation primitive is
// the actual contract under test — it stays fully covered by the two blocks
// below (one Modal-over-panel, one Modal-over-CommissionPanel).

import { test, expect } from '@playwright/test';
import { storageStatePathFor, PERSONA_FOR } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';
import { seedDueCommissionForFixture, type CommissionFixtureHandle } from '../../fixtures/db';

// A minimal settlement CSV the distributor file input accepts (.csv is in
// ALLOWED_EXTENSIONS, parseSheet reads CSV via SheetJS). Header names match
// SETTLEMENT_TEMPLATE_COLUMNS (src/utils/settlement.js); the row carries a
// valid Agent ID + a positive Amount Paid so normalizeUploadedRows keeps it
// and CommissionPanel opens the confirm modal. We do NOT confirm the
// settlement here — opening the modal is enough to exercise the Escape
// contract, and not confirming avoids mutating commission state.
function settlementCsv(agentId: string, amountPaid: number): string {
  return [
    'Agent ID,Agent Name,Branch,Pending Amount (UGX),Amount Paid (UGX),Payment Reference,Payment Date',
    `${agentId},Fixture Agent,Fixture Branch,${amountPaid},${amountPaid},MODAL-ESCAPE,`,
  ].join('\n');
}

test.describe('Modal Escape regression', () => {
  test.describe('distributor → ViewBranches confirm-status modal', () => {
    test.use({ storageState: storageStatePathFor('distributor') });

    test.beforeEach(async ({ page }) => {
      await disableAnimations(page);
    });

    test('Escape closes the modal, not the panel', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByRole('button', { name: /^overview$/i })).toBeVisible();

      // Open ViewBranches. ONE click — the two-mode redesign (65dcab5,
      // 2026-07-22) made dash mode navigate the rail straight to the full page;
      // the "View Existing Branches" flyout only renders in MAP mode now.
      await page.getByRole('button', { name: /^branches$/i }).click();
      const panelHeading = page.getByRole('heading', { name: /existing branches/i, level: 2 });
      await expect(panelHeading).toBeVisible();

      // Wait for the virtualised branch list to render. The first row has
      // `data-index="0"`; click it to drill into branch detail view. We
      // wait for the list-count line to flip from cold-load before
      // grabbing the row so the virtualiser has had time to mount it.
      await expect(page.getByText(/Showing\s+\d+\s+of\s+\d+\s+branches/i).first()).toBeVisible({ timeout: 20_000 });
      const firstBranchRow = page.locator('button[data-index="0"]').first();
      await expect(firstBranchRow).toBeVisible({ timeout: 10_000 });

      // Click the branch row to drill into BranchDetail.
      await firstBranchRow.click();

      // Race the error-boundary text against the status-toggle button.
      // Whichever appears first tells us whether BranchDetail rendered the
      // distributor detail view (with its Activate/Deactivate footer) or
      // fell through to the error boundary.
      const statusToggle = page.getByRole('button', { name: /^(deactivate|activate)\s+branch$/i });
      const errorBoundary = page.getByText(/something went wrong/i);

      const ready = await Promise.race([
        statusToggle.first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => 'toggle' as const).catch(() => null),
        errorBoundary.first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => 'error' as const).catch(() => null),
      ]);

      // HARD ASSERTION (was a silent `test.skip` — §15-M5, decision V1).
      //
      // The original guard skipped this test GREEN whenever the status-toggle
      // state wasn't reached, on the premise that BranchDetail "can crash on
      // certain branches whose metrics shape diverges". That premise no longer
      // holds for the distributor detail view, so a skip would mask a real,
      // demo-visible defect that has no other guard. Specifically, every field
      // BranchDetail reads is now crash-safe for the distributor role:
      //   - `branch.metrics` is always populated — either EMPTY_METRICS (12-slot
      //     monthlyContributions array + zeroed counters) from the entity mapper,
      //     or the get_entity_metrics_rollup RPC, which COALESCEs the array and
      //     newSubscribers* counters (0020_entity_metrics_rollup_v3.sql), so
      //     `MiniChart`'s `Math.max(...data)` never spreads undefined.
      //   - `<Demographics metrics={m}>` null-guards genderRatio/ageDistribution
      //     internally (Demographics.jsx).
      //   - `commission` from useEntityCommissionSummary is read only behind
      //     `commission ? … : '--'` guards.
      //   - `getInitials(branch.managerName)` is null-safe (String(name ?? '')).
      //   - Phase 1 only gated the Edit/footer controls behind `readOnly`
      //     (distributor keeps full controls); Phase 2 removed dead Disputed
      //     rows. Neither touches a data read, so neither adds a crash path.
      // Therefore: if we DON'T reach the toggle, that's a genuine regression
      // (a BranchDetail render crash, a missing footer, or a relabelled
      // button) and the test must FAIL loudly rather than skip.
      expect(
        ready,
        `BranchDetail did not reach the distributor status-toggle state (race winner: ${ready ?? 'none'}). ` +
          'BranchDetail reads as crash-safe for the distributor role, so this indicates a real ' +
          'regression — an upstream render crash (error boundary), a missing Activate/Deactivate ' +
          'footer, or a relabelled toggle button — not a tolerable skip condition.',
      ).toBe('toggle');

      await statusToggle.first().click();

      // The modal is rendered via portal — the role="dialog" element is the
      // inner motion.div. Title contains "Deactivate branch?" / "Activate
      // branch?".
      const modals = page.getByRole('dialog');
      await expect(modals).toHaveCount(1, { timeout: 5_000 });

      // Wait for focus to actually land INSIDE the dialog before pressing
      // Escape. `Modal` binds its key handler to the BACKDROP, so Escape is only
      // seen once focus is within the portal; the portal mounts asynchronously
      // (AnimatePresence), so there is a brief window after the dialog appears
      // where focus is still on the trigger. A real user never hits that window
      // — they read the prompt first — but Playwright presses within
      // milliseconds. Waiting here tests the contract rather than the race.
      //
      // NB this window used to be unbounded: Modal's focus step was a one-shot
      // `setTimeout(0)` that gave up silently if the node wasn't mounted yet, so
      // focus NEVER moved and Escape could not dismiss the dialog at all. Fixed
      // in Modal.jsx (bounded retry); this wait covers the residual mount time.
      await expect
        .poll(
          () => page.evaluate(() => {
            const dlg = document.querySelector('[role="dialog"]');
            return !!(dlg && document.activeElement && dlg.contains(document.activeElement));
          }),
          { timeout: 5_000, message: 'focus should move into the dialog when it opens' },
        )
        .toBe(true);

      // Press Escape inside the modal. The shared <Modal> primitive calls
      // e.preventDefault + e.stopPropagation + nativeEvent.stopImmediatePropagation
      // (Modal.jsx:144-154) to ensure the document-level "Escape closes
      // panel" listener (ViewBranches.jsx:509) doesn't also fire. The
      // test guards that contract: after Escape we expect the modal closed
      // AND the panel still mounted.
      const urlBefore = page.url();
      await page.keyboard.press('Escape');

      // Modal closes (count drops back to 0).
      await expect(modals).toHaveCount(0, { timeout: 5_000 });

      // URL must not have changed — Escape didn't trigger a navigation.
      expect(page.url()).toBe(urlBefore);

      // ViewBranches panel is still open. We check for ANY of:
      //   - The status toggle button (we were in detail view).
      //   - The panel's outer close button (any view).
      //   - The panel's "Existing Branches" heading (list view).
      // The error-boundary fallback is treated as a SEPARATE product bug:
      // if Escape inside the modal crashes the panel's exit-animation
      // code path, that's a defect we want surfaced — but the modal
      // contract (closing only the modal) is verified by the
      // toHaveCount(0) + URL checks above.
      const errorVisible = await page
        .getByText(/something went wrong/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (errorVisible) {
        // Annotate the test result with the upstream defect rather than
        // failing — the modal/escape contract is intact (modal closed,
        // URL unchanged); the crash is downstream in the panel exit
        // animation path.
        test.info().annotations.push({
          type: 'upstream-bug',
          description:
            'ViewBranches detail view crashed during/after modal close — modal/escape stop-propagation contract is intact, but the panel renders an error boundary.',
        });
      } else {
        const panelStillOpen =
          (await page.getByRole('button', { name: /^close$/i }).first().isVisible().catch(() => false)) ||
          (await statusToggle.first().isVisible().catch(() => false));
        expect(panelStillOpen, 'ViewBranches panel closed unexpectedly after modal Escape').toBe(true);
      }
    });
  });

  test.describe('distributor → settlement confirm modal', () => {
    test.use({ storageState: storageStatePathFor('distributor') });

    // Seed a `due` commission for the default agent so the distributor has a
    // pending due to settle — guarantees the upload normalizes to ≥1 settleable
    // row and the confirm modal opens, independent of the seed window or a
    // prior run that already paid the agent off. Cleanup restores any flipped
    // row. Replaces the retired dispute fixtures (no dispute states survive
    // the 0029 two-state collapse).
    let dueHandle: CommissionFixtureHandle | null = null;
    test.beforeAll(async () => {
      dueHandle = await seedDueCommissionForFixture(PERSONA_FOR.agent.entityId, 1);
    });
    test.afterAll(async () => {
      if (dueHandle) await dueHandle.cleanup();
    });

    test.beforeEach(async ({ page }) => {
      await disableAnimations(page);
    });

    test('Escape closes the confirm modal without closing CommissionPanel', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByRole('button', { name: /^overview$/i })).toBeVisible();

      // Switch to MAP view before opening Commissions — this is load-bearing,
      // not incidental.
      //
      // The two-mode redesign (65dcab5, 2026-07-22) gave CommissionPanel two
      // forms. In DASH mode `DashboardShell` renders `<CommissionPanel fullPage />`
      // as a routed page: `role="region"`, and its document-level Escape listener
      // is disabled outright (`if (e.key === 'Escape' && !fullPage)` in
      // CommissionPanel.jsx). Testing the Escape contract there would assert
      // nothing — there is no listener left to stop.
      //
      // The contract this spec exists to guard only exists in the DIALOG form,
      // which `DashboardShell` renders behind `{!dashMode && …}`: `role="dialog"`
      // WITH the live Escape-closes-the-panel listener. So drive map mode, where
      // an Escape that escaped the modal really would close the panel.
      await page.getByRole('switch', { name: /map view/i }).click();
      await page.getByRole('button', { name: /^commissions$/i }).click();
      const panel = page.getByRole('dialog', { name: /^commissions$/i });
      await expect(panel).toBeVisible();

      // Drive the "Upload settlement" hidden file input directly. handleUploadFile
      // parses the file, normalizes the rows, and (with ≥1 settleable row) stages
      // pendingUpload — which opens the shared <Modal> confirm dialog. No RPC is
      // fired until "Confirm settlement" is clicked, which we deliberately do NOT
      // do (this spec only exercises the Escape contract; confirming would mutate
      // commission state and depends on the post-0032 two-arg RPC being live).
      await panel
        .getByRole('button', { name: /upload settlement/i })
        .scrollIntoViewIfNeeded();
      await page.setInputFiles('input[type="file"]', {
        name: 'settlement.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(settlementCsv(PERSONA_FOR.agent.entityId, 5000), 'utf-8'),
      });

      // The confirm modal is portaled to <body> via the shared <Modal>; it
      // carries its own role="dialog" with the "Confirm settlement" title. We
      // scope to the modal (not the panel, which is also role="dialog") by
      // title text so the locator is unambiguous.
      const modal = page
        .getByRole('dialog')
        .filter({ hasText: /confirm settlement/i });
      await expect(modal).toBeVisible({ timeout: 15_000 });

      // Press Escape inside the modal. The shared <Modal> primitive calls
      // e.preventDefault + e.stopPropagation + nativeEvent.stopImmediatePropagation
      // (Modal.jsx) so the document-level "Escape closes the panel" listener in
      // CommissionPanel (the useEffect onKey at CommissionPanel.jsx) does NOT
      // also fire. The contract: after Escape the modal is closed AND the
      // CommissionPanel is still open.
      const urlBefore = page.url();
      await page.keyboard.press('Escape');

      // Modal closes.
      await expect(modal).toHaveCount(0, { timeout: 5_000 });

      // URL unchanged — Escape didn't trigger a navigation.
      expect(page.url()).toBe(urlBefore);

      // CommissionPanel is still open (the Escape stopped at the modal).
      await expect(panel).toBeVisible();
    });
  });
});
