import { chromium } from '@playwright/test';
import { SignJWT } from 'jose';
const BASE = 'http://localhost:5173';
const SECRET = process.env.SUPABASE_JWT_SECRET;
const now = Math.floor(Date.now()/1000);
const token = await new SignJWT({ sub:'admin-001', role:'authenticated', app_role:'admin', phone:'+256700000041', adminId:'admin-001' })
  .setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer('upensions').setAudience('authenticated')
  .setIssuedAt(now).setExpirationTime(now+3600).sign(new TextEncoder().encode(SECRET));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:1440,height:900}, storageState:{cookies:[],origins:[{origin:BASE,localStorage:[
  {name:'upensions_token',value:token},
  {name:'upensions_auth',value:JSON.stringify({role:'admin',phone:'+256700000041',name:'Default admin (head office)',adminId:'admin-001'})}]}]}});
await ctx.addInitScript(() => {
  window.__A24_EXEC = [];
  ['__A24_XSS_ORG','__A24_XSS_ORG2','__A24_XSS_REG','__A24_XSS_NAME','__A24_XSS_NAME2','__A24_XSS_EMAIL','__A24_XSS_SECTOR','__A24_XSS_DISTRICT','__A24_XSS_MSG','__A24_XSS_DEC','__A24_XSS_DEC2','__A24_XSS_CLM','__A24_XSS_CLM2','__A24_XSS_REL','__A24_XSS_DIS','__A24_XSS_NOTES']
    .forEach((k)=>Object.defineProperty(window,k,{configurable:true,set(){window.__A24_EXEC.push(k);},get(){return undefined;}}));
  window.alert = () => window.__A24_EXEC.push('alert');
});
const page = await ctx.newPage();
const bad = [];
page.on('response', async (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().slice(0,180)}`); });
await page.goto(BASE + '/dashboard', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(4000);
console.log('aria-labels on buttons:', JSON.stringify((await page.$$eval('button[aria-label]', els=>els.map(e=>e.getAttribute('aria-label')))).slice(0,40)));
for (const label of ['Access requests','Nominee claims']) {
  const b = page.locator(`button[aria-label="${label}"]`).first();
  console.log(label, 'count=', await page.locator(`button[aria-label="${label}"]`).count());
  try { await b.click({ timeout: 6000, force: true }); } catch(e){ console.log('click fail', String(e).slice(0,140)); continue; }
  await page.waitForTimeout(3500);
  const info = await page.evaluate(() => ({
    probeText: (document.body.innerText.match(/A24XSSPROBE/g)||[]).length,
    escapedPayload: (document.documentElement.innerHTML.match(/&lt;(img|script|svg|iframe)/g)||[]).length,
    liveImgs: [...document.querySelectorAll('img')].filter(i=>['x','1'].includes(i.getAttribute('src')||'')).length,
    liveSvgOnload: document.querySelectorAll('svg[onload]').length,
    injectedScripts: [...document.querySelectorAll('script')].filter(s=>(s.textContent||'').includes('__A24_XSS')).length,
    iframes: document.querySelectorAll('iframe').length,
    exec: window.__A24_EXEC,
  }));
  console.log(label, JSON.stringify(info));
  await page.screenshot({ path:`docs/audits/2026-08-23/a24-desktop-${label.replace(/\s/g,'-')}.png` });
}
console.log('\n>=400 responses:'); console.log([...new Set(bad)].join('\n'));
await browser.close();
