/* For each read RPC: diff the LIVE payload keys against the keys the calling
   service dereferences. A deref of a key the RPC never returns is the A08-001
   failure class at the RPC layer (silent undefined -> `?? 0` -> fabricated money). */
import fs from 'node:fs'; import path from 'node:path';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const D=path.join(ROOT,'docs/audits/2026-08-23/a08r2');
const shapes=JSON.parse(fs.readFileSync(path.join(D,'rpcshapes.json'),'utf8'));
const files=fs.readdirSync(path.join(ROOT,'src/services')).filter(f=>f.endsWith('.js'));
const src={}; for(const f of files) src[f]=fs.readFileSync(path.join(ROOT,'src/services',f),'utf8');

function windowAround(text, idx, before=200, after=2600){return text.slice(Math.max(0,idx-before), idx+after);}
const report=[];
for(const[fn,info] of Object.entries(shapes)){
  if(info.status!==200) continue;
  const live=new Set(info.keys);
  if(info.keys[0]&&info.keys[0].startsWith('scalar')) continue;
  for(const f of files){
    let i=src[f].indexOf(`'${fn}'`);
    while(i!==-1){
      const w=windowAround(src[f],i);
      // property accesses on `data` / `row` / `r` / `x` within the window
      const props=new Set();
      for(const m of w.matchAll(/\b(?:data|row|r|d|x|s|e|b|a)\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) props.add(m[1]);
      for(const m of w.matchAll(/const\s*\{([^}]*)\}\s*=\s*(?:data|row)\b/g)) m[1].split(',').forEach(k=>{const kk=k.split(':')[0].split('=')[0].trim(); if(/^[A-Za-z_]/.test(kk)) props.add(kk);});
      const JSAPI=new Set(['map','filter','length','find','forEach','reduce','slice','sort','some','every','join','push','concat','includes','indexOf','toFixed','toLowerCase','toUpperCase','trim','split','at','then','catch','keys','values','entries','error','data','status','message','code','details','hint','count','name','stack','rpc','from','select','eq','order','limit','single','maybeSingle','insert','update','upsert','toISOString','getFullYear','setFullYear','padStart','replace','match','test','toString','valueOf']);
      const missing=[...props].filter(p=>!live.has(p)&&!JSAPI.has(p));
      if(missing.length) report.push({rpc:fn,file:`src/services/${f}`,offsetLine:src[f].slice(0,i).split('\n').length,liveKeys:[...live],derefNotInPayload:missing});
      i=src[f].indexOf(`'${fn}'`, i+1);
    }
  }
}
fs.writeFileSync(path.join(D,'rpcderef.json'),JSON.stringify(report,null,2));
for(const r of report) console.log(`${r.file}:${r.offsetLine}  ${r.rpc}\n    deref-not-in-live-payload: ${r.derefNotInPayload.join(', ')}`);
console.log(`\nsites analysed: ${report.length} with at least one candidate`);
