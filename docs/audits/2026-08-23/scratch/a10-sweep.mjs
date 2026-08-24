import { launch, loginSubscriber, BASE } from './a10-login.mjs';

const WIDTH = parseInt(process.argv[2] || '1440', 10);
const HEIGHT = WIDTH < 700 ? 812 : 950;
const PHONE = process.argv[3] || '+256711000001';
const TAG = WIDTH < 700 ? 'm' : (WIDTH < 1024 ? String(WIDTH) : 'd');

const ROUTES = [
  ['/dashboard', 'index'],
  ['/dashboard/save', 'save'],
  ['/dashboard/save/schedule', 'save-schedule'],
  ['/dashboard/withdraw', 'withdraw'],
  ['/dashboard/withdraw/savings', 'withdraw-savings'],
  ['/dashboard/withdraw/claim', 'withdraw-claim'],
  ['/dashboard/claim', 'claim-redirect'],
  ['/dashboard/activity', 'activity'],
  ['/dashboard/reports', 'reports'],
  ['/dashboard/reports/all-transactions', 'reports-all-transactions'],
  ['/dashboard/reports/contributions-summary', 'reports-contributions-summary'],
  ['/dashboard/reports/withdrawals-history', 'reports-withdrawals-history'],
  ['/dashboard/reports/insurance-statement', 'reports-insurance-statement'],
  ['/dashboard/reports/annual-statement', 'reports-annual-statement'],
  ['/dashboard/policies', 'policies'],
  ['/dashboard/help', 'help'],
  ['/dashboard/agent', 'agent'],
  ['/dashboard/settings', 'settings'],
  ['/dashboard/settings/profile', 'settings-profile'],
  ['/dashboard/settings/nominees', 'settings-nominees'],
  ['/dashboard/settings/insurance', 'settings-insurance'],
  ['/dashboard/settings/notifications', 'settings-notifications-redirect'],
  ['/dashboard/settings/security', 'settings-security-redirect'],
];

const { b, page } = await launch(WIDTH, HEIGHT);
const consoleErrs = [];
page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0,160)); });
page.on('pageerror', e => consoleErrs.push('PAGEERROR: ' + e.message.slice(0,160)));

try {
  await loginSubscriber(page, PHONE, '123456');
  console.log(`=== SWEEP width=${WIDTH} tag=${TAG} phone=${PHONE} ===`);
  for (const [route, name] of ROUTES) {
    consoleErrs.length = 0;
    let finalUrl='', h1='', errBoundary=false, bodyLen=0, sample='';
    try {
      await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2200);
      finalUrl = page.url().replace(BASE,'');
      errBoundary = await page.getByText(/something went wrong/i).count() > 0;
      const h1c = await page.locator('h1').count();
      h1 = h1c ? (await page.locator('h1').first().innerText()).replace(/\n+/g,' ').slice(0,60) : '(no h1)';
      const body = await page.innerText('body');
      bodyLen = body.length;
      sample = body.replace(/\n+/g,' | ').slice(0,120);
      await page.screenshot({ path: `docs/audits/2026-08-23/screenshots/subscriber/${name}-${TAG}.png`, fullPage: false });
    } catch (e) { sample = 'NAV-ERR: ' + e.message.slice(0,80); }
    const errs = consoleErrs.length ? ` CONSOLE[${consoleErrs.length}]:${consoleErrs[0]}` : '';
    console.log(`${route}\n  -> url=${finalUrl} h1="${h1}" errB=${errBoundary} len=${bodyLen}${errs}\n     ${sample}`);
  }
} catch (e) { console.log('SWEEP FAILED:', e.message.slice(0,300)); }
finally { await b.close(); }
