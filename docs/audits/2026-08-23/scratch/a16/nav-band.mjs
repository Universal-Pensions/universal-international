import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const OUT='docs/audits/2026-08-23/screenshots/public';
async function probe(w){
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:w,height:800}});
  const page=await ctx.newPage();
  await page.goto(BASE+'/faq',{waitUntil:'networkidle'});
  await page.waitForTimeout(400);
  const r=await page.evaluate(()=>{
    const vis=el=>{ if(!el)return null; const s=getComputedStyle(el); const b=el.getBoundingClientRect(); return !(s.display==='none'||s.visibility==='hidden'||b.width===0); };
    const byText=(t)=>[...document.querySelectorAll('a,button')].filter(e=>new RegExp(t,'i').test(e.textContent||'')).map(e=>({t:(e.textContent||'').trim().slice(0,20),vis:vis(e)}));
    const burger=document.querySelector('[aria-label*="menu" i],[class*="burger"]');
    const cta=[...document.querySelectorAll('a')].find(a=>/start saving/i.test(a.textContent||''));
    const signin=[...document.querySelectorAll('button')].find(b=>/^sign in$/i.test((b.textContent||'').trim()));
    return { startSaving: byText('start saving'), signIn: vis(signin), burgerVisible: vis(burger) };
  });
  console.log(`width=${w}:`, JSON.stringify(r));
  await page.screenshot({path:`${OUT}/faq-navband-${w}.png`});
  await browser.close();
}
for(const w of [1440, 950, 900, 800, 769]) await probe(w);
