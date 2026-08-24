// CHECK 4 — auth expiry. Three sub-cases.
import { browser, mint, userObj, uiSignIn, PHONES, BASE } from './a22-lib.mjs';

const { b, ctx } = await browser();

// ---- 4a: startup gate. Expired token + stored session -> clean logout to '/'
{
  const p = await ctx.newPage();
  const dead = await mint('subscriber', { ttlSec: -3600 });
  await p.addInitScript(([t, u]) => {
    localStorage.setItem('upensions_token', t);
    localStorage.setItem('upensions_auth', u);
  }, [dead, JSON.stringify(userObj('subscriber'))]);
  await p.goto(BASE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  console.log('[4a startup gate] url =', p.url());
  console.log('[4a startup gate] localStorage keys =', JSON.stringify(await p.evaluate(() => Object.keys(localStorage))));
  console.log('[4a startup gate] body head =', (await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '))).slice(0,180));
  await p.close();
}

// ---- 4b: MID-SESSION expiry. Sign in live, then swap the stored token for an
//      expired one and force a refetch. isJwtExpired() makes supabaseClient send
//      the ANON key instead. What does the user see?
{
  const p = await ctx.newPage();
  const seen = [];
  p.on('response', async r => {
    if (r.url().includes('/rest/v1/')) seen.push(r.status() + ' ' + r.url().split('/rest/v1/')[1].split('?')[0]);
  });
  await uiSignIn(p, { landingPath: '/distributors', phone: PHONES.distributor });
  await p.waitForTimeout(6000);
  const dead = await mint('distributor', { ttlSec: -3600 });
  await p.evaluate((t) => localStorage.setItem('upensions_token', t), dead);
  console.log('\n[4b mid-session] token replaced with an EXPIRED one (auth object left intact).');
  seen.length = 0;
  // force fresh mounts / fetches
  await p.evaluate(() => { const t=[...document.querySelectorAll('button,a')].find(e=>/^Agents$/i.test((e.innerText||'').trim())); if(t)t.click(); });
  await p.waitForTimeout(6000);
  console.log('[4b] url =', p.url());
  console.log('[4b] responses:', JSON.stringify([...new Set(seen)]));
  const body = await p.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  console.log('[4b] screen:', body.slice(100, 700));
  console.log('[4b] logged out? token =', await p.evaluate(() => localStorage.getItem('upensions_token') ? 'STILL PRESENT' : 'cleared'));
  await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-4b-midsession-expiry.png' });
  await p.close();
}

// ---- 4c: /api/* 401 path
{
  const p = await ctx.newPage();
  await uiSignIn(p, { landingPath: '/', phone: PHONES.subscriber });
  await p.waitForTimeout(5000);
  console.log('\n[4c] signed in as subscriber, url =', p.url());
  await p.route('**/api/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'session_expired' }) }));
  const res = await p.evaluate(async () => {
    try { const r = await fetch('/api/kyc/status', { headers: { Authorization: 'Bearer x' } }); return r.status; }
    catch (e) { return 'threw ' + e.message; }
  });
  console.log('[4c] raw fetch status (route-intercepted):', res);
  // now drive it through the app's own apiFetch by hitting a page that uses /api
  await p.evaluate(() => { const t=[...document.querySelectorAll('button,a')].find(e=>/Account settings|Profile/i.test((e.innerText||'').trim())); if(t)t.click(); });
  await p.waitForTimeout(5000);
  console.log('[4c] url after an /api 401 while browsing =', p.url());
  console.log('[4c] token =', await p.evaluate(() => localStorage.getItem('upensions_token') ? 'STILL PRESENT' : 'cleared'));
  await p.close();
}
await b.close(); process.exit(0);
