import { chromium } from 'playwright';
const BASE='http://localhost:5173';
const OUT='docs/audits/2026-08-23/screenshots/public';
async function idUpload(page){
  const img={name:'id.jpg',mimeType:'image/jpeg',buffer:Buffer.alloc(32*1024,0xff)};
  await page.setInputFiles('#id-upload-front',img);
  await page.setInputFiles('#id-upload-back',img);
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^continue$/i.test(x.textContent.trim()));return b&&!b.disabled;},{timeout:30000});
  await page.getByRole('button',{name:/^continue$/i}).click();
}
async function reviewFill(page,digits){
  await page.getByRole('heading',{name:/check your details/i}).waitFor({timeout:30000});
  await page.locator('input[name="phone"]').fill(digits);
  await page.locator('#nin').fill(`CF${digits}ABC`);
  await page.locator('#district').click(); await page.locator('#district').fill('Kampala');
  await page.getByRole('option',{name:'Kampala',exact:true}).click();
  await page.locator('#occupation').selectOption('farmer');
  await page.locator('#password').fill('Demo1234'); await page.locator('#confirm-password').fill('Demo1234');
  await page.getByRole('button',{name:/^continue$/i}).click();
}
// NIRA no-match -> click Get help from an agent -> agent terminal
{
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1440,height:900}});
  const page=await ctx.newPage();
  await page.route('**/api/kyc/nira-verify',r=>r.continue({headers:{...r.request().headers(),'x-qa-force':'no-match'}}));
  const digits='719933'+String(Date.now()).slice(-3);
  try{
    await page.goto(BASE+'/signup',{waitUntil:'networkidle'});
    await idUpload(page); await reviewFill(page,digits);
    await page.getByRole('button',{name:/get help from an agent/i}).waitFor({timeout:15000});
    await page.getByRole('button',{name:/get help from an agent/i}).click();
    await page.waitForTimeout(1500);
    const head=await page.locator('h1,h2,h3').first().textContent().catch(()=>'');
    const body=(await page.locator('#main,body').first().innerText().catch(()=>'')).replace(/\s+/g,' ').trim().slice(0,240);
    console.log('[AGENT terminal] head:',JSON.stringify((head||'').trim().slice(0,60)),'\n   body:',body);
    await page.screenshot({path:`${OUT}/signup-terminal-agent-1440.png`});
  }catch(e){console.log('[AGENT] ERR',e.message.slice(0,140));}
  await browser.close();
}
// AML flagged -> pending review (longer wait)
{
  const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  const ctx=await browser.newContext({viewport:{width:1440,height:900},permissions:['camera']});
  const page=await ctx.newPage();
  await page.route('**/api/kyc/aml-screen',r=>r.continue({headers:{...r.request().headers(),'x-qa-force':'flagged'}}));
  const digits='719944'+String(Date.now()).slice(-3);
  try{
    await page.goto(BASE+'/signup',{waitUntil:'networkidle'});
    await idUpload(page); await reviewFill(page,digits);
    await page.getByRole('heading',{name:/enter the code we sent you/i}).waitFor({timeout:25000});
    for(let i=0;i<4;i++)await page.getByRole('textbox',{name:new RegExp(`digit ${i+1} of 4`,'i')}).fill('1234'[i]);
    await page.getByRole('heading',{name:/take a quick selfie/i}).waitFor({timeout:15000});
    await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>/take selfie/i.test(x.textContent));return b&&!b.disabled;},{timeout:15000});
    await page.getByRole('button',{name:/take selfie/i}).click();
    await page.getByRole('heading',{name:/under review|review your|we.?re reviewing|checking a few|need to review|hold|manual/i}).waitFor({timeout:20000}).catch(()=>{});
    await page.waitForTimeout(9000);
    const head=await page.locator('h1,h2,h3').first().textContent().catch(()=>'');
    const body=(await page.locator('#main,body').first().innerText().catch(()=>'')).replace(/\s+/g,' ').trim().slice(0,240);
    console.log('[PENDING terminal] head:',JSON.stringify((head||'').trim().slice(0,60)),'\n   body:',body);
    await page.screenshot({path:`${OUT}/signup-terminal-pending-1440.png`});
  }catch(e){console.log('[PENDING] ERR',e.message.slice(0,140));}
  await browser.close();
}
