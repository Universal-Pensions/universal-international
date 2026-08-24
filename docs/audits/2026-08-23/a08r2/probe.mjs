/* A08 r2 LIVE probe. Non-mutating:
   (A) RPC schema-cache resolution via a deliberately bogus arg (body never runs).
   (B) GET every static .select() site (limit=1) -> a bad column is a 400.
   Secrets read from .env.local, NEVER printed (G2). */
import fs from 'node:fs'; import path from 'node:path'; import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={}; for(const line of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split('\n')){const m=line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=`${env.VITE_SUPABASE_URL.replace(/\/+$/,'')}/rest/v1`;
const ANON=env.VITE_SUPABASE_ANON_KEY, SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const P={subscriber:{id:'s-0001',claim:'subscriberId',phone:'+256711000001'},agent:{id:'a-001',claim:'agentId',phone:'+256700000001'},branch:{id:'b-kam-015',claim:'branchId',phone:'+256700000011'},distributor:{id:'d-001',claim:'distributorId',phone:'+256700000021'},employer:{id:'emp-001',claim:'employerId',phone:'+256700000031'},admin:{id:'admin-001',claim:'adminId',phone:'+256700000041'}};
const tok={};
async function mint(r){if(tok[r])return tok[r];const p=P[r];tok[r]=await new SignJWT({role:'authenticated',app_role:r,phone:p.phone,[p.claim]:p.id}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject(p.phone).setIssuedAt().setExpirationTime('1h').sign(SECRET);return tok[r];}
async function call(method,url,role,body){const auth=role==='anon'?ANON:await mint(role);
 const res=await fetch(url,{method,headers:{apikey:ANON,Authorization:`Bearer ${auth}`,'Content-Type':'application/json',Accept:'application/json'},body:body?JSON.stringify(body):undefined});
 let t=''; try{t=await res.text()}catch{}; let j=null; try{j=JSON.parse(t)}catch{}
 return {status:res.status,body:j??t.slice(0,200),cr:res.headers.get('content-range')};}

const rpcs=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/audits/2026-08-23/a08r2/report.json'),'utf8')).rpcSites.map(r=>r.name).filter(Boolean);
console.log('=== A) RPC schema-cache resolution (expect PGRST202 = resolved, function exists) ===');
let resolved=0,unresolved=[];
for(const n of [...new Set(rpcs)].sort()){
  const r=await call('POST',`${BASE}/rpc/${n}`,'admin',{__a08r2_probe__:1});
  const code=r.body&&r.body.code;
  if(r.status===404&&code==='PGRST202'&&/without parameters|__a08r2_probe__/.test(r.body.message||'')){resolved++;}
  else if(r.status===404&&code==='PGRST202'&&!/Could not find the function public\.[a-z_]+ in the schema cache/.test(r.body.message||'')){resolved++;}
  else if(r.status===404&&code==='PGRST202'){ // ambiguous: check hint enumerates signatures
    if(r.body.hint&&r.body.hint.includes(n)){resolved++;} else {unresolved.push([n,r.status,JSON.stringify(r.body).slice(0,180)]);}
  } else {unresolved.push([n,r.status,JSON.stringify(r.body).slice(0,180)]);}
}
console.log(`resolved ${resolved}/${new Set(rpcs).size}`);
for(const u of unresolved) console.log('  UNRESOLVED/OTHER',u[0],u[1],u[2]);

console.log('\n=== B) live GET of every static select site ===');
const SEL=[
 ['subscribers','id,name,phone,email,gender,age,dob,nin,occupation,agent_id,district_id,kyc_status,is_active,registered_date,products_held,contribution_history,current_unit_value,unit_value_as_of,subscriber_balances(total_balance)','admin','LEVEL_LIST_COLUMNS.subscriber'],
 ['regions','id,name,parent_id,center_lng,center_lat','admin','LEVEL_LIST_COLUMNS.region'],
 ['districts','id,name,region_id,center_lng,center_lat,active','admin','LEVEL_LIST_COLUMNS.district'],
 ['distributors','id,name,parent_id,manager_name,manager_phone,manager_email,status,created_at','admin','LEVEL_LIST_COLUMNS.distributor'],
 ['subscribers','id,name,phone,email,gender,age,kyc_status,is_active,registered_date,last_contribution_date,products_held,contribution_history,contribution_schedules(frequency,amount,retirement_pct,emergency_pct,include_insurance,insurance_choice_made,next_due_date),subscriber_balances(total_balance,retirement_balance,emergency_balance),insurance_policies(cover,premium_monthly,status),subscriber_insurance_products(product,status)','agent','agent.js:167'],
 ['subscribers','*,subscriber_balances(*),contribution_schedules(*),insurance_policies(*),nominees(*)','employer','MEMBER_SELECT'],
 ['subscribers','*,subscriber_balances(*),contribution_schedules(*),insurance_policies(*),subscriber_insurance_products(*)','subscriber','updateProfile return select'],
 ['transactions','id,subscriber_id,agent_id,type,source,amount,date,status,method,txn_ref,bucket,split_retirement,split_emergency,contribution_run_id','subscriber','subscriber.js:518'],
];
let ok=0,bad=[];
for(const[t,cols,role,label] of SEL){
  const r=await call('GET',`${BASE}/${t}?select=${encodeURIComponent(cols)}&limit=1`,role);
  if(r.status>=200&&r.status<300){ok++;console.log(`OK  http=${r.status} ${label} (${t} as ${role})`);}
  else{bad.push(label);console.log(`BAD http=${r.status} ${label} :: ${JSON.stringify(r.body).slice(0,200)}`);}
}
console.log(`\nselect probes: ${ok}/${SEL.length} 200; bad=${bad.length}`);
