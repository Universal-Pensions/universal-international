// A22 throwaway — optimistic rollback + error surface: useUpdateProfile (useSubscriber.js).
// The write is ALWAYS intercepted and failed, so no live row is ever mutated.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const MODE = process.argv[2] || '500';   // 500 | abort | 400
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: 'e2e/.auth/subscriber.json' });
const page = await ctx.newPage();
let intercepted = 0;
await page.route('**/rest/v1/subscribers**', async (route) => {
  if (route.request().method() !== 'PATCH') return route.continue();
  intercepted++;
  if (MODE === 'abort') return route.abort('failed');
  if (MODE === '400') return route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"22001","message":"value too long for type character varying(80)"}' });
  return route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"XX000","message":"injected server error"}' });
});
await page.goto(BASE + '/dashboard/settings/profile', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);
const heading = () => page.evaluate(() => document.body.innerText.replace(/\s+/g,' ').match(/EDIT YOUR PERSONAL DETAILS TIER 1 · ACTIVE ([^U]*)UPU/)?.[1]?.trim());
console.log('before  :', await heading());
const name = page.locator('input[type="text"]').first();
await name.fill('ZZ AUDIT PROBE');
await page.waitForTimeout(400);
const save = page.getByRole('button', { name: /save/i }).first();
console.log('save btn:', (await save.allInnerTexts()).join('|'));
await save.click();
for (const ms of [300, 400, 500, 800, 1000]) {
  await page.waitForTimeout(ms);
  const al = await page.locator('[role="alert"],[role="status"]').allInnerTexts();
  const tt = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  console.log(`  t+~${ms}ms head=${await heading()} alerts=${JSON.stringify(al)} toast=${(tt.match(/(Could not update profile|Profile updated|injected server error)[^.]{0,40}/i)||['none'])[0]}`);
}
await page.waitForTimeout(5000);
const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
console.log('t+7.2s  :', await heading(), '| intercepted:', intercepted);
console.log('input   :', await name.inputValue());
console.log('alerts  :', JSON.stringify(await page.locator('[role="alert"],[role="status"]').allInnerTexts()));
console.log('toastish:', /couldn.t|could not|failed|error|try again|went wrong|saved/i.test(t) ? t.match(/.{0,90}(couldn.t|could not|failed|error|try again|went wrong|saved).{0,90}/i)[0] : 'NONE');
await page.screenshot({ path: `docs/audits/2026-08-23/scratch/a22b-rollback-sub-${MODE}.png`, fullPage: true });
await b.close();
