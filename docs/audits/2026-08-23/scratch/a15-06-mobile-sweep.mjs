import { ctx, adminLogin, BASE, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(375, 812);
const rows = [];
async function visit(name, path) {
  errors.length = 0;
  try {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${SHOT}/m-${name}-375.png`, fullPage: false });
    const txt = await bodyText(page);
    const url = page.url();
    const redirected = !url.includes(path.split('?')[0]) && path !== '/dashboard';
    rows.push({ name, path, url, redirected, errs: errors.slice(0,4), snip: txt.slice(0,140) });
    console.log(`\n## ${name}  [${path}] -> ${url}${redirected?'  ⚠REDIRECT':''}`);
    console.log('   ERR:', JSON.stringify(errors.slice(0,4)));
    console.log('   TXT:', txt.slice(0, 200).replace(/\s+/g,' '));
  } catch (e) {
    console.log(`## ${name} FAILED: ${e.message}`);
    rows.push({ name, path, error: e.message });
  }
}
try {
  await adminLogin(page);
  await visit('index', '/dashboard');
  await visit('distributors', '/dashboard/distributors');
  await visit('distributor-detail', '/dashboard/distributors/d-001');
  await visit('employers', '/dashboard/employers');
  await visit('employer-detail', '/dashboard/employers/emp-001');
  await visit('access-requests', '/dashboard/access-requests');
  await visit('nav', '/dashboard/nav');
  await visit('nominee-claims', '/dashboard/nominee-claims');
  await visit('attention-reconciliation', '/dashboard/attention/reconciliation');
  await visit('network', '/dashboard/network');
  await visit('branches', '/dashboard/branches');
  await visit('branch-detail', '/dashboard/branches/b-kam-015');
  await visit('agents', '/dashboard/agents');
  await visit('agent-detail', '/dashboard/agents/a-001');
  await visit('subscribers', '/dashboard/subscribers');
  await visit('subscriber-detail', '/dashboard/subscribers/s-0001');
  await visit('reports', '/dashboard/reports');
  await visit('support', '/dashboard/support');
  await visit('settings', '/dashboard/settings');
  await visit('menu', '/dashboard/menu');
  console.log('\n=== SUMMARY ===');
  for (const r of rows) console.log(`${r.name}: ${r.error?('ERR '+r.error):(r.redirected?'REDIRECT->'+r.url:'ok')} ${r.errs&&r.errs.length?('CONSOLE:'+r.errs.length):''}`);
} catch (e) { console.log('FATAL', e.message); }
finally { await b.close(); }
