// Settlement template + upload glue — the pure transform layer between the
// distributor commission panel and the `.xlsx` util (`src/utils/xlsx.js`).
//
// Flow: distributor pays agents offline → downloads a prefilled template
// (one row per agent with a pending due, identity + pending columns filled,
// the three "fill-me" columns blank) → enters Amount Paid + reference (+ an
// optional date) → re-uploads. `parseSheet` turns the workbook back into row
// objects keyed by header; `normalizeUploadedRows` validates + coerces those
// into the `applySettlementUpload` input shape.
//
// Everything here is pure (no DOM, no React, no network) so it unit-tests
// cleanly and keeps the panel thin.
//
// Money parsing is delegated to the canonical `parseAmount` in
// `src/utils/finance.js` (BL-8 / M-C1): it strips grouping/currency, parses
// any decimals, and rounds to a whole-UGX integer (UGX is zero-decimal). This
// module previously carried its own divergent copy that preserved fractional
// shillings; reconciling to one parser keeps `commissions.paid_amount` /
// `settlement_batches.paid_amount` / notification bodies integer-clean.

import { parseAmount } from './finance';
import { formatNumber } from './currency';

/**
 * Build the canonical "Commission settled" notification body (BL-18).
 *
 * One source of truth for the string the agent/branch sees in the feed:
 *   `UGX 25,000 paid for 5 commissions.`  (thousands separators + correct
 *   pluralization — "1 commission" vs "N commissions").
 *
 * Mirrored verbatim by the `apply_settlement` RPC's server-side `to_char`
 * builder (migration 0032), so live and mock modes read identically. Callers
 * pass a whole-UGX integer (already rounded via `parseAmount`); we round again
 * defensively so a stray float never reaches the body.
 *
 * @param {number} amount whole-UGX integer
 * @param {number} lineCount number of commission lines settled
 * @returns {string}
 */
export function formatSettlementNotificationBody(amount, lineCount) {
  const count = Number(lineCount) || 0;
  const unit = count === 1 ? 'commission' : 'commissions';
  return `UGX ${formatNumber(amount)} paid for ${formatNumber(count)} ${unit}.`;
}

/**
 * Human-readable label + concrete fix for every settlement skip reason — both
 * the client-side ones from {@link normalizeUploadedRows} ('missing_agent_id',
 * 'no_amount') and the server-side ones from the `apply_settlement` RPC
 * ('no_due', 'amount_too_low', 'not_your_agent'). One source of truth so the
 * confirm modal and the post-settlement toast read identically and every skip
 * carries a fix path instead of a one-word reason (BL-19).
 *
 * `label` is a terse noun phrase ("no Amount Paid"); `fix` is an actionable
 * sentence the distributor can follow ("Enter the amount paid in the
 * 'Amount Paid (UGX)' column.").
 */
export const SETTLEMENT_SKIP_REASONS = {
  missing_agent_id: {
    label: 'missing Agent ID',
    fix: "Keep the 'Agent ID' column from the template — don't blank or rename it.",
  },
  no_amount: {
    label: 'no Amount Paid',
    fix: "Enter a number in the 'Amount Paid (UGX)' column for this agent.",
  },
  no_due: {
    label: 'no outstanding dues',
    fix: 'This agent has no due commissions left to settle — leave them out.',
  },
  amount_too_low: {
    label: 'amount below the oldest due line',
    fix: "Raise 'Amount Paid (UGX)' to at least cover the agent's oldest due commission.",
  },
  // A05-001. Raised by migration 0109's ownership guard inside apply_settlement
  // when a distributor uploads a row for an agent whose branch belongs to
  // someone else — and by the confirm modal, which blocks those rows before
  // they can be submitted at all. Also covers an Agent ID that matches nobody,
  // deliberately: "not yours" and "doesn't exist" must read the same so the
  // upload can't be used to probe for other distributors' agent ids.
  not_your_agent: {
    label: 'not one of your agents',
    fix: 'You can only settle agents in your own branches. Remove this row, then download a fresh template.',
  },
};

/**
 * Resolve a skip reason to its `{ label, fix }`. Falls back to the raw reason as
 * the label (and an empty fix) for an unknown code, so a new RPC reason never
 * renders blank.
 *
 * @param {string} reason
 * @returns {{ label: string, fix: string }}
 */
