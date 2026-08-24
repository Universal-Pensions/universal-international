import { ctx, adminLogin, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(1440, 900);
try {
  await adminLogin(page);
  await page.getByRole('button', { name: /^Subscribers$/i }).first().click();
  await page.waitForTimeout(3500);
  // click first subscriber row
  const row = page.getByText(/Brian Okello/i).first();
  if (await row.count()) { await row.click(); await page.waitForTimeout(3500); }
  const txt = await bodyText(page);
  const m = txt.match(/Balance[\s\S]{0,60}/i);
  console.log('DESKTOP detail Balance:', m?m[0].replace(/\s+/g,' '):'(none)');
  const c = txt.match(/Total Contributions[\s\S]{0,40}/i);
  console.log('Contributions:', c?c[0].replace(/\s+/g,' '):'(none)');
  console.log('snippet:', txt.slice(0,400).replace(/\s+/g,' '));
  await page.screenshot({path:`${SHOT}/desktop-subscriber-detail-1440.png`, fullPage:false});
  console.log('ERR', JSON.stringify(errors.slice(0,5)));
} catch(e){ console.log('ERR', e.message); }
finally { await b.close(); }
