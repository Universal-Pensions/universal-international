// A23 — prove /contact renders the raw code `message_too_long`.
// The server rejects >4000 chars with 400 BEFORE any DB insert, so no rows are created.
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173/contact', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

await page.locator('#name, input[name="name"]').first().fill('Audit Probe');
await page.locator('#email, input[name="email"]').first().fill('audit@example.com');
await page.locator('textarea').first().fill('x'.repeat(4001));
await page.getByRole('button', { name: /send/i }).first().click();
await page.waitForTimeout(2500);

console.log('RENDERED role=alert TEXT >>>', JSON.stringify(await page.locator('[role="alert"]').first().textContent().catch(() => null)));
await browser.close();
