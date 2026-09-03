// Contract test for the admin Needs-attention RPCs.
//
// Both `get_admin_attention()` (the badge) and `get_admin_attention_rows()`
// (the drill-down) decide independently which records are outstanding. Every
// bug this area has produced is the same shape — the two definitions drifting
// apart, or a row being listed that the list cannot describe:
//
//   A04-007  the NAV badge counted pre-seeded 'pending' rows while the list
//            enumerated every unsigned weekday. 0116 pointed both at one helper.
//   0163     an employer that had never posted a run was counted and listed,
//            then had Raised / Due by / Days late all NULL, because they were
//            derived from a previous run it did not have.
//
// So these assert on the SQL text of the newest definition of each function:
// cheap, and they fail the moment a later migration re-emits one of them from a
// stale copy — which is exactly how 0095 silently dropped 0090's work.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../supabase/migrations');

function stripSqlComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

/** Forward migrations only, oldest → newest. */
function forwardMigrations() {
  // `!/ \d+\.sql$/` — folder-sync conflict copies ("0110_purge 2.sql") also end
  // in .sql, and would change which body is judged newest.
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !/ \d+\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort();
}

/** Body of the LAST migration that defines `fnName`, comments stripped. */
function newestDefinitionOf(fnName) {
  const files = forwardMigrations();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, files[i]), 'utf8'));
    const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`, 'i');
    const start = body.search(re);
    if (start === -1) continue;
    const rest = body.slice(start);
    const end = rest.search(/\$(?:function)?\$\s*;/);
    return { file: files[i], body: end === -1 ? rest : rest.slice(0, end) };
  }
  return null;
}

describe('admin Needs-attention contract', () => {
  const count = () => newestDefinitionOf('get_admin_attention');
  const rows = () => newestDefinitionOf('get_admin_attention_rows');

  it('both functions are still defined somewhere', () => {
    expect(count()).toBeTruthy();
    expect(rows()).toBeTruthy();
  });

  describe('delayed employer transfers', () => {
    // The anchor is the whole fix: "when was a run first owed". The badge and
    // the list must compute it identically or they report different employers.
    const ANCHOR = /COALESCE\(\s*lr\.last_run::date\s*,\s*fm\.first_member\s*\)/;

    it('the badge counts on the first-member anchor', () => {
      expect(ANCHOR.test(count().body)).toBe(true);
    });

    it('the list selects on the same anchor, so the two cannot disagree', () => {
      expect(ANCHOR.test(rows().body)).toBe(true);
    });

    it('never reintroduces the null days-late branch', () => {
      // `CASE WHEN lr.last_run IS NULL THEN NULL` is the original defect: it is
      // what emptied Due by and Days late on the most overdue rows.
      expect(
        /CASE\s+WHEN\s+lr\.last_run\s+IS\s+NULL\s+THEN\s+NULL/i.test(rows().body),
        'days-late fell back to NULL for a never-run employer again',
      ).toBe(false);
    });

    it('does not flag an employer with neither a run nor a member', () => {
      // Nobody to pay means nothing owed. Without this guard such an employer is
      // permanently overdue for a payroll it never owed.
      expect(/COALESCE\(lr\.last_run::date, fm\.first_member\)\s*IS NOT NULL/i.test(count().body))
        .toBe(true);
    });

    it('ranks most overdue first, which is what the tile claims', () => {
      // The old `ORDER BY lr.last_run NULLS FIRST` could not rank never-run
      // employers against each other at all.
      expect(/ORDER BY lr\.last_run NULLS FIRST/i.test(rows().body)).toBe(false);
    });

    it('flags a never-run employer so the client need not infer it from nulls', () => {
      expect(/'neverRun'/.test(rows().body)).toBe(true);
    });

    it('0164 keeps a restore point before it credits any units', () => {
      // It is the one irreversible-looking step in this set: the money trigger
      // credits units on insert and nothing recomputes balances on delete, so
      // the down migration has to restore them wholesale. 0105's rule.
      const files = readdirSync(MIGRATIONS_DIR);
      const up = files.find((f) => f.startsWith('0164') && !f.endsWith('.down.sql'));
      const down = files.find((f) => f.startsWith('0164') && f.endsWith('.down.sql'));
      expect(up, 'no forward migration 0164').toBeDefined();
      expect(down, 'no down migration 0164').toBeDefined();

      const upBody = readFileSync(join(MIGRATIONS_DIR, up), 'utf8');
      const downBody = readFileSync(join(MIGRATIONS_DIR, down), 'utf8');
      expect(/subscriber_balances_pre_0164/.test(upBody)).toBe(true);
      expect(/subscriber_balances_pre_0164/.test(downBody)).toBe(true);
      // And the down must refuse rather than half-unwind if it is missing.
      expect(/RAISE EXCEPTION/.test(downBody)).toBe(true);
    });
  });

  describe('reversibility', () => {
    for (const n of ['0162', '0163', '0164']) {
      it(`${n} ships a paired .down.sql`, () => {
        const files = readdirSync(MIGRATIONS_DIR);
        const forward = forwardMigrations().find((f) => f.startsWith(n));
        expect(forward, `no forward migration ${n}`).toBeDefined();
        const down = forward.replace(/\.sql$/, '.down.sql');
        expect(files.includes(down), `${forward} has no ${down}`).toBe(true);
      });
    }
  });
});