export function describeSkippedReason(reason) {
  return SETTLEMENT_SKIP_REASONS[reason] || { label: String(reason ?? ''), fix: '' };
}

/**
 * Column headers for the settlement template, in display order. The first
 * four are prefilled (identity + pending); the last three are blank for the
 * distributor to fill before re-uploading.
 */
export const SETTLEMENT_TEMPLATE_COLUMNS = [
  'Agent ID',
  'Agent Name',
  'Branch',
  'Pending Amount (UGX)',
  'Amount Paid (UGX)',
  'Payment Reference',
  'Payment Date',
];

/**
 * The columns a re-uploaded settlement sheet MUST carry for a row to be
 * settleable. 'Agent ID' identifies the agent; 'Amount Paid (UGX)' is the
 * value the distributor fills. The other template columns are prefilled /
 * optional and their absence does not block a settlement.
 */
export const REQUIRED_UPLOAD_COLUMNS = ['Agent ID', 'Amount Paid (UGX)'];

/**
 * Detect renamed / reordered / missing column headers BEFORE row validation
 * (C2 / column-mapping feedback). When a distributor renames or drops a header
 * the per-row pass would otherwise skip every row with an opaque
 * 'missing_agent_id' / 'no_amount' reason — this surfaces the *real* cause:
 * which expected columns were not found, and which headers the file actually
 * carried.
 *
 * Header detection is order-independent (a reordered sheet is fine) and reads
 * the keys present on the parsed rows, since `parseSheet` returns objects keyed
 * by the header row.
 *
 * @param {Array<Record<string, unknown>>} rawRows — rows from `parseSheet`.
 * @returns {{ ok: boolean, missing: string[], found: string[] }}
 *   `ok` is true when every {@link REQUIRED_UPLOAD_COLUMNS} header is present.
 *   `missing` lists the required headers not found; `found` lists every header
 *   the file actually carried (for the "expected vs found" message).
 */
export function detectMissingColumns(rawRows) {
  const list = Array.isArray(rawRows) ? rawRows : [];
  // Union of keys across rows — a header is "present" if any row carries it.
  const found = new Set();
  for (const row of list) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) found.add(key);
    }
  }
  const missing = REQUIRED_UPLOAD_COLUMNS.filter((col) => !found.has(col));
  return { ok: missing.length === 0, missing, found: [...found] };
}

/**
 * Build prefilled template row objects keyed by {@link SETTLEMENT_TEMPLATE_COLUMNS}.
 * Identity + pending columns are filled from the per-agent pending-dues data;
 * the three fill-me columns ('Amount Paid (UGX)', 'Payment Reference',
 * 'Payment Date') start blank.
 *
 * @param {Array<{agentId: string, agentName: string, branchName: string, pendingAmount: number}>} pendingByAgent
 * @returns {Array<Record<string, string|number>>}
 */
export function buildTemplateRows(pendingByAgent) {
  const list = Array.isArray(pendingByAgent) ? pendingByAgent : [];
  return list.map((agent) => ({
    'Agent ID': agent?.agentId ?? '',
    'Agent Name': agent?.agentName ?? '',
    'Branch': agent?.branchName ?? '',
    'Pending Amount (UGX)': agent?.pendingAmount ?? 0,
    'Amount Paid (UGX)': '',
    'Payment Reference': '',
    'Payment Date': '',
  }));
}

/**
 * Normalize parsed sheet rows (objects keyed by header string, as produced by
 * `parseSheet`) into the `applySettlementUpload` input.
 *
 * Rules:
 *   - Keep a row only when 'Agent ID' is present AND 'Amount Paid (UGX)' parses
 *     to a whole-UGX integer > 0 (via the canonical `parseAmount`).
 *   - Missing/blank Agent ID → skipped with reason 'missing_agent_id'.
 *   - Blank / zero / non-numeric Amount Paid → skipped with reason 'no_amount'.
 *   - amountPaid = whole-UGX integer; paymentRef = trimmed String; paymentDate
 *     coerced to a 'YYYY-MM-DD' string (or '' when blank/unparseable — the
 *     backend defaults to today).
 *
 * @param {Array<Record<string, unknown>>} rawRows
 * @returns {{ rows: Array<{agentId: string, amountPaid: number, paymentRef: string, paymentDate: string}>,
 *             skipped: Array<{agentId: string|null, reason: string}> }}
 */
