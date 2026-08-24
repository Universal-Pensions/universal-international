import fs from 'node:fs';
import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={};for(const l of fs.readFileSync(ROOT+'/.env.local','utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=env.VITE_SUPABASE_URL.replace(/\/+$/,'')+'/rest/v1';const ANON=env.VITE_SUPABASE_ANON_KEY;
const SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const P={admin:['adminId','admin-001','+256700000041'],distributor:['distributorId','d-001','+256700000021'],branch:['branchId','b-kam-015','+256700000011'],agent:['agentId','a-001','+256700000001']};
async function tok(r){const[c,i,p]=P[r];return new SignJWT({role:'authenticated',app_role:r,phone:p,[c]:i}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject(p).setIssuedAt().setExpirationTime('1h').sign(SECRET);}
const COLS='id,name,phone,email,gender,age,dob,nin,occupation,agent_id,district_id,kyc_status,is_active,registered_date,products_held,contribution_history,current_unit_value,unit_value_as_of,subscriber_balances(total_balance)';
async function g(url,role,prefer){const t=await tok(role);const s=Date.now();const r=await fetch(url,{headers:{apikey:ANON,Authorization:'Bearer '+t,Prefer:prefer}});const b=await r.text();return{ms:Date.now()-s,status:r.status,cr:r.headers.get('content-range'),n:(()=>{try{return JSON.parse(b).length}catch{return b.slice(0,160)}})()};}
for(const role of ['admin','distributor','branch','agent']){
  const u=`${BASE}/subscribers?select=${encodeURIComponent(COLS)}&order=registered_date.desc.nullslast&offset=0&limit=1000`;
  console.log('count=estimated',role,JSON.stringify(await g(u,role,'count=estimated')));
}
console.log('count=exact admin',JSON.stringify(await g(`${BASE}/subscribers?select=${encodeURIComponent(COLS)}&order=registered_date.desc.nullslast&offset=0&limit=1000`,'admin','count=exact')));
// with search filter
const q=encodeURIComponent('name.ilike.%oke%,phone.ilike.%oke%');
console.log('estimated+search admin',JSON.stringify(await g(`${BASE}/subscribers?select=${encodeURIComponent(COLS)}&or=(${q})&order=registered_date.desc.nullslast&offset=0&limit=1000`,'admin','count=estimated')));
// page 2
console.log('page2 admin',JSON.stringify(await g(`${BASE}/subscribers?select=${encodeURIComponent(COLS)}&order=registered_date.desc.nullslast&offset=1000&limit=1000`,'admin','count=estimated')));
