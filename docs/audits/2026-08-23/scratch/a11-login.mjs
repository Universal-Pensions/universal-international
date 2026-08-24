// Reusable agent login via the REAL UI (no token injection).
export async function loginAsAgent(page, { phone = '700000001' } = {}) {
  await page.goto('http://localhost:5173/distributors', { waitUntil: 'domcontentloaded' });
  // scroll to login card
  await page.evaluate(() => document.getElementById('login')?.scrollIntoView());
  // Click the Agent role tab
  const agentTab = page.getByRole('tab', { name: 'Agent' });
  await agentTab.waitFor({ state: 'visible', timeout: 15000 });
  await agentTab.click();
  // Phone entry
  const phoneInput = page.getByLabel('Phone number');
  await phoneInput.waitFor({ state: 'visible', timeout: 10000 });
  await phoneInput.fill(phone);
  await page.getByRole('button', { name: /send verification code/i }).click();
  // OTP step
  const d1 = page.getByLabel('Digit 1 of 6');
  await d1.waitFor({ state: 'visible', timeout: 15000 });
  const code = '123456';
  for (let i = 0; i < 6; i++) {
    await page.getByLabel(`Digit ${i + 1} of 6`).fill(code[i]);
  }
  await page.getByRole('button', { name: /verify & sign in/i }).click();
  // Wait for dashboard
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}
