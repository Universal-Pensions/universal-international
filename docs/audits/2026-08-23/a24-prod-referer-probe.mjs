import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
const rows = [];
p.on('request', (r) => {
  let h=''; try { h = new URL(r.url()).host; } catch { return; }
  if (h.includes('vercel.app')) return;
  rows.push({ host: h, referer: r.headers().referer ?? '(none)', origin: r.headers().origin ?? '(none)', cookie: r.headers().cookie ? 'PRESENT' : '(none)', auth: r.headers().authorization ? 'PRESENT' : '(none)' });
});
for (const path of ['/', '/subscribers', '/about']) { await p.goto('https://uganda-dashboard.vercel.app' + path, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4000); }
const seen = new Set(); 
for (const r of rows) { const k = JSON.stringify(r); if (seen.has(k)) continue; seen.add(k); console.log(JSON.stringify(r)); }
console.log('total third-party requests:', rows.length, 'distinct hosts:', [...new Set(rows.map(r=>r.host))].join(', '));
await b.close();
