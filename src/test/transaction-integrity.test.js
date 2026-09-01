// Migration contract for the ledger guard and the reversal path — 0148
// (Phase 7 of the unitization redesign).
//
// Every money trigger in this schema fires on INSERT and only on INSERT, so the
// ledger and the book agree only while nobody UPDATEs or DELETEs a transaction.
// Nothing enforced that before 0148. The three things below must survive every
// future re-emission:
//
//   1. The guard trigger exists and is wired to BEFORE UPDATE OR DELETE. A
//      guard that is defined but not attached is worse than none, because it
//      reads as protection in review.
//
//   2. reverse_transaction() unwinds at the row's OWN struck price. Reversing
//      at a current price hands back a different number of units than were
//      issued, and the difference is a silent transfer between the member and
//      every other unit holder.
//
//   3. Both money triggers stay narrowed to `units_delta IS NULL`. That clause
//      is what stops the compensating row a reversal writes from firing the
//      contribution trigger and applying the reversal a SECOND time. It lives
//      in a CREATE TRIGGER rather than a function body precisely so a
//      re-emission of the body cannot drop it — but a re-emission of the
//      TRIGGER still could, so it is pinned here.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

function forwardMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !/ \d+\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort();
}

function newestDefinitionOf(fnName) {
  const files = forwardMigrations();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, files[i]), 'utf8'));
    const start = body.search(
      new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`, 'i'),
    );
    if (start === -1) continue;
    const rest = body.slice(start);
    const end = rest.search(/\$(?:function)?\$\s*;/);
    return { file: files[i], body: end === -1 ? rest : rest.slice(0, end) };
  }
  return null;
}

/** Every forward migration concatenated, comments stripped. */
function allSql() {
  return forwardMigrations()
    .map((f) => stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')))
    .join('\n');
}

describe('transaction mutation guard', () => {
  it('is defined by some migration', () => {
    expect(newestDefinitionOf('trg_transactions_guard_mutation')).not.toBeNull();
  });

  it('is attached BEFORE UPDATE OR DELETE on transactions', () => {
    // A guard function nobody calls reads as protection in review and provides
    // none, which is worse than having neither.
    expect(
      /CREATE\s+TRIGGER\s+transactions_guard_mutation\s+BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.transactions/i
        .test(allSql()),
    ).toBe(true);
  });

  it('refuses to let a settled figure be rewritten', () => {
    const def = newestDefinitionOf('trg_transactions_guard_mutation');
    for (const col of ['amount', 'subscriber_id', 'units_delta', 'unit_price_applied']) {
      expect(def.body.includes(col), `the guard does not protect ${col}`).toBe(true);
    }
    expect(/ERRCODE\s*=\s*'P0001'/i.test(def.body)).toBe(true);
  });

  it('still allows a NULL figure to be filled in', () => {
    const def = newestDefinitionOf('trg_transactions_guard_mutation');
    // The synchronous contribution trigger stamps unit_price_applied and
    // units_delta immediately after the insert, on a row already marked
    // 'priced'. Blocking that breaks EVERY contribution while the pricing kill
    // switch is off — measured, not theorised.
    expect(
      /OLD\.units_delta\s+IS\s+NOT\s+NULL/i.test(def.body),
      'the guard blocks NULL -> value, which breaks the synchronous pricing path',
    ).toBe(true);
    expect(/OLD\.unit_price_applied\s+IS\s+NOT\s+NULL/i.test(def.body)).toBe(true);
  });

  it('leaves `date` editable so the re-anchoring migrations keep working', () => {
    const def = newestDefinitionOf('trg_transactions_guard_mutation');
    // 0134, 0135 and 0138 rewrite demo dates. `date` must not be in the
    // protected list; `received_at` — the immutable receipt instant — must be.
    expect(/NEW\.date\s+IS\s+DISTINCT\s+FROM\s+OLD\.date/i.test(def.body)).toBe(false);
    expect(/NEW\.received_at\s+IS\s+DISTINCT\s+FROM\s+OLD\.received_at/i.test(def.body)).toBe(true);
  });

  it('has a deliberate, greppable override rather than a silent one', () => {
    const def = newestDefinitionOf('trg_transactions_guard_mutation');
    expect(/app\.allow_transaction_mutation/.test(def.body)).toBe(true);
  });
});

describe('reverse_transaction', () => {
  it('is defined and admin-gated', () => {
    const def = newestDefinitionOf('reverse_transaction');
    expect(def, 'reverse_transaction() is not defined by any migration').not.toBeNull();
    expect(/->>\s*'app_role'/.test(def.body)).toBe(true);
    expect(/'admin'/.test(def.body)).toBe(true);
  });

  it('unwinds at the row’s OWN struck price, never a current one', () => {
    const def = newestDefinitionOf('reverse_transaction');
    // Reversing at today's price returns a different number of units than were
    // issued; the difference is a silent transfer between this member and every
    // other unit holder. units_delta / unit_price_applied exist for this.
    expect(/unit_price_applied/.test(def.body)).toBe(true);
    expect(/units_delta/.test(def.body)).toBe(true);
    expect(
      /latest_nav\s*\(|nav_for_date\s*\(|nav_price_row\s*\(/.test(def.body),
      'reverse_transaction() reads a price function — it must use the row’s own struck price',
    ).toBe(false);
  });

  it('resyncs bucket units', () => {
    const def = newestDefinitionOf('reverse_transaction');
    // Deferrable constraint trigger: skip this and the transaction aborts at
    // COMMIT with 23514.
    expect(/_resync_bucket_units/.test(def.body)).toBe(true);
  });

  it('keeps the ledger append-only with a compensating row', () => {
    const def = newestDefinitionOf('reverse_transaction');
    expect(/INSERT\s+INTO\s+public\.transactions/i.test(def.body)).toBe(true);
    expect(/'reversed'/.test(def.body)).toBe(true);
  });

  it('is revoked from PUBLIC and anon', () => {
    expect(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.reverse_transaction\s*\(/i.test(allSql()),
    ).toBe(true);
  });
});

describe('a row that arrives already accounted for is not accounted for twice', () => {
  it('both money triggers are narrowed to units_delta IS NULL', () => {
    const sql = allSql();
    // reverse_transaction writes a compensating row of the SAME TYPE with the
    // amount negated. Without this clause that row fires the contribution
    // trigger and applies the reversal a second time.
    const contribution = sql.match(
      /CREATE\s+TRIGGER\s+transactions_after_insert_contribution[\s\S]*?EXECUTE\s+FUNCTION/gi,
    );
    const withdrawal = sql.match(
      /CREATE\s+TRIGGER\s+transactions_after_insert_withdrawal[\s\S]*?EXECUTE\s+FUNCTION/gi,
    );
    expect(contribution, 'no contribution trigger found').not.toBeNull();
    expect(withdrawal, 'no withdrawal trigger found').not.toBeNull();
    expect(
      /units_delta\s+IS\s+NULL/i.test(contribution.at(-1)),
      'the newest contribution trigger does not exclude pre-priced rows',
    ).toBe(true);
    expect(
      /units_delta\s+IS\s+NULL/i.test(withdrawal.at(-1)),
      'the newest withdrawal trigger does not exclude pre-priced rows',
    ).toBe(true);
  });
});

describe('reversibility', () => {
  it('0148 ships a paired .down.sql', () => {
    const files = readdirSync(MIGRATIONS_DIR);
    const forward = files.find(
      (f) => f.startsWith('0148') && f.endsWith('.sql') && !f.endsWith('.down.sql'),
    );
    expect(forward, 'no forward migration 0148').toBeDefined();
    expect(files.includes(forward.replace(/\.sql$/, '.down.sql'))).toBe(true);
  });
});
