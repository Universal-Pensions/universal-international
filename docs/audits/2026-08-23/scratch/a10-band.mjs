import { launch, loginSubscriber, BASE } from './a10-login.mjs';
const W = parseInt(process.argv[2],10);
const { b, page } = await launch(W, 1000);
const KEY = [['/dashboard','index'],['/dashboard/save','save'],['/dashboard/withdraw','withdraw'],
  ['/dashboard/policies','policies'],['/dashboard/reports','reports'],['/dashboard/settings','settings']];
try {
  await loginSubscriber(page, '+256711000001', '123456');
  console.log(`=== BAND ${W} ===`);
  for (const [r,n] of KEY){
    await page.goto(BASE+r,{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2200);
    const errB = await page.getByText(/something went wrong/i).count();
    // shell signal: desktop shell has a persistent SideNav "Account settings"; mobile has BottomTabBar
    const hasCopilot = await page.getByText(/Co-Pilot|Ask AI/i).count();
    const hbody = (await page.innerText('body')).replace(/\n+/g,' | ').slice(0,90);
    await page.screenshot({path:`docs/audits/2026-08-23/screenshots/subscriber/${n}-${W}.png`});
    console.log(`${r} errB=${errB} copilotSignal=${hasCopilot} :: ${hbody}`);
  }
} catch(e){ console.log('ERR', e.message.slice(0,200)); }
finally { await b.close(); }
