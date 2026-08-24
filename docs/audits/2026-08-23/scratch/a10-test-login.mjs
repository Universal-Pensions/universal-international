import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, page } = await launch(1440, 950);
page.on('console', m => { if (m.type()==='error') console.log('CONSOLE.ERR:', m.text().slice(0,140)); });
try {
  await loginSubscriber(page, '+256711000001', '123456');
  console.log('URL after login:', page.url());
  const auth = await page.evaluate(() => localStorage.getItem('upensions_auth'));
  console.log('auth:', auth);
  const body = (await page.innerText('body')).replace(/\n+/g,' | ').slice(0,300);
  console.log('body:', body);
} catch (e) {
  console.log('LOGIN FAILED:', e.message.slice(0,300));
  await page.screenshot({ path: 'docs/audits/2026-08-23/scratch/a10-login-fail.png' });
} finally { await b.close(); }
