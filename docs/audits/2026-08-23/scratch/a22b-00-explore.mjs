// A22 throwaway — explore admin vs distributor(d-002) dashboards in CLEAN contexts.
import { browser, seed, txt, BASE } from './a22-lib.mjs';

async function run(role, entityId, tag) {
  const { b, ctx } = await browser();
  await seed(ctx, role, entityId ? { entityId } : {});
  const page = await ctx.newPage();
  const reqs = [];
  page.on('request', (r) => { if (/rest\/v1/.test(r.url())) reqs.push(r.url().split('/rest/v1/')[1].slice(0, 90)); });
  await page.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const t = await txt(page);
  console.log(`\n===== ${tag} =====`);
  console.log(t.slice(0, 1400));
  console.log(`--- ${reqs.length} rest calls ---`);
  console.log([...new Set(reqs)].join('\n'));
  await page.screenshot({ path: `docs/audits/2026-08-23/scratch/a22b-${tag}.png`, fullPage: false });
  await b.close();
}

await run('admin', null, 'admin-clean');
await run('distributor', 'd-002', 'dist002-clean');
