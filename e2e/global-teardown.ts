// Playwright global teardown — runs once after the whole suite finishes.
//
// Job: FAIL THE RUN LOUDLY if the suite leaked rows into the live demo DB
// that it did not clean up. This is a safety NET on top of (not a
// replacement for) each spec's own afterEach cleanup — audit finding
// A25-004 found 22 fire-and-forget teardown deletes across 8 spec files that
// never checked their own returned `error`, so a failed per-spec cleanup
// could leak rows into the LIVE demo DB with nothing ever noticing. This file
// is the backstop: even if a future spec's cleanup is silently broken, the
// suite itself now fails instead of the leak going unnoticed.
//
// BASELINE, NOT ABSOLUTE COUNTS — why this matters:
// live already carries KNOWN pre-existing residue from before this
// remediation landed — as of 2026-08-25: 1,881 EMP-% transactions (1,824 of
// them orphaned, contribution_run_id IS NULL), 4 tst-sub-* subscribers
// missing a balance row, 5 orphaned E2E-* settlement batches, and 157
// settlement_uploads rows. Migrations 0110-0112 (Phase 2's purge of exactly
// this residue) are written and dry-run-proven but NOT YET APPLIED, so all
// of it is still live right now — see
// docs/audits/2026-08-23/a04/phase2-emp-predicate.md; Phase 2 owns purging
// it, NOT this sweep — Phase 0 commits no live deletes. A sweep that fails
// on day-one residue gets disabled by whoever hits it first, so every probe
// below (see e2e/fixtures/db.ts's "globalTeardown leak-sweep probes"
// section) is scoped to rows created SINCE THIS RUN STARTED, never "any row
// matching the pattern" or any count captured at authoring time — these
// specific numbers are cited here only as context for a human reader; no
// probe's logic depends on them, so it stays correct as Phase 2 lands.
//
// HOW "since this run started" IS COMPUTED WITHOUT TOUCHING global-setup.ts:
// this fix's write-set is e2e/fixtures/db.ts + this file + a one-line
// registration in playwright.config.ts — e2e/global-setup.ts is deliberately
// NOT part of it. global-setup.ts's entire job is minting
// e2e/.auth/{role}.json fresh on every run (its own header comment: the
// files are gitignored and "minted fresh each run"). That means their
// filesystem mtime is an already-existing, reliable proxy for "the moment
// this run's setup began" — read here with zero changes to global-setup.ts.
// A small safety margin (below) absorbs clock skew between this machine and
// the DB server, biased toward catching one extra pre-existing row rather
// than ever missing a real leak.
//
// IDEAL FUTURE STATE (escalated, not done here): have global-setup.ts persist
// an explicit baseline (row-id snapshot, not just a timestamp) so this sweep
// does not depend on a filesystem side-effect of a file it does not own.
// Out of this fix's write-set — see this agent's `escalations`.
//
// Registered in playwright.config.ts as `globalTeardown` (global-setup.ts
// already established the config pattern this file follows: a default
// export `async function(config: FullConfig)`).

import type { FullConfig } from '@playwright/test';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  findOrphanedEmployerTransactionsSince,
  findLeakedSettlementBatchesSince,
  findLeakedTestSubscribersSince,
  findLeakedSettlementUploadsSince,
  findSubscribersMissingBalanceSince,
  findLeakedTestBranchesSince,
} from './fixtures/db';

/** Absorbs clock skew between this machine and the DB server — see header. */
const SAFETY_MARGIN_MS = 5_000;

/**
 * Earliest mtime across e2e/.auth/*.json, minus SAFETY_MARGIN_MS, as an ISO
 * timestamp. Throws rather than guessing if the directory is empty/missing —
 * a wrong baseline could either hide a real leak (too late) or false-fail on
 * legitimate pre-existing data (too early), and global-setup ALWAYS
 * populates this directory before any spec runs, so its absence means
 * something upstream already went wrong and the whole run's result is
 * already suspect.
 */
export function resolveRunStartIso(authDir = path.resolve(process.cwd(), 'e2e/.auth')): string {
  let earliestMs: number | null = null;
  let files: string[];
  try {
    files = readdirSync(authDir).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }
  for (const f of files) {
    const { mtimeMs } = statSync(path.join(authDir, f));
    if (earliestMs === null || mtimeMs < earliestMs) earliestMs = mtimeMs;
  }
  if (earliestMs === null) {
    throw new Error(
      'global-teardown: no e2e/.auth/*.json storageState files found, so the leak sweep ' +
        'cannot compute a run-start baseline. global-setup.ts mints these fresh on every ' +
        'run — if it did not run (or ran somewhere unexpected), this run\'s result is ' +
        'already suspect. Refusing to guess a baseline rather than risk silently hiding ' +
        'a real leak or false-failing on legitimate pre-existing data.',
    );
  }
  return new Date(earliestMs - SAFETY_MARGIN_MS).toISOString();
}

