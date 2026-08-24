import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const OUT='docs/audits/2026-08-23/screenshots/public';

async function walk(vw){
  const browser=await chromium.launch({ args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const ctx=await browser.newContext({viewport:{width:vw,height:900}, permissions:['camera']});
  const page=await ctx.newPage();
  const errs=[];
  page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  page.on('pageerror',e=>errs.push('PAGEERR:'+e.message));
  const shot=n=>page.screenshot({path:`${OUT}/signup-${n}-${vw}.png`}).catch(()=>{});
  const digits='719900'+String(Date.now()).slice(-3);
  const log=(s,extra='')=>console.log(`  [${vw}] ${s} ${extra}`);
  try{
    await page.goto(BASE+'/signup',{waitUntil:'networkidle'});
    await page.waitForTimeout(600);
    // Step1 id-upload
    const h1=await page.locator('h1,h2').first().textContent().catch(()=>'');
    log('step1 id-upload heading:', JSON.stringify((h1||'').trim().slice(0,50)));
    await shot('1-idupload');
    const img={name:'id.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(32*1024,0xff)};
    await page.setInputFiles('#id-upload-front',img);
    await page.setInputFiles('#id-upload-back',img);
    const cont=page.getByRole('button',{name:/^continue$/i});
    await cont.waitFor({timeout:30000});
    await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^continue$/i.test(x.textContent.trim()));return b&&!b.disabled;},{timeout:30000}).catch(()=>{});
    await cont.click();
    // Step2 review
    await page.getByRole('heading',{name:/check your details/i}).waitFor({timeout:30000});
    log('step2 review reached');
    await page.locator('input[name="phone"]').fill(digits);
    await page.locator('#nin').fill(`CF${digits}ABC`);
    await page.locator('#district').click();
    await page.locator('#district').fill('Kampala');
    await page.getByRole('option',{name:'Kampala',exact:true}).click();
    await page.locator('#occupation').selectOption('farmer');
    await page.locator('#password').fill('Demo1234');
    await page.locator('#confirm-password').fill('Demo1234');
    await shot('2-review');
    await page.getByRole('button',{name:/^continue$/i}).click();
    // Step3 nira (auto)
    log('step3 nira (auto-advance)');
    // Step4 otp
    await page.getByRole('heading',{name:/enter the code we sent you/i}).waitFor({timeout:25000});
    log('step4 otp reached');
    await shot('4-otp');
    const otp='1234';
    for(let i=0;i<4;i++){await page.getByRole('textbox',{name:new RegExp(`digit ${i+1} of 4`,'i')}).fill(otp[i]);}
    // Step5 liveness
    await page.getByRole('heading',{name:/take a quick selfie/i}).waitFor({timeout:15000});
    log('step5 liveness reached');
    await shot('5-liveness');
    const sel=page.getByRole('button',{name:/take selfie/i});
    await sel.waitFor({timeout:15000});
    await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>/take selfie/i.test(x.textContent));return b&&!b.disabled;},{timeout:15000}).catch(()=>{});
    await sel.click();
    // Step6 aml (auto) -> Step7 beneficiaries
    await page.getByRole('heading',{name:/who inherits your savings/i}).waitFor({timeout:30000});
    log('step6 aml auto-passed; step7 beneficiaries reached');
    await shot('7-beneficiaries');
    await page.getByRole('textbox',{name:/full name/i}).fill('Test Nominee');
    await page.getByPlaceholder('7XX XXX XXX').fill('700111222');
    await page.getByRole('combobox').first().selectOption('spouse');
    const bc=page.getByRole('button',{name:/^continue$/i});
    await page.waitForTimeout(400);
    await bc.click();
    // Step8 consent
    await page.getByRole('heading',{name:/one last thing before payment/i}).waitFor({timeout:15000});
    log('step8 consent reached');
    await shot('8-consent');
    // Do NOT complete payment (would write live). Confirm contribution route renders instead.
    await page.locator('label').filter({hasText:/I consent to Universal Pensions processing/i}).click();
    await page.getByRole('button',{name:/i consent.*continue/i}).click();
    await page.waitForTimeout(1500);
    const url=new URL(page.url()).pathname;
    const cH=await page.locator('h1,h2,h3').first().textContent().catch(()=>'');
    log('after consent -> url:',url+' firstHead:'+JSON.stringify((cH||'').trim().slice(0,50)));
    await shot('9-contribution-setup');
    log('STOPPED before Pay (no live write).');
  }catch(e){
    log('WIZARD ERROR:', e.message.slice(0,160));
    await shot('error');
  }
  log('consoleErrors:', errs.length? errs.slice(0,3).join(' || '):'none');
  await browser.close();
}
await walk(1440);
await walk(375);
