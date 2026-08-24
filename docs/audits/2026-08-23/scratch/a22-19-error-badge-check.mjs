// A22 — precise check: on a hero-read 500, does an error affordance render, and
// what money is shown? admin(get_platform_overview) + distributor(get_entity_metrics_rollup).
import { browser, uiSignIn, PHONES } from './a22-lib.mjs';
const cases = [
  { role: 'admin',       landing: '/admin',        block: 'get_platform_overview' },
  { role: 'distributor', landing: '/distributors', block: 'get_entity_metrics_rollup' },
];
const { b, ctx } = await browser();
for (const c of cases) {
  const p = await ctx.newPage();
  await p.route(`**/rest/v1/**${c.block}**`, r => r.fulfill({ status:500, contentType:'application/json', body:'{"message":"injected 500"}' }));
  await uiSignIn(p, { landingPath: c.landing, phone: PHONES[c.role] });
  await p.waitForTimeout(9000);
  const t = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  const fum = (t.match(/FUNDS UNDER MANAGEMENT ([^A0-9]{0,3}|UGX [\d.,BMK]+)/)||[])[1];
  console.log(`\n== ${c.role} / ${c.block} 500 ==`);
  console.log('  FUM shown:', JSON.stringify(fum));
  console.log('  "unavailable" present:', /unavailable/i.test(t));
  console.log('  "Metrics unavailable" present:', /metrics unavailable/i.test(t));
  console.log('  any retry/refresh button:', /try again|retry|refresh|reload/i.test(t));
  console.log('  role=status/alert texts:', JSON.stringify(await p.locator('[role="status"],[role="alert"]').allInnerTexts().catch(()=>[])));
  await p.close();
}
await b.close(); process.exit(0);
