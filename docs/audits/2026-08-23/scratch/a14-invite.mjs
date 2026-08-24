import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const BASE = 'http://localhost:5173';
const TOKEN = 'inv-097aadbd95c649d9ae4e37309e9a920d';
const run = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));

  // pending-kyc as employer first
  await signIn(page, { landingPath: '/employers', phone: '+256700000031' });
  await page.goto(BASE + '/dashboard/pending-kyc', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const pk = (await page.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  const pki = pk.indexOf('AWAITING'); console.log('===== PENDING KYC =====\n' + pk.slice(pki>=0?pki:0,(pki>=0?pki:0)+900));
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/employer/pending-kyc-1440.png', fullPage: true });

  // now the public invite route (fresh context, no auth)
  const ctx2 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page2 = await ctx2.newPage();
  const errs2=[]; page2.on('pageerror',e=>errs2.push(e.message));
  await page2.goto(BASE + '/invite/' + TOKEN, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(2500);
  console.log('\n===== /invite/:token url=' + page2.url() + ' errs=' + errs2.length + ' =====');
  const it = (await page2.locator('body').innerText()).replace(/\n{2,}/g,'\n');
  console.log(it.slice(0, 900));
  if (errs2.length) console.log('PAGEERR:', errs2.slice(0,2).join(' | '));
  await page2.screenshot({ path: 'docs/audits/2026-08-23/screenshots/employer/invite-token-375.png', fullPage: true });
  await browser.close();
};
run().catch(e => { console.error('FATAL', e); process.exit(1); });
