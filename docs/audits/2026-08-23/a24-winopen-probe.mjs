import { chromium, webkit, firefox } from '@playwright/test';
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await engine.launch();
  const p = await (await b.newContext()).newPage();
  await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  const r = await p.evaluate(() => {
    const out = {};
    const a = window.open('', '_blank', 'noopener,noreferrer');
    out.withNoopener = a === null ? 'NULL' : 'window';
    try { if (a) a.close(); } catch { /* */ }
    const c = window.open('', '_blank');
    out.withoutFeatures = c === null ? 'NULL' : 'window';
    if (c) {
      try {
        c.document.open(); c.document.write('<b id=t>hi</b>'); c.document.close();
        out.sameOriginWrite = c.document.getElementById('t') ? 'OK' : 'no-node';
        out.popupOrigin = c.location.origin;
        out.canReadOpenerLocalStorage = (() => { try { return typeof c.localStorage.getItem === 'function' ? 'yes' : 'no'; } catch (e) { return 'blocked: ' + e.name; } })();
      } catch (e) { out.sameOriginWrite = 'threw ' + e.name; }
      c.close();
    }
    return out;
  });
  console.log(name, JSON.stringify(r));
  await b.close();
}
