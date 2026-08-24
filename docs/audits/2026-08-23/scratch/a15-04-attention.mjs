import { ctx, adminLogin, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(1440, 1200);
try {
  await adminLogin(page);
  await page.waitForTimeout(1500);
  const txt = await bodyText(page);
  // find "Needs attention" region
  const idx = txt.toLowerCase().indexOf('needs attention');
  console.log('--- Needs attention region ---');
  console.log(idx >= 0 ? txt.slice(idx, idx + 600) : '(needs attention text not on landing)');
  // Enumerate clickable attention items
  const items = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button, [role=button], a').forEach(e => {
      const t = (e.innerText||'').replace(/\s+/g,' ').trim();
      if (/reconcil|attention|access request|nominee|custody|withdrawal|dormant|insurance|employer transfer|underperform|inactive branch|not priced|price/i.test(t) && t.length < 120) out.push(t);
    });
    return [...new Set(out)].slice(0, 40);
  });
  console.log('--- attention-ish controls ---');
  console.log(JSON.stringify(items, null, 0));
  await page.screenshot({ path: `${SHOT}/desktop-overview-attention-1440.png`, fullPage: true });
  // Try to click a reconciliation row
  const rec = page.getByText(/reconciliation/i).first();
  if (await rec.count()) {
    await rec.click();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${SHOT}/desktop-reconciliation-drill-1440.png`, fullPage: true });
    const t2 = await bodyText(page);
    console.log('--- after reconciliation click (700) ---');
    console.log(t2.slice(0, 900));
  } else {
    console.log('no reconciliation text clickable');
  }
  console.log('ERRORS:', JSON.stringify(errors.slice(0,5)));
} catch (e) { console.log('ERR', e.message); }
finally { await b.close(); }
