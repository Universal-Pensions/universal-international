import fs from 'node:fs'; import path from 'node:path'; import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={}; for(const l of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=`${env.VITE_SUPABASE_URL.replace(/\/+$/,'')}/rest/v1`, ANON=env.VITE_SUPABASE_ANON_KEY, S=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const t=await new SignJWT({role:'authenticated',app_role:'distributor',phone:'+256700000021',distributorId:'d-001'}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject('+256700000021').setIssuedAt().setExpirationTime('1h').sign(S);
async function ids(){const r=await fetch(`${BASE}/rpc/get_agent_commission_list`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:JSON.stringify({p_status_focus:null})});const j=await r.json();return j.map(x=>x.agent_id);}
const A=await ids(), B=await ids(), C=await ids();
const sa=new Set(A), sb=new Set(B);
const onlyA=[...sa].filter(x=>!sb.has(x)), onlyB=[...sb].filter(x=>!sa.has(x));
console.log(`call1 n=${A.length} call2 n=${B.length} call3 n=${C.length}`);
console.log(`set difference call1\\call2 = ${onlyA.length}; call2\\call1 = ${onlyB.length}`);
console.log(`row-order identical call1 vs call2: ${JSON.stringify(A)===JSON.stringify(B)}`);
console.log(`row-order identical call1 vs call3: ${JSON.stringify(A)===JSON.stringify(C)}`);
console.log('sample missing agents (in call1 not call2):', onlyA.slice(0,5));
// which agents are NEVER returned?
console.log('first 3 ids call1:', A.slice(0,3), ' last 3:', A.slice(-3));

// Find an agent under d-001 WITH pending dues that the truncated list omits.
const r=await fetch(`${BASE}/rpc/get_pending_dues_by_agent`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${t}`,'Content-Type':'application/json'},body:'{}'});
const dues=await r.json();
const inList=new Set(dues.map(x=>x.agent_id));
fs.writeFileSync(path.join(ROOT,'docs/audits/2026-08-23/a08r2/dues-ids.json'),JSON.stringify([...inList]));
console.log('\ndues list returned', dues.length, 'agent ids; wrote dues-ids.json');
console.log('sum in list =', dues.reduce((s,x)=>s+Number(x.pending_amount||0),0));
