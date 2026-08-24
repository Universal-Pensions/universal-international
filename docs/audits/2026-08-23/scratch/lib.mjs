export async function signIn(p, { landingPath, phone, code = '123456' }, opts = {}) {
  if (!opts.noGoto) {
    await p.goto(`http://localhost:5173${landingPath}`, { waitUntil: 'domcontentloaded' });
  }
  await p.waitForTimeout(1200);
  let tel = p.locator('input[type="tel"]:visible').first();
  if (!(await tel.count())) {
    await p.getByRole('button', { name: /^Sign in$/i }).first().click();
    await p.waitForTimeout(1200);
    tel = p.locator('input[type="tel"]:visible').first();
  }
  await tel.waitFor({ state: 'visible', timeout: 20000 });
  await tel.fill(phone);
  await p.getByRole('button', { name: /send verification code|send code|continue/i }).first().click();
  const d0 = p.locator('input[name="otp-0"]');
  await d0.waitFor({ state: 'visible', timeout: 20000 });
  for (let i = 0; i < 6; i++) await p.locator(`input[name="otp-${i}"]`).fill(code[i]);
  await p.getByRole('button', { name: /verify/i }).first().click();
  await p.waitForURL(/\/dashboard/, { timeout: 40000 });
}
