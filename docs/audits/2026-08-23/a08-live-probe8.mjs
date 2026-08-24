import fs from 'node:fs';
import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={};for(const l of fs.readFileSync(ROOT+'/.env.local','utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=env.VITE_SUPABASE_URL.replace(/\/+$/,'')+'/rest/v1';const ANON=env.VITE_SUPABASE_ANON_KEY;
const SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const T=await new SignJWT({role:'authenticated',app_role:'distributor',phone:'+256700000021',distributorId:'d-001'}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject('+256700000021').setIssuedAt().setExpirationTime('1h').sign(SECRET);
const COLS='id,name,phone,email,gender,age,dob,nin,occupation,agent_id,district_id,kyc_status,is_active,registered_date,products_held,contribution_history,current_unit_value,unit_value_as_of,subscriber_balances(total_balance)';
const r=await fetch(`${BASE}/subscribers?select=${encodeURIComponent(COLS)}&limit=2`,{headers:{apikey:ANON,Authorization:'Bearer '+T}});
const rows=JSON.parse(await r.text());
console.log('HTTP',r.status);
console.log('row[0] keys:',Object.keys(rows[0]).join(','));
console.log('row[0].total_contributions =',JSON.stringify(rows[0].total_contributions));
console.log('row[0].subscriber_balances =',JSON.stringify(rows[0].subscriber_balances));
console.log('SAMPLE:',JSON.stringify(rows[0]).slice(0,420));
