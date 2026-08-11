// Shared walkthrough for the "Plan & pay" contribution wizard
// (`src/signup/contribution/ContributionSettings.jsx`).
//
// ONE helper, THREE specs. The same component is rendered by the subscriber's
// /signup/contribution route AND — since the agent-onboarding parity change — by
// the agent wizard's Schedule stage in `embedded` mode. Before that, the agent
// path had its own older form and each spec hand-rolled its own selectors, which
// is exactly how the two journeys silently drifted apart. Keep the sequence here
// so a change to the wizard breaks in one place.
//
// The wizard is TWO pages behind a tablist, not one long form:
//   page 1  "Your/Their savings"        frequency · amount · split · yearly step-up
//     ↓  CTA "Next: protect your/their family"
//   page 2  "Protect your/their family" cover products · pay-now vs save-up
//     ↓  CTA "Continue to payment"      (converts the summary into the picker)
//   payMode                             method + MoMo number
//     ↓  CTA "Pay UGX …"                fires onConfirm after a 1.2s fake delay
//
// Two selector traps worth knowing:
//   • Copy is audience-switched via OnboardAudienceContext, so the tab and the
//     page-1 CTA read "your" for a subscriber and "their" for an agent. Pass
//     `audience` and let the helper build the regex.
//   • A cover switch's accessible name is its WHOLE card, beginning with the
//     `shortProductName()` ("Health Hospital & clinic cover UGX 60,000/year Pays
//     UGX 3,000,000") — so match start-anchored, not exact. Note the price and
//     payout in that name now track the CHOSEN cover tier, so never match on
//     them; anchor on the product name only.
//
// Each selected product also exposes its own cover ladder as a `role="group"`
// named "<Product> cover amount". Pass `covers` to pick a non-default tier.

import { expect, type Page } from '@playwright/test';

export type ContributionAudience = 'self' | 'agent';

export type ContributionWalkConfig = {
  /** Whose journey this is — drives the second/third-person copy selectors. */
  audience?: ContributionAudience;
  /**
   * Exact preset chip label to click (e.g. 'UGX 10,000'). Mutually exclusive
   * with `amount`; a preset is the more stable choice where one exists.
   */
  presetLabel?: string;
  /** Amount typed into the amount field instead of clicking a preset. */
  amount?: string;
  /**
   * Cover products to TOGGLE. Life starts selected by default, so listing it
   * turns it OFF. Omit to keep the default (life only).
   */
  toggleProducts?: Array<'life' | 'health' | 'funeral'>;
  /**
   * Cover AMOUNT per product, in UGX — e.g. `{ life: 5_000_000 }`. Must be a
   * value on that product's ladder (`coverTiers` in src/constants/savings.js).
   * Only applies to products that end up SELECTED. Omit to keep each product's
   * entry tier, which is the cover it had before per-product amounts existed.
   */
  covers?: Partial<Record<'life' | 'health' | 'funeral', number>>;
  /** 9-digit local MoMo number. Defaults to a synthetic demo number. */
  momoDigits?: string;
};

/**
 * Product NAME as rendered on the card / picker label. Keyed by the stored
 * product id — 'health' is the DB enum value, 'Hospital cash' is its name.
 */
const SHORT: Record<string, string> = { life: 'Life', health: 'Hospital cash', funeral: 'Funeral' };

