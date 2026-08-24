import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SETTLEMENT_TEMPLATE_COLUMNS,
  REQUIRED_UPLOAD_COLUMNS,
  SETTLEMENT_SKIP_REASONS,
  buildTemplateRows,
  normalizeUploadedRows,
  partitionRowsByAgentScope,
  detectMissingColumns,
  describeSkippedReason,
  formatSettlementNotificationBody,
} from '../settlement';

describe('settlement utils', () => {
  describe('formatSettlementNotificationBody()', () => {
    it('formats the amount with thousands separators (BL-18)', () => {
      expect(formatSettlementNotificationBody(25000, 5)).toBe('UGX 25,000 paid for 5 commissions.');
      expect(formatSettlementNotificationBody(1200000, 9)).toBe('UGX 1,200,000 paid for 9 commissions.');
    });

    it('pluralizes correctly: "1 commission" vs "N commissions"', () => {
      expect(formatSettlementNotificationBody(5000, 1)).toBe('UGX 5,000 paid for 1 commission.');
      expect(formatSettlementNotificationBody(10000, 2)).toBe('UGX 10,000 paid for 2 commissions.');
    });

    it('rounds a stray fractional amount in the body', () => {
      expect(formatSettlementNotificationBody(5000.4, 1)).toBe('UGX 5,000 paid for 1 commission.');
    });
  });

  describe('describeSkippedReason() (BL-19)', () => {
    it('returns a label + concrete fix for every known reason', () => {
      // Both the client-side normalize reasons and the server-side RPC reasons
      // must carry an actionable fix sentence.
      for (const reason of [
        'missing_agent_id',
        'no_amount',
        'no_due',
        'amount_too_low',
        'not_your_agent',
      ]) {
        const { label, fix } = describeSkippedReason(reason);
        expect(label).toBeTruthy();
        expect(fix).toBeTruthy();
        expect(SETTLEMENT_SKIP_REASONS[reason]).toEqual({ label, fix });
      }
    });

    it('includes the server-only no_due / amount_too_low reasons', () => {
      // These never come from normalizeUploadedRows — only from apply_settlement.
      expect(describeSkippedReason('no_due').label).toBe('no outstanding dues');
      expect(describeSkippedReason('amount_too_low').label).toBe('amount below the oldest due line');
    });

    it('explains not_your_agent in plain language (A05-001)', () => {
      // Migration 0109's tenancy guard raises this, and the confirm modal
      // pre-blocks the same rows. Without an entry here the modal would render
      // the bare code `not_your_agent` at a distributor — the fallback branch.
      const { label, fix } = describeSkippedReason('not_your_agent');
      expect(label).toBe('not one of your agents');
      expect(fix).toMatch(/your own branches/i);
      // No jargon: the reason a distributor reads must not be the raw code.
      expect(label).not.toContain('_');
    });

    it('falls back to the raw reason as the label (empty fix) for an unknown code', () => {
      expect(describeSkippedReason('brand_new_reason')).toEqual({ label: 'brand_new_reason', fix: '' });
      expect(describeSkippedReason(undefined)).toEqual({ label: '', fix: '' });
    });
  });

  describe('buildTemplateRows()', () => {
    const pending = [
      { agentId: 'a-001', agentName: 'Diana Musinguzi', branchName: 'Kampala Central', pendingAmount: 45000, pendingCount: 9 },
      { agentId: 'a-002', agentName: 'Brian Okello', branchName: 'Gulu', pendingAmount: 10000, pendingCount: 2 },
    ];

    it('keys every row by the canonical template headers', () => {
      const [row] = buildTemplateRows(pending);
      expect(Object.keys(row).sort()).toEqual([...SETTLEMENT_TEMPLATE_COLUMNS].sort());
    });

    it('prefills identity + pending columns from the pending-dues data', () => {
      const rows = buildTemplateRows(pending);
      expect(rows[0]['Agent ID']).toBe('a-001');
      expect(rows[0]['Agent Name']).toBe('Diana Musinguzi');
      expect(rows[0]['Branch']).toBe('Kampala Central');
      expect(rows[0]['Pending Amount (UGX)']).toBe(45000);
      expect(rows[1]['Agent ID']).toBe('a-002');
      expect(rows[1]['Pending Amount (UGX)']).toBe(10000);
    });

    it('leaves the three fill-me columns blank', () => {
      const [row] = buildTemplateRows(pending);
      expect(row['Amount Paid (UGX)']).toBe('');
      expect(row['Payment Reference']).toBe('');
      expect(row['Payment Date']).toBe('');
    });

    it('returns an empty array for nullish / non-array input', () => {
      expect(buildTemplateRows(undefined)).toEqual([]);
      expect(buildTemplateRows(null)).toEqual([]);
    });
  });

  describe('detectMissingColumns()', () => {
    it('reports ok when every required header is present (order-independent)', () => {
      // Headers reordered + extra columns present — still ok.
      const result = detectMissingColumns([
        { 'Amount Paid (UGX)': 5000, 'Branch': 'Gulu', 'Agent ID': 'a-001' },
      ]);
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.found).toEqual(expect.arrayContaining(['Agent ID', 'Amount Paid (UGX)', 'Branch']));
    });

    it('flags a renamed Agent ID header and lists expected vs found (C2)', () => {
      // Distributor renamed "Agent ID" → "AgentID"; without this check every
      // row would skip with an opaque 'missing_agent_id'.
      const result = detectMissingColumns([
        { 'AgentID': 'a-001', 'Amount Paid (UGX)': 5000 },
      ]);
      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(['Agent ID']);
      expect(result.found).toContain('AgentID');
      expect(result.found).not.toContain('Agent ID');
    });

    it('flags multiple missing required columns at once', () => {
      const result = detectMissingColumns([{ 'Branch': 'Kampala', 'Notes': 'x' }]);
      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(REQUIRED_UPLOAD_COLUMNS);
      expect(result.found).toEqual(expect.arrayContaining(['Branch', 'Notes']));
    });

    it('unions header keys across rows (a header present on any row counts)', () => {
      const result = detectMissingColumns([
        { 'Agent ID': 'a-001' },
        { 'Amount Paid (UGX)': 5000 },
      ]);
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('treats empty / nullish / non-array input as all required columns missing', () => {
      expect(detectMissingColumns([])).toEqual({ ok: false, missing: REQUIRED_UPLOAD_COLUMNS, found: [] });
      expect(detectMissingColumns(null)).toEqual({ ok: false, missing: REQUIRED_UPLOAD_COLUMNS, found: [] });
      expect(detectMissingColumns(undefined)).toEqual({ ok: false, missing: REQUIRED_UPLOAD_COLUMNS, found: [] });
    });
  });

  describe('normalizeUploadedRows()', () => {
    it('keeps valid rows and coerces the fields', () => {
      const { rows, skipped } = normalizeUploadedRows([
        {
          'Agent ID': 'a-001',
          'Amount Paid (UGX)': 45000,
          'Payment Reference': '  MM-9931  ',
          'Payment Date': '2026-05-30',
        },
      ]);
      expect(skipped).toEqual([]);
      expect(rows).toEqual([
        { agentId: 'a-001', amountPaid: 45000, paymentRef: 'MM-9931', paymentDate: '2026-05-30' },
      ]);
    });

    it('skips a row with a missing / blank Agent ID', () => {
      const { rows, skipped } = normalizeUploadedRows([
        { 'Agent ID': '', 'Amount Paid (UGX)': 1000 },
        { 'Agent ID': '   ', 'Amount Paid (UGX)': 1000 },
      ]);
      expect(rows).toEqual([]);
      expect(skipped).toEqual([
        { agentId: null, reason: 'missing_agent_id' },
        { agentId: null, reason: 'missing_agent_id' },
      ]);
    });

    it('skips rows with a blank, zero, or non-numeric Amount Paid', () => {
      const { rows, skipped } = normalizeUploadedRows([
        { 'Agent ID': 'a-001', 'Amount Paid (UGX)': '' },
        { 'Agent ID': 'a-002', 'Amount Paid (UGX)': 0 },
        { 'Agent ID': 'a-003', 'Amount Paid (UGX)': 'abc' },
      ]);
      expect(rows).toEqual([]);
      expect(skipped).toEqual([
        { agentId: 'a-001', reason: 'no_amount' },
        { agentId: 'a-002', reason: 'no_amount' },
        { agentId: 'a-003', reason: 'no_amount' },
      ]);
    });

    it('parses formatted-string amounts ("1,200,000", "UGX 50,000", "20 000")', () => {
      const { rows } = normalizeUploadedRows([
        { 'Agent ID': 'a-001', 'Amount Paid (UGX)': '1,200,000' },
        { 'Agent ID': 'a-002', 'Amount Paid (UGX)': 'UGX 50,000' },
        { 'Agent ID': 'a-003', 'Amount Paid (UGX)': '20 000' },
      ]);
      expect(rows[0].amountPaid).toBe(1200000);
      expect(rows[1].amountPaid).toBe(50000);
      expect(rows[2].amountPaid).toBe(20000);
    });

    it('skips a formula or scientific-notation cell instead of inventing an amount (A05-011)', () => {
      // Excel hands back the literal string for a cell it stored as a formula.
      // The old parser deleted every character outside [\d.-] and parsed the
      // remainder, so "=1+1" settled UGX 11 and "1e9" settled UGX 19 — amounts
      // a distributor could never tell apart from a rejected row.
      const { rows, skipped } = normalizeUploadedRows([
        { 'Agent ID': 'a-001', 'Amount Paid (UGX)': '=1+1' },
        { 'Agent ID': 'a-002', 'Amount Paid (UGX)': '1e9' },
        { 'Agent ID': 'a-003', 'Amount Paid (UGX)': '=SUM(B2:B9)' },
        { 'Agent ID': 'a-004', 'Amount Paid (UGX)': '-5' },
      ]);
      expect(rows).toEqual([]);
      expect(skipped).toEqual([
        { agentId: 'a-001', reason: 'no_amount' },
        { agentId: 'a-002', reason: 'no_amount' },
        { agentId: 'a-003', reason: 'no_amount' },
        { agentId: 'a-004', reason: 'no_amount' },
      ]);
    });

    it('rounds fractional amounts to whole UGX (BL-8 — no fractional shillings)', () => {
      const { rows } = normalizeUploadedRows([
        { 'Agent ID': 'a-001', 'Amount Paid (UGX)': '45,000.50' },
        { 'Agent ID': 'a-002', 'Amount Paid (UGX)': 45000.49 },
      ]);
      expect(rows[0].amountPaid).toBe(45001);
      expect(rows[1].amountPaid).toBe(45000);
      // Integers only — never a fractional shilling reaches the RPC.
      rows.forEach((r) => expect(Number.isInteger(r.amountPaid)).toBe(true));
    });

    it('coerces an Excel serial number date to YYYY-MM-DD', () => {
      // Serial 46172 = 2026-05-30 (25569 + days since Unix epoch).
      const { rows } = normalizeUploadedRows([
        { 'Agent ID': 'a-001', 'Amount Paid (UGX)': 1000, 'Payment Date': 46172 },
      ]);
      expect(rows[0].paymentDate).toBe('2026-05-30');
    });

    it('keeps a YYYY-MM-DD string date as-is and blanks unparseable / empty dates', () => {
      const { rows } = normalizeUploadedRows([
        { 'Agent ID': 'a-001', 'Amount Paid (UGX)': 1000, 'Payment Date': '2026-01-15' },
        { 'Agent ID': 'a-002', 'Amount Paid (UGX)': 1000, 'Payment Date': '' },
        { 'Agent ID': 'a-003', 'Amount Paid (UGX)': 1000, 'Payment Date': 'not-a-date' },
      ]);
      expect(rows[0].paymentDate).toBe('2026-01-15');
      expect(rows[1].paymentDate).toBe('');
      expect(rows[2].paymentDate).toBe('');
    });

    it('defaults a missing Payment Reference to an empty string', () => {
      const { rows } = normalizeUploadedRows([
        { 'Agent ID': 'a-001', 'Amount Paid (UGX)': 1000 },
      ]);
      expect(rows[0].paymentRef).toBe('');
    });

    it('returns empty results for nullish / non-array input', () => {
      expect(normalizeUploadedRows(undefined)).toEqual({ rows: [], skipped: [] });
      expect(normalizeUploadedRows(null)).toEqual({ rows: [], skipped: [] });
    });
  });

  describe('partitionRowsByAgentScope() (A05-001)', () => {
    const own = ['a-001', 'a-002'];
    const row = (agentId, amountPaid = 5000) => ({
      agentId, amountPaid, paymentRef: 'MM-1', paymentDate: '2026-08-25',
    });

    it("refuses a row for another distributor's agent", () => {
      // The audit's exploit, at the client seam: a hand-edited sheet carrying
      // a-780 (owned by d-002) uploaded by d-001. It used to be submitted with
      // no mismatch and no skip — a plain green Confirm that settled someone
      // else's commissions.
      const { rows, skipped } = partitionRowsByAgentScope(
        [row('a-001'), row('a-780', 15000)],
        own,
      );
      expect(rows).toEqual([row('a-001')]);
      expect(skipped).toEqual([{ agentId: 'a-780', reason: 'not_your_agent' }]);
    });

    it('keeps every own-agent row untouched', () => {
      const input = [row('a-001'), row('a-002', 9000)];
      const { rows, skipped } = partitionRowsByAgentScope(input, own);
      expect(rows).toEqual(input);
      expect(skipped).toEqual([]);
    });

    it('refuses an Agent ID that matches nobody (no existence probe)', () => {
      // "Not yours" and "doesn't exist" must be indistinguishable, or the
      // upload becomes a way to enumerate other distributors' agent ids.
      const { rows, skipped } = partitionRowsByAgentScope([row('a-nobody')], own);
      expect(rows).toEqual([]);
      expect(skipped).toEqual([{ agentId: 'a-nobody', reason: 'not_your_agent' }]);
    });

    it('accepts a Set as well as an array', () => {
      const { rows } = partitionRowsByAgentScope([row('a-002')], new Set(own));
      expect(rows).toHaveLength(1);
    });

    it('blocks nothing while the roster is unknown (null) — the RPC still guards', () => {
      // Refusing rows because a fetch was in flight would break a legitimate
      // settlement. 0109 rejects a foreign agent server-side regardless.
      const input = [row('a-001'), row('a-780')];
      expect(partitionRowsByAgentScope(input, null)).toEqual({ rows: input, skipped: [] });
      expect(partitionRowsByAgentScope(input, undefined)).toEqual({ rows: input, skipped: [] });
    });

    it('refuses everything against an empty roster', () => {
      const { rows, skipped } = partitionRowsByAgentScope([row('a-001')], []);
      expect(rows).toEqual([]);
      expect(skipped).toEqual([{ agentId: 'a-001', reason: 'not_your_agent' }]);
    });

    it('returns empty results for nullish / non-array rows', () => {
      expect(partitionRowsByAgentScope(undefined, own)).toEqual({ rows: [], skipped: [] });
      expect(partitionRowsByAgentScope(null, own)).toEqual({ rows: [], skipped: [] });
    });

    it('only ever emits a reason SETTLEMENT_SKIP_REASONS can explain', () => {
      const { skipped } = partitionRowsByAgentScope([row('a-780')], own);
      for (const s of skipped) expect(SETTLEMENT_SKIP_REASONS[s.reason]).toBeDefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Migration contract — the tenancy guard inside `apply_settlement` (A05-001).
//
// `apply_settlement` is the ONE write on the commission surface that moves
// money. Until 0109 it gated on the caller's role alone
// (`IF v_role NOT IN ('distributor','admin')`) and then trusted the
// caller-supplied `agentId` verbatim, so any distributor could mark ANOTHER
// distributor's commissions paid, stamp them with a payment reference that
// distributor never issued, and drop a settlement_batches row into the
// victim's branch. Proven live: d-002 settled a-001, whose branch belongs to
// d-001. Every commission READ had been bounded by the 0081-0089 series; this
// write had not.
//
// The regression is INVISIBLE at the call site — the RPC returns a healthy
// {"agentsSettled":1,...} and RLS then hides the rows from their own author —
// so nothing about a normal run would reveal a lost predicate. And
// CREATE OR REPLACE overwrites rather than merges: the 0095-over-0090 incident
// deleted a security-critical write exactly this way and shipped to prod.
//
// This asserts the NEWEST forward definition still carries the guard, so a
// later migration that rewrites the function from an older body fails here
// instead of in production.
// ─────────────────────────────────────────────────────────────────────────────
const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);

function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

// Forward migrations only. A `.down.sql` deliberately restores the older,
// unguarded body, so asserting against one would fail by design.
const forwardMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort();

/**
 * The last forward migration that (re)defines `fnName`, plus just that
 * definition's text — sliced from its CREATE to the next CREATE FUNCTION in the
 * file, so an unrelated function later in the same migration can't satisfy the
 * assertion on its behalf.
 */
function latestDefinitionOf(fnName) {
  const create = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`,
    'i',
  );
  const anyCreate = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s/gi;

  for (const file of [...forwardMigrations].reverse()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    const start = sql.search(create);
    if (start === -1) continue;
    anyCreate.lastIndex = start + 1;
    const next = anyCreate.exec(sql);
    return { file, body: sql.slice(start, next ? next.index : undefined) };
  }
  return null;
}

const LOST_GUARD_MESSAGE =
  'holds the newest definition of apply_settlement, and it no longer bounds a ' +
  'distributor to their own agents.\n\n' +
  'That re-opens A05-001: any distributor can settle ANY other distributor\'s ' +
  'agents — marking their commissions paid, stamping a payment reference they ' +
  'never issued, notifying their agents and branches, and writing a ' +
  'settlement_batches row into their branch. RLS hides the write from its own ' +
  'author, so nothing errors and nobody sees it until the victim\'s dashboard ' +
  'shows money as settled that was never paid.\n\n' +
  'If you rewrote this function with CREATE OR REPLACE, you overwrote the ' +
  'guard rather than merging it (the same way 0095 overwrote 0090). Re-add, ' +
  'inside the per-row loop:\n\n' +
  "  IF v_role = 'distributor'\n" +
  '     AND NOT EXISTS (SELECT 1 FROM public.agents a\n' +
  '                      WHERE a.id = v_agent_id\n' +
  '                        AND a.branch_id IN (SELECT public.distributor_branch_ids()))\n' +
  '  THEN ... skip with reason \'not_your_agent\'; CONTINUE; END IF;\n\n' +
  'See supabase/migrations/0109_settlement_tenancy.sql.';

describe('apply_settlement tenancy contract across migrations (A05-001)', () => {
  it('discovers forward migration files', () => {
    expect(forwardMigrations.length).toBeGreaterThan(0);
  });

  it('the newest apply_settlement bounds a distributor to their own agents', () => {
    const found = latestDefinitionOf('apply_settlement');
    expect(found, 'no migration defines apply_settlement').not.toBeNull();

    // The ownership source of truth (0081) — agents -> branches -> distributor.
    expect(found.body, `${found.file} ${LOST_GUARD_MESSAGE}`).toContain(
      'distributor_branch_ids',
    );
    // Foreign rows must be SKIPPED with a reason the UI can explain, never
    // silently dropped and never fatal to the rest of the batch.
    expect(found.body, `${found.file} ${LOST_GUARD_MESSAGE}`).toContain('not_your_agent');
  });

  it('every skip reason the RPC can emit has a plain-language explanation', () => {
    // A reason string in the SQL with no SETTLEMENT_SKIP_REASONS entry renders
    // as the raw code (the describeSkippedReason fallback) at a distributor.
    const found = latestDefinitionOf('apply_settlement');
    const reasons = [...found.body.matchAll(/'reason',\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of new Set(reasons)) {
      expect(
        SETTLEMENT_SKIP_REASONS[reason],
        `apply_settlement can skip a row with reason '${reason}', but ` +
          'SETTLEMENT_SKIP_REASONS has no entry for it — the confirm modal would ' +
          `show the distributor the bare code '${reason}'.`,
      ).toBeDefined();
    }
  });
});
