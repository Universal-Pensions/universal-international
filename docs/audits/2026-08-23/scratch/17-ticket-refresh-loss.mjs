import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await signIn(p, { landingPath: '/', phone: '+256711000001' });
await p.goto('http://localhost:5173/dashboard/agent', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(7000);
const openCount = async () => (await p.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g,' ');
  return (t.match(/Open (\d+)/) || [])[1];
}));
console.log('open tickets BEFORE:', await openCount());
await p.getByRole('button', { name: /Raise an issue/ }).click();
await p.waitForTimeout(1500);
const ctrls = await p.evaluate(() => [...document.querySelectorAll('button,input,textarea,select')].filter(e=>e.offsetParent!==null).map(e=>`${e.tagName} ${(e.getAttribute('aria-label')||e.innerText||e.placeholder||'').trim().replace(/\s+/g,' ').slice(0,45)}`));
console.log('form controls:', JSON.stringify(ctrls));
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/raise-issue-form.png' });
await b.close(); process.exit(0);
