import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const OUT='docs/audits/2026-08-23/screenshots/public';

async function reviewFill(page,digits){
  await page.getByRole('heading',{name:/check your details/i}).waitFor({timeout:30000});
  await page.locator('input[name="phone"]').fill(digits);
  await page.locator('#nin').fill(`CF${digits}ABC`);
  await page.locator('#district').click();
  await page.locator('#district').fill('Kampala');
  await page.getByRole('option',{name:'Kampala',exact:true}).click();
  await page.locator('#occupation').selectOption('farmer');
  await page.locator('#password').fill('Demo1234');
  await page.locator('#confirm-password').fill('Demo1234');
  await page.getByRole('button',{name:/^continue$/i}).click();
}
async function idUpload(page){
  const img={name:'id.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(32*1024,0xff)};
  await page.setInputFiles('#id-upload-front',img);
  await page.setInputFiles('#id-upload-back',img);
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^continue$/i.test(x.textContent.trim()));return b&&!b.disabled;},{timeout:30000});
  await page.getByRole('button',{name:/^continue$/i}).click();
}

// Run A: NIRA no-match -> agent fallback
async function runNira(){
  const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900},permissions:['camera']});
  const page=await ctx.newPage();
  await page.route('**/api/kyc/nira-verify',(route)=>{const h={...route.request().headers(),'x-qa-force':'no-match'};route.continue({headers:h});});
  const digits='719911'+String(Date.now()).slice(-3);
  try{
    await page.goto(BASE+'/signup',{waitUntil:'networkidle'});
    await idUpload(page);
    await reviewFill(page,digits);
    await page.waitForTimeout(4000);
    const head=await page.locator('h1,h2,h3').first().textContent().catch(()=>'');
    const body=(await page.locator('#main,body').first().innerText().catch(()=>'')).replace(/\s+/g,' ').trim().slice(0,220);
    console.log('[NIRA no-match] head:',JSON.stringify((head||'').trim().slice(0,60)));
    console.log('   body:',body);
    await page.screenshot({path:`${OUT}/signup-terminal-agent-1440.png`});
  }catch(e){console.log('[NIRA] ERR',e.message.slice(0,140));await page.screenshot({path:`${OUT}/signup-terminal-agent-ERR.png`});}
  await browser.close();
}

// Run B: AML flagged -> pending review
async function runAml(){
  const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900},permissions:['camera']});
  const page=await ctx.newPage();
  await page.route('**/api/kyc/aml-screen',(route)=>{const h={...route.request().headers(),'x-qa-force':'flagged'};route.continue({headers:h});});
  const digits='719922'+String(Date.now()).slice(-3);
  try{
    await page.goto(BASE+'/signup',{waitUntil:'networkidle'});
    await idUpload(page);
    await reviewFill(page,digits);
    // otp
    await page.getByRole('heading',{name:/enter the code we sent you/i}).waitFor({timeout:25000});
    for(let i=0;i<4;i++)await page.getByRole('textbox',{name:new RegExp(`digit ${i+1} of 4`,'i')}).fill('1234'[i]);
    // liveness
    await page.getByRole('heading',{name:/take a quick selfie/i}).waitFor({timeout:15000});
    const sel=page.getByRole('button',{name:/take selfie/i});
    await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>/take selfie/i.test(x.textContent));return b&&!b.disabled;},{timeout:15000});
    await sel.click();
    await page.waitForTimeout(5000);
    const head=await page.locator('h1,h2,h3').first().textContent().catch(()=>'');
    const body=(await page.locator('#main,body').first().innerText().catch(()=>'')).replace(/\s+/g,' ').trim().slice(0,220);
    console.log('[AML flagged] head:',JSON.stringify((head||'').trim().slice(0,60)));
    console.log('   body:',body);
    await page.screenshot({path:`${OUT}/signup-terminal-pending-1440.png`});
  }catch(e){console.log('[AML] ERR',e.message.slice(0,140));await page.screenshot({path:`${OUT}/signup-terminal-pending-ERR.png`});}
  await browser.close();
}
await runNira();
await runAml();
