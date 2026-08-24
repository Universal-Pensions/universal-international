// CHECK 2 (re-run) — poll for the toast, which auto-dismisses after 3500 ms.
import { browser, uiSignIn, PHONES, BASE } from './a22-lib.mjs';

async function pollToast(p, ms = 6000) {
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await p.evaluate(() => [...document.querySelectorAll('[class*="toast" i],[role="status"],[role="alert"]')]
      .map(e => (e.innerText || '').trim().replace(/\s+/g, ' ')).filter(Boolean));
    t.forEach(x => seen.add(`+${Date.now() - t0}ms  ${x}`));
    await p.waitForTimeout(200);
  }
  return [...seen];
}

const { b, ctx } = await browser();

/* 2a — subscriber useUpdateProfile */
{
  const p = await ctx.newPage();
  await uiSignIn(p, { landingPath: '/', phone: PHONES.subscriber });
  await p.waitForTimeout(3000);
  await p.goto(BASE + '/dashboard/settings/profile', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  const box = p.locator('input[type="email"]:visible').first();
  const before = await box.inputValue();
  await p.route('**/rest/v1/subscribers**', r => r.request().method() === 'PATCH'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected 500"}' })
    : r.continue());
  await box.fill('a22-probe@example.invalid');
  await p.waitForTimeout(300);
  const mid = await box.inputValue();
  await p.locator('button:visible', { hasText: /save/i }).first().click();
  const toasts = await pollToast(p, 6000);
  console.log('\n=== 2a useUpdateProfile (subscriber) ===');
  console.log('before:', before, '| optimistic:', mid, '| after failure:', await box.inputValue());
  console.log('toasts:', JSON.stringify(toasts));
  await p.close();
}

/* 2c — agent useUpdateSubscriberSchedule */
{
  const p = await ctx.newPage();
  await uiSignIn(p, { landingPath: '/', phone: PHONES.agent });
  await p.waitForTimeout(5000);
  console.log('\n=== 2c useUpdateSubscriberSchedule (agent) ===');
  console.log('agent url:', p.url());
  const nav = await p.evaluate(() => [...document.querySelectorAll('button,a')].filter(e=>e.offsetParent).map(e=>(e.innerText||'').trim().split('\n')[0]).filter(Boolean).slice(0,30));
  console.log('agent nav:', JSON.stringify(nav));
  console.log('agent screen:', (await p.evaluate(()=>document.body.innerText.replace(/\s+/g,' '))).slice(0,400));
  await p.screenshot({ path: 'docs/audits/2026-08-23/scratch/a22-agent-home.png' });
  await p.close();
}
await b.close(); process.exit(0);
