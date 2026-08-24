// CHECK 3b (targeted) — does tab A's distributor UI render ADMIN-scoped rows
// after tab B replaced the shared JWT?  Compare the Subscribers list total.
import { browser, uiSignIn, PHONES } from './a22-lib.mjs';

const { b, ctx } = await browser();

async function subscribersTotal(page, label) {
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button,a')].find(e => /^Subscribers$/i.test((e.innerText||'').trim()));
    if (t) t.click();
  });
  await page.waitForTimeout(7000);
  const s = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  const m = s.match(/Showing\s+([\d,]+)\s+of\s+([\d,]+)/i) || s.match(/([\d,]{3,})\s+subscribers/i);
  console.log(`[${label}] subscribers page marker: ${m ? m[0] : 'NOT FOUND'}`);
  console.log(`[${label}] head: ${s.slice(120, 480)}`);
  return m ? m[0] : null;
}

// Control: a clean distributor tab
const C = await ctx.newPage();
await uiSignIn(C, { landingPath: '/distributors', phone: PHONES.distributor });
await C.waitForTimeout(6000);
const control = await subscribersTotal(C, 'CONTROL distributor');
await C.close();

// Control: a clean admin tab
const D = await ctx.newPage();
await uiSignIn(D, { landingPath: '/admin', phone: PHONES.admin });
await D.waitForTimeout(6000);
const adminControl = await subscribersTotal(D, 'CONTROL admin');
await D.close();

// The experiment
const A = await ctx.newPage();
await uiSignIn(A, { landingPath: '/distributors', phone: PHONES.distributor });
await A.waitForTimeout(6000);
const B2 = await ctx.newPage();
await uiSignIn(B2, { landingPath: '/admin', phone: PHONES.admin });
await B2.waitForTimeout(5000);
console.log('\n>>> shared token is now the ADMIN one. Tab A still renders the distributor shell.');
await A.bringToFront();
const after = await subscribersTotal(A, 'TAB A after admin login in tab B');
console.log('\nCONTROL distributor =', control);
console.log('CONTROL admin       =', adminControl);
console.log('TAB A after switch  =', after);
console.log('LEAK?', after && adminControl && after === adminControl && after !== control ? 'YES — admin-scoped rows in the distributor UI' : 'no / inconclusive');
await A.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-twotab-leak.png' });
await b.close(); process.exit(0);
