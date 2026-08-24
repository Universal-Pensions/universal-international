import { launch, loginSubscriber, BASE } from './a10-login.mjs';
import fs from 'node:fs';
const { b, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  for (const [route, label] of [
    ['/dashboard/reports/all-transactions','all-transactions'],
    ['/dashboard/reports/contributions-summary','contributions-summary'],
    ['/dashboard/reports/annual-statement','annual-statement'],
  ]) {
    await page.goto(BASE + route, { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(3000);
    const exp = page.getByRole('button', { name: /export|download/i }).first();
    if (await exp.count() === 0) { console.log(label, '-> NO export button'); continue; }
    const dlPromise = page.waitForEvent('download', { timeout: 8000 }).catch(()=>null);
    await exp.click();
    const dl = await dlPromise;
    if (!dl) { console.log(label, '-> export clicked, NO download event'); continue; }
    const path = `docs/audits/2026-08-23/scratch/a10-${label}.csv`;
    await dl.saveAs(path);
    const txt = fs.readFileSync(path,'utf8');
    const lines = txt.split(/\r?\n/).filter(Boolean);
    console.log(`${label} -> file="${dl.suggestedFilename()}" totalLines=${lines.length} (incl header)`);
    console.log('   header:', JSON.stringify(lines[0].replace(/^﻿/,'').slice(0,120)));
  }
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
