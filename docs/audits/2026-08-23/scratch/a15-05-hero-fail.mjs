import { ctx, adminLogin, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(1440, 900);
try {
  await adminLogin(page);          // log in with the RPC WORKING
  await page.waitForTimeout(1000);
  // Now abort the platform-overview read and force a reload of the hero.
  await page.route('**/rpc/get_platform_overview*', route => route.abort());
  await page.route('**/rpc/get_entity_metrics_rollup*', route => route.abort());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOT}/desktop-hero-read-fail-1440.png`, fullPage: false });
  const txt = await bodyText(page);
  const fum = txt.match(/FUNDS UNDER MANAGEMENT[\s\S]{0,120}/i);
  console.log('HERO on failed read:', fum ? fum[0].replace(/\s+/g,' ') : '(no FUM)');
  console.log('has "unavailable":', /unavailable/i.test(txt));
  console.log('has "retry":', /retry|try again/i.test(txt));
  console.log('has "Needs work":', /needs work/i.test(txt));
  const health = txt.match(/Health Score[\s\S]{0,40}/i);
  console.log('Health:', health ? health[0].replace(/\s+/g,' ') : '(none)');
  // role=status/alert present?
  const alerts = await page.locator('[role="status"], [role="alert"]').count();
  console.log('role=status/alert count:', alerts);
  console.log('BODY 200-600:', txt.slice(200, 600));
} catch (e) { console.log('ERR', e.message); }
finally { await b.close(); }
