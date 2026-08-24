import { ctx, adminLogin, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(1440, 900);
const results = [];
async function snap(name, navName) {
  errors.length = 0;
  try {
    if (navName) {
      const btn = page.getByRole('button', { name: navName }).first();
      const link = page.getByRole('link', { name: navName }).first();
      if (await btn.count()) await btn.click();
      else if (await link.count()) await link.click();
      await page.waitForTimeout(1800);
    }
    await page.screenshot({ path: `${SHOT}/desktop-${name}-1440.png`, fullPage: false });
    const txt = await bodyText(page);
    results.push({ name, url: page.url(), errs: errors.slice(0,5), snippet: txt.slice(0, 220) });
    console.log(`\n### ${name} (${page.url()})`);
    console.log('ERRORS:', JSON.stringify(errors.slice(0,5)));
    console.log('TXT:', txt.slice(0, 260));
  } catch (e) {
    console.log(`### ${name} FAILED: ${e.message}`);
    results.push({ name, error: e.message });
  }
}
try {
  await adminLogin(page);
  await snap('overview', null); // landing
  await snap('distributors', /Distributor Network/i);
  await snap('employers', /^Employers$/i);
  await snap('subscribers', /^Subscribers$/i);
  await snap('access-requests', /Access requests/i);
  await snap('nominee-claims', /Nominee claims/i);
  await snap('nav', /Unit price/i);
  await snap('support', /^Support$/i);
  await snap('reports', /^Reports$/i);
  await snap('settings', /^Settings$/i);
} catch (e) { console.log('FATAL', e.message); }
finally { await b.close(); }
