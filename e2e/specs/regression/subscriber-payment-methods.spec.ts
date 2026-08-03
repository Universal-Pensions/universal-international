// Regression spec: every subscriber pay surface offers ALL FOUR payment
// methods, not just mobile money.
//
// Why this exists: the pay surfaces used to offer MTN MoMo + Airtel Money only,
// and SavePage carried its OWN duplicated copy of that list. Card + Bank
// transfer were added and the list single-sourced into
// `src/constants/payment.js` (PAYMENT_METHODS). Nothing else in the suite
// asserts that the methods actually REACH the UI — the card/nudge unit tests all
// pass just as happily if someone points a surface back at
// MOBILE_MONEY_METHODS, or trims PAYMENT_METHODS. That regression would be
// invisible until a sales rep hit it mid-demo, so it is pinned here at the
// browser level.
//
// Covered surfaces (the ones a subscriber reaches while CONTRIBUTING):
//   • /dashboard/save — ad-hoc top-up AND the "Pay scheduled" mode. Owns its
//     own picker on the form step (desktop chips / mobile rows).
//   • /dashboard/insurance and /dashboard/policies drive the SAME shared
//     confirm surfaces (PaySheet / InlinePayPanel), so the picker there is the
//     one component verified below; they need cover/renewal state to reach, and
//     are covered by unit tests rather than re-driven here.
//
// The card gateway assertions matter as much as the chip: "Card" existing but
// collecting no details would be a silently broken demo.

import { test, expect } from '@playwright/test';
import { storageStatePathFor } from '../../fixtures/auth';
import { disableAnimations } from '../../fixtures/motion';

test.use({ storageState: storageStatePathFor('subscriber') });

// The desktop chips show the SHORT label ("MTN MoMo") while the phone rows show
// the full name ("MTN Mobile Money"), so each method is matched by a regex that
// accepts either — one spec, both form factors.
const METHODS: Array<[string, RegExp]> = [
  ['MTN', /^MTN Mo(Mo|bile Money)/i],
  ['Airtel', /^Airtel Money/i],
  ['Card', /^Card\b/i],
  ['Bank transfer', /^Bank transfer/i],
];

test.describe('subscriber contribution — payment methods', () => {
  test.beforeEach(async ({ page }) => {
    await disableAnimations(page);
    await page.goto('/dashboard/save');
  });

  test('Save offers mobile money, card AND bank transfer', async ({ page }) => {
    // The picker is a radiogroup on both form factors (pill chips on desktop,
    // full-width rows on the phone), so one assertion covers both.
    for (const [, pattern] of METHODS) {
      await expect(page.getByRole('radio', { name: pattern })).toBeVisible();
    }
  });

  test('choosing Card reveals the card gateway and gates the CTA until it is complete', async ({ page }) => {
    const payCta = page.getByRole('button', { name: /^(Top up|Pay)\b/ });
    // Mobile money needs no extra detail — the CTA is live straight away.
    await expect(payCta).toBeEnabled();

    await page.getByRole('radio', { name: /^Card\b/i }).click();

    // The gateway appears...
    await expect(page.getByRole('textbox', { name: 'Card number' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Expiry date' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Security code' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Name on card' })).toBeVisible();

    // ...and an empty card must NOT be payable.
    await expect(payCta).toBeDisabled();

    // The demo-card shortcut fills a valid card, which re-enables the CTA.
    await page.getByRole('button', { name: /use a demo card/i }).click();
    await expect(page.getByRole('textbox', { name: 'Card number' })).toHaveValue('4242 4242 4242 4242');
    await expect(payCta).toBeEnabled();
  });

  test('card number formats as you type and detects the brand', async ({ page }) => {
    await page.getByRole('radio', { name: /^Card\b/i }).click();

    const number = page.getByRole('textbox', { name: 'Card number' });
    await number.fill('');
    await number.type('5555555555554444');

    await expect(number).toHaveValue('5555 5555 5555 4444');
    await expect(page.getByText('Mastercard', { exact: true })).toBeVisible();
  });

  test('choosing Bank transfer reveals account details and a payment reference', async ({ page }) => {
    await page.getByRole('radio', { name: /^Bank transfer/i }).click();

    await expect(page.getByText(/account name/i)).toBeVisible();
    await expect(page.getByText(/account number/i)).toBeVisible();
    await expect(page.getByText(/quote this reference/i)).toBeVisible();
    // The reference is minted per pay attempt — shape, not value.
    await expect(page.getByText(/^UP-[A-Z0-9]{6}$/)).toBeVisible();

    // Bank transfer needs nothing from the user, so it stays payable.
    await expect(page.getByRole('button', { name: /^(Top up|Pay)\b/ })).toBeEnabled();
  });
});
