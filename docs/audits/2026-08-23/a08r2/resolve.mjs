// Manually-resolved dynamic select/embed sites, verified against live columns.
import fs from 'node:fs';
const D='docs/audits/2026-08-23/a08r2';
const COLS=new Map();
for(const l of fs.readFileSync(`${D}/columns.txt`,'utf8').trim().split('\n')){const[t,c]=l.split('|');if(!COLS.has(t))COLS.set(t,new Set());COLS.get(t).add(c);}
const FK=fs.readFileSync(`${D}/fk.txt`,'utf8').trim().split('\n').map(l=>{const[a,b,c,d,e]=l.split('|');return{child:a,childCol:b,parent:c,parentCol:d,name:e};});
function parseSel(sel){const cols=[],em=[];let d=0,cur='',parts=[];for(const ch of sel){if(ch==='(')d++;if(ch===')')d--;if(ch===','&&d===0){parts.push(cur);cur='';continue}cur+=ch}if(cur.trim())parts.push(cur);
 for(const r of parts){const p=r.trim().replace(/\s+/g,'');if(!p)continue;const m=p.match(/^([A-Za-z_][\w]*)\(([\s\S]*)\)$/);if(m){em.push({name:m[1],inner:m[2]});continue}if(p==='*')continue;cols.push(p)}return{cols,em};}
const SITES=[
 ['src/services/agent.js:167','subscribers','id, name, phone, email, gender, age, kyc_status, is_active, registered_date, last_contribution_date, products_held, contribution_history, contribution_schedules(frequency, amount, retirement_pct, emergency_pct, include_insurance, insurance_choice_made, next_due_date), subscriber_balances(total_balance, retirement_balance, emergency_balance), insurance_policies(cover, premium_monthly, status), subscriber_insurance_products(product, status)'],
 ['src/services/employer.js:396 MEMBER_SELECT','subscribers','*, subscriber_balances(*), contribution_schedules(*), insurance_policies(*), nominees(*)'],
 ['src/services/employer.js:432 MEMBER_SELECT','subscribers','*, subscriber_balances(*), contribution_schedules(*), insurance_policies(*), nominees(*)'],
 ['src/services/subscriber.js:518','transactions','id, subscriber_id, agent_id, type, source, amount, date, status, method, txn_ref, bucket, split_retirement, split_emergency, contribution_run_id'],
 ['entities LEVEL_LIST_COLUMNS.region','regions','id, name, parent_id, center_lng, center_lat'],
 ['entities LEVEL_LIST_COLUMNS.district','districts','id, name, region_id, center_lng, center_lat, active'],
 ['entities LEVEL_LIST_COLUMNS.subscriber','subscribers','id, name, phone, email, gender, age, dob, nin, occupation, agent_id, district_id, kyc_status, is_active, registered_date, products_held, contribution_history, current_unit_value, unit_value_as_of, subscriber_balances(total_balance)'],
 ['entities LEVEL_LIST_COLUMNS.distributor','distributors','id, name, parent_id, manager_name, manager_phone, manager_email, status, created_at'],
];
let bad=0,checked=0,embeds=0;
for(const[label,tbl,sel] of SITES){
  const t=COLS.get(tbl); if(!t){console.log(`MISSING TABLE ${tbl} @ ${label}`);bad++;continue}
  const {cols,em}=parseSel(sel);
  for(const c of cols){checked++;if(!t.has(c)){console.log(`BAD COLUMN ${tbl}.${c} @ ${label}`);bad++}}
  for(const e of em){embeds++;const tt=COLS.get(e.name);
    if(!tt){console.log(`BAD EMBED ${e.name} @ ${label}`);bad++;continue}
    const nfk=FK.filter(k=>(k.child===tbl&&k.parent===e.name)||(k.parent===tbl&&k.child===e.name));
    if(nfk.length===0){console.log(`EMBED NO FK ${tbl}->${e.name} @ ${label}`);bad++}
    if(nfk.length>1){console.log(`EMBED AMBIGUOUS ${tbl}->${e.name} (${nfk.length} fks) @ ${label}`);bad++}
    const sub=parseSel(e.inner);
    for(const c of sub.cols){checked++;if(!tt.has(c)){console.log(`BAD EMBED COLUMN ${e.name}.${c} @ ${label}`);bad++}}
  }
}
console.log(JSON.stringify({sites:SITES.length,colsChecked:checked,embeds,bad}));
