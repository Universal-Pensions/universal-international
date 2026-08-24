import { launch, loginSubscriber } from './a10-login.mjs';
const { b, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  // Read the balance repeatedly to see if it's animating and where it settles.
  for (const t of [0, 1500, 3000, 5000]) {
    await page.waitForTimeout(t === 0 ? 0 : t - (t===1500?0:0));
  }
  // simpler: sample over time
  const samples = [];
  for (let i = 0; i < 8; i++) {
    const txt = await page.evaluate(() => {
      const els = [...document.querySelectorAll('*')].filter(e => /TOTAL BALANCE/i.test(e.textContent||'') && e.children.length < 6);
      // find the UGX value near "TOTAL BALANCE"
      const m = (document.body.innerText.match(/TOTAL BALANCE\s*\|?\s*UGX\s*([\d,]+)/i) || document.body.innerText.match(/TOTAL BALANCE[\s\S]{0,40}?UGX\s*([\d,]+)/i));
      return m ? m[1] : 'NOT FOUND';
    });
    samples.push(txt);
    await page.waitForTimeout(700);
  }
  console.log('balance samples over ~5.6s:', JSON.stringify(samples));
  // Final settled: also grab units + invested
  const finalTxt = await page.innerText('body');
  const bal = (finalTxt.match(/TOTAL BALANCE[\s\S]{0,40}?UGX\s*([\d,]+)/i)||[])[1];
  const units = (finalTxt.match(/UNITS[\s\S]{0,30}?([\d.,]+)\s*\|?\s*units/i)||[])[1];
  const inv = (finalTxt.match(/AMOUNT INVESTED[\s\S]{0,40}?UGX\s*([\d.,MK]+)/i)||[])[1];
  console.log('FINAL bal:', bal, 'units:', units, 'invested:', inv);
} catch (e) { console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
