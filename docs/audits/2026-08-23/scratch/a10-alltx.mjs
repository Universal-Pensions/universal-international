import { launch, loginSubscriber, BASE } from './a10-login.mjs';
import fs from 'node:fs';
const { b, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  await page.goto(BASE + '/dashboard/reports/all-transactions', { waitUntil:'domcontentloaded' });
  // Wait for on-screen rows: look for a currency amount cell to appear
  await page.waitForTimeout(1500);
  const loadingEarly = /loading transactions/i.test(await page.innerText('body'));
  console.log('loading text present at 1.5s:', loadingEarly);
  // Wait until table body rows render (up to 12s)
  let onScreenRows = 0;
  for (let i=0;i<12;i++){
    onScreenRows = await page.locator('table tbody tr').count().catch(()=>0);
    if (onScreenRows > 0) break;
    await page.waitForTimeout(1000);
  }
  console.log('on-screen table rows:', onScreenRows);
  const body = await page.innerText('body');
  console.log('still loading?', /loading transactions/i.test(body), '| body sample:', body.replace(/\n+/g,' | ').slice(0,180));
  await page.screenshot({path:'docs/audits/2026-08-23/screenshots/subscriber/a10-all-transactions-d.png', fullPage:true});
  // now export
  const exp = page.getByRole('button', { name: /export|download/i }).first();
  const dlPromise = page.waitForEvent('download', { timeout: 8000 }).catch(()=>null);
  await exp.click();
  const dl = await dlPromise;
  if (dl){ await dl.saveAs('docs/audits/2026-08-23/scratch/a10-all-transactions-v2.csv');
    const lines = fs.readFileSync('docs/audits/2026-08-23/scratch/a10-all-transactions-v2.csv','utf8').split(/\r?\n/).filter(Boolean);
    console.log('CSV data rows (excl header):', lines.length-1);
  } else console.log('no download');
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
