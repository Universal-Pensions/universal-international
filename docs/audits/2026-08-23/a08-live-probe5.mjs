// A08 — reproduce getAllAtLevel()'s parallel unordered range() fan-out and test
// whether the union of pages equals the true row set. READ-ONLY (GETs only).
import fs from 'node:fs';
import { SignJWT } from 'jose';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const env={};for(const l of fs.readFileSync(ROOT+'/.env.local','utf8').split('\n')){const m=l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const BASE=env.VITE_SUPABASE_URL.replace(/\/+$/,'')+'/rest/v1';const ANON=env.VITE_SUPABASE_ANON_KEY;
const SECRET=new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const T=await new SignJWT({role:'authenticated',app_role:'admin',phone:'+256700000041',adminId:'admin-001'}).setProtectedHeader({alg:'HS256'}).setIssuer('upensions').setAudience('authenticated').setSubject('+256700000041').setIssuedAt().setExpirationTime('1h').sign(SECRET);
const H={apikey:ANON,Authorization:'Bearer '+T};
const PAGE=1000;
async function page(from,to){const r=await fetch(`${BASE}/subscribers?select=id`,{headers:{...H,Range:`${from}-${to}`,'Range-Unit':'items'}});return JSON.parse(await r.text()).map(x=>x.id);}
async function exact(){const r=await fetch(`${BASE}/subscribers?select=id`,{headers:{...H,Prefer:'count=exact'},method:'HEAD'});return Number((r.headers.get('content-range')||'/0').split('/')[1]);}
for(let trial=1;trial<=5;trial++){
  const total=await exact();
  const first=await page(0,PAGE-1);
  const reqs=[];for(let f=PAGE;f<total;f+=PAGE)reqs.push(page(f,Math.min(f+PAGE-1,total-1)));
  const pages=await Promise.all(reqs);
  const all=[...first,...pages.flat()];
  const uniq=new Set(all);
  console.log(`trial ${trial}: exactTotal=${total} fetched=${all.length} distinct=${uniq.size} duplicates=${all.length-uniq.size} missing=${total-uniq.size}`);
}
