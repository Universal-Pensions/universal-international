import { chromium } from 'playwright';
import { signIn } from './lib.mjs';
const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
try {
  await signIn(p, { landingPath: '/admin', phone: '+256700000041' });
  console.log('LOGGED IN, url=', p.url());
} catch (e) { console.log('ERR', e.message.slice(0,300), 'url=', p.url());
  console.log(await p.evaluate(()=>document.body.innerText.slice(0,900)));
}
await b.close();