export function normalizeUploadedRows(rawRows) {
  const list = Array.isArray(rawRows) ? rawRows : [];
  const rows = [];
  const skipped = [];

  for (const raw of list) {
    const agentId = String(raw?.['Agent ID'] ?? '').trim();
    if (!agentId) {
      skipped.push({ agentId: null, reason: 'missing_agent_id' });
      continue;
    }

    // Canonical parse → whole-UGX integer, or null for blank / zero / negative
    // / non-numeric. `parseAmount` rejects rather than coerces (A05-011): a
    // formula cell ("=1+1") or scientific notation ("1e9") is null here, not a
    // plausible-looking UGX 11 / UGX 19. A null means the cell can't settle.
    const amountPaid = parseAmount(raw?.['Amount Paid (UGX)']);
    if (amountPaid == null) {
      skipped.push({ agentId, reason: 'no_amount' });
      continue;
    }

    rows.push({
      agentId,
      amountPaid,
      paymentRef: String(raw?.['Payment Reference'] ?? '').trim(),
      paymentDate: coerceDate(raw?.['Payment Date']),
    });
  }

  return { rows, skipped };
}

/**
 * Split normalized upload rows into the ones the signed-in distributor may
 * actually submit and the ones to refuse as 'not_your_agent' (A05-001).
 *
 * A settlement sheet is hand-edited in Excel, so nothing stops a distributor
 * typing in an Agent ID that belongs to a DIFFERENT distributor. Until
 * migration 0109, `apply_settlement` gated on the caller's role alone and
 * settled that row: another distributor's commissions were marked paid,
 * stamped with a payment reference they never issued, and a settlement batch
 * landed in their branch — invisibly, because RLS then hid the rows from the
 * person who wrote them. 0109 is the real fix. This is the front half: a
 * foreign id is dropped from the payload and named in the confirm modal, so
 * the distributor sees WHY instead of watching a settlement quietly do nothing.
 *
 * `ownAgentIds` must be every agent id the caller can settle for — the union of
 * their pending-dues list and their commission roster, both already scoped to
 * the caller server-side. Pass `null` when that list hasn't loaded yet: this
 * function then blocks nothing and leaves the decision entirely to the RPC,
 * rather than refusing legitimate rows because a fetch was still in flight.
 *
 * An id that matches nobody at all is also 'not_your_agent', deliberately: the
 * upload must not double as a probe for which agent ids exist elsewhere.
 *
 * @param {Array<{agentId: string}>} rows normalized rows from {@link normalizeUploadedRows}
 * @param {Iterable<string> | null | undefined} ownAgentIds ids the caller may settle, or null when unknown
 * @returns {{ rows: Array<object>, skipped: Array<{agentId: string, reason: 'not_your_agent'}> }}
 */
export function partitionRowsByAgentScope(rows, ownAgentIds) {
  const list = Array.isArray(rows) ? rows : [];
  // Roster not loaded — pre-block nothing; the RPC's 0109 guard still holds.
  if (ownAgentIds == null) return { rows: [...list], skipped: [] };

  const own = ownAgentIds instanceof Set ? ownAgentIds : new Set(ownAgentIds);
  const kept = [];
  const skipped = [];
  for (const row of list) {
    if (own.has(row?.agentId)) kept.push(row);
    else skipped.push({ agentId: row?.agentId ?? null, reason: 'not_your_agent' });
  }
  return { rows: kept, skipped };
}

// Excel's epoch is 1899-12-30; serial 25569 maps to the Unix epoch
// (1970-01-01). `parseSheet` reads without `cellDates`, so date cells can
// arrive as serial numbers.
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86400 * 1000;
const YMD_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * Coerce a 'Payment Date' cell into a 'YYYY-MM-DD' string, or '' when blank /
 * unparseable. A cell may be:
 *   - a 'YYYY-MM-DD'(-ish) string → kept (sliced to 10 chars);
 *   - a JS Date → ISO date slice;
 *   - an Excel serial number → converted via the Excel epoch;
 *   - anything else / empty → ''.
 */
function coerceDate(value) {
  if (value == null || value === '') return '';

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    const ms = Math.round((value - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  const str = String(value).trim();
  if (YMD_RE.test(str)) return str.slice(0, 10);

  // Last-ditch: let Date try to parse other string forms (e.g. "8 Apr 2026").
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}
