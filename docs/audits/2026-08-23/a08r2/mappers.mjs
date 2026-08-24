/* For every `.from(T).select(COLS)` site whose result is fed to a mapper fn,
   list the snake_case properties the mapper dereferences that are NOT in the
   projection (and not embeds). That is the A08-001 failure class:
   silently-undefined field -> `?? 0` -> fabricated money. */
import fs from 'node:fs';
import path from 'node:path';
const ROOT='/Users/shubhang/Desktop/Projects/uganda-dashboard';
const D=path.join(ROOT,'docs/audits/2026-08-23/a08r2');
const COLS=new Map();
for(const l of fs.readFileSync(`${D}/columns.txt`,'utf8').trim().split('\n')){const[t,c]=l.split('|');if(!COLS.has(t))COLS.set(t,new Set());COLS.get(t).add(c);}

const files=fs.readdirSync(path.join(ROOT,'src/services')).filter(f=>f.endsWith('.js'));
const out=[];
for(const f of files){
  const src=fs.readFileSync(path.join(ROOT,'src/services',f),'utf8');
  // find mapper function bodies:  function mapX(row) { ... }  /  const mapX = (row) => {...}
  const re=/(?:function\s+(map[A-Za-z0-9_]*)\s*\(([^)]*)\)|const\s+(map[A-Za-z0-9_]*)\s*=\s*\(([^)]*)\)\s*=>)/g;
  let m;
  while((m=re.exec(src))){
    const name=m[1]||m[3];
    const params=(m[2]||m[4]||'').split(',')[0].trim();
    if(!params||!/^[A-Za-z_$][\w$]*$/.test(params)) continue;
    // body = from match end to matching close brace (rough: next `\n}` at col 0)
    const start=src.indexOf('{',re.lastIndex-1);
    if(start<0) continue;
    let depth=0,i=start,q=null;
    for(;i<src.length;i++){const c=src[i],p=src[i-1];
      if(q){if(c===q&&p!=='\\')q=null;continue}
      if(c==='"'||c==="'"||c==='`'){q=c;continue}
      if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0){i++;break}}}
    const body=src.slice(start,i);
    const props=new Set();
    const pr=new RegExp(`\\b${params}\\??\\.([a-z_][a-z0-9_]*)`,'g');
    let pm; while((pm=pr.exec(body))) props.add(pm[1]);
    // destructuring: const { a, b } = row
    const dr=new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${params}\\b`,'g');
    let dm; while((dm=dr.exec(body))) dm[1].split(',').forEach(x=>{const k=x.split(':')[0].split('=')[0].trim();if(/^[a-z_][a-z0-9_]*$/.test(k))props.add(k)});
    out.push({file:`src/services/${f}`,mapper:name,param:params,props:[...props].filter(p=>/_/.test(p)||true)});
  }
}
fs.writeFileSync(`${D}/mappers.json`,JSON.stringify(out,null,2));
console.log(`mappers found: ${out.length}`);
// Now: for each mapper, which snake_case props are NOT a column of ANY table?
const ALLCOLS=new Set(); for(const s of COLS.values()) for(const c of s) ALLCOLS.add(c);
const JS_SAFE=new Set(['map','filter','length','find','forEach','reduce','slice','toFixed','toLowerCase','toUpperCase','includes','trim','split','some','every','sort','join','push','concat','replace','at','indexOf','keys','values','entries','then','catch','call','apply','bind','constructor','toString','valueOf','hasOwnProperty']);
console.log('\n=== mapper props that exist on NO live table (candidates for the A08-001 class) ===');
let n=0;
for(const mp of out){
  const bad=mp.props.filter(p=>!ALLCOLS.has(p)&&!JS_SAFE.has(p)&&/_/.test(p));
  if(bad.length){n++;console.log(`${mp.file} :: ${mp.mapper}(${mp.param}) -> ${bad.join(', ')}`);}
}
console.log(`(${n} mappers with at least one such prop)`);
