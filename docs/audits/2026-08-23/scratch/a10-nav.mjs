import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, page } = await launch(1440, 950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  // Click each desktop side-nav item and confirm route + no crash
  const navItems = ['Save','Withdrawals','Analytics','Your agent','Help','Account settings','Home'];
  for (const label of navItems) {
    const link = page.getByRole('link', { name: new RegExp('^'+label+'$','i') }).first();
    const btn = (await link.count()) ? link : page.getByRole('button', { name: new RegExp('^'+label+'$','i') }).first();
    if (await btn.count() === 0) { console.log(`nav "${label}" -> NOT FOUND`); continue; }
    await btn.click();
    await page.waitForTimeout(1200);
    const crash = await page.getByText(/something went wrong/i).count();
    console.log(`nav "${label}" -> url=${page.url().replace(BASE,'')} crash=${crash}`);
  }
  // Browser back test
  await page.goto(BASE+'/dashboard/policies',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(800);
  await page.goto(BASE+'/dashboard/help',{waitUntil:'domcontentloaded'}); await page.waitForTimeout(800);
  await page.goBack(); await page.waitForTimeout(1000);
  console.log('after goBack from help -> url=', page.url().replace(BASE,''), 'crash=', await page.getByText(/something went wrong/i).count());
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
