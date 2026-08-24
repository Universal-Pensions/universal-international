import { ctx, adminLogin, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(1440, 900);
try {
  await adminLogin(page);
  console.log('URL after login:', page.url());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: SHOT + '/index-1440.png', fullPage: false });
  const txt = await bodyText(page);
  // Pull the hero figures
  const fum = txt.match(/FUNDS UNDER MANAGEMENT[^A-Za-z]*([^A-Z]*)/i);
  console.log('--- HERO / BODY (first 700) ---');
  console.log(txt.slice(0, 700));
  console.log('--- console errors:', JSON.stringify(errors.slice(0,10)));
} catch (e) {
  console.log('ERR', e.message);
  await page.screenshot({ path: SHOT + '/index-1440-ERR.png', fullPage: false }).catch(()=>{});
} finally { await b.close(); }
