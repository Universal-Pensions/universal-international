import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await signIn(p, { landingPath: '/', phone: '+256711000001' });
await p.waitForTimeout(3000);
await p.goto('http://localhost:5173/dashboard/settings/profile', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(7000);
const dump = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('input, textarea, select, button').forEach((el) => {
    out.push(`${el.tagName}${el.type ? '['+el.type+']' : ''} name=${el.name||''} value=${(el.value||'').slice(0,30)} label=${(el.getAttribute('aria-label')||el.innerText||'').trim().replace(/\s+/g,' ').slice(0,40)}`);
  });
  return out;
});
console.log('URL:', p.url());
console.log(dump.join('\n'));
await b.close(); process.exit(0);
