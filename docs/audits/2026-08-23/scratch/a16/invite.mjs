import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const OUT='docs/audits/2026-08-23/screenshots/public';
const EXPIRED='inv-097aadbd95c649d9ae4e37309e9a920d';
const cases=[
  ['malformed','/invite/not-a-real-token-zzz/'],
  ['expired', `/invite/${EXPIRED}/`],
];
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
for(const [name,route] of cases){
  const netErrs=[];
  page.on('response', r=>{ if(r.url().includes('/rest/') && r.status()>=400) netErrs.push(r.status()+' '+r.url().split('?')[0].split('/').pop()); });
  await page.goto(BASE+route,{waitUntil:'networkidle',timeout:20000});
  await page.waitForTimeout(1200);
  const txt=(await page.locator('#main, body').first().innerText().catch(()=>'')).replace(/\s+/g,' ').trim().slice(0,300);
  const h2=(await page.locator('h2').first().textContent().catch(()=>''))||'';
  await page.screenshot({path:`${OUT}/invite-${name}-1440.png`});
  console.log(`\n[${name}] ${route}`);
  console.log('  h2:', h2.trim());
  console.log('  body:', txt);
  console.log('  restErr:', netErrs.join(', ')||'none');
  page.removeAllListeners('response');
}
await browser.close();
