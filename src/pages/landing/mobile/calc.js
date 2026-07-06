// Savings-projection finance model for the mobile landing calculator.
//
// Mirrors the desktop `SubscribersPage.jsx` model (10%/yr, compounded monthly)
// verbatim so the two surfaces never drift — kept as a mobile-only copy rather
// than refactoring the desktop page, which is under concurrent live edits.
// Sanity check: calcFV(10000, 25) rounds to 13,268,334.

export const MONTHLY_RATE = 0.1 / 12;

/**
 * Future value of a fixed monthly contribution `pmt` (UGX) saved for `years`,
 * at MONTHLY_RATE compounded monthly. Returns 0 for a non-positive term.
 */
export const calcFV = (pmt, years) => {
  const n = years * 12;
  return n > 0 ? pmt * ((Math.pow(1 + MONTHLY_RATE, n) - 1) / MONTHLY_RATE) : 0;
};

export const formatUGX = (n) => 'UGX ' + Math.round(n).toLocaleString('en-US');

// Monthly contribution presets (UGX) — the amount chips.
export const AMOUNTS = [5000, 10000, 20000, 50000];

/**
 * Derive everything the calculator UI needs from a contribution + term:
 * the projected pot, what you put in, the growth on top, and the split used
 * to draw the contributions-vs-growth bar.
 */
export function computeProjection(pmt, years) {
  const fv = calcFV(pmt, years);
  const contributed = pmt * years * 12;
  const growth = fv - contributed;
  const returnPct = fv > 0 ? Math.round((growth / fv) * 100) : 0;
  // Width of the "contributed" (indigo) segment; floor at 4% so it stays visible.
  const contributedPct = Math.max(100 - returnPct, 4);
  return { fv, contributed, growth, returnPct, contributedPct };
}
