import fs from 'node:fs';
import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={};for(const l of fs.readFileSync(ROOT+'/.env.local','utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=env.VITE_SUPABASE_URL.replace(/\/+$/,'')+'/rest/v1';const ANON=env.VITE_SUPABASE_ANON_KEY;
const SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const T=await new SignJWT({role:'authenticated',app_role:'admin',phone:'+256700000041',adminId:'admin-001'}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject('+256700000041').setIssuedAt().setExpirationTime('1h').sign(SECRET);
const TYPES=['dormantSubscribers','delayedEmployerTransfers','delayedNav','pendingComplaints','pendingAccessRequests','underperformingDistributors','delayedInsurancePayouts','delayedWithdrawals','delayedCustodyTransfers','reconciliation'];
for(const t of TYPES){
  const r=await fetch(BASE+'/rpc/get_admin_attention_rows',{method:'POST',headers:{apikey:ANON,Authorization:'Bearer '+T,'Content-Type':'application/json'},body:JSON.stringify({p_type:t,p_limit:50})});
  const b=await r.text();
  let keys='';try{const j=JSON.parse(b);keys=Array.isArray(j)?`rows=${j.length} keys=${j.length?Object.keys(j[0]).join(','):'-'}`:JSON.stringify(j).slice(0,200);}catch{keys=b.slice(0,160);}
  console.log(`http=${r.status} p_type=${t.padEnd(30)} ${keys}`);
}
