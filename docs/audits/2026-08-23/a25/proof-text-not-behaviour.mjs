// A25 check-5 proof: the contract tests' own `latestDefinitionOf` helper,
// copied verbatim from src/test/login-identity-contract.test.js, happily
// returns a "newest definition" for functions that DO NOT EXIST LIVE.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const MIGRATIONS_DIR = resolve(process.cwd(), 'supabase/migrations');
const stripSqlComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
const forwardMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort();
function latestDefinitionOf(fnName) {
  const create = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fnName}\\s*\\(`, 'i');
  const anyCreate = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s/gi;
  for (const file of [...forwardMigrations].reverse()) {
    const sql = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
    const start = sql.search(create);
    if (start === -1) continue;
    anyCreate.lastIndex = start + 1;
    const next = anyCreate.exec(sql);
    return { file, bytes: (next ? sql.slice(start, next.index) : sql.slice(start)).length };
  }
  return null;
}
// From 00-baseline.md §5.1 — names in migration TEXT that are ABSENT from the live DB.
const DEAD = ['submit_contribution_run','agent_dispute_line','branch_approve_all','open_run',
  'release_run','cancel_run','get_run_branch_breakdown','approve_dispute','reject_dispute',
  'withdraw_dispute','mark_branch_reviewed','release_branch','branch_hold_line',
  'branch_approve_line','branch_dispute_line','agent_confirm_commission',
  'update_employee_contribution_config','update_employee_insurance','trg_commissions_before_update'];
for (const fn of DEAD) {
  const d = latestDefinitionOf(fn);
  console.log(`${fn.padEnd(38)} ${d ? 'HELPER RESOLVES -> ' + d.file + ' (' + d.bytes + ' bytes)' : 'not found'}`);
}
