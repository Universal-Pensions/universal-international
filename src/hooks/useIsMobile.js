import { useSyncExternalStore } from 'react';

// Threshold narrowed 768 -> 767 by A18-002 (2026-08-25), paired with
// useIsDesktop.js's 1024 -> 768. Keeping this at 768 would have made 768px
// exactly (the classic non-Pro iPad portrait CSS width) match BOTH this hook
// and the lowered useIsDesktop() simultaneously. Today that collision is
// harmless everywhere it's reachable (see the evidence file), but it is a
// latent trap for the next consumer of both hooks, so the boundary is closed
// instead: this hook now owns [0, 767px], useIsDesktop() owns [768px, inf) —
// adjacent, no gap, no overlap.
// Full method + evidence: docs/audits/2026-08-23/a18/breakpoint-decision.md.
const MQ = '(max-width: 767px)';

function subscribeMQ(cb) {
  const mql = window.matchMedia(MQ);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
}

function getIsMobile() {
  return window.matchMedia(MQ).matches;
}

export function useIsMobile() {
  return useSyncExternalStore(subscribeMQ, getIsMobile);
}
