import { useCallback, useState } from 'react';
import { PAYMENT_METHODS, DEMO_CARD, GATEWAY_LATENCY_MS } from '../../constants/payment';
import { cardRecordLabel, isCardComplete } from '../../utils/card';

// Kept out of PaymentMethodPicker.jsx so that file exports components only
// (react-refresh/only-export-components).

const EMPTY_CARD = { number: '', expiry: '', cvc: '', name: '' };

/**
 * usePaymentMethod — owns the selected method AND whatever that method needs
 * before it can be charged (card details, a bank reference). One hook so a page
 * that renders the picker somewhere OTHER than its confirm surface — Save picks
 * the method on the form, then confirms in a sheet / side panel — still has a
 * single source of truth for both.
 *
 * Pass the result to <PaymentMethodPicker state={…} />. A confirm surface reads:
 *   ready           — may the pay button fire yet (are the card fields complete?)
 *   record          — the string to write to `transactions.method`
 *   note            — the method-specific line under the confirm total
 *   submittingLabel — "Authorising with your bank…" vs "Processing…"
 *
 * @param {Array<{id,kind,label,full,helper,note,submittingLabel}>} methods
 *   Defaults to every method. Pass `[]` for a surface whose caller owns the
 *   method choice — the picker then renders nothing and `ready` stays true.
 */
export function usePaymentMethod(methods = PAYMENT_METHODS) {
  const [methodId, setMethodId] = useState(methods[0]?.id);
  const [card, setCard] = useState(EMPTY_CARD);

  const method = methods.find((m) => m.id === methodId) ?? methods[0];
  const kind = method?.kind ?? 'momo';

  // One reference per pay attempt, minted once via a lazy initialiser (NOT in
  // the render body — that trips react-hooks/purity). The member quotes it on
  // the transfer so an offline payment can be matched back to them.
  const [bankReference] = useState(() => `UP-${crypto.randomUUID().slice(0, 6).toUpperCase()}`);

  const setCardField = useCallback((field, value) => {
    setCard((prev) => ({ ...prev, [field]: value }));
  }, []);

  const fillDemoCard = useCallback(() => setCard(DEMO_CARD), []);

  // Only a card can be "not ready" — mobile money authorises on the handset and
  // bank transfer just needs the member to have read the details.
  const ready = kind === 'card' ? isCardComplete(card) : true;
  const record = kind === 'card' ? cardRecordLabel(card) : method?.full;

  return {
    methods,
    method,
    methodId,
    setMethodId,
    kind,
    card,
    setCardField,
    fillDemoCard,
    bankReference,
    ready,
    record,
    note: method?.note,
    submittingLabel: method?.submittingLabel ?? 'Processing…',
  };
}

/**
 * Mocked gateway hop. Awaited by the confirm handler BEFORE the write RPC so
 * the authorising step is actually visible; resolves immediately for mobile
 * money. Owned by <PaySheet> / <InlinePayPanel> when they own the picker, and
 * by the page itself when it does not (Save).
 */
export function gatewayPause(kind) {
  const ms = GATEWAY_LATENCY_MS[kind] ?? 0;
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
