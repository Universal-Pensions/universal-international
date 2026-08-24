import { chromium } from '@playwright/test';
import { SignJWT } from 'jose';
const BASE='http://localhost:5173';
const now=Math.floor(Date.now()/1000);
const tok=await new SignJWT({sub:'s-0001',role:'authenticated',app_role:'subscriber',phone:'+256711000001',subscriberId:'s-0001'})
 .setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer('upensions').setAudience('authenticated')
 .setIssuedAt(now).setExpirationTime(now+3600).sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
let ok=0,bad=0;
for (let i=0;i<6;i++){
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1440,height:900},storageState:{cookies:[],origins:[{origin:BASE,localStorage:[
    {name:'upensions_token',value:tok},
    {name:'upensions_auth',value:JSON.stringify({role:'subscriber',subscriberId:'s-0001',phone:'+256711000001',name:'Brian Okello'})}]}]}});
  const p=await ctx.newPage();
  const codes=[];
  p.on('requestfinished', async r=>{ if(!r.url().includes('supabase.co')) return; try{ codes.push((await r.response()).status()); }catch{} });
  await p.goto(BASE+'/dashboard',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5000);
  const n5=codes.filter(c=>c>=500).length;
  console.log(`load ${i+1}: supabase reqs=${codes.length} statuses=${JSON.stringify(codes)}`);
  if(n5) bad++; else ok++;
  await b.close();
}
console.log(`clean loads=${ok} loads-with-500=${bad}`);
