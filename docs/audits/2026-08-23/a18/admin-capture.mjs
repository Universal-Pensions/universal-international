import { chromium } from '@playwright/test';
const OUT='docs/audits/2026-08-23/a18';
const b=await chromium.launch();
for(const role of ['admin','branch']){
for(const w of [820,1023,1024]){
  const c=await b.newContext({storageState:`e2e/.auth/${role}.json`,viewport:{width:w,height:800}});
  const p=await c.newPage();
  try{await p.goto('http://localhost:5173/dashboard',{waitUntil:'networkidle',timeout:20000});}catch(e){console.log(role,w,'nav',e.message.slice(0,40));}
  await p.waitForTimeout(1500);
  const o=await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth}));
  await p.screenshot({path:`${OUT}/${role}-${w}.png`});
  console.log(`${role}@${w} overflowX=${o.sw>o.cw+1} (${o.sw}/${o.cw})`);
  await c.close();
}}
await b.close();
