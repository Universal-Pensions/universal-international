/* Invariant (entities.js:237): "Each list MUST be a superset of the columns its
   mapper dereferences." Verify it for every NARROW projection in src/services. */
import fs from 'node:fs';
const D='docs/audits/2026-08-23/a08r2';
const MAP=new Map(JSON.parse(fs.readFileSync(`${D}/mappers.json`,'utf8')).map(m=>[m.file+'::'+m.mapper,m]));
const COLS=new Map();
for(const l of fs.readFileSync(`${D}/columns.txt`,'utf8').trim().split('\n')){const[t,c]=l.split('|');if(!COLS.has(t))COLS.set(t,new Set());COLS.get(t).add(c);}
const PAIRS=[
 ['entities.js LEVEL_LIST_COLUMNS.region  -> mapRegion','regions','src/services/entities.js::mapRegion','id, name, parent_id, center_lng, center_lat'],
 ['entities.js LEVEL_LIST_COLUMNS.district-> mapDistrict','districts','src/services/entities.js::mapDistrict','id, name, region_id, center_lng, center_lat, active'],
 ['entities.js LEVEL_LIST_COLUMNS.subscriber -> mapSubscriber','subscribers','src/services/entities.js::mapSubscriber','id, name, phone, email, gender, age, dob, nin, occupation, agent_id, district_id, kyc_status, is_active, registered_date, products_held, contribution_history, current_unit_value, unit_value_as_of, subscriber_balances(total_balance)'],
 ['entities.js LEVEL_LIST_COLUMNS.distributor -> mapDistributor','distributors','src/services/entities.js::mapDistributor','id, name, parent_id, manager_name, manager_phone, manager_email, status, created_at'],
 ['agent.js:167 -> mapAgentSubscriberRow','subscribers','src/services/agent.js::mapAgentSubscriberRow','id, name, phone, email, gender, age, kyc_status, is_active, registered_date, last_contribution_date, products_held, contribution_history, contribution_schedules(...), subscriber_balances(...), insurance_policies(...), subscriber_insurance_products(...)'],
 ['subscriber.js:518 -> mapTransactionRow','transactions','src/services/subscriber.js::mapTransactionRow','id, subscriber_id, agent_id, type, source, amount, date, status, method, txn_ref, bucket, split_retirement, split_emergency, contribution_run_id'],
];
const EMBED_TABLES=new Set([...COLS.keys()]);
let issues=0,checked=0;
for(const[label,tbl,mkey,sel] of PAIRS){
  const m=MAP.get(mkey); if(!m){console.log('NO MAPPER',mkey);continue}
  const proj=new Set(sel.split(',').map(s=>s.trim().replace(/\(.*$/,'')).filter(Boolean));
  const tcols=COLS.get(tbl);
  const missing=m.props.filter(p=>{
    if(proj.has(p))return false;
    if(EMBED_TABLES.has(p))return false;         // embed alias
    if(!tcols.has(p))return false;               // handled by the other check (no such column at all)
    return true;
  });
  checked+=m.props.length;
  if(missing.length){issues++;console.log(`GAP  ${label}\n     mapper reads real columns NOT projected: ${missing.join(', ')}`);}
  else console.log(`OK   ${label}  (${m.props.length} props, all projected or embedded)`);
}
console.log(JSON.stringify({pairs:PAIRS.length,propsChecked:checked,gaps:issues}));
