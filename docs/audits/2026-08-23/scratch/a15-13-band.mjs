import { chromium } from 'playwright';
import { adminLogin, BASE, SHOT, bodyText } from './a15-lib.mjs';
const b = await chromium.launch({headless:true});
for (const w of [768, 900, 1023, 1024]) {
  const c = await b.newContext({viewport:{width:w,height:900}});
  const page = await c.newPage();
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text());}); page.on('pageerror',e=>errs.push('PAGEERR:'+e.message));
  try {
    await adminLogin(page);
    await page.waitForTimeout(2500);
    await page.screenshot({path:`${SHOT}/band-index-${w}.png`, fullPage:false});
    // detect horizontal overflow
    const overflow = await page.evaluate(()=>({sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth}));
    const shell = await page.evaluate(()=>{
      const hasBottomTab = !!document.querySelector('[class*="bottomTab" i],[class*="BottomTab" i],nav[class*="tab" i]');
      const hasSidebar = !!document.querySelector('[class*="sidebar" i],aside');
      return {hasBottomTab, hasSidebar};
    });
    const t = await bodyText(page);
    console.log(`\n### width=${w}: overflow ${overflow.sw>overflow.cw?('YES '+overflow.sw+'>'+overflow.cw):'no'} | bottomTab=${shell.hasBottomTab} sidebar=${shell.hasSidebar} | ERR=${errs.length}`);
    console.log('  head:', t.slice(0,130).replace(/\s+/g,' '));
    if (errs.length) console.log('  ERRs:', JSON.stringify(errs.slice(0,3)));
  } catch(e){ console.log(`width=${w} FAILED: ${e.message}`); }
  await c.close();
}
await b.close();
