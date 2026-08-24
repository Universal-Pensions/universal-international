import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';

// 1) Exhaust the write rate-limit with INVALID payloads only (400s never reach
//    the DB insert, and the 429 short-circuits before it too) so no fixture rows
//    are created.
for (let i = 0; i < 6; i++) {
  const r = await fetch('http://localhost:3001/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '', email: 'x', message: '' }),
  });
  console.log('warmup', i, r.status, await r.text());
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/contact`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

// Fill the real form with VALID data so client-side validation passes and the
// request actually goes to the server (which will 429).
await page.locator('#name, input[name="name"]').first().fill('Audit Probe');
await page.locator('#email, input[name="email"]').first().fill('audit@example.com');
await page.locator('textarea').first().fill('A23 read-only audit probe.');
await page.getByRole('button', { name: /send/i }).first().click();
await page.waitForTimeout(2500);

const alert = await page.locator('[role="alert"]').first().textContent().catch(() => null);
console.log('RENDERED role=alert TEXT >>>', JSON.stringify(alert));
await page.screenshot({ path: '/private/tmp/claude-501/-Users-shubhang/5bbfd26e-9337-4927-acc3-56c74557b08d/scratchpad/a23-contact-rate-limited.png' });
await browser.close();
