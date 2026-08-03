// Reminder ("nudge") channels for employer pending-KYC invites.
//
// An employer picks one or more channels per send; each channel needs a
// particular contact detail on the invite's `prefill`, and an invite that is
// missing it simply can't be reached that way. `field` is what the reachability
// check reads — see `isReachableBy` below, which the UI uses to show per-channel
// counts and to warn about anyone the chosen channels would miss entirely.
//
// DEMO SCOPE (CLAUDE.md §10a): there is no email/SMS/WhatsApp provider behind
// this. `sendInviteNudges` in services/employer.js is a mock with realistic
// latency, matching the KYC mocks. Nothing is actually delivered.

export const NUDGE_CHANNELS = [
  {
    id: 'email',
    label: 'Email',
    // Prefill key that must be present for this channel to reach someone.
    field: 'email',
    // Shown when an invite can't be reached on this channel.
    missingLabel: 'no email on file',
    helper: 'A reminder with their sign-up link.',
  },
  {
    id: 'sms',
    label: 'SMS',
    field: 'phone',
    missingLabel: 'no phone on file',
    helper: 'A short text with their sign-up link.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    field: 'phone',
    missingLabel: 'no phone on file',
    helper: 'A WhatsApp message with their sign-up link.',
  },
];

export const NUDGE_CHANNEL_BY_ID = Object.fromEntries(
  NUDGE_CHANNELS.map((c) => [c.id, c]),
);

/** Channels selected by default — the two an employer almost always has. */
export const DEFAULT_NUDGE_CHANNELS = ['sms', 'email'];

/**
 * Can this invite be reached on this channel? Reads the contact detail the
 * channel needs off `invite.prefill`.
 * @param {{prefill?: object}} invite
 * @param {string} channelId
 */
export function isReachableBy(invite, channelId) {
  const channel = NUDGE_CHANNEL_BY_ID[channelId];
  if (!channel) return false;
  return Boolean(String(invite?.prefill?.[channel.field] ?? '').trim());
}

/** The subset of `channelIds` that can actually reach this invite. */
export function reachableChannels(invite, channelIds = []) {
  return channelIds.filter((id) => isReachableBy(invite, id));
}

// Mocked send latency (ms) so the sending state is visible in a demo — the
// same deliberate-latency treatment the KYC mocks use.
export const NUDGE_LATENCY_MS = 900;
