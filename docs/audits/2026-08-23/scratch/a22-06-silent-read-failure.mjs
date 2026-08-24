// CHECK 5/6 — force READ failures and record what the user SEES.
import { browser, uiSignIn, PHONES } from './a22-lib.mjs';

const cases = [
  { role: 'admin',       landing: '/admin',        block: 'get_platform_overview',     label: 'admin platform overview' },
  { role: 'distributor', landing: '/distributors', block: 'get_entity_metrics_rollup', label: 'distributor hero metrics' },
  { role: 'admin',       landing: '/admin',        block: 'get_admin_attention',       label: 'admin needs-attention card' },
  { role: 'employer',    landing: '/employers',    block: 'get_employer_metrics',      label: 'employer hero metrics' },
];

const { b, ctx } = await browser();
for (const c of cases) {
  const p = await ctx.newPage();
  let hits = 0;
  await p.route(`**/rest/v1/**${c.block}**`, async (route) => {
    hits++;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'injected 500' }) });
  });
  console.log(`\n===== ${c.label}: forcing 500 on ${c.block} =====`);
  try {
    await uiSignIn(p, { landingPath: c.landing, phone: PHONES[c.role] });
    await p.waitForTimeout(9000);
    const t = await p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    console.log('intercepted:', hits);
    console.log('SCREEN:', t.slice(90, 760));
    const errWords = /couldn.t load|something went wrong|try again|error|failed|retry/i.test(t);
    console.log('any error/retry affordance on screen?', errWords ? 'YES' : '*** NO — SILENT ***');
    await p.screenshot({ path: `docs/audits/2026-08-23/scratch/a22-silent-${c.block}.png`, fullPage: false });
  } catch (e) { console.log('probe error:', e.message.slice(0, 200)); }
  await p.close();
}
await b.close(); process.exit(0);
