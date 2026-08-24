// A23 — prove the public NOMINEE CLAIM form renders a raw snake_case error code.
// Read-only: the limiter is exhausted with 400-only payloads (no DB write), and
// the browser submission is rejected 429 before the insert, so no rows are created.
import { chromium } from '@playwright/test';

for (let i = 0; i < 7; i++) {
  const r = await fetch('http://localhost:3001/api/nominee-claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: 'nope' }),
  });
  console.log('warmup', i, r.status, await r.text());
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5173/claim', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

await page.locator('#nc-product [role="radio"], #nc-product button, #nc-product input').first().click().catch(() => {});
await page.fill('#nc-deceasedName', 'Test Deceased');
await page.fill('#nc-deceasedNin', 'CM90000000000A');
await page.fill('#nc-dateOfDeath', '2026-08-01');
await page.fill('#nc-claimantName', 'Audit Probe');
await page.selectOption('#nc-relationship', { index: 1 }).catch(() => {});
await page.fill('#nc-claimantPhone', '700000123');
await page.getByRole('button', { name: /send|submit|start/i }).last().click();
await page.waitForTimeout(2500);

const alerts = await page.locator('[role="alert"]').allTextContents();
console.log('RENDERED role=alert TEXTS >>>', JSON.stringify(alerts));
await page.screenshot({ path: '/Users/shubhang/Desktop/Projects/uganda-dashboard/docs/audits/2026-08-23/a23-claim-rate-limited.png', fullPage: false });
await browser.close();
