// Shared payment methods for the subscriber demo pay surfaces.
//
// Single-sourced so every pay flow — ad-hoc top-up and scheduled contribution
// (Save), settle-this-period (Schedule), insurance cover funding (Insurance),
// and policy renewals (Policies) — offers an IDENTICAL picker, whether it
// renders through the mobile <PaySheet>, the desktop <InlinePayPanel>, or
// Save's own inline picker. Add a method here and all five surfaces get it.
//
// `full` is the fallback string written to `transactions.method`. The card
// method overrides it per-payment with a brand + last-4 label ("Visa •••• 4242"
// — see `utils/card.js#cardRecordLabel`), so the activity feed stays legible.
// The column is free-text TEXT with no CHECK constraint (migration 0001), so
// new methods need no migration.

// `kind` drives the confirm-step UI: 'momo' is a bare chip, 'card' reveals the
// card-entry gateway, 'bank' reveals the account details + payment reference.
export const PAYMENT_METHODS = [
  {
    id: 'mtn',
    kind: 'momo',
    label: 'MTN MoMo',
    full: 'MTN Mobile Money',
    helper: '+256 71 100 0001',
    note: "You'll receive an SMS prompt to authorise the payment on your mobile money account.",
    submittingLabel: 'Processing…',
  },
  {
    id: 'airtel',
    kind: 'momo',
    label: 'Airtel Money',
    full: 'Airtel Money',
    helper: '+256 70 100 0001',
    note: "You'll receive an SMS prompt to authorise the payment on your mobile money account.",
    submittingLabel: 'Processing…',
  },
  {
    id: 'card',
    kind: 'card',
    label: 'Card',
    full: 'Card',
    helper: 'Visa, Mastercard and Amex',
    note: 'Your card is authorised with your bank straight away. We never store the full card number.',
    // Short enough to stay on one line in a narrow confirm panel's button —
    // the authorising strip above it carries the full "with your bank" sentence.
    submittingLabel: 'Authorising…',
  },
  {
    id: 'bank',
    kind: 'bank',
    label: 'Bank transfer',
    full: 'Bank transfer',
    helper: 'Takes 1–2 working days to clear',
    note: 'Send the amount using the details above and quote the reference. Your savings are credited once the transfer clears.',
    submittingLabel: 'Recording…',
  },
];

// Retained for any surface that must stay mobile-money-only. Derived rather
// than duplicated so it can never drift from the list above.
export const MOBILE_MONEY_METHODS = PAYMENT_METHODS.filter((m) => m.kind === 'momo');

// Prefill for the "Use a demo card" shortcut on the card form — lets a sales
// rep move through the gateway without typing 16 digits mid-pitch. Not a real
// card: the demo gateway never contacts a processor.
export const DEMO_CARD = {
  number: '4242 4242 4242 4242',
  expiry: '12 / 30',
  cvc: '123',
  name: 'DEMO SUBSCRIBER',
};

// Collection-account details shown for the bank-transfer method. PLACEHOLDER —
// swap in the real banking partner's account before this is shown to anyone
// outside a demo.
export const BANK_TRANSFER_ACCOUNT = {
  accountName: 'Universal Pensions Uganda Ltd',
  accountNumber: '9030 0451 7782',
  bank: 'Universal Pensions Collection Account',
  branch: 'Kampala',
  swift: 'UPUGUGKA',
};

// Mocked gateway latency, in ms, so the authorising step is actually visible in
// a demo (the RPC alone returns almost instantly). Mirrors the deliberate
// latency in the KYC mocks — see CLAUDE.md §10a.
export const GATEWAY_LATENCY_MS = {
  momo: 0,
  card: 1600,
  bank: 700,
};
