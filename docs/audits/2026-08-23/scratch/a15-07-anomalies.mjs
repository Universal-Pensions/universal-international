import { ctx, adminLogin, BASE, SHOT, bodyText } from './a15-lib.mjs';
const { b, page, errors } = await ctx(375, 812);
async function probe(name, path, waitMs=4000) {
  errors.length=0;
  await page.goto(BASE+path,{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(waitMs);
  await page.screenshot({path:`${SHOT}/m-${name}-375.png`, fullPage:true});
  const txt = await bodyText(page);
  console.log(`\n##### ${name} [${path}]`);
  console.log('ERR:', JSON.stringify(errors.slice(0,5)));
  console.log('LEN:', txt.length);
  console.log('TXT:', txt.slice(0, 500).replace(/\s+/g,' '));
}
try {
  await adminLogin(page);
  await probe('subscribers-deep', '/dashboard/subscribers', 5000);
  await probe('agents-deep', '/dashboard/agents', 5000);
  await probe('subscriber-detail-deep', '/dashboard/subscribers/s-0001', 5000);
} catch(e){ console.log('ERR', e.message); }
finally { await b.close(); }
