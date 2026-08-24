import { ctx, adminLogin, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(1440, 900);
try {
  await adminLogin(page);
  await page.getByRole('button', { name: /Unit price/i }).first().click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOT}/desktop-nav-1440.png`, fullPage: false });
  // Find the price input (a number/text input in the publish card)
  const inputs = await page.locator('input').all();
  console.log('inputs found:', inputs.length);
  // Type a new price to trigger inline projection — DO NOT click Publish.
  const priceInput = page.locator('input[inputmode="decimal"], input[type="number"], input[name*="price" i]').first();
  let typed = false;
  if (await priceInput.count()) { await priceInput.fill('1500'); typed = true; }
  else {
    // fallback: first visible input inside the publish card
    const vis = page.locator('input:visible').first();
    if (await vis.count()) { await vis.fill('1500'); typed = true; }
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOT}/desktop-nav-projection-1440.png`, fullPage: false });
  const txt = await bodyText(page);
  console.log('typed 1500:', typed);
  const proj = txt.match(/fund would move to[^.]*\./i);
  console.log('PROJECTION LINE:', proj ? proj[0] : '(not found)');
  const curAum = txt.match(/Fund value[^0-9]*[\d.,BMK ]*UGX[\d.,BMK ]*/i);
  console.log('BODY around price (400-1000):', txt.slice(300, 1100));
  console.log('ERRORS:', JSON.stringify(errors.slice(0,5)));
} catch (e) { console.log('ERR', e.message); }
finally { await b.close(); }
