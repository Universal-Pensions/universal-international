/* Execute every STABLE (provolatile='s') read RPC the frontend calls, as the role
   that calls it, with the frontend's real argument shape. Capture top-level keys. */
import fs from 'node:fs'; import path from 'node:path'; import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={}; for(const l of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=`${env.VITE_SUPABASE_URL.replace(/\/+$/,'')}/rest/v1`;
const ANON=env.VITE_SUPABASE_ANON_KEY, SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const P={subscriber:{id:'s-0001',claim:'subscriberId',phone:'+256711000001'},agent:{id:'a-001',claim:'agentId',phone:'+256700000001'},branch:{id:'b-kam-015',claim:'branchId',phone:'+256700000011'},distributor:{id:'d-001',claim:'distributorId',phone:'+256700000021'},employer:{id:'emp-001',claim:'employerId',phone:'+256700000031'},admin:{id:'admin-001',claim:'adminId',phone:'+256700000041'}};
const tok={}; async function mint(r){if(tok[r])return tok[r];const p=P[r];tok[r]=await new SignJWT({role:'authenticated',app_role:r,phone:p.phone,[p.claim]:p.id}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject(p.phone).setIssuedAt().setExpirationTime('1h').sign(SECRET);return tok[r];}
async function rpc(n,role,args){const a=await mint(role);const res=await fetch(`${BASE}/rpc/${n}`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${a}`,'Content-Type':'application/json'},body:JSON.stringify(args||{})});const t=await res.text();let j=null;try{j=JSON.parse(t)}catch{};return{status:res.status,data:j??t.slice(0,160)};}
const CASES=[
 ['get_admin_attention','admin',{}],
 ['get_admin_attention_rows','admin',{p_type:'reconciliation',p_limit:5}],
 ['get_agent_commission_detail','branch',{p_agent_id:'a-001'}],
 ['get_agent_commission_list','branch',{p_status_focus:'due'}],
 ['get_all_employers_metrics','admin',{}],
 ['get_branch_pending_contributions','branch',{p_branch_id:'b-kam-015'}],
 ['get_breadcrumb','admin',{p_level:'agent',p_ids:{agent:'a-001'}}],
 ['get_commission_rate','distributor',{}],
 ['get_commission_summary','distributor',{p_branch_id:null}],
 ['get_distributor_rollup','admin',{}],
 ['get_employer_activity_rollup','admin',{}],
 ['get_employer_geo_rollup','admin',{}],
 ['get_employer_metrics','employer',{}],
 ['get_entity_commission_summary','distributor',{p_level:'distributor',p_entity_id:'d-001'}],
 ['get_entity_metrics_rollup','distributor',{p_level:'branch',p_entity_ids:['b-kam-015']}],
 ['get_my_employer_funding','subscriber',{}],
 ['get_nav_overview','admin',{p_fund_code:'UPF-BAL'}],
 ['get_pending_dues_by_agent','distributor',{}],
 ['get_pending_dues_by_branch','distributor',{}],
 ['get_platform_overview','admin',{}],
 ['get_top_branch','distributor',{p_level:'distributor',p_parent_id:'d-001'}],
 ['get_top_entities','distributor',{p_level:'branch',p_sort_key:'aum',p_limit:5}],
 ['list_access_requests','admin',{p_status:'pending'}],
 ['list_nav_snapshots','admin',{p_fund_code:'UPF-BAL',p_limit:5,p_offset:0,p_status:null}],
 ['list_nominee_claims','admin',{p_status:'pending'}],
 ['search_entities','admin',{p_q:'kam'}],
];
const out={};
for(const[n,role,args] of CASES){
  const r=await rpc(n,role,args);
  const d=r.data;
  const keys=Array.isArray(d)?(d.length?Object.keys(d[0]):['<empty array>']):(d&&typeof d==='object'?Object.keys(d):[`scalar:${typeof d}`]);
  out[n]={role,status:r.status,isArray:Array.isArray(d),n:Array.isArray(d)?d.length:undefined,keys};
  console.log(`http=${r.status} ${n.padEnd(34)} role=${role.padEnd(11)} ${Array.isArray(d)?`rows=${d.length} `:''}keys=${JSON.stringify(keys)}`);
  if(r.status>=400) console.log('    BODY',JSON.stringify(d).slice(0,240));
}
fs.writeFileSync(path.join(ROOT,'docs/audits/2026-08-23/a08r2/rpcshapes.json'),JSON.stringify(out,null,2));
