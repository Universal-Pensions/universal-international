import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const W = parseInt(process.argv[2]||'1440',10);
const { b, page } = await launch(W, W<700?812:950);
try {
  await loginSubscriber(page, '+256711000001', '123456');
  await page.goto(BASE + '/dashboard/save', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(2500);
  const inputs = await page.$$eval('input', els=>els.map(e=>({type:e.type,ph:e.placeholder,al:e.getAttribute('aria-label'),val:e.value,im:e.inputMode})));
  console.log('INPUTS:', JSON.stringify(inputs));
  const btns = await page.$$eval('button', els=>els.map(e=>(e.innerText||e.getAttribute('aria-label')||'').trim()).filter(Boolean));
  console.log('BUTTONS:', JSON.stringify(btns));
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
