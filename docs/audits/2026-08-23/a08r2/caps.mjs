/* Which SETOF/TABLE-returning RPCs and which .from() reads hit PostgREST's
   db-max-rows cap for the widest role that calls them?  Read-only. */
import fs from 'node:fs'; import path from 'node:path'; import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={}; for(const l of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=`${env.VITE_SUPABASE_URL.replace(/\/+$/,'')}/rest/v1`;
const ANON=env.VITE_SUPABASE_ANON_KEY, SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const P={subscriber:{id:'s-0001',claim:'subscriberId',phone:'+256711000001'},agent:{id:'a-001',claim:'agentId',phone:'+256700000001'},branch:{id:'b-kam-015',claim:'branchId',phone:'+256700000011'},distributor:{id:'d-001',claim:'distributorId',phone:'+256700000021'},employer:{id:'emp-001',claim:'employerId',phone:'+256700000031'},admin:{id:'admin-001',claim:'adminId',phone:'+256700000041'}};
const tok={}; async function mint(r){if(tok[r])return tok[r];const p=P[r];tok[r]=await new SignJWT({role:'authenticated',app_role:r,phone:p.phone,[p.claim]:p.id}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject(p.phone).setIssuedAt().setExpirationTime('1h').sign(SECRET);return tok[r];}
async function rpc(n,role,args){const a=await mint(role);const res=await fetch(`${BASE}/rpc/${n}`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${a}`,'Content-Type':'application/json',Prefer:'count=exact'},body:JSON.stringify(args||{})});const t=await res.text();let j=null;try{j=JSON.parse(t)}catch{};return{status:res.status,cr:res.headers.get('content-range'),n:Array.isArray(j)?j.length:null};}
const CASES=[
 ['get_agent_commission_list','admin',{p_status_focus:null}],
 ['get_agent_commission_list','distributor',{p_status_focus:null}],
 ['get_pending_dues_by_agent','admin',{}],
 ['get_pending_dues_by_agent','distributor',{}],
 ['get_pending_dues_by_agent','branch',{}],
 ['get_pending_dues_by_branch','admin',{}],
 ['get_pending_dues_by_branch','distributor',{}],
 ['get_branch_pending_contributions','distributor',{p_branch_id:null}],
 ['get_branch_pending_contributions','admin',{p_branch_id:null}],
 ['get_distributor_rollup','admin',{}],
 ['get_top_entities','admin',{p_level:'agent',p_sort_key:'aum',p_limit:2000}],
 ['search_entities','admin',{p_q:'a'}],
 ['get_admin_attention_rows','admin',{p_type:'dormantSubscribers',p_limit:5000}],
 ['list_nominee_claims','admin',{p_status:null}],
 ['list_access_requests','admin',{p_status:null}],
 ['get_breadcrumb','admin',{p_level:'agent',p_ids:{agent:'a-001'}}],
];
console.log('=== RPC row counts vs the 1000-row cap ===');
for(const[n,role,args] of CASES){
  const r=await rpc(n,role,args);
  const flag=(r.n===1000)?'  <-- EXACTLY 1000: CAPPED?':'';
  console.log(`http=${r.status} ${n.padEnd(32)} role=${role.padEnd(11)} rows=${String(r.n).padStart(5)} content-range=${r.cr}${flag}`);
}
