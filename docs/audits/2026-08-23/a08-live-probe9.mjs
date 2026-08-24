import fs from 'node:fs';
import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={};for(const l of fs.readFileSync(ROOT+'/.env.local','utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=env.VITE_SUPABASE_URL.replace(/\/+$/,'')+'/rest/v1';const ANON=env.VITE_SUPABASE_ANON_KEY;
const SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const P={branch:['branchId','b-kam-015','+256700000011'],distributor:['distributorId','d-001','+256700000021'],admin:['adminId','admin-001','+256700000041'],agent:['agentId','a-001','+256700000001'],subscriber:['subscriberId','s-0001','+256711000001'],employer:['employerId','emp-001','+256700000031']};
const c={};async function tok(r){if(c[r])return c[r];const[k,i,p]=P[r];c[r]=await new SignJWT({role:'authenticated',app_role:r,phone:p,[k]:i}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject(p).setIssuedAt().setExpirationTime('1h').sign(SECRET);return c[r];}
async function rpc(n,role,args){const t=await tok(role);const r=await fetch(`${BASE}/rpc/${n}`,{method:'POST',headers:{apikey:ANON,Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify(args)});const b=await r.text();let s='';try{const j=JSON.parse(b);s=j&&j.message?`${j.code} ${j.message}`:`OK keys=${Array.isArray(j)?'[]':Object.keys(j||{}).slice(0,6).join(',')}`;}catch{s=b.slice(0,120);}return`http=${r.status} ${s}`;}
const CASES=[
 ['get_entity_metrics_rollup','branch',{p_level:'district',p_entity_ids:['d-kampala']}],
 ['get_entity_metrics_rollup','branch',{p_level:'region',p_entity_ids:['r-central']}],
 ['get_entity_metrics_rollup','branch',{p_level:'country',p_entity_ids:['ug']}],
 ['get_entity_metrics_rollup','branch',{p_level:'branch',p_entity_ids:['b-kam-015']}],
 ['get_entity_metrics_rollup','branch',{p_level:'agent',p_entity_ids:['a-001']}],
 ['get_entity_metrics_rollup','agent',{p_level:'agent',p_entity_ids:['a-001']}],
 ['get_entity_metrics_rollup','agent',{p_level:'branch',p_entity_ids:['b-kam-015']}],
 ['get_top_entities','branch',{p_level:'branch',p_sort_key:'aum',p_limit:3}],
 ['get_top_branch','branch',{p_level:'country',p_parent_id:'ug'}],
 ['get_commission_summary','branch',{p_branch_id:'b-kam-015'}],
 ['get_entity_commission_summary','branch',{p_level:'branch',p_entity_id:'b-kam-015'}],
 ['get_agent_commission_list','branch',{p_status_focus:null}],
 ['get_agent_commission_detail','branch',{p_agent_id:'a-001'}],
 ['search_entities','branch',{p_q:'kam'}],
 ['search_entities','subscriber',{p_q:'kam'}],
 ['search_entities','employer',{p_q:'kam'}],
 ['mark_notifications_read','subscriber',{p_ids:[]}],
 ['mark_notifications_read','agent',{p_ids:[]}],
];
for(const [n,role,a] of CASES) console.log(`${n.padEnd(28)} role=${role.padEnd(12)} args=${JSON.stringify(a).slice(0,60).padEnd(60)} -> ${await rpc(n,role,a)}`);