export type Leak = { check: string; count: number; sample: string[]; detail: string };

/** Runs every leak probe against the given baseline. Pure aggregation — no throwing here (see globalTeardown). */
export async function runLeakSweep(sinceIso: string): Promise<Leak[]> {
  const leaks: Leak[] = [];

  const orphanedTxns = await findOrphanedEmployerTransactionsSince(sinceIso);
  if (orphanedTxns.count > 0) {
    leaks.push({
      check: 'orphaned employer transactions',
      count: orphanedTxns.count,
      sample: orphanedTxns.sampleIds,
      detail:
        "transactions with source='employer' and contribution_run_id IS NULL, created " +
        `at/after ${sinceIso} (A06-002 shape — cleanup deleted the contribution_runs ` +
        'header before the transactions that reference it, and ON DELETE SET NULL erased the link)',
    });
  }

  const settlementBatches = await findLeakedSettlementBatchesSince(sinceIso);
  if (settlementBatches.count > 0) {
    leaks.push({
      check: 'E2E-* settlement batches',
      count: settlementBatches.count,
      sample: settlementBatches.sampleIds,
      detail: `settlement_batches.txn_ref LIKE 'E2E-%', created at/after ${sinceIso}`,
    });
  }

  const testSubscribers = await findLeakedTestSubscribersSince(sinceIso);
  if (testSubscribers.count > 0) {
    leaks.push({
      check: 'tst-sub-* subscribers',
      count: testSubscribers.count,
      sample: testSubscribers.sampleIds,
      detail: `subscribers.id LIKE 'tst-sub-%', created at/after ${sinceIso}`,
    });
  }

  const settlementUploads = await findLeakedSettlementUploadsSince(sinceIso);
  if (settlementUploads.count > 0) {
    leaks.push({
      check: 'stray settlement_uploads',
      count: settlementUploads.count,
      sample: settlementUploads.sampleIds,
      detail: `settlement_uploads rows created at/after ${sinceIso}, still present at teardown`,
    });
  }

  const missingBalance = await findSubscribersMissingBalanceSince(sinceIso);
  if (missingBalance.count > 0) {
    leaks.push({
      check: 'subscribers missing subscriber_balances (A04-010 shape)',
      count: missingBalance.count,
      sample: missingBalance.sampleIds,
      detail: `subscribers created at/after ${sinceIso} with no subscriber_balances row`,
    });
  }

  // Bonus — see findLeakedTestBranchesSince's doc-comment (extends A25-004's
  // own suggested fix to branches using the mechanism this fix already owns;
  // does not close A25-004, which also needs work outside this write-set).
  const testBranches = await findLeakedTestBranchesSince(sinceIso);
  if (testBranches.count > 0) {
    leaks.push({
      check: 'TST/E2E-named branches (A25-004 shape)',
      count: testBranches.count,
      sample: testBranches.sampleIds,
      detail: `branches with id LIKE 'b-new-%' or name matching TST/E2E, created at/after ${sinceIso}`,
    });
  }

  return leaks;
}

/**
 * Pure decision + message-formatting logic, extracted so it can be exercised
 * directly with a fabricated `Leak[]` (no DB access, no live writes) — see
 * this agent's in-process verification. Returns null for a clean sweep, or
 * the full failure message otherwise. globalTeardown() below is a thin
 * wrapper: resolve the baseline, run the real probes, hand the result here,
 * log/throw based on what comes back.
 */
export function formatLeakFailure(leaks: Leak[], sinceIso: string): string | null {
  if (leaks.length === 0) return null;
  const summary = leaks
    .map((l) => `  - ${l.check}: ${l.count} row(s) — sample: ${l.sample.join(', ') || '(none captured)'}\n    ${l.detail}`)
    .join('\n');
  return (
    `[global-teardown] LEAK SWEEP FAILED — this run left ${leaks.length} kind(s) of residue ` +
    `in the live database that it did not clean up:\n${summary}\n` +
    `Baseline (run start, minus a ${SAFETY_MARGIN_MS}ms clock-skew margin): ${sinceIso}. ` +
    'Rows older than this are known pre-existing residue and are intentionally excluded — ' +
    'see docs/audits/2026-08-23/a04/phase2-emp-predicate.md (Phase 2 owns purging those).'
  );
}

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const sinceIso = resolveRunStartIso();
  const leaks = await runLeakSweep(sinceIso);

  const message = formatLeakFailure(leaks, sinceIso);
  if (message === null) {
    // eslint-disable-next-line no-console
    console.log(`[global-teardown] leak sweep clean — no residue created since ${sinceIso}.`);
    return;
  }

  // eslint-disable-next-line no-console
  console.error(message);
  throw new Error(message);
}
