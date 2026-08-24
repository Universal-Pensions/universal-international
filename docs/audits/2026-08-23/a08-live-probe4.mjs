import fs from 'node:fs';
import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={};for(const l of fs.readFileSync(ROOT+'/.env.local','utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=env.VITE_SUPABASE_URL.replace(/\/+$/,'')+'/rest/v1';const ANON=env.VITE_SUPABASE_ANON_KEY;
const SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
async function tok(){return new SignJWT({role:'authenticated',app_role:'admin',phone:'+256700000041',adminId:'admin-001'}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject('+256700000041').setIssuedAt().setExpirationTime('1h').sign(SECRET);}
async function g(url,prefer){const t=await tok();const r=await fetch(url,{headers:{apikey:ANON,Authorization:'Bearer '+t,Prefer:prefer}});await r.text();return r.headers.get('content-range');}
for(const lim of [10,100,1000,undefined]){
  const u=`${BASE}/subscribers?select=id${lim?`&limit=${lim}&offset=0`:''}`;
  console.log(`limit=${lim??'(none)'}  estimated -> ${await g(u,'count=estimated')}   exact -> ${await g(u,'count=exact')}   planned -> ${await g(u,'count=planned')}`);
}
