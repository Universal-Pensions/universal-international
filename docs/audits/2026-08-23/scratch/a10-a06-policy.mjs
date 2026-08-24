import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const { b, page } = await launch(1440, 950);
try {
  // s-0003 Patrick Nsubuga; life renewal_date 2026-04-16 < MOCK_NOW 2026-07-01 => Expired
  await loginSubscriber(page, '+256701945855', '123456');
  const auth = await page.evaluate(()=>localStorage.getItem('upensions_auth'));
  console.log('auth:', auth);
  await page.goto(BASE + '/dashboard/policies', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(3000);
  const body = await page.innerText('body');
  // find Life cover + its status
  const hasExpired = /expired/i.test(body);
  const lifeLine = (body.match(/Life cover[\s\S]{0,120}/i)||[''])[0].replace(/\n+/g,' | ').slice(0,140);
  console.log('page mentions "expired":', hasExpired);
  console.log('Life cover context:', JSON.stringify(lifeLine));
  // subtitle summary counts
  const sub = (body.match(/(\d+ active[\s\S]{0,40}?expired)/i)||[''])[0].replace(/\n+/g,' ');
  console.log('summary:', JSON.stringify(sub));
  await page.screenshot({ path: 'docs/audits/2026-08-23/screenshots/subscriber/a10-a06-s0003-life-expired.png', fullPage: true });
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
