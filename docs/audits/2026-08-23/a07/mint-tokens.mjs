import { SignJWT } from 'jose';
const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
const wrong  = new TextEncoder().encode('wrong-secret-'.repeat(4));
const base = { sub:'admin:+256700000001', role:'authenticated', app_role:'admin', phone:'+256700000001', adminId:'admin-001' };
const now = Math.floor(Date.now()/1000);
async function mk(payload, key, hdr={alg:'HS256',typ:'JWT'}, opts={}) {
  let b = new SignJWT({...base,...payload}).setProtectedHeader(hdr).setIssuedAt(opts.iat??now);
  b = b.setIssuer(opts.iss??'upensions').setAudience(opts.aud??'authenticated').setExpirationTime(opts.exp??now+3600);
  return b.sign(key);
}
const out = {};
out.valid       = await mk({}, secret);
out.wrongsecret = await mk({}, wrong);
out.expired     = await mk({}, secret, {alg:'HS256',typ:'JWT'}, {exp: now-100});
out.futurenbf   = await (new SignJWT({...base}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuedAt(now).setNotBefore(now+9999).setIssuer('upensions').setAudience('authenticated').setExpirationTime(now+99999)).sign(secret);
out.wrongiss    = await mk({}, secret, {alg:'HS256',typ:'JWT'}, {iss:'evil'});
out.wrongaud    = await mk({}, secret, {alg:'HS256',typ:'JWT'}, {aud:'anon'});
// alg:none — hand-craft
const b64=(o)=>Buffer.from(JSON.stringify(o)).toString('base64url');
out.algnone = b64({alg:'none',typ:'JWT'})+'.'+b64({...base,exp:now+3600,iat:now,iss:'upensions',aud:'authenticated'})+'.';
// tampered app_role: sign subscriber, then flip payload role to admin without re-signing
const subTok = await mk({app_role:'subscriber', sub:'subscriber:+256711000001', subscriberId:'s-0001'}, secret);
const [h,p,s]=subTok.split('.'); const pj=JSON.parse(Buffer.from(p,'base64url')); pj.app_role='admin';
out.tampered = h+'.'+Buffer.from(JSON.stringify(pj)).toString('base64url')+'.'+s;
console.log(JSON.stringify(out));
