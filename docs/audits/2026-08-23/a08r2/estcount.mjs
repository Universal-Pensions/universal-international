import fs from 'node:fs'; import path from 'node:path'; import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={}; for(const l of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=`${env.VITE_SUPABASE_URL.replace(/\/+$/,'')}/rest/v1`, ANON=env.VITE_SUPABASE_ANON_KEY, S=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const t=await new SignJWT({role:'authenticated',app_role:'admin',phone:'+256700000041',adminId:'admin-001'}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject('+256700000041').setIssuedAt().setExpirationTime('1h').sign(S);
for(const pref of ['count=estimated','count=exact','count=planned']){
  const r=await fetch(`${BASE}/subscribers?select=id&limit=1000`,{headers:{apikey:ANON,Authorization:`Bearer ${t}`,Prefer:pref}});
  console.log(pref.padEnd(16), 'http='+r.status, 'content-range='+r.headers.get('content-range'));
}
