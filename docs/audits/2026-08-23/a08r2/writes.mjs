import fs from 'node:fs';
const D='docs/audits/2026-08-23/a08r2';
const COLS=new Map();
for(const l of fs.readFileSync(`${D}/columns.txt`,'utf8').trim().split('\n')){const[t,c,ty,nn,hd]=l.split('|');if(!COLS.has(t))COLS.set(t,new Map());COLS.get(t).set(c,{ty,nn:nn==='t',hd:hd==='t'});}
const CG=new Map();
for(const l of fs.readFileSync(`${D}/colgrants.txt`,'utf8').trim().split('\n')){const[t,g,p,c]=l.split('|');const k=`${t}|${g}|${p}`;if(!CG.has(k))CG.set(k,new Set());CG.get(k).add(c);}
const TG=new Set(fs.readFileSync(`${D}/tablegrants.txt`,'utf8').trim().split('\n').map(l=>l));
const SITES=[
 ['src/services/entities.js:1065','branches','INSERT',['id','name','district_id','manager_name','manager_phone','manager_email','status','distributor_id']],
 ['src/services/entities.js:1101','agents','INSERT',['id','name','gender','employee_id','branch_id','phone','email','status','languages','specialties']],
 ['src/services/entities.js:1133','branches','UPDATE',['name','district_id','manager_name','manager_phone','manager_email','status']],
 ['src/services/entities.js:1185','distributors','UPDATE',['manager_name','manager_phone','manager_email']],
 ['src/services/entities.js:1411','agents','UPDATE',['status']],
 ['src/services/subscriber.js:1049','contribution_schedules','UPDATE',['frequency','amount','retirement_pct','emergency_pct','include_insurance','insurance_choice_made','next_due_date','contribution_indexation_pct','updated_at']],
 ['src/services/subscriber.js:1212','insurance_policies','INSERT',['subscriber_id','cover','premium_monthly','status','updated_at']],
 ['src/services/subscriber.js:1212','insurance_policies','UPDATE',['subscriber_id','cover','premium_monthly','status','updated_at']],
 ['src/services/subscriber.js:1219','subscriber_insurance_products','UPDATE',['cover','premium_monthly','status','updated_at']],
 ['src/services/subscriber.js:1399','insurance_policies','UPDATE',['status','renewal_date','updated_at']],
 ['src/services/subscriber.js:1403','subscriber_insurance_products','UPDATE',['status','renewal_date','updated_at']],
 ['src/services/subscriber.js:1411','transactions','INSERT',['id','subscriber_id','type','amount','date','status','method','txn_ref']],
 ['src/services/subscriber.js:1463','subscribers','UPDATE',['name','email','phone','occupation','consent_at']],
 // api/ + server/ (service_role)
 ['api/access-request.ts:132','access_requests','INSERT',null],
 ['api/contact.ts:62','contact_submissions','INSERT',['id','name','email','message']],
 ['api/kyc/agent-referral.ts:95','agent_referrals','INSERT',['id','ticket_id','phone','reason','stage','tracking_id','session_id','status','eta']],
 ['api/nominee-claim.ts:163','nominee_claims','INSERT',null],
 ['api/auth/change-password.ts:146','users','UPDATE',['password_hash']],
 ['api/auth/verify-otp.ts:94','users','INSERT',['id','phone','role','last_login_at','password_hash']],
 ['api/auth/verify-password.ts:50','users','UPDATE',['last_login_at']],
];
let bad=0,keys=0;
for(const[label,tbl,priv,cols] of SITES){
  if(!cols) continue;
  const t=COLS.get(tbl); if(!t){console.log(`BAD TABLE ${tbl} @ ${label}`);bad++;continue}
  const grantee=(label.startsWith('api/')||label.startsWith('server/'))?'service_role':'authenticated';
  const gset=CG.get(`${tbl}|${grantee}|${priv}`)||new Set();
  for(const c of cols){keys++;
    if(!t.has(c)){console.log(`FAIL column-missing  ${tbl}.${c}  ${priv} @ ${label}`);bad++;continue}
    if(!gset.has(c)){console.log(`FAIL grant-missing  ${grantee} ${priv} ${tbl}.${c} @ ${label}`);bad++}
  }
  if(priv==='INSERT'){
    const provided=new Set(cols);
    for(const[c,m] of t){ if(m.nn && !m.hd && !provided.has(c)) console.log(`WARN notnull-nodefault-not-provided ${tbl}.${c} (${m.ty}) @ ${label}`); }
  }
}
console.log(JSON.stringify({sites:SITES.filter(s=>s[3]).length,keysChecked:keys,failures:bad}));
