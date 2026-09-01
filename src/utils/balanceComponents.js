// The ONE place a member's balance is decomposed. Added by migration 0146
// (Phase 4 of the unitization redesign).
//
// A member's money sits in three separate states, and conflating them is how
// you either overstate what they can withdraw or understate what they own:
//
//   1. ALLOCATED   units they actually hold, at the book unit price.
//                  This is `total_balance` and it is the only part that moves
//                  when the admin publishes a new price.
//   2. IN          money received that has not yet bought units, at face value.
//                  Frozen — it has bought nothing, so a price move is not
//                  theirs yet.
//   3. OUT         units already sold at a struck price whose cash has not yet
//                  reached them. Also frozen — they no longer own the units.
//
//   member total = 1 + 2 + 3          (money never disappears from the headline)
//   withdrawable = 1 - held redemptions
//
// `pending_redemption_*` is the fourth column pair and is NOT part of the
// total: it is a HOLD on money already counted in (1). Between requesting a
// withdrawal and its dealing date the units are still owned and still valued in
// `total_balance`, so without the hold a member could request the same money
// twice. It is subtracted from withdrawable only, and disappears at
// liquidation when the value moves into (3).
//
// ⚠️ DO NOT fold any pending figure back into `total_balance`. Three guards
//    depend on that column meaning exactly units x price:
//    subscriber_balances_bucket_sum_chk (a hard equality), assert_book_revaluable()
//    (2% drift gate on the whole book), and the nav_mismatch reconciliation
//    check (1 UGX per member). See 0146's header.
//
// While every pending column is 0 — which is the case until 0147 flips
// fund_dealing_config.pricing_enabled — every figure below equals the
// pre-0146 value exactly.

const n = (v) => Number(v ?? 0);

/**
 * Decompose a raw `subscriber_balances` row into the figures the UI may show.
 *
 * @param {object|null|undefined} bal raw row (snake_case), or null
 * @returns {{
 *   allocatedBalance:number, allocatedRetirement:number, allocatedEmergency:number,
 *   pendingContribution:number, pendingPayout:number, pendingRedemption:number,
 *   netBalance:number, retirementBalance:number, emergencyBalance:number,
 *   withdrawableBalance:number, withdrawableRetirement:number, withdrawableEmergency:number
 * }}
 */
export function deriveBalanceFigures(bal) {
  const allocatedRetirement = n(bal?.retirement_balance);
  const allocatedEmergency = n(bal?.emergency_balance);
  const allocatedBalance = n(bal?.total_balance);

  const pcR = n(bal?.pending_contribution_retirement);
  const pcE = n(bal?.pending_contribution_emergency);
  const ppR = n(bal?.pending_payout_retirement);
  const ppE = n(bal?.pending_payout_emergency);
  const prR = n(bal?.pending_redemption_retirement);
  const prE = n(bal?.pending_redemption_emergency);

  return {
    // (1) — what AUM, every rollup and assert_book_revaluable() read.
    allocatedBalance,
    allocatedRetirement,
    allocatedEmergency,

    // (2) and (3), summed across both pots for the history UI.
    pendingContribution: pcR + pcE,
    pendingPayout: ppR + ppE,
    pendingRedemption: prR + prE,

    // The HEADLINE. Money never disappears from it: the instant a contribution
    // is received it is here at face value, and at allocation it simply moves
    // from (2) into (1) at the dealing price — no jump.
    netBalance: allocatedBalance + pcR + pcE + ppR + ppE,

    // The two pots as DISPLAYED, so they keep summing to netBalance exactly.
    retirementBalance: allocatedRetirement + pcR + ppR,
    emergencyBalance: allocatedEmergency + pcE + ppE,

    // What may actually be taken out. Allocated only, less anything already
    // spoken for by a redemption still waiting for its dealing date.
    withdrawableBalance: allocatedBalance - prR - prE,
    withdrawableRetirement: allocatedRetirement - prR,
    withdrawableEmergency: allocatedEmergency - prE,
  };
}
