// A25 check 5 — do the 4 migration-text contract tests prove TEXT or BEHAVIOUR?
// Re-implements the exact helpers the tests use, then (a) shows the helper
// happily resolves functions that DO NOT EXIST live, and (b) re-runs each
// test's assertions against the LIVE pg_get_functiondef body.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MIG = resolve('supabase/migrations');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
const fwd = readdirSync(MIG).filter(f => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort();

// employer-split-contract.test.js / login-identity-contract.test.js helper
function latestDefinitionOf(fn) {
  const create = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${fn}\\s*\\(`, 'i');
  const anyCreate = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s/gi;
  for (const file of [...fwd].reverse()) {
    const sql = strip(readFileSync(join(MIG, file), 'utf8'));
    const start = sql.search(create);
    if (start === -1) continue;
    anyCreate.lastIndex = start + 1;
    const next = anyCreate.exec(sql);
    return { file, body: sql.slice(start, next ? next.index : undefined) };
  }
  return null;
}

// The 20 names A00 proved exist in migration TEXT but NOT in the live DB.
const PHANTOMS = ['agent_confirm_commission','agent_dispute_line','approve_dispute','branch_approve_all',
 'branch_approve_line','branch_dispute_line','branch_hold_line','cancel_run','get_run_branch_breakdown',
 'mark_branch_reviewed','open_run','reject_dispute','release_branch','release_run','submit_contribution_run',
 'withdraw_dispute','trg_commissions_before_update','update_employee_contribution_config','update_employee_insurance'];

console.log('=== (a) the contract tests\' own resolver on functions that DO NOT EXIST LIVE ===');
let resolved = 0;
for (const p of PHANTOMS) {
  const f = latestDefinitionOf(p);
  if (f) { resolved++; console.log(`  RESOLVED  ${p.padEnd(38)} -> ${f.file} (${f.body.length} chars of text for a function with 0 live OIDs)`); }
  else console.log(`  not-found ${p}`);
}
console.log(`  => ${resolved}/${PHANTOMS.length} phantom functions get a full "newest definition" from the same helper the contract tests use.\n`);

// ---- (b) run the assertions against the LIVE bodies -------------------------
const live = Object.fromEntries(
  readFileSync('docs/audits/2026-08-23/a25/live/functiondefs.txt','utf8')
    .split(/^-----FN:(.*?)-----$/m).slice(1)
    .reduce((acc,v,i,a)=> i%2===0 ? [...acc,[v.trim(), a[i+1]]] : acc, [])
);

const results = [];
function check(test, fn, label, fnPredicate) {
  const t = latestDefinitionOf(fn);
  const l = live[fn];
  const textOK = t ? fnPredicate(t.body) : null;
  const liveOK = l ? fnPredicate(strip(l)) : null;
  results.push({ test, fn, label, textOK, liveOK, agree: textOK === liveOK });
}

// nav-pricing-contract.test.js
for (const fn of ['trg_transactions_contribution','request_withdrawal']) {
  check('nav-pricing', fn, 'no hardcoded 1000 unit price', b => (b.match(/v_unit_price\s+\w+\s*:=\s*1000/gi) === null));
  check('nav-pricing', fn, 'prices from NAV register', b => /public\.(nav_for_date|latest_nav)\s*\(/.test(b));
  check('nav-pricing', fn, 'SECURITY DEFINER', b => /SECURITY\s+DEFINER/i.test(b));
  check('nav-pricing', fn, 'pinned search_path', b => /SET\s+search_path\s*(?:TO|=)/i.test(b));
}

// ── 0147: the pricing AUTHORITY moved ──────────────────────────────────────
// The four predicates above stay true and stay valuable, but they no longer
// prove where a price comes from: both money functions retain a synchronous
// fallback (used while fund_dealing_config.pricing_enabled is false) and so
// still mention nav_for_date/latest_nav. What actually prices money now is
// price_pending_transactions, and what it must price FROM is the strict
// nav_price_row lookup. These check that.
check('nav-pricing', 'price_pending_transactions', 'prices from the strict dealing-date lookup',
  b => /public\.nav_price_row\s*\(/.test(b));
check('nav-pricing', 'price_pending_transactions', 'resyncs bucket units after moving units',
  b => /_resync_bucket_units/.test(b));
check('nav-pricing', 'price_pending_transactions', 'SECURITY DEFINER',
  b => /SECURITY\s+DEFINER/i.test(b));
check('nav-pricing', 'price_pending_transactions', 'pinned search_path',
  b => /SET\s+search_path\s*(?:TO|=)/i.test(b));

// nav_for_date is STRICT since 0147. Each of these three fallbacks priced real
// money at a number nobody published; the backward carry alone mispriced 5,329
// contributions.
check('nav-pricing', 'nav_for_date', 'no backward carry to an earlier day',
  b => !/nav_date\s*<=/.test(b));
check('nav-pricing', 'nav_for_date', 'no fallback chain and no 1000 literal',
  b => !/COALESCE/i.test(b) && !/\b1000\b/.test(b));

check('nav-pricing', 'publish_nav_snapshot', 'releases the pricing queue',
  b => /price_pending_transactions/.test(b));
check('nav-pricing', 'publish_nav_snapshot', 'releases the queue OUTSIDE the newest-day block',
  b => {
      // THE bug this whole phase warns about: calling the engine INSIDE the
      // `IF v_is_newest` block means a BACK-DATED publish — the one event that
      // makes a stalled queue priceable — releases nothing at all. The price
      // lands, the rows stay pending, and that money never allocates.
      const i = b.search(/IF\s+v_is_newest/i);
      const j = b.search(/price_pending_transactions/);
      if (i === -1 || j === -1) return false;
      return /END\s+IF\s*;/i.test(b.slice(i, j));
    });
for (const fn of ['nav_for_date','latest_nav']) {
  check('nav-pricing', fn, 'STABLE', b => /\bSTABLE\b/i.test(b));
  check('nav-pricing', fn, 'SECURITY DEFINER', b => /SECURITY\s+DEFINER/i.test(b));
  check('nav-pricing', fn, 'pinned search_path', b => /SET\s+search_path\s*(?:TO|=)/i.test(b));
}
check('nav-pricing','publish_nav_snapshot','gates on app_role', b => /->>\s*'app_role'/.test(b));
check('nav-pricing','publish_nav_snapshot','raises P0001', b => /ERRCODE\s*=\s*'P0001'/i.test(b));
check('nav-pricing','publish_nav_snapshot','p_confirm_move server gate', b => /p_confirm_move/i.test(b));

// employer-split-contract.test.js
check('employer-split','submit_employer_contribution_run','does NOT read a member retirement pct', b => !/ret_pct|retirement_pct/i.test(b));
check('employer-split','submit_employer_contribution_run','v_retirement := v_employee_leg', b => /v_retirement\s*:=\s*v_employee_leg\s*;/.test(b));
check('employer-split','submit_employer_contribution_run','v_retirement := v_employer_leg', b => /v_retirement\s*:=\s*v_employer_leg\s*;/.test(b));
check('employer-split','create_subscriber_from_employer_invite','ignores payload retirementPct', b => !b.includes("v_sched ->> 'retirementPct'"));
check('employer-split','create_subscriber_from_employer_invite','writes 80/20 default', b => /retirement_pct[\s\S]{0,600}?VALUES[^;]*?,\s*80,\s*20,/.test(b));

// login-identity-contract.test.js
for (const fn of ['approve_access_request','create_employer','create_distributor']) {
  check('login-identity', fn, 'binds a login identity', b => /register_login_identity|demo_personas/.test(b));
}

const pad=(s,n)=>String(s).padEnd(n);
console.log('=== (b) same assertion, migration TEXT vs LIVE pg_get_functiondef ===');
console.log(pad('test',15), pad('function',40), pad('assertion',42), pad('TEXT',6), pad('LIVE',6), 'AGREE');
for (const r of results) {
  console.log(pad(r.test,15), pad(r.fn,40), pad(r.label,42), pad(r.textOK,6), pad(r.liveOK,6), r.agree ? '' : ' <<< DIVERGES');
}
const div = results.filter(r=>!r.agree);
console.log(`\nassertions checked: ${results.length}; diverging text-vs-live: ${div.length}`);
