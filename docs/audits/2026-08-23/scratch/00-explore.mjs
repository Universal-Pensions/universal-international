import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const b = await chromium.launch();
const ctx = await b.newContext();
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type()==='error') console.log('[console.error]', m.text().slice(0,200)); });
await p.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
console.log('URL:', p.url());
const html = await p.content();
console.log('TITLE:', await p.title());
// dump interactive elements
const items = await p.evaluate(() => {
  const out = [];
  document.querySelectorAll('button, a[href], input, [role="button"]').forEach((el) => {
    const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g,' ').slice(0,60);
    out.push(`${el.tagName}${el.type?'['+el.type+']':''} :: ${t}`);
  });
  return out;
});
console.log(items.join('\n'));
await b.close();
