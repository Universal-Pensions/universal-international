// Wording for the three nominee-claim decisions, shared by the desktop panel
// (ViewNomineeClaims) and the phone page (mobile/AdminNomineeClaimsMobile).
//
// It lives in its own module because this is the copy a bereaved family is
// judged by: the confirm body tells the admin to CALL the claimant, and a
// rejection wording that exists on one surface but not the other is exactly the
// drift that leaves someone finding out by silence. One definition, both doors.
//
// Three actions rather than two: "Start review" acknowledges a claim without
// committing to an outcome, which matters when finding the member takes days.
// Approve and reject are terminal — the RPC refuses to re-decide.

import { productName } from '../../utils/policies';

/** @type {Object<'in_review'|'approved'|'rejected', {title: string, cta: string, toast: string, body: (claim: object) => string}>} */
export const REVIEW_LABEL = Object.freeze({
  in_review: {
    title: 'Start reviewing',
    cta: 'Start review',
    toast: 'moved to in review',
    body: (c) => `Marks ${c.reference} as being looked at. ${c.claimantName} is not told anything yet — call them on ${c.claimantPhone} when you have something to say.`,
  },
  approved: {
    title: 'Approve',
    cta: 'Approve claim',
    toast: 'approved',
    body: (c) => `Confirms the claim on ${c.deceasedName}'s ${productName(c.product).toLowerCase()} is valid. This is final — it cannot be changed from here. Match it to a member ID so the payout can be traced back to their record.`,
  },
  rejected: {
    title: 'Reject',
    cta: 'Reject claim',
    toast: 'rejected',
    body: (c) => `Declines the claim on ${c.deceasedName}. This is final. Leave a note saying why, and call ${c.claimantName} on ${c.claimantPhone} — a rejection they only find out about later is the worst version of this.`,
  },
});
