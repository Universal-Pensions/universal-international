// A22 throwaway — money-write error matrix. All target RPCs are intercepted and
// FAILED, so no live money row is ever written.
import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const FLOWS = {
  withdrawal:  { role: 'subscriber', path: '/dashboard/withdraw', rpc: 'request_withdrawal',
                 steps: [/^Withdraw savings/i, /^Request withdrawal$/i, /^Continue|^Next|^Review/i, /^Confirm|^Withdraw UGX|^Request/i] },
  employerRun: { role: 'employer',   path: '/dashboard/runs',      rpc: 'submit_employer_contribution_run',
                 steps: [/^New contribution run$/i, /^Continue|^Review|^Next/i, /^Confirm|^Run|^Pay/i] },
  navPublish:  { role: 'admin',      path: '/dashboard/nav',       rpc: 'publish_nav_snapshot',
                 steps: [/^Publish|^New price|^Add price/i, /^Continue|^Review|^Next/i, /^Confirm|^Publish/i] },
};
const MODES = {
  '500':   (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"XX000","message":"injected server error"}' }),
  'abort': (route) => route.abort('failed'),
  '400':   (route) => route.fulfill({ status: 400, contentType: 'application/json', body: '{"code":"P0001","message":"period already funded"}' }),
};
const which = process.argv[2];
const f = FLOWS[which];
const b = await chromium.launch({ headless: true });
for (const [mode, handler] of Object.entries(MODES)) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: `e2e/.auth/${f.role}.json` });
  const page = await ctx.newPage();
  let hit = 0;
  await page.route(`**/rest/v1/rpc/${f.rpc}**`, (route) => { hit++; return handler(route); });
  await page.goto(BASE + f.path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  const trail = [];
  for (const rx of f.steps) {
    const btn = page.getByRole('button', { name: rx }).first();
    if (await btn.count() && await btn.isVisible().catch(()=>false) && await btn.isEnabled().catch(()=>false)) {
      const label = (await btn.innerText()).replace(/\s+/g,' ').trim().slice(0,40);
      await btn.click().catch(()=>{});
      trail.push(label);
      await page.waitForTimeout(1500);
      // fill any empty visible text/number input that appeared (amount fields)
      const inputs = page.locator('input:visible:not([name="message"])');
      const n = await inputs.count();
      for (let i = 0; i < n; i++) {
        const el = inputs.nth(i);
        const ty = await el.getAttribute('type');
        if (ty && !['text','number','tel'].includes(ty)) continue;
        if (!(await el.inputValue())) { await el.fill('10000').catch(()=>{}); trail.push('fill=10000'); }
      }
      await page.waitForTimeout(600);
    } else { trail.push(`MISS(${rx.source.slice(0,22)})`); }
  }
  const samples = [];
  for (const ms of [300, 400, 500, 800]) {
    await page.waitForTimeout(ms);
    samples.push(JSON.stringify(await page.locator('[role="alert"],[role="status"]').allInnerTexts()));
  }
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g,' '));
  console.log(`\n### ${which}/${f.rpc} mode=${mode} intercepted=${hit}`);
  console.log('  trail:', JSON.stringify(trail));
  console.log('  alerts:', samples.join(' '));
  console.log('  buttons now:', JSON.stringify((await page.getByRole('button').allInnerTexts()).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).slice(0,14)));
  console.log('  success words:', /success|done|complete|funded|published|submitted|received/i.test(after) ? (after.match(/.{0,60}(success|done|complete|funded|published|submitted|received).{0,60}/i)||[])[0] : 'none');
  await page.screenshot({ path: `docs/audits/2026-08-23/scratch/a22b-money-${which}-${mode}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
