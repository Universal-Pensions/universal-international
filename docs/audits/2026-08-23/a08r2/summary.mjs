import fs from 'node:fs'; import path from 'node:path'; import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={}; for(const l of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=`${env.VITE_SUPABASE_URL.replace(/\/+$/,'')}/rest/v1`, ANON=env.VITE_SUPABASE_ANON_KEY, S=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const P={distributor:{id:'d-001',claim:'distributorId',phone:'+256700000021'},admin:{id:'admin-001',claim:'adminId',phone:'+256700000041'}};
async function mint(r){const p=P[r];return new SignJWT({role:'authenticated',app_role:r,phone:p.phone,[p.claim]:p.id}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject(p.phone).setIssuedAt().setExpirationTime('1h').sign(S);}
for(const role of ['distributor','admin']){
 const a=await mint(role);
 const res=await fetch(`${BASE}/rpc/get_commission_summary`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${a}`,'Content-Type':'application/json'},body:JSON.stringify({p_branch_id:null})});
 console.log(role, res.status, await res.text());
 // sum of the TRUNCATED dues list the UI actually holds
 const r2=await fetch(`${BASE}/rpc/get_pending_dues_by_agent`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${a}`,'Content-Type':'application/json',Prefer:'count=exact'},body:'{}'});
 const rows=await r2.json();
 const sum=rows.reduce((s,x)=>s+Number(x.pending_amount||0),0);
 console.log(`   truncated dues list: rows=${rows.length} content-range=${r2.headers.get('content-range')} sum(pending_amount)=${sum}`);
}