/** Page-1 → page-2 → payMode, stopping just short of clicking Pay. */
export async function fillContributionPlan(
  page: Page,
  config: ContributionWalkConfig = {},
): Promise<void> {
  const {
    audience = 'self',
    presetLabel,
    amount,
    toggleProducts = [],
    covers = {},
    momoDigits = '700123456',
  } = config;
  const possessive = audience === 'agent' ? 'their' : 'your';

  // ── Page 1 · savings ───────────────────────────────────────────────────────
  // The wizard renders no headings (sections are labelled via aria-label +
  // eyebrow divs), so the tablist is the stable landmark. Monthly is the default
  // frequency and 80/20 the default split — both left alone.
  await expect(
    page.getByRole('tab', { name: new RegExp(`${possessive} savings`, 'i') }),
  ).toBeVisible({ timeout: 15_000 });

  if (presetLabel) {
    await page.getByRole('button', { name: new RegExp(`^${presetLabel}$`) }).click();
  } else {
    await page
      .getByRole('textbox', { name: /contribution amount/i })
      .fill(amount ?? '50000');
  }

  await page
    .getByRole('button', { name: new RegExp(`next: protect ${possessive} family`, 'i') })
    .click();

  // ── Page 2 · cover ─────────────────────────────────────────────────────────
  await expect(
    page.getByRole('tab', { name: new RegExp(`protect ${possessive} family`, 'i') }),
  ).toBeVisible({ timeout: 10_000 });

  for (const product of toggleProducts) {
    // The switch's accessible name is the whole card, starting with the product
    // NAME: "Hospital cash Hospital & clinic cover UGX 60,000/year Pays UGX
    // 3,000,000". Anchor at the START only — an exact match hits nothing, and a
    // bare /funeral/i would also hit that card's own "burial costs" blurb text.
    //
    // Match on SHORT[product], never the raw id: the id is the stored DB enum
    // ('health') and no longer equals the displayed name ('Hospital cash').
    await page.getByRole('switch', { name: new RegExp(`^${SHORT[product]}\\b`, 'i') }).click();
  }

  // Each selected product reveals its own cover ladder inside its card. Match
  // the tier on the mark's aria-label, which carries the EXACT figure — the
  // visible text is compacted ("5.0M") to fit the card and would be brittle.
  for (const [product, cover] of Object.entries(covers)) {
    const group = page.getByRole('group', { name: `${SHORT[product]} cover amount` });
    await expect(group).toBeVisible();
    await group
      // 'en-UG' mirrors LOCALE in src/utils/currency.js, which formats the label.
      .getByRole('button', { name: new RegExp(`^UGX ${cover.toLocaleString('en-UG')} cover`) })
      .click();
  }

  // Route A ("Pay now") is not the default — the component defaults to Route B
  // ("Save up for it") unless the restored schedule says pay_now. Select it
  // explicitly so the premium is charged today and 0072 writes the extra
  // `type='premium'` transaction the specs assert on.
  const payNow = page.getByRole('radio', { name: /pay now/i });
  if (await payNow.count()) await payNow.first().click();

  // ── payMode · payment picker ───────────────────────────────────────────────
  await page.getByRole('button', { name: /continue to payment/i }).click();

  // Mobile Money is preselected; the MoMo number gates the Pay CTA. It may be
  // prefilled from the signup phone, so overwrite rather than append.
  await page.getByPlaceholder('700 000 000').fill(momoDigits);
}

/**
 * Click the Pay CTA. Split from `fillContributionPlan` because the two hosts
 * write at different moments: self-signup's onConfirm calls the create RPC
 * directly, whereas the agent wizard advances to OnboardingComplete which fires
 * its RPC on mount — so that spec registers its listener before it even enters
 * the wizard and just needs the click here.
 */
export async function clickPay(page: Page): Promise<void> {
  const payBtn = page.getByRole('button', { name: /^pay (ugx|\d)/i });
  await expect(payBtn).toBeEnabled();
  await payBtn.click();
}

/**
 * Full walk: plan → cover → payment → Pay, resolving once `rpcName` returns 200.
 * The listener is registered BEFORE the click so the 1.2s fake payment delay
 * can't race it.
 */
export async function walkContributionAndPay(
  page: Page,
  rpcName: string,
  config: ContributionWalkConfig = {},
): Promise<void> {
  await fillContributionPlan(page, config);

  const payBtn = page.getByRole('button', { name: /^pay (ugx|\d)/i });
  await expect(payBtn).toBeEnabled();

  const rpcPromise = page.waitForResponse(
    (r) => r.url().includes(`/rest/v1/rpc/${rpcName}`) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );

  await payBtn.click();

  const rpcResponse = await rpcPromise;
  expect(rpcResponse.status(), `${rpcName} RPC must succeed`).toBe(200);
}
