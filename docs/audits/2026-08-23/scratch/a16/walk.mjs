import { chromium, devices } from 'playwright';

const BASE = 'http://localhost:5173';
const OUT = 'docs/audits/2026-08-23/screenshots/public';
const routes = ['/', '/employers', '/distributors', '/admin', '/faq', '/contact', '/about', '/request-access', '/request-access?type=distributor', '/claim', '/admin/login', '/coming-soon', '/nonexistent-xyz'];

function slug(r){ return r.replace(/[^a-z0-9]+/gi,'_').replace(/^_|_$/g,'') || 'home'; }

async function headings(page){
  return await page.evaluate(() => {
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h=>h.offsetParent!==null || h.getClientRects().length);
    const counts = {h1:0,h2:0,h3:0,h4:0,h5:0,h6:0};
    hs.forEach(h=>counts[h.tagName.toLowerCase()]++);
    const firstH1 = document.querySelector('h1');
    return { counts, firstVisibleTag: hs[0]?.tagName?.toLowerCase() ?? null, firstVisibleText: (hs[0]?.textContent||'').trim().slice(0,60), h1Present: !!firstH1, h1Text:(firstH1?.textContent||'').trim().slice(0,60) };
  });
}

async function run(label, viewport, contextOpts){
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, ...contextOpts });
  const page = await context.newPage();
  const errs = [];
  page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  console.log(`\n===== ${label} (${viewport.width}x${viewport.height}) =====`);
  for(const r of routes){
    const perr=[];
    const h=(m)=>{ if(m.type&&m.type()==='error') perr.push(m.text()); };
    page.on('console', h);
    try{
      const resp = await page.goto(BASE+r, { waitUntil:'networkidle', timeout:15000 });
      await page.waitForTimeout(500);
      const hd = await headings(page);
      const finalUrl = new URL(page.url()).pathname + new URL(page.url()).search;
      const eb = await page.locator('[data-testid="error-boundary-fallback"], .error-boundary').count().catch(()=>0);
      await page.screenshot({ path:`${OUT}/${slug(r)}-${viewport.width}.png`, fullPage:false });
      console.log(`${r}  -> final=${finalUrl}  h1=${hd.h1Present?('YES:"'+hd.h1Text+'"'):'NO'}  firstHead=${hd.firstVisibleTag}:"${hd.firstVisibleText}"  counts=${JSON.stringify(hd.counts)} eb=${eb} err=${perr.length}`);
      if(perr.length) console.log('   consoleErr:', perr.slice(0,2).join(' | '));
    }catch(e){
      console.log(`${r}  -> ERROR ${e.message.slice(0,120)}`);
    }
    page.off('console', h);
  }
  await browser.close();
}

await run('DESKTOP', {width:1440,height:900}, {});
await run('MOBILE-375', {width:375,height:812}, { userAgent: devices['iPhone 12'].userAgent, isMobile:true, hasTouch:true });
await run('BAND-920', {width:920,height:800}, {});
