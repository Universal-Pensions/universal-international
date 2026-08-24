import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await signIn(p, { landingPath: '/', phone: '+256711000001' });
await p.goto('http://localhost:5173/dashboard/settings/profile', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(7000);

const nameInput = p.locator('input[type="text"]').first();
const original = await nameInput.inputValue();
console.log('original name =', original);

let hits = 0;
await p.route('**/rest/v1/subscribers*', async (route) => {
  if (route.request().method() === 'PATCH') {
    hits++;
    console.log('  >> INTERCEPT PATCH subscribers ->500 body=', route.request().postData());
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'injected 500 (audit A22)' }) });
  }
  return route.continue();
});

await nameInput.fill('AUDIT A22 ROLLBACK PROBE');
await p.waitForTimeout(300);
// find the save button
const save = p.getByRole('button', { name: /save/i }).first();
console.log('save button text =', await save.innerText().catch(()=> 'n/a'));
await save.click();
// sample the field DURING the in-flight mutation
await p.waitForTimeout(150);
console.log('name during flight =', await nameInput.inputValue());
await p.waitForTimeout(1200);
console.log('PATCH intercepts =', hits);
console.log('name AFTER failure =', await nameInput.inputValue());
const txt = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g,' ');
console.log('error visible? ', /could not|failed|error|try again|injected/i.test(txt));
console.log('toast/alert nodes:', await p.locator('[role="alert"], [role="status"]').count());
const alerts = await p.locator('[role="alert"], [role="status"]').allInnerTexts().catch(()=>[]);
console.log('alert texts:', JSON.stringify(alerts));
// header display name (rendered from currentSubscriber cache) — did the optimistic patch roll back?
console.log('body contains probe string?', txt.includes('AUDIT A22 ROLLBACK PROBE'));
console.log('body contains original name?', txt.includes(original));
await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/rollback-subscriber-profile.png' });
await b.close(); process.exit(0);
